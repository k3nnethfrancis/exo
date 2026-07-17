import { clamp, sphereBounds } from './stellar-math.js';

const FLAG_SELECTED = 1;
const FLAG_NEIGHBOR = 2;
const FLAG_PATH = 4;
const FLAG_HOVERED = 8;
const GRID_SIZE = 44;
const EMPTY_SET = new Set();

export const STELLAR_PRESENTATION_PROFILES = Object.freeze({
  'benchmark-v1': Object.freeze({
    id: 'benchmark-v1', curve: 'historical', zoomExponent: 0, zoomMin: 1, zoomMax: 1,
    radiusMin: 3.6, radiusMax: 11.5, opacity: Object.freeze({ idle: 0.72, focused: 1, dimmed: 0.18 }),
    aura: Object.freeze({ selectedScale: 1, hoveredScale: 1, selectedAlpha: 0, hoveredAlpha: 0 }),
    labels: Object.freeze({ mobile: 7, compact: 11, wide: 16 }),
  }),
  'explore-v1': Object.freeze({
    id: 'explore-v1', curve: 'explore', zoomExponent: 0.38, zoomMin: 0.95, zoomMax: 4,
    radiusMin: 3, radiusMax: 30, opacity: Object.freeze({ idle: 0.86, focused: 1, dimmed: 0.2 }),
    aura: Object.freeze({ selectedScale: 2.4, hoveredScale: 1.8, selectedAlpha: 0.11, hoveredAlpha: 0.075 }),
    labels: Object.freeze({ mobile: 7, compact: 12, wide: 18 }),
  }),
  'capture-v1': Object.freeze({
    id: 'capture-v1', curve: 'capture', zoomExponent: 0.48, zoomMin: 1, zoomMax: 6,
    radiusMin: 4, radiusMax: 44, opacity: Object.freeze({ idle: 0.92, focused: 1, dimmed: 0.22 }),
    aura: Object.freeze({ selectedScale: 3, hoveredScale: 2.1, selectedAlpha: 0.14, hoveredAlpha: 0.09 }),
    labels: Object.freeze({ mobile: 8, compact: 14, wide: 22 }),
  }),
});

export function resolvePresentationProfile(id) {
  return STELLAR_PRESENTATION_PROFILES[id] || STELLAR_PRESENTATION_PROFILES['explore-v1'];
}

export function resolveNodeBaseRadius(degree, profileOrId = 'explore-v1') {
  const profile = typeof profileOrId === 'string' ? resolvePresentationProfile(profileOrId) : profileOrId;
  const safeDegree = Math.max(0, Number(degree) || 0);
  if (profile.curve === 'historical') return clamp(3.2 + Math.sqrt(Math.max(1, safeDegree)) * 0.88, 3.6, 11.5);
  if (profile.curve === 'capture') return clamp(4 + 0.92 * Math.log2(1 + safeDegree), 4, 12);
  return clamp(3 + 0.75 * Math.log2(1 + safeDegree), 3.4, 10);
}

export function resolvePresentationZoom(zoomRatio, profileOrId = 'explore-v1') {
  const profile = typeof profileOrId === 'string' ? resolvePresentationProfile(profileOrId) : profileOrId;
  if (profile.zoomExponent === 0) return 1;
  return clamp(Math.pow(Math.max(0.001, Number(zoomRatio) || 1), profile.zoomExponent), profile.zoomMin, profile.zoomMax);
}

export function resolveNodeScreenRadius(degree, zoomRatio, profileOrId = 'explore-v1') {
  const profile = typeof profileOrId === 'string' ? resolvePresentationProfile(profileOrId) : profileOrId;
  return clamp(resolveNodeBaseRadius(degree, profile) * resolvePresentationZoom(zoomRatio, profile), profile.radiusMin, profile.radiusMax);
}

export class StellarScene {
  constructor(raw, { presentationProfile = 'explore-v1' } = {}) {
    this.presentation = resolvePresentationProfile(presentationProfile);
    this.presentationZoom = 1;
    const rawNodes = raw.nodes || [];
    this.nodes = rawNodes.map((node, index) => ({
      ...node,
      index,
      label: node.label || node.title || leaf(node.path) || `Document ${index + 1}`,
      title: node.title || node.label || leaf(node.path) || `Document ${index + 1}`,
      path: node.path || '',
      group: node.group || node.path?.split('/')[0] || 'notes',
      degree: Number(node.degree || 0),
    }));
    this.indexById = new Map(this.nodes.map((node, index) => [node.id, index]));
    this.edges = (raw.edges || raw.links || [])
      .map((edge) => ({ source: this.indexById.get(edge.source), target: this.indexById.get(edge.target), kind: edge.kind || 'reference' }))
      .filter((edge) => edge.source !== undefined && edge.target !== undefined && edge.source !== edge.target);
    this.adjacency = this.nodes.map(() => new Set());
    this.edges.forEach(({ source, target }) => {
      this.adjacency[source].add(target);
      this.adjacency[target].add(source);
    });
    this.nodes.forEach((node, index) => node.degree = this.adjacency[index].size || node.degree);
    this.groups = [...new Set(this.nodes.map((node) => node.group))].sort();
    this.groupIndex = new Map(this.groups.map((group, index) => [group, index]));
    this.positions = new Float32Array(this.nodes.length * 3);
    this.hasInitialPositions = rawNodes.length > 0 && rawNodes.every((node) =>
      Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z));
    if (this.hasInitialPositions) {
      for (let index = 0; index < rawNodes.length; index += 1) {
        const offset = index * 3;
        this.positions[offset] = rawNodes[index].x;
        this.positions[offset + 1] = rawNodes[index].y;
        this.positions[offset + 2] = rawNodes[index].z;
      }
    }
    this.projected = new Float32Array(this.nodes.length * 4);
    this.nodeVisuals = new Float32Array(this.nodes.length * 4);
    this.edgeVisuals = new Float32Array(this.edges.length * 2);
    this.nodeGpuData = new Float32Array(this.nodes.length * 8);
    this.edgeGpuData = new ArrayBuffer(this.edges.length * 16);
    this.edgeGpuView = new DataView(this.edgeGpuData);
    this.selected = -1;
    this.pathTarget = -1;
    this.hovered = -1;
    this.pathNodes = new Set();
    this.pathEdges = new Set();
    this.layoutEpoch = 0;
    this.layoutEnergy = this.hasInitialPositions ? 0 : Infinity;
    this.layoutSettled = this.hasInitialPositions;
    this.projectionGrid = new Map();
    this.labelPlacements = [];
    this.writeStaticEdges();
    this.updateVisuals();
  }

  applyLayout(frame) {
    if (!(frame.positions instanceof Float32Array) || frame.positions.length !== this.positions.length) return false;
    this.positions.set(frame.positions);
    this.layoutEpoch = frame.epoch || this.layoutEpoch + 1;
    this.layoutEnergy = Number(frame.energy || 0);
    this.layoutSettled = Boolean(frame.settled);
    return true;
  }

  select(index) {
    if (index < 0 || index >= this.nodes.length) return;
    if (this.selected >= 0 && index !== this.selected) {
      this.pathTarget = index;
      const path = shortestPath(this.adjacency, this.selected, index);
      this.pathNodes = path.nodes;
      this.pathEdges = path.edges;
    } else {
      this.selected = index;
      this.pathTarget = -1;
      this.pathNodes.clear();
      this.pathEdges.clear();
    }
    this.updateVisuals();
  }

  clearSelection() {
    this.selected = -1;
    this.pathTarget = -1;
    this.pathNodes.clear();
    this.pathEdges.clear();
    this.updateVisuals();
  }

  clearPath() {
    this.pathTarget = -1;
    this.pathNodes.clear();
    this.pathEdges.clear();
    this.updateVisuals();
  }

  setHovered(index) {
    if (index === this.hovered) return false;
    this.hovered = index;
    this.updateVisuals();
    return true;
  }

  setPresentationProfile(id) {
    const next = resolvePresentationProfile(id);
    if (next === this.presentation) return false;
    this.presentation = next;
    this.updateVisuals();
    return true;
  }

  setPresentationZoom(zoomRatio) {
    const next = resolvePresentationZoom(zoomRatio, this.presentation);
    if (Math.abs(next - this.presentationZoom) < 0.0001) return false;
    this.presentationZoom = next;
    return true;
  }

  nodeScreenRadius(index) {
    return clamp(this.nodeVisuals[index * 4] * this.presentationZoom, this.presentation.radiusMin, this.presentation.radiusMax);
  }

  nodeOpacity(index) {
    return this.nodeVisuals[index * 4 + 2];
  }

  updateVisuals() {
    const selectedNeighbors = this.selected >= 0 ? this.adjacency[this.selected] : EMPTY_SET;
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index];
      const selected = index === this.selected || index === this.pathTarget;
      const neighbor = selectedNeighbors.has(index);
      const onPath = this.pathNodes.has(index);
      const hovered = index === this.hovered;
      let flags = 0;
      if (selected) flags |= FLAG_SELECTED;
      if (neighbor) flags |= FLAG_NEIGHBOR;
      if (onPath) flags |= FLAG_PATH;
      if (hovered) flags |= FLAG_HOVERED;
      const focused = selected || neighbor || onPath || hovered;
      const opacity = this.selected < 0 ? this.presentation.opacity.idle : focused ? this.presentation.opacity.focused : this.presentation.opacity.dimmed;
      const radius = resolveNodeBaseRadius(node.degree, this.presentation);
      const offset = index * 4;
      this.nodeVisuals[offset] = radius;
      this.nodeVisuals[offset + 1] = this.groupIndex.get(node.group) % 8;
      this.nodeVisuals[offset + 2] = opacity;
      this.nodeVisuals[offset + 3] = flags;
    }
    for (let index = 0; index < this.edges.length; index++) {
      const edge = this.edges[index];
      const focused = edge.source === this.selected || edge.target === this.selected;
      const onPath = this.pathEdges.has(edgeKey(edge.source, edge.target));
      const offset = index * 2;
      this.edgeVisuals[offset] = onPath ? 1.85 : focused ? 1.25 : 0.62;
      this.edgeVisuals[offset + 1] = onPath ? 0.96 : focused ? 0.72 : this.selected < 0 ? 0.14 : 0.045;
    }
    this.writeStaticEdges();
  }

  writeStaticEdges() {
    for (let index = 0; index < this.edges.length; index++) {
      const edge = this.edges[index];
      const byte = index * 16;
      this.edgeGpuView.setUint32(byte, edge.source, true);
      this.edgeGpuView.setUint32(byte + 4, edge.target, true);
      this.edgeGpuView.setFloat32(byte + 8, this.edgeVisuals[index * 2] || 0.62, true);
      this.edgeGpuView.setFloat32(byte + 12, this.edgeVisuals[index * 2 + 1] || 0.21, true);
    }
  }

  buildGpuNodes() {
    for (let index = 0; index < this.nodes.length; index++) {
      const source = index * 3;
      const visual = index * 4;
      const target = index * 8;
      this.nodeGpuData[target] = this.positions[source];
      this.nodeGpuData[target + 1] = this.positions[source + 1];
      this.nodeGpuData[target + 2] = this.positions[source + 2];
      this.nodeGpuData[target + 3] = this.nodeVisuals[visual];
      this.nodeGpuData[target + 4] = this.nodeVisuals[visual + 1];
      this.nodeGpuData[target + 5] = this.nodeVisuals[visual + 2];
      this.nodeGpuData[target + 6] = this.nodeVisuals[visual + 3];
      this.nodeGpuData[target + 7] = 0;
    }
    return this.nodeGpuData;
  }

  updateProjection(matrix, width, height) {
    this.projectionGrid.clear();
    for (let index = 0; index < this.nodes.length; index++) {
      const position = index * 3;
      const x = this.positions[position];
      const y = this.positions[position + 1];
      const z = this.positions[position + 2];
      const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      const target = index * 4;
      if (clipW <= 0.000001) {
        this.projected[target + 3] = 0;
        continue;
      }
      const inverseW = 1 / clipW;
      const ndcX = clipX * inverseW;
      const ndcY = clipY * inverseW;
      const depth = clipZ * inverseW;
      const screenX = (ndcX * 0.5 + 0.5) * width;
      const screenY = (-ndcY * 0.5 + 0.5) * height;
      const visible = depth >= 0 && depth <= 1 && ndcX >= -1.15 && ndcX <= 1.15 && ndcY >= -1.15 && ndcY <= 1.15;
      this.projected[target] = screenX;
      this.projected[target + 1] = screenY;
      this.projected[target + 2] = depth;
      this.projected[target + 3] = visible ? 1 : 0;
      if (!visible) continue;
      const key = gridKey(screenX, screenY);
      let bucket = this.projectionGrid.get(key);
      if (!bucket) this.projectionGrid.set(key, bucket = []);
      bucket.push(index);
    }
  }

  pick(screenX, screenY, hitPadding = 10) {
    const cellX = Math.floor(screenX / GRID_SIZE);
    const cellY = Math.floor(screenY / GRID_SIZE);
    let best = -1;
    let bestDistance = Infinity;
    let bestDepth = Infinity;
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const bucket = this.projectionGrid.get(gridCellKey(cellX + offsetX, cellY + offsetY));
        if (!bucket) continue;
        for (const index of bucket) {
          const projected = index * 4;
          const distance = Math.hypot(this.projected[projected] - screenX, this.projected[projected + 1] - screenY);
          const radius = this.nodeScreenRadius(index) + hitPadding;
          const depth = this.projected[projected + 2];
          if (distance <= radius && (distance < bestDistance - 1 || (Math.abs(distance - bestDistance) <= 1 && depth < bestDepth))) {
            best = index;
            bestDistance = distance;
            bestDepth = depth;
          }
        }
      }
    }
    return best;
  }

  placeLabels(width, height, measure) {
    const centerX = width / 2;
    const centerY = height / 2;
    const selectedNeighbors = this.selected >= 0 ? this.adjacency[this.selected] : EMPTY_SET;
    const limit = width < 600 ? this.presentation.labels.mobile : width < 1000 ? this.presentation.labels.compact : this.presentation.labels.wide;
    const candidates = [];
    const candidateLimit = limit * 5;
    for (let index = 0; index < this.nodes.length; index++) {
      const projected = index * 4;
      if (!this.projected[projected + 3]) continue;
      const selected = index === this.selected || index === this.pathTarget;
      const hovered = index === this.hovered;
      const onPath = this.pathNodes.has(index);
      const neighbor = selectedNeighbors.has(index);
      const distance = Math.hypot(this.projected[projected] - centerX, this.projected[projected + 1] - centerY);
      const score = (selected ? 1e9 : 0) + (hovered ? 5e8 : 0) + (onPath ? 1e7 : 0) + (neighbor ? 9000 : 0) + this.nodes[index].degree * 38 + 1200 / (1 + distance / 160) - this.projected[projected + 2] * 140;
      insertCandidate(candidates, { index, score, selected, hovered, onPath, neighbor }, candidateLimit);
    }
    const occupied = [];
    const placements = [];
    for (const candidate of candidates) {
      if (placements.length >= limit && !candidate.selected && !candidate.hovered) break;
      const projected = candidate.index * 4;
      const node = this.nodes[candidate.index];
      const priority = candidate.selected || candidate.hovered || candidate.onPath;
      const size = priority ? 12.5 : 10.5;
      const textWidth = measure(node.label, size, priority);
      const radius = this.nodeScreenRadius(candidate.index) + 6;
      const anchors = labelAnchors(this.projected[projected], this.projected[projected + 1], radius, textWidth, size);
      const placement = anchors.find((anchor) => anchor.box.left >= 8 && anchor.box.right <= width - 8 && anchor.box.top >= 8 && anchor.box.bottom <= height - 8 && !occupied.some((box) => overlaps(anchor.box, box)));
      if (!placement && !priority) continue;
      const resolved = placement || anchors[0];
      occupied.push(resolved.box);
      placements.push({ ...resolved, index: candidate.index, text: node.label, size, priority, depth: this.projected[projected + 2] });
    }
    this.labelPlacements = placements;
    return placements;
  }

  bounds() {
    return sphereBounds(this.positions);
  }

  get selectedNode() {
    return this.nodes[this.pathTarget >= 0 ? this.pathTarget : this.selected] || null;
  }

  get pathLength() {
    return this.pathTarget >= 0 && this.pathNodes.size ? this.pathNodes.size - 1 : 0;
  }
}

function shortestPath(adjacency, source, target) {
  const queue = new Int32Array(adjacency.length);
  const previous = new Int32Array(adjacency.length);
  previous.fill(-2);
  let head = 0;
  let tail = 0;
  queue[tail++] = source;
  previous[source] = -1;
  while (head < tail) {
    const current = queue[head++];
    if (current === target) break;
    for (const next of adjacency[current]) {
      if (previous[next] !== -2) continue;
      previous[next] = current;
      queue[tail++] = next;
    }
  }
  if (previous[target] === -2) return { nodes: new Set(), edges: new Set() };
  const nodes = new Set();
  const edges = new Set();
  for (let current = target; current !== -1; current = previous[current]) {
    nodes.add(current);
    const parent = previous[current];
    if (parent !== -1) edges.add(edgeKey(current, parent));
  }
  return { nodes, edges };
}

function labelAnchors(x, y, radius, width, height) {
  const gap = radius + 5;
  return [
    { x: x + gap, y: y + height * 0.36, box: { left: x + gap - 2, top: y - height, right: x + gap + width + 3, bottom: y + 4 } },
    { x: x - gap - width, y: y + height * 0.36, box: { left: x - gap - width - 3, top: y - height, right: x - gap + 2, bottom: y + 4 } },
    { x: x - width / 2, y: y - gap, box: { left: x - width / 2 - 3, top: y - gap - height - 2, right: x + width / 2 + 3, bottom: y - gap + 3 } },
    { x: x - width / 2, y: y + gap + height, box: { left: x - width / 2 - 3, top: y + gap - 3, right: x + width / 2 + 3, bottom: y + gap + height + 3 } },
  ];
}

function insertCandidate(candidates, candidate, limit) {
  if (candidates.length === limit && candidate.score <= candidates[candidates.length - 1].score) return;
  let index = candidates.length;
  while (index > 0 && candidates[index - 1].score < candidate.score) index--;
  candidates.splice(index, 0, candidate);
  if (candidates.length > limit) candidates.pop();
}

function gridKey(x, y) { return gridCellKey(Math.floor(x / GRID_SIZE), Math.floor(y / GRID_SIZE)); }
function gridCellKey(x, y) { return (x + 32) * 65536 + (y + 32); }
function overlaps(a, b) { return a.left < b.right + 6 && a.right + 6 > b.left && a.top < b.bottom + 5 && a.bottom + 5 > b.top; }
function edgeKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
function leaf(path) { return path?.split('/').at(-1)?.replace(/\.md$/i, '') || ''; }
