import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EXO_PLUGIN_MANIFEST_FILE,
  readPluginManifest,
  type DiscoveredPlugin,
  type PluginSource,
} from "./plugin";
import {
  resolveUserPluginRoot,
  resolveWorkspacePluginRoot,
} from "./plugin-locations";

export type LocalPluginInstallTarget = "user" | "workspace";

export interface LocalPluginIdentity {
  pluginId: string;
  source?: PluginSource;
  manifestPath: string;
  rootDirectory: string;
}

export interface AddLocalPluginOptions {
  workspaceRoot: string;
  sourceDirectory: string;
  target: LocalPluginInstallTarget;
  env?: Record<string, string | undefined>;
}

export interface ReplaceLocalPluginOptions extends AddLocalPluginOptions {
  existing: LocalPluginIdentity;
}

export interface RemoveLocalPluginOptions {
  workspaceRoot: string;
  plugin: LocalPluginIdentity;
  env?: Record<string, string | undefined>;
}

export interface LocalPluginManagementResult {
  pluginId: string;
  manifestPath: string;
  rootDirectory: string;
  source: "user" | "workspace";
}

export async function addLocalPlugin(options: AddLocalPluginOptions): Promise<LocalPluginManagementResult> {
  const sourceRoot = await requireValidPluginRoot(options.sourceDirectory);
  const manifest = await requirePluginManifest(sourceRoot);
  const destinationRoot = await uniquePluginDestination(managedRootForTarget(options), manifest.id);
  await copyPluginDirectory(sourceRoot, destinationRoot);
  return resultForDestination(destinationRoot, options.target, manifest.id);
}

export async function removeLocalPlugin(options: RemoveLocalPluginOptions): Promise<LocalPluginManagementResult> {
  const source = requireLocalPluginSource(options.plugin.source);
  const managedRoot = managedRootForTarget({ ...options, target: source });
  const pluginRoot = await requireManagedPluginRoot(options.plugin.rootDirectory, managedRoot);
  if (path.resolve(options.plugin.manifestPath) !== path.join(pluginRoot, EXO_PLUGIN_MANIFEST_FILE)) {
    throw new Error("Plugin manifest path must belong to the managed local plugin directory.");
  }
  const manifest = await requirePluginManifest(pluginRoot);
  if (manifest.id !== options.plugin.pluginId) {
    throw new Error(`Plugin id mismatch: expected ${options.plugin.pluginId}, found ${manifest.id}.`);
  }
  await rm(pluginRoot, { recursive: true, force: true });
  return resultForDestination(pluginRoot, source, manifest.id);
}

export async function replaceLocalPlugin(options: ReplaceLocalPluginOptions): Promise<LocalPluginManagementResult> {
  const source = requireLocalPluginSource(options.existing.source);
  if (source !== options.target) {
    throw new Error(`Plugin replacement target must match existing local source: ${source}.`);
  }

  const sourceRoot = await requireValidPluginRoot(options.sourceDirectory);
  const sourceManifest = await requirePluginManifest(sourceRoot);
  if (sourceManifest.id !== options.existing.pluginId) {
    throw new Error(`Replacement manifest id must match ${options.existing.pluginId}; found ${sourceManifest.id}.`);
  }

  const managedRoot = managedRootForTarget(options);
  const existingRoot = await requireManagedPluginRoot(options.existing.rootDirectory, managedRoot);
  if (path.resolve(options.existing.manifestPath) !== path.join(existingRoot, EXO_PLUGIN_MANIFEST_FILE)) {
    throw new Error("Plugin manifest path must belong to the managed local plugin directory.");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-replace-"));
  const replacementRoot = path.join(tempRoot, path.basename(existingRoot));
  const backupRoot = `${existingRoot}.old-${Date.now()}`;
  let movedExisting = false;
  try {
    await copyPluginDirectory(sourceRoot, replacementRoot);
    await requirePluginManifest(replacementRoot);
    await rename(existingRoot, backupRoot);
    movedExisting = true;
    await mkdir(path.dirname(existingRoot), { recursive: true });
    await rename(replacementRoot, existingRoot);
    movedExisting = false;
    await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (movedExisting) {
      await rm(existingRoot, { recursive: true, force: true }).catch(() => undefined);
      await rename(backupRoot, existingRoot).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  return resultForDestination(existingRoot, source, sourceManifest.id);
}

export function isManagedLocalPlugin(plugin: Pick<DiscoveredPlugin, "source" | "rootDirectory">, options: {
  workspaceRoot: string;
  env?: Record<string, string | undefined>;
}): boolean {
  if (plugin.source !== "user" && plugin.source !== "workspace") {
    return false;
  }
  const managedRoot = managedRootForTarget({ ...options, target: plugin.source });
  try {
    requireManagedPathSync(plugin.rootDirectory, managedRoot);
    return true;
  } catch {
    return false;
  }
}

async function requireValidPluginRoot(sourceDirectory: string): Promise<string> {
  const sourceRoot = path.resolve(sourceDirectory);
  const sourceStats = await stat(sourceRoot);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Local plugin source must be a directory: ${sourceDirectory}`);
  }
  await requirePluginManifest(sourceRoot);
  return sourceRoot;
}

async function requirePluginManifest(pluginRoot: string) {
  const manifestPath = path.join(pluginRoot, EXO_PLUGIN_MANIFEST_FILE);
  const manifest = await readPluginManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Local plugin directory must contain ${EXO_PLUGIN_MANIFEST_FILE}: ${pluginRoot}`);
  }
  return manifest;
}

async function uniquePluginDestination(managedRoot: string, pluginId: string): Promise<string> {
  await mkdir(managedRoot, { recursive: true });
  const baseName = pluginIdToDirectoryName(pluginId);
  const baseDestination = path.join(managedRoot, baseName);
  for (let index = 0; index < 100; index += 1) {
    const destination = index === 0 ? baseDestination : path.join(managedRoot, `${baseName}-${index + 1}`);
    try {
      await access(destination, fsConstants.F_OK);
    } catch {
      return destination;
    }
  }
  throw new Error(`Could not find an available local plugin directory for ${pluginId}.`);
}

async function copyPluginDirectory(sourceRoot: string, destinationRoot: string): Promise<void> {
  await mkdir(path.dirname(destinationRoot), { recursive: true });
  await cp(sourceRoot, destinationRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
}

async function requireManagedPluginRoot(rootDirectory: string, managedRoot: string): Promise<string> {
  const pluginRoot = path.resolve(rootDirectory);
  const parentRoot = await realpath(path.dirname(pluginRoot)).catch(() => path.resolve(path.dirname(pluginRoot)));
  const realManagedRoot = await realpath(managedRoot).catch(() => path.resolve(managedRoot));
  // Local management may delete or replace directories, so writes are constrained to
  // Exo-owned install roots instead of arbitrary manifest paths selected by metadata.
  if (parentRoot !== realManagedRoot) {
    throw new Error(`Plugin directory is outside the managed local plugin root: ${rootDirectory}`);
  }
  return pluginRoot;
}

function requireManagedPathSync(rootDirectory: string, managedRoot: string): void {
  const pluginRoot = path.resolve(rootDirectory);
  const expectedParent = path.resolve(managedRoot);
  if (path.dirname(pluginRoot) !== expectedParent) {
    throw new Error(`Plugin directory is outside the managed local plugin root: ${rootDirectory}`);
  }
}

function managedRootForTarget(options: {
  workspaceRoot: string;
  target: LocalPluginInstallTarget;
  env?: Record<string, string | undefined>;
}): string {
  if (options.target === "workspace") {
    return resolveWorkspacePluginRoot(options.workspaceRoot);
  }
  const userRoot = resolveUserPluginRoot(options.env ?? process.env);
  if (!userRoot) {
    throw new Error("User plugin installs require EXO_USER_DATA_PATH.");
  }
  return userRoot;
}

function requireLocalPluginSource(source: PluginSource | undefined): LocalPluginInstallTarget {
  if (source === "user" || source === "workspace") {
    return source;
  }
  throw new Error("Only managed user or workspace local plugins can be removed or replaced.");
}

function pluginIdToDirectoryName(pluginId: string): string {
  return pluginId.replace(/\./g, "-");
}

function resultForDestination(rootDirectory: string, source: LocalPluginInstallTarget, pluginId: string): LocalPluginManagementResult {
  return {
    pluginId,
    source,
    rootDirectory,
    manifestPath: path.join(rootDirectory, EXO_PLUGIN_MANIFEST_FILE),
  };
}
