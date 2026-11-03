import fs from "node:fs";
import path from "node:path";
import { localDir } from "./common.mjs";
import { current, json } from "./release-lib.mjs";
const state = current(localDir, false);
const dir = path.join(localDir, "releases");
const versions = fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((name) => /^[a-f0-9]{12,40}$/.test(name))
      .map((name) => {
        const m = json(path.join(dir, name, "release.json"));
        return {
          id: name,
          commit: m.commit,
          platform: m.platform,
          arch: m.arch,
          node: m.node,
          builtAt: m.builtAt,
          legacy: !!m.legacy,
          migrationCount: m.migrations.length,
          plugins: Object.fromEntries(
            Object.entries(m.plugins).map(([k, v]) => [k, v.version]),
          ),
        };
      })
  : [];
console.log(
  JSON.stringify(
    {
      localDir,
      current: state?.release ?? null,
      previous: state?.previous ?? null,
      checkpoint: state?.checkpoint ?? null,
      pluginsPendingSync: state?.pluginsPendingSync ?? false,
      pending: fs.existsSync(path.join(localDir, "pending-deployment.json")),
      versions,
    },
    null,
    2,
  ),
);
