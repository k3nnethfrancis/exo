import type { CapabilityMetadata, CapabilitySurface } from "./capabilities";

export interface SurfaceContributionPolicy {
  surface: CapabilitySurface;
  audience: "human" | "agent" | "internal";
  defaultExposure: "allowed" | "review" | "hidden";
}

export const defaultSurfaceContributionPolicies: SurfaceContributionPolicy[] = [
  { surface: "desktop", audience: "human", defaultExposure: "review" },
  { surface: "cli", audience: "human", defaultExposure: "review" },
  { surface: "commandServer", audience: "internal", defaultExposure: "hidden" },
  { surface: "internal", audience: "internal", defaultExposure: "hidden" },
];

export function isCapabilityAvailableOnSurface(capability: CapabilityMetadata, surface: CapabilitySurface): boolean {
  // This is discoverability policy, not an authorization check. Runtime owners
  // still need to enforce permissions before launching agents, writing files, or exposing tools.
  return capability.lifecycle !== "disabled" && capability.surfaces.includes(surface);
}

export function getSurfaceContributionPolicy(surface: CapabilitySurface): SurfaceContributionPolicy {
  const policy = defaultSurfaceContributionPolicies.find((candidate) => candidate.surface === surface);
  if (!policy) {
    throw new Error(`Unknown capability surface: ${surface}`);
  }
  return policy;
}
