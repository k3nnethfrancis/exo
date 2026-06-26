import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolvePluginLocations } from "../plugin-locations";

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
      { path: path.join("/app/resources", "plugins"), source: "built-in", trust: "trusted", enabled: true, kind: "resources" },
      { path: path.join("/repo/exo", "plugins"), source: "built-in", trust: "trusted", enabled: true, kind: "source" },
      { path: "/dev/a", source: "dev", trust: "trusted", enabled: true, kind: "dev-env" },
      { path: "/dev/b", source: "dev", trust: "trusted", enabled: true, kind: "dev-env" },
      { path: "/operator/plugins", source: "dev", trust: "trusted", enabled: true, kind: "operator-env" },
      { path: path.join("/user-data", "plugins"), source: "user", trust: "untrusted", enabled: true, kind: "user" },
      { path: path.join("/workspace", ".exo", "plugins"), source: "workspace", trust: "untrusted", enabled: true, kind: "workspace" },
    ]);
  });

  it("keeps user and workspace plugin roots untrusted by default", () => {
    expect(resolvePluginLocations({ workspaceRoot: "/workspace", env: {} })).toEqual([
      { path: path.join("/workspace", ".exo", "plugins"), source: "workspace", trust: "untrusted", enabled: true, kind: "workspace" },
    ]);
  });
});
