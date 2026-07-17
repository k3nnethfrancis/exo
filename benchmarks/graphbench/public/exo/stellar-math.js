const EPSILON = 1e-6;

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize3(vector) {
  const length = length3(vector);
  return length < EPSILON ? [0, 0, 0] : scale3(vector, 1 / length);
}

export function cameraBasis(camera) {
  const cosinePitch = Math.cos(camera.pitch);
  const forward = normalize3([
    -Math.sin(camera.yaw) * cosinePitch,
    -Math.sin(camera.pitch),
    -Math.cos(camera.yaw) * cosinePitch,
  ]);
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = normalize3(cross3(right, forward));
  return { forward, right, up };
}

export function cameraEye(camera) {
  const { forward } = cameraBasis(camera);
  return subtract3(camera.target, scale3(forward, camera.distance));
}

export function viewProjection(camera, width, height) {
  const eye = cameraEye(camera);
  const { up } = cameraBasis(camera);
  const view = lookAt(eye, camera.target, up);
  const projection = perspective(camera.fov, Math.max(1, width) / Math.max(1, height), camera.near, camera.far);
  return { eye, view, projection, matrix: multiply4(projection, view) };
}

export function perspective(fovRadians, aspect, near, far) {
  const f = 1 / Math.tan(fovRadians / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * range, -1,
    0, 0, near * far * range, 0,
  ]);
}

export function lookAt(eye, target, upHint = [0, 1, 0]) {
  const forward = normalize3(subtract3(target, eye));
  let right = normalize3(cross3(forward, upHint));
  if (length3(right) < EPSILON) right = [1, 0, 0];
  const up = cross3(right, forward);
  return new Float32Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot3(right, eye), -dot3(up, eye), dot3(forward, eye), 1,
  ]);
}

export function multiply4(a, b) {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      output[column * 4 + row] =
        a[row] * b[column * 4]
        + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2]
        + a[12 + row] * b[column * 4 + 3];
    }
  }
  return output;
}

export function projectPoint(point, matrix, width, height) {
  const x = point[0], y = point[1], z = point[2];
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (clipW <= EPSILON) return { x: -1e6, y: -1e6, depth: 2, visible: false, w: clipW };
  const inverseW = 1 / clipW;
  const ndcX = clipX * inverseW;
  const ndcY = clipY * inverseW;
  const depth = clipZ * inverseW;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height,
    depth,
    w: clipW,
    visible: depth >= 0 && depth <= 1 && ndcX >= -1.15 && ndcX <= 1.15 && ndcY >= -1.15 && ndcY <= 1.15,
  };
}

export function sphereBounds(positions) {
  if (!positions.length) return { center: [0, 0, 0], radius: 1 };
  const center = [0, 0, 0];
  const count = positions.length / 3;
  for (let index = 0; index < positions.length; index += 3) {
    center[0] += positions[index];
    center[1] += positions[index + 1];
    center[2] += positions[index + 2];
  }
  center[0] /= count;
  center[1] /= count;
  center[2] /= count;
  let radius = 1;
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(radius, Math.hypot(
      positions[index] - center[0],
      positions[index + 1] - center[1],
      positions[index + 2] - center[2],
    ));
  }
  return { center, radius };
}

export function hashString(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}
