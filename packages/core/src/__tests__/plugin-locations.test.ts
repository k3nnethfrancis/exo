import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXO_PLUGIN_DIRECTORY_NAME,
  EXO_WORKSPACE_PLUGIN_DIRECTORY,
  resolvePluginLocations,
} from "../plugin-locations";

describe("plugin location resolver", () => {
  it("covers resources, source, dev, operator env, user, and workspace locations", () => {
    const locations = resolvePluginLocations({
      workspaceRoot: "/workspace",
      env: {
        EXO_RESOURCES_PATH: "/app/resources",
        EXO_PROJECT_ROOT: "/repo/exo",
        EXO_DEV_PLUGIN_DIRS: ["/dev/a", "/dev/b"].join(path.delimiter),
        EXO_PLUGIN_DIRS: "/operator/plugins",
        EXO_USER_DATA_PATH: "/user-data",
      },
    });

    expect(locations).toEqual([
      { path: path.join("/app/resources", EXO_PLUGIN_DIRECTORY_NAME), source: "built-in", trust: "trusted", enabled: true, kind: "resources", purpose: "bundled-install" },
      { path: path.join("/repo/exo", EXO_PLUGIN_DIRECTORY_NAME), source: "built-in", trust: "trusted", enabled: true, kind: "source", purpose: "bundled-install" },
      { path: "/dev/a", source: "dev", trust: "trusted", enabled: true, kind: "dev-env", purpose: "developer-load" },
      { path: "/dev/b", source: "dev", trust: "trusted", enabled: true, kind: "dev-env", purpose: "developer-load" },
      { path: "/operator/plugins", source: "dev", trust: "trusted", enabled: true, kind: "operator-env", purpose: "developer-load" },
      { path: path.join("/user-data", EXO_PLUGIN_DIRECTORY_NAME), source: "user", trust: "untrusted", enabled: true, kind: "user", purpose: "local-install" },
      { path: path.join("/workspace", EXO_WORKSPACE_PLUGIN_DIRECTORY), source: "workspace", trust: "untrusted", enabled: true, kind: "workspace", purpose: "local-install" },
    ]);
  });

  it("keeps user and workspace plugin roots untrusted by default", () => {
    expect(resolvePluginLocations({ workspaceRoot: "/workspace", env: {} })).toEqual([
      { path: path.join("/workspace", EXO_WORKSPACE_PLUGIN_DIRECTORY), source: "workspace", trust: "untrusted", enabled: true, kind: "workspace", purpose: "local-install" },
    ]);
  });
});
