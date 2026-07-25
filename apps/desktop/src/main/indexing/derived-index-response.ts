import {
  graphTopologyPayloadBytes,
  type GraphTopology,
} from "@exo/core";

import type { DerivedIndexResponse } from "./derived-index-protocol";

export const MAX_DERIVED_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Measures the wire contract rather than JSON-expanding typed arrays into
 * numeric-keyed objects. Structured-clone framing is runtime-owned; Exo counts
 * its UTF-8 metadata and every typed-buffer byte exactly.
 */
export function derivedIndexResponseBytes(response: DerivedIndexResponse): number {
  if (response.ok && isGraphTopology(response.result)) {
    const envelopeBytes = Buffer.byteLength(JSON.stringify({ id: response.id, ok: true, result: null }), "utf8");
    return graphTopologyPayloadBytes(response.result) + envelopeBytes - Buffer.byteLength("null", "utf8");
  }
  return Buffer.byteLength(JSON.stringify(response), "utf8");
}

export function isGraphTopology(value: unknown): value is GraphTopology {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GraphTopology>;
  return candidate.version === "0.1"
    && Number.isSafeInteger(candidate.nodeCount)
    && Number.isSafeInteger(candidate.edgeCount)
    && candidate.nodes?.identityKeys instanceof Uint32Array
    && candidate.nodes?.seeds instanceof Uint32Array
    && candidate.nodes?.groups instanceof Uint32Array
    && candidate.nodes?.degrees instanceof Uint32Array
    && candidate.nodes?.visualClasses instanceof Uint8Array
    && candidate.edges?.endpoints instanceof Uint32Array
    && candidate.edges?.visualClasses instanceof Uint8Array;
}
