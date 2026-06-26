import type { PluginInventoryItem } from "@exo/core";

export interface PluginInventoryGroup {
  id: string;
  label: string;
  items: PluginInventoryItem[];
}

const SOURCE_ORDER: Record<PluginInventoryItem["source"], number> = {
  core: 0,
  bundled: 1,
  localManifest: 2,
};

export function groupPluginInventoryItems(items: PluginInventoryItem[]): PluginInventoryGroup[] {
  const groups = new Map<string, PluginInventoryGroup>();
  for (const item of items) {
    const group = groups.get(item.categoryId) ?? {
      id: item.categoryId,
      label: item.categoryLabel,
      items: [],
    };
    group.items.push(item);
    groups.set(item.categoryId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(compareInventoryItems),
    }))
    .sort((a, b) => `${categorySort(a.id)}:${a.label}`.localeCompare(`${categorySort(b.id)}:${b.label}`));
}

function compareInventoryItems(a: PluginInventoryItem, b: PluginInventoryItem): number {
  return `${SOURCE_ORDER[a.source]}:${a.label}`.localeCompare(`${SOURCE_ORDER[b.source]}:${b.label}`);
}

function categorySort(categoryId: string): number {
  switch (categoryId) {
    case "core":
      return 0;
    case "searchProvider":
      return 1;
    case "agentHarness":
      return 2;
    case "routineTemplate":
      return 3;
    default:
      return 10;
  }
}
