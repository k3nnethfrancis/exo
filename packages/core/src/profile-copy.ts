import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ActiveProfileIdentity, ProfileStateStore } from "./profile-state";
import { markProfileReviewRequired, readProfileStateStore, setActiveProfile, writeProfileStateStore } from "./profile-state";
import { type CapabilityMetadata } from "./capabilities";
import { EXO_PLUGIN_MANIFEST_FILE, type DiscoveredPlugin, type PluginManifest } from "./plugin";
import { EXO_WORKSPACE_PLUGIN_DIRECTORY } from "./plugin-locations";
import { discoverManagedPlugins } from "./plugin-management";
import { hashPluginManifest, readPluginStateStore, upsertPluginStateRecord, writePluginStateStore } from "./plugin-state";

export interface CopyProfileOptions {
  workspaceRoot: string;
  runtimeRoot: string;
  sourceProfile: ActiveProfileIdentity;
  env?: Record<string, string | undefined>;
  now?: () => string;
}

export interface CopyProfileResult {
  identity: ActiveProfileIdentity;
  profileState: ProfileStateStore;
  manifestPath: string;
  rootDirectory: string;
}

export async function copyProfileToWorkspacePlugin(options: CopyProfileOptions): Promise<CopyProfileResult> {
  const plugins = await discoverManagedPlugins({
    workspaceRoot: options.workspaceRoot,
    env: options.env,
  });
  const source = findSourceProfile(plugins, options.sourceProfile);
  if (!source) {
    throw new Error(`Source profile not found: ${options.sourceProfile.capabilityId}`);
  }

  const baseSlug = slugifyProfileId(options.sourceProfile.profileId);
  const rootDirectory = await uniqueProfilePluginDirectory(options.workspaceRoot, baseSlug);
  const pluginId = `${path.basename(rootDirectory)}.plugin`;
  const capabilityId = `${path.basename(rootDirectory)}.profile`;
  const manifestPath = path.join(rootDirectory, EXO_PLUGIN_MANIFEST_FILE);
  const manifest = copiedProfileManifest(source.plugin, source.capability, {
    pluginId,
    capabilityId,
  });
  const rawManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestHash = hashPluginManifest(rawManifest);

  await mkdir(rootDirectory, { recursive: true });
  await writeFile(manifestPath, rawManifest, "utf8");

  const discoveredCopy: DiscoveredPlugin = {
    manifest,
    manifestPath,
    rootDirectory,
    source: "workspace",
    trust: "untrusted",
    enabled: true,
    manifestHash,
  };
  const now = options.now?.() ?? new Date().toISOString();
  const pluginStateStore = await readPluginStateStore(options.runtimeRoot);
  await writePluginStateStore(
    options.runtimeRoot,
    upsertPluginStateRecord(pluginStateStore, discoveredCopy, { trust: "trusted", enabled: true, reviewedAt: now }),
  );

  const identity: ActiveProfileIdentity = {
    profileId: capabilityId,
    capabilityId,
    pluginId,
    source: "workspace",
    manifestPath,
    rootDirectory,
    manifestHash,
  };
  const profileState = markProfileReviewRequired(
    setActiveProfile(await readProfileStateStore(options.runtimeRoot), identity, now),
    true,
    now,
  );
  await writeProfileStateStore(options.runtimeRoot, profileState);

  return { identity, profileState, manifestPath, rootDirectory };
}

function findSourceProfile(
  plugins: DiscoveredPlugin[],
  identity: ActiveProfileIdentity,
): { plugin: DiscoveredPlugin; capability: CapabilityMetadata } | null {
  for (const plugin of plugins) {
    if (identity.pluginId && plugin.manifest.id !== identity.pluginId) {
      continue;
    }
    if (identity.manifestPath && plugin.manifestPath !== identity.manifestPath) {
      continue;
    }
    if (identity.rootDirectory && plugin.rootDirectory !== identity.rootDirectory) {
      continue;
    }
    const capability = plugin.manifest.capabilities.find((candidate) => {
      const payload = candidate.compatibility?.profile;
      return candidate.kind === "core:profile"
        && (candidate.id === identity.capabilityId || (isRecord(payload) && payload.id === identity.profileId));
    });
    if (capability) {
      return { plugin, capability };
    }
  }
  return null;
}

function copiedProfileManifest(
  sourcePlugin: DiscoveredPlugin,
  sourceCapability: CapabilityMetadata,
  ids: { pluginId: string; capabilityId: string },
): PluginManifest {
  const profilePayload = isRecord(sourceCapability.compatibility?.profile)
    ? JSON.parse(JSON.stringify(sourceCapability.compatibility.profile))
    : {};
  const sourceLabel = typeof profilePayload.label === "string" ? profilePayload.label : sourceCapability.label;
  const sourceDescription = typeof profilePayload.description === "string" ? profilePayload.description : sourceCapability.description;

  return {
    id: ids.pluginId,
    name: `${sourceLabel} Copy`,
    version: "0.1.0",
    exoApiVersion: sourcePlugin.manifest.exoApiVersion,
    description: `Workspace-local editable copy of ${sourceLabel}.`,
    capabilities: [
      {
        ...sourceCapability,
        id: ids.capabilityId,
        label: `${sourceLabel} Copy`,
        description: sourceDescription,
        lifecycle: "experimental",
        owner: ids.pluginId,
        compatibility: {
          ...(sourceCapability.compatibility ?? {}),
          profile: {
            ...profilePayload,
            id: ids.capabilityId,
            label: `${sourceLabel} Copy`,
            description: sourceDescription,
          },
        },
      },
    ],
    permissions: sourcePlugin.manifest.permissions,
    surfaces: sourcePlugin.manifest.surfaces,
  };
}

async function uniqueProfilePluginDirectory(workspaceRoot: string, baseSlug: string): Promise<string> {
  const pluginsRoot = path.join(workspaceRoot, EXO_WORKSPACE_PLUGIN_DIRECTORY);
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = path.join(pluginsRoot, `${baseSlug}-copy${suffix}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error(`Unable to choose a local profile copy directory for ${baseSlug}.`);
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function slugifyProfileId(profileId: string): string {
  const slug = profileId.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "core:profile";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
