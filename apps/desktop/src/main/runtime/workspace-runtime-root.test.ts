import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  WORKSPACE_RUNTIME_DIRECTORY,
  migrateLegacyWorkspaceRuntime,
  runtimeRootForWorkspace,
} from "./workspace-runtime-root";

describe("workspace runtime root", () => {
  it("uses .exograph for every default runtime root", () => {
    expect(runtimeRootForWorkspace("/workspace", {})).toBe(`/workspace/${WORKSPACE_RUNTIME_DIRECTORY}`);
  });

  it("atomically upgrades a legacy .stem directory before services use it", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exograph-runtime-"));
    const legacy = path.join(workspace, ".stem");
    await mkdir(legacy);
    await writeFile(path.join(legacy, "server.json"), "legacy", "utf8");

    await expect(migrateLegacyWorkspaceRuntime(workspace, {})).resolves.toEqual({
      status: "migrated",
      from: legacy,
      to: path.join(workspace, WORKSPACE_RUNTIME_DIRECTORY),
    });
    await expect(migrateLegacyWorkspaceRuntime(workspace, {})).resolves.toEqual({ status: "already-current" });
  });
});
