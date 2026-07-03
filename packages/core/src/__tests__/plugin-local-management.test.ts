import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  addLocalPlugin,
  removeLocalPlugin,
  replaceLocalPlugin,
} from "../plugin-local-management";
import { EXO_PLUGIN_MANIFEST_FILE } from "../plugin";

describe("local plugin management", () => {
  it("adds a valid plugin into the workspace plugin root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const source = await writePlugin(path.join(root, "source"), "example.profile");

      const result = await addLocalPlugin({
        workspaceRoot: root,
        sourceDirectory: source,
        target: "workspace",
      });

      expect(result).toMatchObject({
        pluginId: "example.profile",
        source: "workspace",
      });
      expect(result.rootDirectory).toBe(path.join(root, ".exo", "plugins", "example-profile"));
      await expect(readFile(result.manifestPath, "utf8")).resolves.toContain("\"id\": \"example.profile\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds a valid plugin into the user plugin root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const source = await writePlugin(path.join(root, "source"), "user.profile");

      const result = await addLocalPlugin({
        workspaceRoot: path.join(root, "workspace"),
        sourceDirectory: source,
        target: "user",
        env: { EXO_USER_DATA_PATH: path.join(root, "user-data") },
      });

      expect(result).toMatchObject({
        pluginId: "user.profile",
        source: "user",
        rootDirectory: path.join(root, "user-data", "plugins", "user-profile"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects directories without a valid plugin manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const source = path.join(root, "source");
      await mkdir(source, { recursive: true });

      await expect(addLocalPlugin({
        workspaceRoot: root,
        sourceDirectory: source,
        target: "workspace",
      })).rejects.toThrow("must contain exo.plugin.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes only managed local plugin copies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const source = await writePlugin(path.join(root, "source"), "remove.profile");
      const installed = await addLocalPlugin({ workspaceRoot: root, sourceDirectory: source, target: "workspace" });

      await removeLocalPlugin({
        workspaceRoot: root,
        plugin: {
          pluginId: installed.pluginId,
          source: "workspace",
          manifestPath: installed.manifestPath,
          rootDirectory: installed.rootDirectory,
        },
      });

      await expect(stat(installed.rootDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects remove requests outside managed local roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const external = await writePlugin(path.join(root, "external"), "external.profile");

      await expect(removeLocalPlugin({
        workspaceRoot: root,
        plugin: {
          pluginId: "external.profile",
          source: "workspace",
          manifestPath: path.join(external, EXO_PLUGIN_MANIFEST_FILE),
          rootDirectory: external,
        },
      })).rejects.toThrow("outside the managed local plugin root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaces a managed plugin only after validating the new manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const source = await writePlugin(path.join(root, "source"), "swap.profile", "Original");
      const installed = await addLocalPlugin({ workspaceRoot: root, sourceDirectory: source, target: "workspace" });
      const replacement = await writePlugin(path.join(root, "replacement"), "swap.profile", "Replacement");

      const result = await replaceLocalPlugin({
        workspaceRoot: root,
        sourceDirectory: replacement,
        target: "workspace",
        existing: {
          pluginId: installed.pluginId,
          source: "workspace",
          manifestPath: installed.manifestPath,
          rootDirectory: installed.rootDirectory,
        },
      });

      expect(result.rootDirectory).toBe(installed.rootDirectory);
      await expect(readFile(installed.manifestPath, "utf8")).resolves.toContain("\"name\": \"Replacement\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the existing plugin intact when replacement validation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-local-plugin-"));
    try {
      const source = await writePlugin(path.join(root, "source"), "swap.profile", "Original");
      const installed = await addLocalPlugin({ workspaceRoot: root, sourceDirectory: source, target: "workspace" });
      const replacement = await writePlugin(path.join(root, "replacement"), "other.profile", "Replacement");

      await expect(replaceLocalPlugin({
        workspaceRoot: root,
        sourceDirectory: replacement,
        target: "workspace",
        existing: {
          pluginId: installed.pluginId,
          source: "workspace",
          manifestPath: installed.manifestPath,
          rootDirectory: installed.rootDirectory,
        },
      })).rejects.toThrow("Replacement manifest id must match swap.profile");

      await expect(readFile(installed.manifestPath, "utf8")).resolves.toContain("\"name\": \"Original\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writePlugin(root: string, pluginId: string, name = "Example Profile"): Promise<string> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, EXO_PLUGIN_MANIFEST_FILE), JSON.stringify({
    id: pluginId,
    name,
    version: "0.1.0",
    exoApiVersion: "0.1",
    capabilities: [
      {
        id: `${pluginId}.capability`,
        kind: "core:profile",
        label: name,
        description: "Profile capability.",
        lifecycle: "experimental",
        owner: pluginId,
        surfaces: ["desktop"],
        permissions: ["workspace:read"],
      },
    ],
    permissions: ["workspace:read"],
    surfaces: ["desktop"],
  }, null, 2), "utf8");
  return root;
}
