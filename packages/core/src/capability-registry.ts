import { builtInCapabilities, type CapabilityKind, type CapabilityLifecycle, type CapabilityMetadata, type CapabilitySurface } from "./capabilities";

export interface CapabilityFilter {
  kind?: CapabilityKind;
  lifecycle?: CapabilityLifecycle;
  surface?: CapabilitySurface;
  includeDisabled?: boolean;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityMetadata>();

  constructor(capabilities: CapabilityMetadata[] = []) {
    this.registerMany(capabilities);
  }

  register(capability: CapabilityMetadata): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability already registered: ${capability.id}`);
    }

    this.capabilities.set(capability.id, capability);
  }

  registerMany(capabilities: CapabilityMetadata[]): void {
    for (const capability of capabilities) {
      this.register(capability);
    }
  }

  get(id: string): CapabilityMetadata | undefined {
    return this.capabilities.get(id);
  }

  list(filter: CapabilityFilter = {}): CapabilityMetadata[] {
    return [...this.capabilities.values()].filter((capability) => matchesCapabilityFilter(capability, filter));
  }

  listActive(filter: Omit<CapabilityFilter, "includeDisabled"> = {}): CapabilityMetadata[] {
    return this.list({ ...filter, includeDisabled: false });
  }
}

function matchesCapabilityFilter(capability: CapabilityMetadata, filter: CapabilityFilter): boolean {
  if (!filter.includeDisabled && capability.lifecycle === "disabled") {
    return false;
  }

  if (filter.kind && capability.kind !== filter.kind) {
    return false;
  }

  if (filter.lifecycle && capability.lifecycle !== filter.lifecycle) {
    return false;
  }

  if (filter.surface && !capability.surfaces.includes(filter.surface)) {
    return false;
  }

  return true;
}

export function createBuiltInCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry(builtInCapabilities);
}

export const capabilityRegistry = createBuiltInCapabilityRegistry();
