import { presentationProfileHash, StellarScene } from './stellar-scene.js?v=smooth-topology-1';
import {
  add3,
  cameraBasis,
  clamp,
  scale3,
  subtract3,
  viewProjection,
} from './stellar-math.js?v=smooth-topology-1';
import { StellarWebGPURenderer } from './stellar-webgpu.js?v=smooth-topology-1';
import { StellarCanvasRenderer } from './stellar-canvas.js?v=smooth-topology-1';

const shell = document.querySelector('#stellar-shell');
const gpuCanvas = document.querySelector('#stellar-gpu');
const fallbackCanvas = document.querySelector('#stellar-fallback');
const labelCanvas = document.querySelector('#stellar-labels');
const labelContext = labelCanvas.getContext('2d');
const loading = document.querySelector('#stellar-loading');
const detail = document.querySelector('#stellar-detail');
const detailTitle = detail.querySelector('[data-title]');
const detailPath = detail.querySelector('[data-path]');
const detailMeta = detail.querySelector('[data-meta]');
const hint = document.querySelector('#stellar-hint');
const telemetry = document.querySelector('#stellar-telemetry');
const liveRegion = document.querySelector('#stellar-live');

const query = new URLSearchParams(location.search);
const presentationProfileId = query.get('profile') || 'explore-v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const showTelemetry = query.has('debug');
const showLabels = query.get('labels') !== '0';
const frameSamples = [];
const widthCache = new Map();

const state = {
  scene: null,
  renderer: null,
  worker: null,
  rendererGeneration: 0,
  rendererFailures: 0,
  ready: false,
  firstLayout: true,
  raf: 0,
  lastFrameAt: 0,
  renderCount: 0,
  motion: null,
  width: 1,
  height: 1,
  dpr: 1,
  labelOverlaps: 0,
  layoutChecksum: 'pending',
  overviewDistance: 820,
  pointers: new Map(),
  gesture: null,
  suppressTap: false,
  lastTap: null,
  camera: {
    target: [0, 0, 0],
    yaw: -0.62,
    pitch: 0.34,
    distance: 820,
    fov: Math.PI / 4.2,
    near: 0.1,
    far: 50000,
  },
};

boot().catch(failBoot);

async function boot() {
  if (coarsePointer) {
    hint.textContent = 'Drag to orbit · two fingers to move · pinch to zoom';
    shell.setAttribute('aria-label', 'Exo spatial graph. Drag to orbit, use two fingers to pan, and pinch to zoom.');
  }
  const topologyUrl = query.get('topology') || './topology.json';
  const response = await fetch(topologyUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Topology failed to load (${response.status})`);
  state.scene = new StellarScene(await response.json(), { presentationProfile: presentationProfileId });
  await installRenderer(query.get('renderer') === 'canvas');
  if (query.get('layout') === 'static') {
    if (!state.scene.hasInitialPositions) throw new Error('Static layout requires finite x, y, and z coordinates for every node');
    finishStaticLayout();
  } else {
    startLayout();
  }
  installInteractions();
  observeSize();
  exposeBenchmarkContract();
}

function finishStaticLayout() {
  state.firstLayout = false;
  state.layoutChecksum = checksumPositions(state.scene.positions);
  state.renderer.updateScene(state.scene);
  overview({ immediate: true });
  state.ready = true;
  loading.classList.add('is-hidden');
  shell.classList.add('is-ready');
  hint.classList.add('is-hidden');
  invalidate();
}

async function installRenderer(forceCanvas = false) {
  const generation = ++state.rendererGeneration;
  let renderer;
  if (!forceCanvas) {
    try {
      renderer = await StellarWebGPURenderer.create(gpuCanvas, (error) => handleRendererFailure(error, generation));
    } catch (error) {
      console.info('[stellar] WebGPU unavailable; using the Canvas renderer.', error.message);
    }
  }
  if (!renderer) renderer = new StellarCanvasRenderer(fallbackCanvas);
  if (generation !== state.rendererGeneration) {
    renderer.destroy();
    return;
  }
  state.renderer?.destroy();
  state.renderer = renderer;
  gpuCanvas.hidden = renderer.kind !== 'webgpu';
  fallbackCanvas.hidden = renderer.kind === 'webgpu';
  await renderer.setScene(state.scene);
  resize();
  invalidate();
}

async function handleRendererFailure(error, generation) {
  if (generation !== state.rendererGeneration) return;
  console.warn('[stellar] renderer failure', error);
  state.rendererFailures += 1;
  try {
    if (state.rendererFailures === 1 && navigator.gpu) {
      await installRenderer(false);
    } else {
      await installRenderer(true);
    }
  } catch (fallbackError) {
    failBoot(fallbackError);
  }
}

function startLayout({ initialPositions = null, warmStartCount = 0 } = {}) {
  const worker = new Worker('./stellar-layout-worker.js', { type: 'module' });
  state.worker = worker;
  worker.addEventListener('message', ({ data }) => {
    if (data.type !== 'frame' || !state.scene.applyLayout(data)) return;
    const recycled = data.positions.buffer;
    worker.postMessage({ type: 'recycle', buffer: recycled }, [recycled]);
    state.renderer.updateScene(state.scene);
    if (state.firstLayout) {
      state.firstLayout = false;
      overview({ immediate: true });
      state.ready = true;
      loading.classList.add('is-hidden');
      shell.classList.add('is-ready');
      window.setTimeout(() => hint.classList.add('is-hidden'), 4600);
    }
    if (state.scene.layoutSettled) state.layoutChecksum = checksumPositions(state.scene.positions);
    invalidate();
  });
  worker.addEventListener('error', (event) => failBoot(event.error || new Error(event.message)));
  const message = {
    type: 'init',
    nodes: state.scene.nodes.map(({ id, group }) => ({ id, group })),
    edges: state.scene.edges.map(({ source, target }) => ({ source, target })),
    initialPositions,
    warmStartCount,
  };
  worker.postMessage(message, initialPositions ? [initialPositions.buffer] : []);
}

async function applyIncrementalTopology(fraction = 0.01) {
  const previous = state.scene;
  const initialPositions = new Float32Array(previous.positions);
  const originalCount = previous.nodes.length;
  const addedCount = Math.max(1, Math.round(originalCount * clamp(Number(fraction) || 0.01, 0.001, 0.1)));
  const nodes = previous.nodes.map(({ id, label, title, path, group }) => ({ id, label, title, path, group }));
  const edges = previous.edges.map(({ source, target, kind }) => ({
    source: previous.nodes[source].id,
    target: previous.nodes[target].id,
    kind,
  }));
  for (let index = 0; index < addedCount; index += 1) {
    const id = `incremental:${originalCount}:${index}`;
    nodes.push({ id, label: `Incremental ${index + 1}`, group: previous.groups[index % Math.max(1, previous.groups.length)] || 'notes' });
    const first = (index * 7919 + 17) % originalCount;
    const second = (index * 1543 + Math.floor(originalCount / 3) + 1) % originalCount;
    edges.push({ source: id, target: previous.nodes[first].id, kind: 'incremental' });
    if (second !== first) edges.push({ source: id, target: previous.nodes[second].id, kind: 'incremental' });
  }
  state.worker?.terminate();
  state.worker = null;
  state.scene = new StellarScene({ nodes, edges }, { presentationProfile: previous.presentation.id });
  state.firstLayout = true;
  state.ready = false;
  state.layoutChecksum = 'pending';
  await state.renderer.setScene(state.scene);
  startLayout({ initialPositions, warmStartCount: originalCount });
  return { originalCount, addedNodes: addedCount, addedEdges: edges.length - previous.edges.length };
}

function observeSize() {
  new ResizeObserver(resize).observe(shell);
  addEventListener('resize', resize, { passive: true });
  resize();
}

function resize() {
  const bounds = shell.getBoundingClientRect();
  state.width = Math.max(1, bounds.width);
  state.height = Math.max(1, bounds.height);
  state.dpr = Math.min(2, devicePixelRatio || 1);
  state.renderer?.resize({ width: state.width, height: state.height, dpr: state.dpr });
  labelCanvas.width = Math.round(state.width * state.dpr);
  labelCanvas.height = Math.round(state.height * state.dpr);
  labelCanvas.style.width = `${state.width}px`;
  labelCanvas.style.height = `${state.height}px`;
  labelContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  invalidate();
}

function invalidate() {
  if (!state.raf) state.raf = requestAnimationFrame(renderFrame);
}

function renderFrame(now) {
  state.raf = 0;
  state.renderCount += 1;
  const started = performance.now();
  const elapsed = state.lastFrameAt ? Math.min(48, now - state.lastFrameAt) : 16.7;
  state.lastFrameAt = now;
  const moving = advanceMotion(now, elapsed);
  state.scene.setPresentationZoom(state.overviewDistance / Math.max(1, state.camera.distance));
  const { matrix } = viewProjection(state.camera, state.width, state.height);
  state.scene.updateProjection(matrix, state.width, state.height);
  state.renderer?.render({ matrix });
  drawLabels();
  const duration = performance.now() - started;
  frameSamples.push(duration);
  if (frameSamples.length > 240) frameSamples.shift();
  updateTelemetry();
  if (moving) invalidate();
}

function advanceMotion(now, elapsed) {
  const motion = state.motion;
  if (!motion) return false;
  if (motion.kind === 'focus') {
    const progress = clamp((now - motion.startedAt) / motion.duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    state.camera.target = interpolate3(motion.fromTarget, motion.toTarget, eased);
    state.camera.distance = mix(motion.fromDistance, motion.toDistance, eased);
    if (progress >= 1) state.motion = null;
    return progress < 1;
  }
  if (motion.kind === 'inertia') {
    state.camera.yaw += motion.yawVelocity * elapsed;
    state.camera.pitch = clamp(state.camera.pitch + motion.pitchVelocity * elapsed, -1.43, 1.43);
    const damping = Math.exp(-elapsed / 82);
    motion.yawVelocity *= damping;
    motion.pitchVelocity *= damping;
    if (Math.abs(motion.yawVelocity) + Math.abs(motion.pitchVelocity) < 0.000002) {
      state.motion = null;
      return false;
    }
    return true;
  }
  state.motion = null;
  return false;
}

function drawLabels() {
  labelContext.clearRect(0, 0, state.width, state.height);
  if (!showLabels) {
    state.scene.labelPlacements = [];
    state.labelOverlaps = 0;
    return;
  }
  const placements = state.scene.placeLabels(state.width, state.height, measureLabel);
  state.labelOverlaps = countOverlaps(placements);
  labelContext.textBaseline = 'alphabetic';
  labelContext.lineJoin = 'round';
  for (const label of placements.sort((left, right) => right.depth - left.depth)) {
    const node = state.scene.nodes[label.index];
    const selected = label.index === state.scene.selected || label.index === state.scene.pathTarget;
    const path = state.scene.pathNodes.has(label.index);
    labelContext.font = `${label.priority ? 620 : 520} ${label.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    labelContext.strokeStyle = 'rgba(246, 246, 239, .92)';
    labelContext.lineWidth = label.priority ? 4 : 3;
    labelContext.strokeText(label.text, label.x, label.y);
    labelContext.fillStyle = path ? '#bd6740' : selected ? '#2e7368' : 'rgba(37, 43, 39, .78)';
    labelContext.fillText(label.text, label.x, label.y);

    if (label.priority) {
      const projected = label.index * 4;
      const nodeX = state.scene.projected[projected];
      const nodeY = state.scene.projected[projected + 1];
      const edgeX = clamp(nodeX, label.box.left, label.box.right);
      const edgeY = clamp(nodeY, label.box.top, label.box.bottom);
      labelContext.beginPath();
      labelContext.moveTo(nodeX, nodeY);
      labelContext.lineTo(edgeX, edgeY);
      labelContext.strokeStyle = path ? 'rgba(189, 103, 64, .48)' : 'rgba(46, 115, 104, .42)';
      labelContext.lineWidth = 0.75;
      labelContext.stroke();
    }
  }
}

function measureLabel(text, size, priority) {
  const key = `${size}:${priority ? 1 : 0}:${text}`;
  if (widthCache.has(key)) return widthCache.get(key);
  labelContext.font = `${priority ? 620 : 520} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const width = labelContext.measureText(text).width;
  if (widthCache.size > 1500) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

function installInteractions() {
  shell.addEventListener('contextmenu', (event) => event.preventDefault());
  shell.addEventListener('pointerdown', pointerDown);
  shell.addEventListener('pointermove', pointerMove);
  shell.addEventListener('pointerup', pointerUp);
  shell.addEventListener('pointercancel', pointerUp);
  shell.addEventListener('wheel', wheel, { passive: false });
  shell.addEventListener('dblclick', doubleClick);
  addEventListener('keydown', keyDown);
}

function pointerDown(event) {
  dismissHint();
  state.motion = null;
  shell.setPointerCapture?.(event.pointerId);
  state.pointers.set(event.pointerId, pointerPoint(event));
  if (state.pointers.size >= 2) {
    state.suppressTap = true;
    state.gesture = multiGesture();
    shell.dataset.gesture = 'move';
    return;
  }
  state.suppressTap = false;
  state.gesture = {
    kind: event.button === 1 || event.button === 2 || event.shiftKey || event.metaKey || event.ctrlKey ? 'pan' : 'orbit',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    lastAt: performance.now(),
    moved: false,
    yawVelocity: 0,
    pitchVelocity: 0,
  };
  shell.dataset.gesture = state.gesture.kind;
}

function pointerMove(event) {
  const stored = state.pointers.get(event.pointerId);
  if (stored) state.pointers.set(event.pointerId, pointerPoint(event));
  if (state.pointers.size >= 2) {
    const previous = state.gesture?.kind === 'multi' ? state.gesture : multiGesture();
    const next = multiGesture();
    const dx = next.centerX - previous.centerX;
    const dy = next.centerY - previous.centerY;
    const scale = previous.distance > 1 ? next.distance / previous.distance : 1;
    panCamera(dx, dy);
    state.camera.distance = clamp(state.camera.distance / Math.max(0.3, scale), 24, 30000);
    state.gesture = next;
    invalidate();
    return;
  }
  const gesture = state.gesture;
  if (gesture && gesture.pointerId === event.pointerId && stored) {
    const now = performance.now();
    const dx = event.clientX - gesture.lastX;
    const dy = event.clientY - gesture.lastY;
    const dt = Math.max(4, now - gesture.lastAt);
    gesture.moved ||= Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5;
    if (gesture.kind === 'pan') {
      panCamera(dx, dy);
    } else {
      orbitCamera(dx, dy);
      gesture.yawVelocity = (-dx * 0.0048) / dt;
      gesture.pitchVelocity = (-dy * 0.0042) / dt;
    }
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastAt = now;
    invalidate();
    return;
  }
  if (event.pointerType === 'mouse') updateHover(event.clientX, event.clientY);
}

function pointerUp(event) {
  const gesture = state.gesture;
  const wasMulti = state.pointers.size >= 2 || gesture?.kind === 'multi' || state.suppressTap;
  state.pointers.delete(event.pointerId);
  shell.releasePointerCapture?.(event.pointerId);
  if (wasMulti) {
    if (state.pointers.size < 2) state.gesture = null;
    if (!state.pointers.size) state.suppressTap = false;
    delete shell.dataset.gesture;
    return;
  }
  state.gesture = null;
  delete shell.dataset.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  if (!gesture.moved) {
    handleTap(event.clientX, event.clientY);
  } else if (gesture.kind === 'orbit' && !reducedMotion) {
    state.motion = {
      kind: 'inertia',
      yawVelocity: gesture.yawVelocity,
      pitchVelocity: gesture.pitchVelocity,
    };
    invalidate();
  }
}

function wheel(event) {
  event.preventDefault();
  dismissHint();
  state.motion = null;
  const magnitude = event.deltaMode === 1 ? event.deltaY * 14 : event.deltaY;
  state.camera.distance = clamp(state.camera.distance * Math.exp(magnitude * 0.00135), 24, 30000);
  invalidate();
}

function doubleClick(event) {
  event.preventDefault();
  const index = pickAt(event.clientX, event.clientY);
  if (index >= 0) focusNode(index);
  else overview();
}

function handleTap(clientX, clientY) {
  const now = performance.now();
  const index = pickAt(clientX, clientY);
  if (state.lastTap && now - state.lastTap.at < 330 && Math.hypot(clientX - state.lastTap.x, clientY - state.lastTap.y) < 20) {
    if (index >= 0) focusNode(index);
    else overview();
    state.lastTap = null;
    return;
  }
  state.lastTap = { at: now, x: clientX, y: clientY };
  if (index >= 0) selectNode(index);
  else if (state.scene.pathTarget >= 0) {
    state.scene.clearPath();
    syncInteraction();
  }
}

function updateHover(clientX, clientY) {
  const index = pickAt(clientX, clientY);
  if (!state.scene.setHovered(index)) return;
  shell.dataset.hovering = index >= 0 ? 'node' : '';
  state.renderer.updateInteraction(state.scene);
  invalidate();
}

function pickAt(clientX, clientY) {
  const bounds = shell.getBoundingClientRect();
  return state.scene.pick(clientX - bounds.left, clientY - bounds.top, coarsePointer ? 16 : 9);
}

function selectNode(index) {
  state.scene.select(index);
  syncInteraction();
  if (state.scene.pathTarget >= 0 && state.scene.pathLength > 0) focusPath();
  else focusNode(state.scene.selected);
}

function syncInteraction() {
  state.renderer.updateInteraction(state.scene);
  updateDetail();
  invalidate();
}

function updateDetail() {
  const node = state.scene.selectedNode;
  detail.classList.toggle('is-visible', Boolean(node));
  if (!node) return;
  detailTitle.textContent = node.title;
  detailPath.textContent = node.path || node.group;
  detailMeta.textContent = `${node.degree} ${node.degree === 1 ? 'link' : 'links'}`;
  liveRegion.textContent = `${node.title}, ${detailMeta.textContent}`;
}

function focusNode(index, { preserveDistance = false } = {}) {
  if (index < 0) return;
  const offset = index * 3;
  const target = [state.scene.positions[offset], state.scene.positions[offset + 1], state.scene.positions[offset + 2]];
  const focalDistance = state.width < 600 ? 470 : 350;
  moveCamera(target, preserveDistance ? state.camera.distance : Math.min(state.camera.distance, focalDistance));
}

function focusPath() {
  const source = state.scene.selected * 3;
  const destination = state.scene.pathTarget * 3;
  const from = [state.scene.positions[source], state.scene.positions[source + 1], state.scene.positions[source + 2]];
  const to = [state.scene.positions[destination], state.scene.positions[destination + 1], state.scene.positions[destination + 2]];
  const center = scale3(add3(from, to), 0.5);
  const separation = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const minimum = state.width < 600 ? 470 : 340;
  const distance = clamp(separation / Math.tan(state.camera.fov / 2) * 0.72 + 105, minimum, 5000);
  moveCamera(center, distance);
}

function overview({ immediate = false } = {}) {
  if (!state.scene) return;
  const bounds = state.scene.bounds();
  const aspect = Math.max(0.45, state.width / state.height);
  const distance = clamp((bounds.radius / Math.sin(state.camera.fov / 2)) * (aspect < 1 ? 1 / aspect : 1) * 1.08, 90, 30000);
  state.overviewDistance = distance;
  moveCamera(bounds.center, distance, immediate);
}

function moveCamera(target, distance, immediate = reducedMotion) {
  state.motion = null;
  if (immediate) {
    state.camera.target = [...target];
    state.camera.distance = distance;
    invalidate();
    return;
  }
  state.motion = {
    kind: 'focus',
    startedAt: performance.now(),
    duration: 420,
    fromTarget: [...state.camera.target],
    toTarget: [...target],
    fromDistance: state.camera.distance,
    toDistance: distance,
  };
  invalidate();
}

function orbitCamera(dx, dy) {
  state.camera.yaw -= dx * 0.0048;
  state.camera.pitch = clamp(state.camera.pitch - dy * 0.0042, -1.43, 1.43);
}

function panCamera(dx, dy) {
  const { right, up } = cameraBasis(state.camera);
  const unitsPerPixel = (2 * state.camera.distance * Math.tan(state.camera.fov / 2)) / Math.max(1, state.height);
  state.camera.target = add3(
    subtract3(state.camera.target, scale3(right, dx * unitsPerPixel)),
    scale3(up, dy * unitsPerPixel),
  );
}

function keyDown(event) {
  if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const step = event.shiftKey ? 0.16 : 0.055;
  if (event.key === 'Escape') {
    state.motion = null;
    if (state.scene.pathTarget >= 0) state.scene.clearPath();
    else state.scene.clearSelection();
    syncInteraction();
    return;
  }
  if (event.key.toLowerCase() === 'o') {
    event.preventDefault();
    overview();
    return;
  }
  if (event.key.toLowerCase() === 'f' && state.scene.selectedNode) {
    event.preventDefault();
    focusNode(state.scene.pathTarget >= 0 ? state.scene.pathTarget : state.scene.selected);
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    state.camera.distance = clamp(state.camera.distance * 0.82, 24, 30000);
    invalidate();
    return;
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    state.camera.distance = clamp(state.camera.distance * 1.22, 24, 30000);
    invalidate();
    return;
  }
  const directions = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  state.motion = null;
  state.camera.yaw += direction[0];
  state.camera.pitch = clamp(state.camera.pitch + direction[1], -1.43, 1.43);
  invalidate();
}

function multiGesture() {
  const points = [...state.pointers.values()].slice(0, 2);
  const first = points[0] || { x: 0, y: 0 };
  const second = points[1] || first;
  return {
    kind: 'multi',
    centerX: (first.x + second.x) / 2,
    centerY: (first.y + second.y) / 2,
    distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
  };
}

function pointerPoint(event) { return { x: event.clientX, y: event.clientY }; }

function updateTelemetry() {
  if (!showTelemetry) return;
  telemetry.hidden = false;
  const stats = frameStats();
  telemetry.textContent = `${state.renderer?.kind || '—'} · ${state.scene.nodes.length} nodes · ${state.scene.edges.length} links · ${stats.p95.toFixed(1)} ms p95`;
}

function frameStats() {
  if (!frameSamples.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...frameSamples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1),
  };
}

function exposeBenchmarkContract() {
  window.__exoStellarLab = {
    snapshot() {
      return {
        renderer: state.renderer?.kind || 'initializing',
        profile: state.scene?.presentation.id || presentationProfileId,
        profileHash: presentationProfileHash(state.scene?.presentation || presentationProfileId),
        ready: state.ready,
        camera: {
          yaw: state.camera.yaw,
          pitch: state.camera.pitch,
          distance: state.camera.distance,
          target: [...state.camera.target],
        },
        nodeCount: state.scene?.nodes.length || 0,
        edgeCount: state.scene?.edges.length || 0,
        selected: state.scene?.selected >= 0 ? state.scene.selected : null,
        pathLength: state.scene?.pathLength || 0,
        frameStats: frameStats(),
        renderCount: state.renderCount,
        rendererFailures: state.rendererFailures,
        moving: Boolean(state.motion),
        gpuTiming: state.renderer?.gpuTimingSnapshot?.() || {
          supported: false,
          reason: `${state.renderer?.kind || 'initializing'} does not expose WebGPU timestamp queries.`,
          samples: [],
          stats: { count: 0, p50: null, p95: null, max: null },
        },
        layout: {
          epoch: state.scene?.layoutEpoch || 0,
          energy: Number.isFinite(state.scene?.layoutEnergy) ? state.scene.layoutEnergy : 0,
          settled: Boolean(state.scene?.layoutSettled),
          checksum: state.layoutChecksum,
        },
        labels: {
          count: state.scene?.labelPlacements.length || 0,
          overlaps: state.labelOverlaps,
        },
      };
    },
    actions: {
      overview: () => overview({ immediate: true }),
      select: (index) => selectNode(index),
      render: () => invalidate(),
      exerciseRendererRecovery: async () => {
        await handleRendererFailure(new Error('GraphBench injected renderer failure'), state.rendererGeneration);
        await handleRendererFailure(new Error('GraphBench injected renderer failure'), state.rendererGeneration);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return state.renderer?.kind || null;
      },
      incrementalUpdate: (fraction) => applyIncrementalTopology(fraction),
      positions: () => ({ dimensions: 3, values: Array.from(state.scene?.positions || []) }),
      clear: () => {
        state.scene.clearSelection();
        syncInteraction();
      },
    },
  };
}

function dismissHint() { hint.classList.add('is-hidden'); }

function failBoot(error) {
  console.error(error);
  loading.classList.remove('is-hidden');
  loading.querySelector('span:last-child').textContent = 'Graph unavailable';
  shell.classList.add('has-error');
}

function countOverlaps(labels) {
  let count = 0;
  for (let left = 0; left < labels.length; left++) {
    for (let right = left + 1; right < labels.length; right++) {
      const a = labels[left].box;
      const b = labels[right].box;
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) count++;
    }
  }
  return count;
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function interpolate3(from, to, amount) {
  return [mix(from[0], to[0], amount), mix(from[1], to[1], amount), mix(from[2], to[2], amount)];
}

function mix(from, to, amount) { return from + (to - from) * amount; }

function checksumPositions(positions) {
  const words = new Uint32Array(positions.buffer, positions.byteOffset, positions.byteLength / 4);
  let hash = 2166136261;
  for (let index = 0; index < words.length; index++) hash = Math.imul(hash ^ words[index], 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

addEventListener('beforeunload', () => {
  state.worker?.postMessage({ type: 'dispose' });
  state.renderer?.destroy();
});
