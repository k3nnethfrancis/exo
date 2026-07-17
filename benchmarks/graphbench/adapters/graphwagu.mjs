import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const graphbenchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const prepared = existsSync(path.join(graphbenchRoot, '.cache', 'graphwagu', 'dist', 'index.html'));

export const graphwaguAdapter = Object.freeze({
  id: 'graphwagu',
  version: 'bee7b7b834d96a81cff7a1c8910c4a78b9d9c48b',
  available: prepared,
  contract: '__graphBenchGraphWaGu',
  surface: 'canvas',
  capabilities: { render: true, layout: false, product: false, dimensions: 2 },
  reason: prepared ? null : 'Pinned upstream build has not been prepared. Run npm run prepare:graphwagu before the full profile.',
  url(baseUrl) {
    return `${baseUrl}/GraphWaGu/index.html?topology=/__graphbench_fixture__.json`;
  },
});
