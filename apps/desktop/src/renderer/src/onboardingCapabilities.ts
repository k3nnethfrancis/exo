import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { profileFromCapability } from "@exo/core/profile";
import { planProfilePreview, type ProfilePlanPreview } from "@exo/core/profile-plan";

export interface OnboardingCapabilitySection {
  id: string;
  label: string;
  rows: PluginInventoryItem[];
}

export interface OnboardingProfileReview {
  id: string;
  label: string;
  status: string;
  plan: ProfilePlanPreview | null;
  errorMessage?: string;
}

const SECTION_ORDER = [
  ["core", "Core"],
  ["core:searchProvider", "Search providers"],
  ["core:agentHarness", "Agent harness readiness"],
  ["core:profile", "Profiles"],
  ["core:routineTemplate", "Routine templates"],
] as const;

export function buildOnboardingCapabilitySections(inventory: PluginInventory | null): OnboardingCapabilitySection[] {
  const items = inventory?.items ?? [];
  const knownIds = new Set(SECTION_ORDER.map(([id]) => id));
  const sections: OnboardingCapabilitySection[] = SECTION_ORDER.map(([id, label]) => ({
    id,
    label,
    rows: sortCapabilityRows(items.filter((item) => item.categoryId === id)),
  }));
  const otherRows = sortCapabilityRows(items.filter((item) => item.source !== "core" && !knownIds.has(item.categoryId as (typeof SECTION_ORDER)[number][0])));
  if (otherRows.length > 0) {
    sections.push({ id: "other", label: "Other optional capabilities", rows: otherRows });
  }
  return sections.filter((section) => section.rows.length > 0);
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

export function buildOnboardingProfileReviews(inventory: PluginInventory | null): OnboardingProfileReview[] {
  if (!inventory) {
    return [];
  }
  return inventory.items
    .filter((item) => item.kind === "core:profile")
    .map((item) => profileReview(item, inventory))
    .sort((a, b) => a.label.localeCompare(b.label));
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

function profileReview(item: PluginInventoryItem, inventory: PluginInventory): OnboardingProfileReview {
  try {
    const profile = profileFromCapability({
      id: item.id,
      kind: "core:profile",
      label: item.label,
      description: item.description,
      lifecycle: item.lifecycle,
      owner: item.owner,
      surfaces: item.surfaces,
      permissions: item.permissions,
      compatibility: item.compatibility,
    });
    return {
      id: item.id,
      label: item.label,
      status: onboardingCapabilityStatus(item),
      plan: profile ? planProfilePreview(profile, inventory) : null,
    };
  } catch (error) {
    return {
      id: item.id,
      label: item.label,
      status: onboardingCapabilityStatus(item),
      plan: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
