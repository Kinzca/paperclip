import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Boundary for local capture manifests. Never executes manifest-supplied code. */
export function prepareCapture(manifest, manifestPath) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.schema !== 1 ||
    typeof manifest.revision !== "string" || !manifest.revision.trim() || manifest.revision.length > 150 ||
    !["scripted_runtime", "manual_runtime"].includes(manifest.execution) ||
    !Number.isInteger(manifest.width) || !Number.isInteger(manifest.height) ||
    manifest.width < 64 || manifest.height < 64 || manifest.width > 4096 || manifest.height > 4096 ||
    manifest.width % 2 || manifest.height % 2 || typeof manifest.sourceRoot !== "string" ||
    !Array.isArray(manifest.frames) || !manifest.frames.length || manifest.frames.length > 100000 ||
    !Number.isFinite(manifest.endWallSeconds)) throw new Error("Invalid capture manifest");
  const root = fs.realpathSync(path.resolve(path.dirname(manifestPath), manifest.sourceRoot));
  let previous = -Infinity;
  const frames = manifest.frames.map(frame => {
    if (!frame || typeof frame.path !== "string" || path.isAbsolute(frame.path) ||
      !Number.isFinite(frame.wallSeconds) || frame.wallSeconds < 0 || frame.wallSeconds <= previous)
      throw new Error("Frames require contained paths and strictly increasing live wall clocks");
    const absolute = fs.realpathSync(path.resolve(root, frame.path));
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      !fs.statSync(absolute).isFile() || fs.statSync(absolute).size === 0) throw new Error("Frame is empty or outside sourceRoot");
    previous = frame.wallSeconds;
    return { path: absolute, seconds: frame.wallSeconds - manifest.frames[0].wallSeconds,
      sha256: createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
  });
  if (manifest.endWallSeconds <= previous) throw new Error("Capture must be finished after the last frame");
  return { revision: manifest.revision, execution: manifest.execution, width: manifest.width, height: manifest.height,
    duration: manifest.endWallSeconds - manifest.frames[0].wallSeconds, frames };
}

export function encodeCapture(manifestPath, output) {
  if (process.platform !== "darwin") throw new Error("Native media encoding requires macOS AVFoundation; no live or QA claim can be made on this platform");
  manifestPath = path.resolve(manifestPath);
  output = path.resolve(output);
  if (!output.endsWith(".mp4")) throw new Error("Output must end in .mp4");
  for (const suffix of ["", ".verification.json", ".first.png"]) {
    if (fs.existsSync(output + suffix)) throw new Error("Output exists; preserve it and select a new output path");
  }
  const input = prepareCapture(JSON.parse(fs.readFileSync(manifestPath, "utf8")), manifestPath);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-media-"));
  try {
    const prepared = path.join(temporary, "input.json");
    fs.writeFileSync(prepared, JSON.stringify(input), { flag: "wx", mode: 0o600 });
    const cache = path.join(os.tmpdir(), "paperclip-swift-module-cache");
    const result = spawnSync("/usr/bin/swift", ["-module-cache-path", cache,
      fileURLToPath(new URL("./media.swift", import.meta.url)), prepared, output], {
      encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024,
      env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Native encoding/verification failed: ${result.stderr.slice(-4000)}`);
    for (const frame of input.frames) {
      if (createHash("sha256").update(fs.readFileSync(frame.path)).digest("hex") !== frame.sha256)
        throw new Error("A source frame changed during encoding; preserve the failed candidate and recapture a frozen input");
    }
    const report = JSON.parse(fs.readFileSync(output + ".verification.json", "utf8"));
    const bytes = fs.readFileSync(output);
    if (!bytes.length || report.decodedFrames !== input.frames.length || report.maxPtsErrorSeconds > .001)
      throw new Error("Media verification did not match the complete capture");
    const verification = { revision: input.revision, execution: input.execution, viewing: "not_assessed",
      media: { ...report, sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length } };
    fs.writeFileSync(output + ".verification.json", JSON.stringify(verification, null, 2) + "\n");
    return verification;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error("Usage: node scripts/local/media.mjs <capture.json> <new-output.mp4>");
  console.log(JSON.stringify(encodeCapture(process.argv[2], process.argv[3]), null, 2));
}
