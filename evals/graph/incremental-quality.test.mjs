import assert from 'node:assert/strict';
import { procrustesDisplacement } from './lib/incremental-quality.mjs';

const reference = Float32Array.from([
  -1, -1, 0,
  1, -1, 0,
  1, 1, 0,
  -1, 1, 0,
  0, 0, 2,
]);
const angle = Math.PI / 3;
const cosine = Math.cos(angle);
const sine = Math.sin(angle);
const transformed = new Float32Array(reference.length);
for (let index = 0; index < reference.length / 3; index += 1) {
  const offset = index * 3;
  const x = reference[offset];
  const y = reference[offset + 1];
  const z = reference[offset + 2];
  transformed[offset] = 7 + 2.5 * (cosine * x - sine * y);
  transformed[offset + 1] = -3 + 2.5 * (sine * x + cosine * y);
  transformed[offset + 2] = 11 + 2.5 * z;
}

const invariant = procrustesDisplacement(reference, transformed);
assert.equal(invariant.count, 5);
assert(Math.abs(invariant.scale - 2.5) < 1e-5);
assert(invariant.normalized.max < 1e-5);

transformed[0] += 1;
const changed = procrustesDisplacement(reference, transformed);
assert(changed.normalized.p95 > 0.05);
assert.throws(() => procrustesDisplacement([0, 0], [0, 0]), /equal 3D lengths/);

console.log(JSON.stringify({ status: 'passed', invariant: invariant.normalized, changed: changed.normalized }, null, 2));
