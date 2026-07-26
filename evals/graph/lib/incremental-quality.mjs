import { summarize } from './metrics.mjs';

export function procrustesDisplacement(reference, candidate, dimensions = 3) {
  if (dimensions !== 3) throw new Error('Procrustes displacement currently requires 3D positions');
  if (reference.length !== candidate.length || reference.length % dimensions !== 0) {
    throw new Error('reference and candidate positions must have equal 3D lengths');
  }
  const count = reference.length / dimensions;
  if (!count) return { count: 0, normalized: summarize([]), scale: 1, rotation: [0, 0, 0, 1] };

  const referenceCenter = centroid(reference, count);
  const candidateCenter = centroid(candidate, count);
  const covariance = new Float64Array(9);
  let referenceEnergy = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const px = reference[offset] - referenceCenter[0];
    const py = reference[offset + 1] - referenceCenter[1];
    const pz = reference[offset + 2] - referenceCenter[2];
    const qx = candidate[offset] - candidateCenter[0];
    const qy = candidate[offset + 1] - candidateCenter[1];
    const qz = candidate[offset + 2] - candidateCenter[2];
    covariance[0] += px * qx; covariance[1] += px * qy; covariance[2] += px * qz;
    covariance[3] += py * qx; covariance[4] += py * qy; covariance[5] += py * qz;
    covariance[6] += pz * qx; covariance[7] += pz * qy; covariance[8] += pz * qz;
    referenceEnergy += px * px + py * py + pz * pz;
  }

  const quaternion = dominantQuaternion(covariance);
  const rotation = quaternionMatrix(quaternion);
  let scaleNumerator = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const px = reference[offset] - referenceCenter[0];
    const py = reference[offset + 1] - referenceCenter[1];
    const pz = reference[offset + 2] - referenceCenter[2];
    const rx = rotation[0] * px + rotation[1] * py + rotation[2] * pz;
    const ry = rotation[3] * px + rotation[4] * py + rotation[5] * pz;
    const rz = rotation[6] * px + rotation[7] * py + rotation[8] * pz;
    scaleNumerator += rx * (candidate[offset] - candidateCenter[0])
      + ry * (candidate[offset + 1] - candidateCenter[1])
      + rz * (candidate[offset + 2] - candidateCenter[2]);
  }
  const scale = referenceEnergy > 1e-12 ? scaleNumerator / referenceEnergy : 1;
  const referenceRms = Math.sqrt(referenceEnergy / Math.max(1, count)) || 1;
  const displacement = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const px = reference[offset] - referenceCenter[0];
    const py = reference[offset + 1] - referenceCenter[1];
    const pz = reference[offset + 2] - referenceCenter[2];
    const ax = candidateCenter[0] + scale * (rotation[0] * px + rotation[1] * py + rotation[2] * pz);
    const ay = candidateCenter[1] + scale * (rotation[3] * px + rotation[4] * py + rotation[5] * pz);
    const az = candidateCenter[2] + scale * (rotation[6] * px + rotation[7] * py + rotation[8] * pz);
    displacement[index] = Math.hypot(ax - candidate[offset], ay - candidate[offset + 1], az - candidate[offset + 2]) / referenceRms;
  }
  return {
    count,
    normalized: summarize(displacement),
    scale,
    rotation: quaternion,
  };
}

function centroid(positions, count) {
  const center = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    center[0] += positions[offset];
    center[1] += positions[offset + 1];
    center[2] += positions[offset + 2];
  }
  return center.map((value) => value / count);
}

function dominantQuaternion(h) {
  const [hxx, hxy, hxz, hyx, hyy, hyz, hzx, hzy, hzz] = h;
  const trace = hxx + hyy + hzz;
  const matrix = new Float64Array([
    trace, hyz - hzy, hzx - hxz, hxy - hyx,
    hyz - hzy, hxx - hyy - hzz, hxy + hyx, hzx + hxz,
    hzx - hxz, hxy + hyx, -hxx + hyy - hzz, hyz + hzy,
    hxy - hyx, hzx + hxz, hyz + hzy, -hxx - hyy + hzz,
  ]);
  let bound = 1;
  for (let row = 0; row < 4; row += 1) {
    let sum = 0;
    for (let column = 0; column < 4; column += 1) sum += Math.abs(matrix[row * 4 + column]);
    bound = Math.max(bound, sum);
  }
  for (let index = 0; index < 4; index += 1) matrix[index * 4 + index] += bound;
  let vector = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const next = [0, 0, 0, 0];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) next[row] += matrix[row * 4 + column] * vector[column];
    }
    const length = Math.hypot(...next) || 1;
    vector = next.map((value) => value / length);
  }
  return vector;
}

function quaternionMatrix([w, x, y, z]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
