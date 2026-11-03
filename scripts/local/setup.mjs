import fs from "node:fs";
import path from "node:path";
import { root, localDir, pnpm, env, port, run, runNode } from "./common.mjs";
import {
  assertClean,
  assertNode,
  assertStopped,
  lock,
  pins,
  sha,
  json,
  writeJson,
  copy,
  copyPlugin,
  pluginInfo,
  migrationLedger,
  current,
  files,
  git,
  verifyRelease,
  repairDarwinLibraries,
} from "./release-lib.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "用法：node scripts/local/setup.mjs [--prepare-only]\n构建当前干净提交的完整发布版本；首次空实例可选择该版本，已有实例请随后执行 upgrade.mjs --to <版本>。",
  );
  process.exit(0);
}
if (args.some((arg) => arg !== "--prepare-only"))
  throw new Error("仅支持 --prepare-only 或 --help。");
assertNode();
const commit = assertClean(root);
await assertStopped(port);
const unlock = lock(localDir);
const releaseId = commit.slice(0, 12);
const destination = path.join(localDir, "releases", releaseId);
const stage = path.join(localDir, "releases", `.building-${releaseId}`);
try {
  if (fs.existsSync(destination)) {
    verifyRelease(localDir, releaseId);
    console.log(
      `版本 ${releaseId} 已存在，保留不覆盖；请使用 status.mjs 查看或 upgrade.mjs 切换。`,
    );
    process.exitCode = 0;
  } else {
    if (fs.existsSync(stage))
      throw new Error(
        `存在未完成构建 ${stage}，请保留日志后移走此目录再重试。`,
      );
    fs.mkdirSync(stage, { recursive: true });
    const runtimeLock = sha(
      path.join(root, "scripts/local/runtime/package-lock.json"),
    );
    const kit = path.join(
      localDir,
      "dependency-kits",
      `${runtimeLock.slice(0, 12)}-${process.platform}-${process.arch}`,
    );
    const complete = path.join(kit, "complete.json");
    if (!fs.existsSync(complete)) {
      fs.mkdirSync(kit, { recursive: true });
      copy(path.join(root, "scripts/local/runtime"), kit);
      run("npm", ["ci", "--prefix", kit, "--no-audit", "--no-fund"]);
      runNode([
        path.join(root, "scripts/local/apply-runtime.mjs"),
        kit,
        "--dependencies-only",
      ]);
      repairDarwinLibraries(kit);
      writeJson(complete, {
        lock: runtimeLock,
        platform: process.platform,
        arch: process.arch,
      });
    }
    if (json(complete).lock !== runtimeLock)
      throw new Error("依赖缓存锁文件不匹配。");
    const runtime = path.join(stage, "runtime");
    copy(kit, runtime);
    const tools = path.join(localDir, "build-tools");
    if (
      !fs.existsSync(pnpm) ||
      json(path.join(tools, "node_modules/pnpm/package.json")).version !==
        pins.pnpm
    )
      run("npm", [
        "install",
        "--prefix",
        tools,
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        `pnpm@${pins.pnpm}`,
      ]);
    runNode([
      pnpm,
      "--filter",
      "@paperclipai/server...",
      "--filter",
      "@paperclipai/ui...",
      "--filter",
      "@paperclipai/plugin-llm-wiki...",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
    ]);
    // 锁定发布依赖提供 runner / 适配器声明与原生程序；当前 Fork 的宿主核心从源码重编译。
    function seedDeclarations(dir) {
      if (!fs.existsSync(dir)) return;
      const pkgFile = path.join(dir, "package.json");
      if (fs.existsSync(pkgFile)) {
        const pkg = json(pkgFile);
        const packaged = path.join(kit, "node_modules", pkg.name || "_missing");
        if (fs.existsSync(path.join(packaged, "dist"))) {
          fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
          copy(path.join(packaged, "dist"), path.join(dir, "dist"));
        }
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
        if (
          entry.isDirectory() &&
          ![
            "node_modules",
            "dist",
            ".git",
            "src",
            "target",
            "fixtures",
            "catalog",
          ].includes(entry.name)
        )
          seedDeclarations(path.join(dir, entry.name));
    }
    seedDeclarations(path.join(root, "packages"));
    const runner = path.join(
      kit,
      "node_modules/@paperclipai/server/dist/vendor/paperclip-runner",
    );
    fs.rmSync(path.join(root, "packages/paperclip-runner/dist"), {
      recursive: true,
      force: true,
    });
    copy(runner, path.join(root, "packages/paperclip-runner/dist"));
    const tsc = path.join(root, "node_modules/typescript/bin/tsc");
    for (const pkg of [
      "packages/shared",
      "packages/db",
      "packages/plugins/sdk",
      "server",
    ]) {
      fs.rmSync(path.join(root, pkg, "dist"), { recursive: true, force: true });
      runNode([tsc, "-p", path.join(root, pkg, "tsconfig.json")]);
    }
    runNode(["--import", "tsx", "src/check-migration-numbering.ts"], {
      cwd: path.join(root, "packages/db"),
    });
    runNode(["--import", "tsx", "src/check-migration-safety.ts"], {
      cwd: path.join(root, "packages/db"),
    });
    const dbMigrations = path.join(root, "packages/db/dist/migrations");
    fs.mkdirSync(path.join(dbMigrations, "meta"), { recursive: true });
    for (const name of fs.readdirSync(
      path.join(root, "packages/db/src/migrations"),
    ))
      if (name.endsWith(".sql"))
        fs.copyFileSync(
          path.join(root, "packages/db/src/migrations", name),
          path.join(dbMigrations, name),
        );
    fs.copyFileSync(
      path.join(root, "packages/db/src/migrations/meta/_journal.json"),
      path.join(dbMigrations, "meta/_journal.json"),
    );
    runNode([path.join(root, "server/scripts/write-build-stamp.mjs")]);
    runNode([pnpm, "--filter", "@paperclipai/ui", "build"]);
    runNode([pnpm, "--filter", "@paperclipai/plugin-llm-wiki", "build"]);
    for (const [source, name] of [
      ["packages/shared", "shared"],
      ["packages/db", "db"],
      ["packages/plugins/sdk", "plugin-sdk"],
      ["server", "server"],
    ]) {
      const target = path.join(
        runtime,
        "node_modules/@paperclipai",
        name,
        "dist",
      );
      fs.rmSync(target, { recursive: true, force: true });
      copy(path.join(root, source, "dist"), target);
    }
    const server = path.join(runtime, "node_modules/@paperclipai/server");
    // 必须替换源码开发 shim，不能让发布服务引用另一个工作区。
    fs.rmSync(path.join(server, "dist/vendor"), {
      recursive: true,
      force: true,
    });
    copy(
      path.join(kit, "node_modules/@paperclipai/server/dist/vendor"),
      path.join(server, "dist/vendor"),
    );
    for (const name of ["onboarding-assets", "built-ins", "services/scripts"])
      copy(
        path.join(root, "server/src", name),
        path.join(server, "dist", name),
      );
    copy(path.join(root, "skills"), path.join(server, "skills"));
    fs.rmSync(path.join(server, "ui-dist"), { recursive: true, force: true });
    copy(path.join(root, "ui/dist"), path.join(server, "ui-dist"));
    const office = path.join(
      localDir,
      "build-sources",
      `office-${pins.officeCommit.slice(0, 12)}`,
    );
    if (!fs.existsSync(office)) {
      fs.mkdirSync(path.dirname(office), { recursive: true });
      run("git", [
        "clone",
        "https://github.com/Kinzca/Agent-Pixels.git",
        office,
      ]);
      run("git", ["checkout", "--detach", pins.officeCommit], { cwd: office });
    }
    if (assertClean(office) !== pins.officeCommit)
      throw new Error("Office 构建源码与固定提交不符。");
    runNode(
      [
        pnpm,
        "install",
        "--ignore-workspace",
        "--frozen-lockfile",
        "--ignore-scripts",
      ],
      { cwd: office },
    );
    run("npm", ["run", "build"], {
      cwd: office,
      env: {
        ...env,
        PAPERCLIP_SDK_DIST: path.join(root, "packages/plugins/sdk/dist"),
      },
    });
    copyPlugin(office, path.join(stage, "plugins/office"));
    copyPlugin(
      path.join(root, "packages/plugins/plugin-llm-wiki"),
      path.join(stage, "plugins/wiki"),
    );
    if (assertClean(root) !== commit)
      throw new Error("构建期间源码发生变化，拒绝发布。");
    const artifacts = {};
    for (const relative of [
      "runtime/node_modules/@paperclipai/server/dist",
      "runtime/node_modules/@paperclipai/server/ui-dist",
      "runtime/node_modules/@paperclipai/shared/dist",
      "runtime/node_modules/@paperclipai/db/dist",
      "runtime/node_modules/@paperclipai/plugin-sdk/dist",
      "plugins/office",
      "plugins/wiki",
    ])
      artifacts[relative] = files(path.join(stage, relative));
    const manifest = {
      schema: 1,
      commit,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      pins,
      runtimeLock,
      workspaceLock: sha(path.join(root, "pnpm-lock.yaml")),
      builtAt: new Date().toISOString(),
      sourceComponents: ["server", "db", "shared", "plugin-sdk", "ui", "wiki"],
      dependencyComponents: [
        "published runner and native binaries",
        "published adapters",
        "published CLI and external dependencies",
      ],
      migrations: migrationLedger(runtime),
      plugins: Object.fromEntries(
        ["office", "wiki"].map((name) => [
          name,
          pluginInfo(path.join(stage, "plugins", name), name),
        ]),
      ),
      artifacts,
    };
    writeJson(path.join(stage, "release.json"), manifest);
    fs.renameSync(stage, destination);
    if (
      !current(localDir, false) &&
      !fs.existsSync(env.PAPERCLIP_CONFIG) &&
      !args.includes("--prepare-only")
    ) {
      const pluginPaths = Object.fromEntries(
        ["office", "wiki"].map((name) => [
          name,
          path.join(localDir, "plugins", name),
        ]),
      );
      for (const name of ["office", "wiki"]) {
        if (fs.existsSync(pluginPaths[name]))
          throw new Error(`插件目标已存在，保留现场：${pluginPaths[name]}`);
        copy(path.join(destination, "plugins", name), pluginPaths[name]);
      }
      writeJson(path.join(localDir, "current.json"), {
        schema: 1,
        release: releaseId,
        previous: null,
        pluginPaths,
        databaseLedger: manifest.migrations,
        firstStart: true,
      });
    }
    console.log(
      `已准备版本 ${releaseId}。新实例可登录并 start；已有实例执行 node scripts/local/upgrade.mjs --to ${releaseId}。尚未功能验收。`,
    );
  }
} finally {
  unlock();
}
