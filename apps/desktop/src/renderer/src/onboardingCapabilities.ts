import type { PluginInventory, PluginInventoryItem } from "@exo/core";
export interface OnboardingCapabilitySection {
  id: string;
  label: string;
  rows: PluginInventoryItem[];
}

const SECTION_ORDER = [
  ["core:searchProvider", "Search providers"],
  ["core:agentHarness", "Agent harnesses"],
] as const;

export function buildOnboardingCapabilitySections(inventory: PluginInventory | null): OnboardingCapabilitySection[] {
  const setupCategoryIds = new Set<string>(SECTION_ORDER.map(([id]) => id));
  const items = (inventory?.items ?? []).filter((item) => item.source !== "core" && setupCategoryIds.has(item.categoryId) && shouldShowOnboardingCapability(item));
  const sections: OnboardingCapabilitySection[] = SECTION_ORDER.map(([id, label]) => ({
    id,
    label,
    rows: sortCapabilityRows(items.filter((item) => item.categoryId === id)),
  }));
  return sections.filter((section) => section.rows.length > 0);
}

function shouldShowOnboardingCapability(item: PluginInventoryItem): boolean {
  if (item.kind === "core:agentHarness") {
    return item.status === "available" || item.status === "configured";
  }
  return true;
}

export function onboardingCapabilityStatus(item: PluginInventoryItem): string {
  if (item.source === "core") {
    return "Core, locked";
  }
  if (item.trust === "untrusted") {
    return `${item.distributionLabel}, review needed`;
  }
  if (!item.enabled) {
    return `${item.distributionLabel}, disabled`;
  }
  if (item.statusLabel) {
    return `${item.distributionLabel}, ${item.statusLabel.toLowerCase()}`;
  }
  return item.distributionLabel;
}

export function onboardingCapabilitySelected(item: PluginInventoryItem): boolean {
  if (!item.enabled || item.trust === "untrusted") {
    return false;
  }
  if (item.kind === "core:agentHarness") {
    return item.status === "available" || item.status === "configured";
  }
  return item.status !== "missing-dependency" && item.status !== "not-found" && item.status !== "broken";
}

export function onboardingCapabilitySelectable(item: PluginInventoryItem): boolean {
  if (item.trust === "untrusted" || item.status === "unsupported-kind") {
    return false;
  }
  if (item.kind === "core:searchProvider" && item.id === "qmd" && item.source === "bundled") {
    return item.status !== "missing-dependency" && item.status !== "not-found" && item.status !== "broken";
  }
  if (item.kind === "core:agentHarness") {
    return onboardingCapabilitySelected(item);
  }
  return item.source === "localManifest" && Boolean(item.pluginId && item.manifestPath && item.rootDirectory);
}

export function onboardingCapabilityTone(item: PluginInventoryItem): "locked" | "ready" | "warning" | "disabled" {
  if (item.source === "core") {
    return "locked";
  }
  if (item.trust === "untrusted" || item.status.includes("missing") || item.status.includes("not-found")) {
    return "warning";
  }
  if (!item.enabled) {
    return "disabled";
  }
  return "ready";
}

function sortCapabilityRows(items: PluginInventoryItem[]): PluginInventoryItem[] {
  return [...items].sort((a, b) => `${sourceSort(a.source)}:${a.label}`.localeCompare(`${sourceSort(b.source)}:${b.label}`));
}

function sourceSort(source: PluginInventoryItem["source"]): number {
  switch (source) {
    case "core":
      return 0;
    case "bundled":
      return 1;
    case "localManifest":
      return 2;
  }
}
