import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listDirectoryEntries, readExplorerFile } from "./service.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("file explorer service", () => {
  it("lists directory entries even when a dangling symlink exists", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      await mkdir(path.join(root, "packages", "server"), { recursive: true });
      const serverDir = path.join(root, "packages", "server");
      await writeFile(path.join(serverDir, "README.md"), "# server\n", "utf-8");
      await symlink("CLAUDE.md", path.join(serverDir, "AGENTS.md"));

      const result = await listDirectoryEntries({
        root,
        relativePath: "packages/server",
      });

      expect(result.path).toBe("packages/server");
      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("README.md");
      expect(names).not.toContain("AGENTS.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects reading files through symlinks that escape the workspace root", async () => {
    const root = await createTempDir("paseo-file-explorer-root-");
    const outside = await createTempDir("paseo-file-explorer-outside-");

    try {
      const outsideFile = path.join(outside, "secret.txt");
      await writeFile(outsideFile, "top-secret", "utf-8");
      await symlink(outsideFile, path.join(root, "escape.txt"));

      await expect(
        readExplorerFile({
          root,
          relativePath: "escape.txt",
        })
      ).rejects.toThrow("Access outside of agent workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not expose escaping symlinks in directory listings", async () => {
    const root = await createTempDir("paseo-file-explorer-root-");
    const outside = await createTempDir("paseo-file-explorer-outside-");

    try {
      const outsideFile = path.join(outside, "secret.txt");
      await writeFile(outsideFile, "top-secret", "utf-8");
      await symlink(outsideFile, path.join(root, "escape.txt"));
      await writeFile(path.join(root, "inside.txt"), "ok", "utf-8");

      const result = await listDirectoryEntries({
        root,
        relativePath: ".",
      });

      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("inside.txt");
      expect(names).not.toContain("escape.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
