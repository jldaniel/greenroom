import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  installManagedPi,
  managedPiBinaryPath,
  managedPiRootDir,
  managedToolsDir,
  piNpmPackageName,
  piNpmPinnedVersion,
} from "./pi-install";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("managed pi install", () => {
  it("lays out the managed install under <dataDir>/tools/pi", () => {
    expect(managedToolsDir("/data")).toBe("/data/tools");
    expect(managedPiRootDir("/data/tools")).toBe("/data/tools/pi");
    expect(managedPiBinaryPath("/data/tools")).toBe("/data/tools/pi/node_modules/.bin/pi");
  });

  it("installs the pinned package with bun and verifies the binary version", async () => {
    const root = await tempDir();
    const toolsDir = join(root, "tools");
    // Fake bun: records its invocation and materializes the binary layout a
    // real `bun add` would produce, so the install flow runs without network.
    const fakeBun = await writeFakeBun(root, toolsDir, piNpmPinnedVersion);

    const logs: string[] = [];
    const result = await installManagedPi({
      toolsDir,
      bunPath: fakeBun,
      log: (line) => logs.push(line),
    });
    const recorded = await readFile(join(root, "bun-args.txt"), "utf8");
    const manifest = JSON.parse(
      await readFile(join(managedPiRootDir(toolsDir), "package.json"), "utf8"),
    ) as { name: string };

    expect(recorded.trim()).toBe(`add --exact ${piNpmPackageName}@${piNpmPinnedVersion}`);
    expect(result).toMatchObject({
      packageName: piNpmPackageName,
      pinnedVersion: piNpmPinnedVersion,
      rootDir: managedPiRootDir(toolsDir),
      binaryPath: managedPiBinaryPath(toolsDir),
      version: piNpmPinnedVersion,
    });
    expect(manifest.name).toBe("greenroom-managed-pi");
    expect(logs.join("\n")).toContain(piNpmPackageName);
  });

  it("fails when the installed binary reports an unexpected version", async () => {
    const root = await tempDir();
    const toolsDir = join(root, "tools");
    const fakeBun = await writeFakeBun(root, toolsDir, "0.0.1-wrong");

    await expect(installManagedPi({ toolsDir, bunPath: fakeBun })).rejects.toThrow(/expected 0\./u);
  });

  it("surfaces install command failures with stderr detail", async () => {
    const root = await tempDir();
    const toolsDir = join(root, "tools");
    const fakeBun = join(root, "bun");
    await writeFile(fakeBun, "#!/bin/sh\necho 'registry unreachable' >&2\nexit 1\n", "utf8");
    await chmod(fakeBun, 0o755);

    await expect(installManagedPi({ toolsDir, bunPath: fakeBun })).rejects.toThrow(
      /registry unreachable/u,
    );
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "greenroom-pi-install-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFakeBun(root: string, toolsDir: string, version: string): Promise<string> {
  const fakeBun = join(root, "bun");
  const binDir = join(managedPiRootDir(toolsDir), "node_modules", ".bin");
  const script = [
    "#!/bin/sh",
    `echo "$@" > ${shellQuote(join(root, "bun-args.txt"))}`,
    `mkdir -p ${shellQuote(binDir)}`,
    `printf '#!/bin/sh\\necho ${version}\\n' > ${shellQuote(join(binDir, "pi"))}`,
    `chmod +x ${shellQuote(join(binDir, "pi"))}`,
  ].join("\n");
  await writeFile(fakeBun, `${script}\n`, "utf8");
  await chmod(fakeBun, 0o755);
  return fakeBun;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
