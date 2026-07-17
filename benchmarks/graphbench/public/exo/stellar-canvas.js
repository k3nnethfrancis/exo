const BACKGROUND = '#f4f4ee';
const GRAPHITE = [45, 52, 50];
const TEAL = [63, 125, 114];
const AMBER = [191, 104, 64];
const PALETTE = [
  [63, 125, 114],
  [191, 104, 64],
  [120, 105, 156],
  [138, 123, 78],
  [82, 119, 156],
  [155, 95, 108],
  [101, 130, 91],
  [141, 104, 76],
];
const GRAPHITE_CSS = cssColor(GRAPHITE);
const TEAL_CSS = cssColor(TEAL);
const AMBER_CSS = cssColor(AMBER);
const PALETTE_CSS = PALETTE.map(cssColor);
const TAU = Math.PI * 2;

const FLAG_SELECTED = 1;
const FLAG_NEIGHBOR = 2;
const FLAG_PATH = 4;
const FLAG_HOVERED = 8;
const INVISIBLE = -1;

/**
 * Canvas2D renderer for the Stellar scene contract.
 *
 * It intentionally owns projection and depth ordering, but no graph state. That
 * makes switching between this renderer and WebGPU lossless: selection, paths,
 * node meaning, and layout all remain on StellarScene.
 */
export class StellarCanvasRenderer {
  static async create(canvas) {
    return new StellarCanvasRenderer(canvas);
  }

  constructor(canvas) {
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Canvas2D is unavailable');
    this.kind = 'canvas2d';
    this.canvas = canvas;
    this.context = context;
    this.scene = null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.destroyed = false;
    this.projected = new Float32Array(0);
    this.nodeOrder = new Int32Array(0);
    this.minimumW = 1;
    this.maximumW = 1;
    this.grain = createGrainPattern(context);
  }

  async setScene(scene) {
    this.scene = scene;
    this.ensureCapacity(scene.nodes.length);
  }

  updateScene(scene) {
    if (scene !== this.scene) {
      this.scene = scene;
      this.ensureCapacity(scene.nodes.length);
    }
  }

  updateInteraction(scene) {
    this.updateScene(scene);
  }

  resize({ width, height, dpr }) {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    const safeDpr = Math.max(1, dpr || 1);
    const physicalWidth = Math.max(1, Math.round(safeWidth * safeDpr));
    const physicalHeight = Math.max(1, Math.round(safeHeight * safeDpr));
    this.width = safeWidth;
    this.height = safeHeight;
    this.dpr = safeDpr;
    if (this.canvas.width !== physicalWidth) this.canvas.width = physicalWidth;
    if (this.canvas.height !== physicalHeight) this.canvas.height = physicalHeight;
    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;
  }

  render({ matrix }) {
    if (this.destroyed || !this.scene) return { cpuMilliseconds: 0 };
    const started = performance.now();
    const { context, scene } = this;
    this.project(matrix);

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, this.width, this.height);

    if (this.grain) {
      context.globalAlpha = 0.13;
      context.fillStyle = this.grain;
      context.fillRect(0, 0, this.width, this.height);
    }
    this.drawBaseEdges(scene);
    this.drawEmphasizedEdges(scene);
    this.drawNodes(scene);
    context.globalAlpha = 1;
    context.setLineDash(SOLID_LINE);
    return { cpuMilliseconds: performance.now() - started };
  }

  destroy() {
    this.destroyed = true;
    this.scene = null;
    this.projected = new Float32Array(0);
    this.nodeOrder = new Int32Array(0);
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  ensureCapacity(nodeCount) {
    if (this.nodeOrder.length === nodeCount) return;
    this.projected = new Float32Array(nodeCount * 4);
    this.nodeOrder = new Int32Array(nodeCount);
    for (let index = 0; index < nodeCount; index++) this.nodeOrder[index] = index;
  }

  project(matrix) {
    const { positions } = this.scene;
    const projected = this.projected;
    let minimumW = Infinity;
    let maximumW = -Infinity;
    for (let index = 0; index < this.nodeOrder.length; index++) {
      const source = index * 3;
      const target = index * 4;
      const x = positions[source];
      const y = positions[source + 1];
      const z = positions[source + 2];
      const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      if (clipW <= 0.000001) {
        projected[target + 3] = INVISIBLE;
        continue;
      }
      const inverseW = 1 / clipW;
      const ndcX = clipX * inverseW;
      const ndcY = clipY * inverseW;
      const depth = clipZ * inverseW;
      const visible = depth >= 0 && depth <= 1 && ndcX >= -1.15 && ndcX <= 1.15 && ndcY >= -1.15 && ndcY <= 1.15;
      projected[target] = (ndcX * 0.5 + 0.5) * this.width;
      projected[target + 1] = (-ndcY * 0.5 + 0.5) * this.height;
      projected[target + 2] = depth;
      projected[target + 3] = visible ? clipW : INVISIBLE;
      if (visible) {
        minimumW = Math.min(minimumW, clipW);
        maximumW = Math.max(maximumW, clipW);
      }
    }
    this.minimumW = Number.isFinite(minimumW) ? minimumW : 1;
    this.maximumW = Number.isFinite(maximumW) ? Math.max(minimumW + 0.0001, maximumW) : 1.0001;
    this.nodeOrder.sort((left, right) => this.projected[right * 4 + 2] - this.projected[left * 4 + 2]);
  }

  drawBaseEdges(scene) {
    const { context, projected } = this;
    context.beginPath();
    for (let index = 0; index < scene.edges.length; index++) {
      const edge = scene.edges[index];
      const source = edge.source * 4;
      const target = edge.target * 4;
      if (projected[source + 3] === INVISIBLE || projected[target + 3] === INVISIBLE) continue;
      const control = curveControl(projected, source, target, index);
      context.moveTo(projected[source], projected[source + 1]);
      context.quadraticCurveTo(control.x, control.y, projected[target], projected[target + 1]);
    }
    context.globalAlpha = scene.selected < 0 ? 0.14 : 0.042;
    context.strokeStyle = GRAPHITE_CSS;
    context.lineWidth = 0.62;
    context.stroke();
  }

  drawEmphasizedEdges(scene) {
    const { context, projected } = this;
    for (let index = 0; index < scene.edges.length; index++) {
      const visual = index * 2;
      const opacity = scene.edgeVisuals[visual + 1];
      if (opacity < 0.4) continue;
      const edge = scene.edges[index];
      const source = edge.source * 4;
      const target = edge.target * 4;
      if (projected[source + 3] === INVISIBLE || projected[target + 3] === INVISIBLE) continue;
      const depth = (depthFactor(this, source) + depthFactor(this, target)) * 0.5;
      const onPath = scene.edgeVisuals[visual] > 1.5;
      const control = curveControl(projected, source, target, index);
      context.beginPath();
      context.moveTo(projected[source], projected[source + 1]);
      context.quadraticCurveTo(control.x, control.y, projected[target], projected[target + 1]);
      context.globalAlpha = opacity * (0.62 + depth * 0.38);
      context.strokeStyle = onPath ? AMBER_CSS : TEAL_CSS;
      context.lineWidth = scene.edgeVisuals[visual] * (0.82 + depth * 0.22);
      context.stroke();
    }
  }

  drawNodes(scene) {
    const { context, projected } = this;
    for (let order = 0; order < this.nodeOrder.length; order++) {
      const index = this.nodeOrder[order];
      const point = index * 4;
      if (projected[point + 3] === INVISIBLE) continue;
      const visual = index * 4;
      const flags = scene.nodeVisuals[visual + 3] | 0;
      const selected = Boolean(flags & FLAG_SELECTED);
      const neighbor = Boolean(flags & FLAG_NEIGHBOR);
      const onPath = Boolean(flags & FLAG_PATH);
      const hovered = Boolean(flags & FLAG_HOVERED);
      const depth = depthFactor(this, point);
      const radius = scene.nodeScreenRadius(index);
      const opacity = scene.nodeOpacity(index);
      const x = projected[point];
      const y = projected[point + 1];
      const paletteIndex = (scene.nodeVisuals[visual + 1] | 0) % PALETTE.length;
      const paletteCss = PALETTE_CSS[paletteIndex];

      if (selected || hovered) {
        const aura = scene.presentation.aura;
        const auraScale = selected ? aura.selectedScale : aura.hoveredScale;
        const auraAlpha = selected ? aura.selectedAlpha : aura.hoveredAlpha;
        context.beginPath();
        context.arc(x, y, radius * auraScale, 0, TAU);
        context.globalAlpha = auraAlpha;
        context.fillStyle = selected ? TEAL_CSS : paletteCss;
        context.fill();
      }

      context.beginPath();
      context.arc(x, y, Math.max(1.15, radius), 0, TAU);
      context.globalAlpha = opacity;
      context.fillStyle = paletteCss;
      context.fill();

      if (selected || hovered || onPath) {
        context.globalAlpha = selected ? 0.98 : 0.84;
        context.strokeStyle = onPath && !selected ? AMBER_CSS : TEAL_CSS;
        context.lineWidth = selected ? 1.65 : 1.15;
        context.stroke();
      } else if (neighbor) {
        context.globalAlpha = 0.48 + depth * 0.22;
        context.strokeStyle = TEAL_CSS;
        context.lineWidth = 0.72;
        context.stroke();
      }

    }
    context.globalAlpha = 1;
  }
}

function depthFactor(renderer, pointOffset) {
  const w = renderer.projected[pointOffset + 3];
  const range = renderer.maximumW - renderer.minimumW;
  return 1 - Math.max(0, Math.min(1, (w - renderer.minimumW) / range));
}

function curveControl(projected, source, target, index) {
  const dx = projected[target] - projected[source];
  const dy = projected[target + 1] - projected[source + 1];
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const bend = Math.min(34, distance * 0.115) * (index & 1 ? -1 : 1);
  return {
    x: (projected[source] + projected[target]) * 0.5 - dy / distance * bend,
    y: (projected[source + 1] + projected[target + 1]) * 0.5 + dx / distance * bend,
  };
}

function cssColor(color) {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function createGrainPattern(context) {
  if (typeof document === 'undefined') return null;
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return null;
  tileContext.clearRect(0, 0, 8, 8);
  tileContext.fillStyle = 'rgba(40, 48, 46, 0.12)';
  tileContext.fillRect(0, 0, 1, 1);
  tileContext.fillRect(5, 2, 1, 1);
  tileContext.fillRect(2, 6, 1, 1);
  return context.createPattern(tile, 'repeat');
}
