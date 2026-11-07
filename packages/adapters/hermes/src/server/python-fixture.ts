import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Exercise the real Python version probe without depending on the test host. */
export async function withPythonVersion(version: string, run: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "hermes-python-fixture-"));
  const previousPath = process.env.PATH;
  try {
    await writeFile(join(directory, "python3"), `#!/bin/sh\necho 'Python ${version}'\n`, { mode: 0o755 });
    process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
    await run();
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}
