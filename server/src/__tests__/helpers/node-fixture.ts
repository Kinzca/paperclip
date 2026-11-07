/** A synthetic executable independent of the probed environment's PATH. */
export function nodeFixtureScript(source: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const body = source.replace(/^#![^\r\n]*(?:\r?\n|$)/, "");
  return `#!/bin/sh\nexec ${quote(process.execPath)} -e ${quote(body)} "$0" "$@"\n`;
}
