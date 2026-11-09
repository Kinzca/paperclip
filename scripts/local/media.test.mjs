import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareCapture, encodeCapture } from "./media.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-capture-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "frames"));
  fs.writeFileSync(path.join(root, "frames", "one.jpg"), "frame bytes");
  return { root, manifest: { schema: 1, revision: "fixture-r1", execution: "scripted_runtime", width: 960, height: 540,
    sourceRoot: "frames", endWallSeconds: 6, frames: [{ path: "one.jpg", wallSeconds: 4 }, { path: "one.jpg", wallSeconds: 5 }] } };
}
test("retains live wall-clock gaps without accelerating simulation time", t => {
  const f = fixture(t);
  assert.deepEqual(prepareCapture(f.manifest, path.join(f.root, "capture.json")).frames.map(f => f.seconds), [0, 1]);
});
test("rejects partial clocks, empty files, escape paths and symlink escapes", t => {
  const f = fixture(t);
  const at = path.join(f.root, "capture.json");
  assert.throws(() => prepareCapture({ ...f.manifest, endWallSeconds: 5 }, at), /finished/);
  assert.throws(() => prepareCapture({ ...f.manifest, frames: [{ path: "one.jpg", wallSeconds: 4 }, { path: "one.jpg", wallSeconds: 4 }] }, at), /increasing/);
  fs.writeFileSync(path.join(f.root, "outside.jpg"), "outside");
  fs.symlinkSync(path.join(f.root, "outside.jpg"), path.join(f.root, "frames", "linked.jpg"));
  for (const file of ["../outside.jpg", "linked.jpg"]) {
    assert.throws(() => prepareCapture({ ...f.manifest, frames: [{ path: file, wallSeconds: 4 }] }, at), /outside/);
  }
  fs.writeFileSync(path.join(f.root, "frames", "one.jpg"), "");
  assert.throws(() => prepareCapture(f.manifest, at), /empty/);
});

test("native encoder fully decodes the frozen frames at their original presentation times", { skip: process.platform !== "darwin", timeout: 180000 }, t => {
  const f = fixture(t);
  const source = path.join(f.root, "fixture.swift");
  fs.writeFileSync(source, `import AppKit
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 960, pixelsHigh: 540, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.systemBlue.setFill()
NSRect(x: 0, y: 0, width: 960, height: 540).fill()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
`);
  const generated = spawnSync("/usr/bin/swift", ["-module-cache-path", path.join(os.tmpdir(), "paperclip-swift-module-cache"),
    source, path.join(f.root, "frames", "one.jpg")], { encoding: "utf8", timeout: 90000 });
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = path.join(f.root, "capture.json");
  fs.writeFileSync(manifest, JSON.stringify(f.manifest));
  const output = path.join(f.root, "candidate.mp4");
  const report = encodeCapture(manifest, output);
  assert.equal(report.media.decodedFrames, 2);
  assert.ok(report.media.maxPtsErrorSeconds <= .001);
  assert.equal(report.viewing, "not_assessed");
  assert.ok(report.media.candidateLabel.includes("fixture-r1"));
  assert.ok(fs.statSync(output + ".first.png").size > 0);
  assert.throws(() => encodeCapture(manifest, output), /exists/);
});
