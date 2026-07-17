import assert from 'node:assert/strict';
import { aggregateResults, resolveRepetitions } from './lib/aggregate.mjs';
import { createFixture } from './lib/fixture.mjs';
import { computeLayoutQuality } from './lib/quality.mjs';
import { frameReport, summarize } from './lib/metrics.mjs';
import { parseMatrixMarketLines } from './lib/suitesparse.mjs';
import {
  STELLAR_PRESENTATION_PROFILES,
  StellarScene,
  presentationProfileHash,
  resolveNodeBaseRadius,
  resolveNodeScreenRadius,
  resolvePresentationProfile,
  resolvePresentationZoom,
} from './public/exo/stellar-scene.js';

const fixture = createFixture({ nodes: 100, edgeRatio: 3, seed: 'test' });
assert.equal(fixture.nodes.length, 100);
assert.equal(fixture.edges.length, 300);
assert.equal(fixture.edgeRatio, 3);
assert.equal(fixture.meanDegree, 6);
assert(fixture.nodes.every((node) => [node.x, node.y, node.z].every(Number.isFinite)));

const edgeKeys = new Set();
for (const edge of fixture.edges) {
  assert.notEqual(edge.source, edge.target);
  const key = edge.source < edge.target ? `${edge.source}:${edge.target}` : `${edge.target}:${edge.source}`;
  assert(!edgeKeys.has(key), `duplicate edge ${key}`);
  edgeKeys.add(key);
}

const repeated = createFixture({ nodes: 100, edgeRatio: 3, seed: 'test' });
const changed = createFixture({ nodes: 100, edgeRatio: 3, seed: 'different' });
assert.equal(repeated.checksum, fixture.checksum);
assert.notEqual(changed.checksum, fixture.checksum);

const positions = Float32Array.from(fixture.nodes.flatMap(({ x, y, z }) => [x, y, z]));
const quality = computeLayoutQuality({ fixture, positions, dimensions: 3, sampleSize: 32 });
assert(Number.isFinite(quality.edgeUniformity));
assert(Number.isFinite(quality.neighborhoodPreservation));
assert(Number.isFinite(quality.sampledStress));
assert.equal(quality.sampleSize, 32);

assert.deepEqual(summarize([]), { count: 0, p50: null, p95: null, p99: null, max: null, mean: null });
const timing = frameReport([10, 12, 14, 20]);
assert.equal(timing.count, 4);
assert.equal(timing.overBudget, 1);
assert.equal(timing.over2xBudget, 0);
assert(timing.p95 > timing.p50);

assert.equal(resolveRepetitions(null, 3), 3);
assert.equal(resolveRepetitions('5', 1), 5);
assert.throws(() => resolveRepetitions('0', 1), /1 to 20/);
const aggregates = aggregateResults([
  { engine: 'exo', engineVersion: '1', track: 'render', fixture: { checksum: 'a' }, status: 'measured', measurements: { frame: { p95: 2 } } },
  { engine: 'exo', engineVersion: '1', track: 'render', fixture: { checksum: 'a' }, status: 'measured', measurements: { frame: { p95: 4 } } },
  { engine: 'exo', engineVersion: '1', track: 'render', fixture: { checksum: 'a' }, status: 'failed' },
]);
assert.equal(aggregates.length, 1);
assert.equal(aggregates[0].attempted, 3);
assert.equal(aggregates[0].measured, 2);
assert.equal(aggregates[0].failed, 1);
assert.equal(aggregates[0].distribution.p50, 3);
const resilienceAggregate = aggregateResults([
  { engine: 'exo', engineVersion: '1', track: 'resilience', fixture: { checksum: 'r' }, status: 'measured', measurements: { recoveryMs: 12 } },
  { engine: 'exo', engineVersion: '1', track: 'resilience', fixture: { checksum: 'r' }, status: 'measured', measurements: { recoveryMs: 18 } },
])[0];
assert.equal(resilienceAggregate.primaryMetric, 'recovery-ms');
assert.equal(resilienceAggregate.distribution.p50, 15);
const incrementalAggregate = aggregateResults([
  { engine: 'exo', engineVersion: '1', track: 'incremental', fixture: { checksum: 'i' }, status: 'measured', measurements: { settledMs: 24 } },
])[0];
assert.equal(incrementalAggregate.primaryMetric, 'incremental-settled-ms');
assert.equal(incrementalAggregate.distribution.p50, 24);

assert.equal(resolvePresentationProfile('missing').id, 'explore-v1');
assert.equal(presentationProfileHash('benchmark-v1'), presentationProfileHash(resolvePresentationProfile('benchmark-v1')));
assert.notEqual(presentationProfileHash('benchmark-v1'), presentationProfileHash('explore-v1'));
assert(Object.isFrozen(STELLAR_PRESENTATION_PROFILES));
assert(Object.isFrozen(resolvePresentationProfile('capture-v1')));
assert.equal(resolveNodeBaseRadius(0, 'benchmark-v1'), 4.08);
assert.equal(resolveNodeBaseRadius(0, 'benchmark-v2'), 4);
assert.equal(resolveNodeBaseRadius(1000, 'benchmark-v2'), 4);
assert.equal(resolveNodeScreenRadius(1000, 100, 'benchmark-v2'), 4);
assert.equal(resolvePresentationZoom(100, 'benchmark-v1'), 1);
assert.equal(resolveNodeScreenRadius(16, 0.5, 'benchmark-v1'), resolveNodeScreenRadius(16, 8, 'benchmark-v1'));
for (const profileId of ['explore-v1', 'capture-v1']) {
  const profile = resolvePresentationProfile(profileId);
  let previous = 0;
  for (const zoom of [0.25, 0.5, 1, 2, 4, 8, 16]) {
    const radius = resolveNodeScreenRadius(24, zoom, profile);
    assert(radius >= previous, `${profileId} radius must be monotonic`);
    assert(radius >= profile.radiusMin && radius <= profile.radiusMax);
    previous = radius;
  }
}
const sceneTopology = {
  nodes: [{ id: 'a', x: 1, y: 2, z: 3 }, { id: 'b', x: 4, y: 5, z: 6 }],
  edges: [{ source: 'a', target: 'b' }],
};
const presentationScene = new StellarScene(sceneTopology, { presentationProfile: 'explore-v1' });
assert.equal(presentationScene.presentation.id, 'explore-v1');
const originalPositions = [...presentationScene.positions];
presentationScene.setPresentationZoom(8);
presentationScene.setPresentationProfile('capture-v1');
assert.equal(presentationScene.presentation.id, 'capture-v1');
assert.deepEqual([...presentationScene.positions], originalPositions, 'presentation must not mutate topology positions');

const matrixFixture = await parseMatrixMarketLines([
  '%%MatrixMarket matrix coordinate pattern symmetric',
  '% fixture',
  '4 4 7',
  '1 1',
  '1 2',
  '2 1',
  '2 3',
  '3 4',
  '4 3',
  '9 2',
], { requested: 'fixture', sourceUrl: 'https://example.test/fixture', sourceSha256: 'abc123' });
assert.equal(matrixFixture.nodeCount, 4);
assert.equal(matrixFixture.edgeCount, 3);
assert.equal(matrixFixture.sourceSha256, 'abc123');
assert.deepEqual(matrixFixture.edges, [{ source: 0, target: 1 }, { source: 1, target: 2 }, { source: 2, target: 3 }]);

console.log(JSON.stringify({ status: 'passed', fixture: fixture.checksum, quality }, null, 2));
