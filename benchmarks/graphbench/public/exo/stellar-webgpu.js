const NODE_STRIDE = 32;
const EDGE_STRIDE = 16;
const EDGE_SEGMENTS = 8;
const FRAME_BYTE_SIZE = 112;
const MAX_DEVICE_PIXEL_RATIO = 2;

export class StellarWebGPURenderer {
  static async create(canvas, onFailure) {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice();
    let renderer = null;
    try {
      renderer = new StellarWebGPURenderer(canvas, adapter, device, onFailure);
      await renderer.ready;
      return renderer;
    } catch (error) {
      if (renderer) renderer.destroy();
      else device.destroy();
      throw error;
    }
  }

  constructor(canvas, adapter, device, onFailure) {
    this.kind = 'webgpu';
    this.canvas = canvas;
    this.adapter = adapter;
    this.device = device;
    this.onFailure = onFailure;
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new Error('Could not create a WebGPU canvas context');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.frameBuffer = device.createBuffer({
      label: 'stellar frame',
      size: align(FRAME_BYTE_SIZE, 16),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.frameData = new Float32Array(FRAME_BYTE_SIZE / Float32Array.BYTES_PER_ELEMENT);
    this.depthTexture = null;
    this.depthView = null;
    this.nodeBuffer = null;
    this.edgeBuffer = null;
    this.bindGroup = null;
    this.scene = null;
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.destroyed = false;
    this.failed = false;
    this.failureReported = false;
    this.ready = this.initializePipelines();
    this.device.lost.then((information) => {
      if (this.destroyed || information.reason === 'destroyed') return;
      this.reportFailure(new Error(`WebGPU device lost: ${information.message || information.reason}`));
    });
    this.handleUncapturedError = (event) => {
      event.preventDefault?.();
      this.reportFailure(event.error || new Error('WebGPU validation error'));
    };
    this.device.addEventListener?.('uncapturederror', this.handleUncapturedError);
  }

  async initializePipelines() {
    const device = this.device;
    device.pushErrorScope('validation');
    let initializationError = null;
    try {
      this.bindGroupLayout = device.createBindGroupLayout({
        label: 'stellar scene layout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform', minBindingSize: FRAME_BYTE_SIZE },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage', minBindingSize: NODE_STRIDE },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage', minBindingSize: EDGE_STRIDE },
          },
        ],
      });
      const layout = device.createPipelineLayout({ label: 'stellar pipeline layout', bindGroupLayouts: [this.bindGroupLayout] });
      const nodeModule = device.createShaderModule({ label: 'stellar nodes', code: NODE_SHADER });
      const edgeModule = device.createShaderModule({ label: 'stellar edges', code: EDGE_SHADER });
      await Promise.all([
        assertShaderCompiles(nodeModule, 'stellar nodes'),
        assertShaderCompiles(edgeModule, 'stellar edges'),
      ]);
      const blend = {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
      [this.edgePipeline, this.nodePipeline] = await Promise.all([
        device.createRenderPipelineAsync({
          label: 'stellar edge pipeline', layout,
          vertex: { module: edgeModule, entryPoint: 'vertexMain' },
          fragment: { module: edgeModule, entryPoint: 'fragmentMain', targets: [{ format: this.format, blend }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
        }),
        device.createRenderPipelineAsync({
          label: 'stellar node pipeline', layout,
          vertex: { module: nodeModule, entryPoint: 'vertexMain' },
          fragment: { module: nodeModule, entryPoint: 'fragmentMain', targets: [{ format: this.format, blend }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        }),
      ]);
    } catch (error) {
      initializationError = error;
    }
    const validationError = await device.popErrorScope().catch((error) => error);
    if (initializationError) throw initializationError;
    if (validationError) throw validationError;
  }

  async setScene(scene) {
    await this.ready;
    if (this.destroyed || this.failed) return;
    this.scene = scene;
    this.nodeCount = scene.nodes.length;
    this.edgeCount = scene.edges.length;
    const nodeBytes = Math.max(NODE_STRIDE, align(scene.nodeGpuData.byteLength, 16));
    const edgeBytes = Math.max(EDGE_STRIDE, align(scene.edgeGpuData.byteLength, 16));
    const storageLimit = this.device.limits.maxStorageBufferBindingSize;
    if (nodeBytes > storageLimit || edgeBytes > storageLimit) {
      throw new Error(`Graph exceeds this GPU's storage-buffer limit (${storageLimit} bytes)`);
    }
    this.nodeBuffer?.destroy();
    this.edgeBuffer?.destroy();
    this.nodeBuffer = this.device.createBuffer({
      label: 'stellar nodes',
      size: nodeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.edgeBuffer = this.device.createBuffer({
      label: 'stellar edges',
      size: edgeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = this.device.createBindGroup({
      label: 'stellar scene', layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } },
        { binding: 2, resource: { buffer: this.edgeBuffer } },
      ],
    });
    this.updateScene(scene, true);
  }

  updateScene(scene, includeEdges = false) {
    this.scene = scene;
    if (!this.nodeBuffer || this.destroyed || this.failed) return;
    const nodes = scene.buildGpuNodes();
    if (nodes.byteLength) this.device.queue.writeBuffer(this.nodeBuffer, 0, nodes);
    if (includeEdges && this.edgeBuffer && scene.edgeGpuData.byteLength) {
      this.device.queue.writeBuffer(this.edgeBuffer, 0, scene.edgeGpuData);
    }
  }

  updateInteraction(scene) {
    if (!this.nodeBuffer || !this.edgeBuffer || this.destroyed || this.failed) return;
    const nodes = scene.buildGpuNodes();
    if (nodes.byteLength) this.device.queue.writeBuffer(this.nodeBuffer, 0, nodes);
    if (scene.edgeGpuData.byteLength) this.device.queue.writeBuffer(this.edgeBuffer, 0, scene.edgeGpuData);
  }

  resize({ width, height, dpr }) {
    if (this.destroyed || this.failed) return;
    const logicalWidth = Math.max(1, Number.isFinite(width) ? width : 1);
    const logicalHeight = Math.max(1, Number.isFinite(height) ? height : 1);
    const resolvedDpr = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(0.5, Number.isFinite(dpr) ? dpr : 1));
    const physicalWidth = Math.max(1, Math.round(logicalWidth * resolvedDpr));
    const physicalHeight = Math.max(1, Math.round(logicalHeight * resolvedDpr));
    if (physicalWidth === this.width && physicalHeight === this.height) return;
    this.width = physicalWidth;
    this.height = physicalHeight;
    this.dpr = resolvedDpr;
    this.canvas.width = physicalWidth;
    this.canvas.height = physicalHeight;
    this.canvas.style.width = `${logicalWidth}px`;
    this.canvas.style.height = `${logicalHeight}px`;
    this.context.configure({
      device: this.device,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: 'opaque',
      colorSpace: 'srgb',
    });
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: 'stellar depth', size: [physicalWidth, physicalHeight], format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
  }

  render({ matrix }) {
    if (!this.bindGroup || !this.depthView || this.destroyed || this.failed) return { cpuMilliseconds: 0 };
    if (!matrix || matrix.length !== 16) return { cpuMilliseconds: 0 };
    const started = performance.now();
    this.frameData.set(matrix, 0);
    this.frameData[16] = this.width;
    this.frameData[17] = this.height;
    this.frameData[18] = 1 / this.width;
    this.frameData[19] = 1 / this.height;
    this.frameData[20] = this.dpr;
    this.frameData[21] = this.scene?.presentationZoom || 1;
    this.frameData[22] = this.scene?.presentation.radiusMin || 3.6;
    this.frameData[23] = this.scene?.presentation.radiusMax || 11.5;
    this.frameData[24] = this.scene?.presentation.aura.selectedScale || 1;
    this.frameData[25] = this.scene?.presentation.aura.hoveredScale || 1;
    this.frameData[26] = this.scene?.presentation.aura.selectedAlpha || 0;
    this.frameData[27] = this.scene?.presentation.aura.hoveredAlpha || 0;
    this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameData);
    try {
      const encoder = this.device.createCommandEncoder({ label: 'stellar frame' });
      const pass = encoder.beginRenderPass({
        label: 'stellar pass',
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.956, g: 0.956, b: 0.933, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: this.depthView,
          depthClearValue: 1,
          depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      });
      pass.setBindGroup(0, this.bindGroup);
      if (this.edgeCount) {
        pass.setPipeline(this.edgePipeline);
        pass.draw(6 * EDGE_SEGMENTS, this.edgeCount);
      }
      if (this.nodeCount) {
        pass.setPipeline(this.nodePipeline);
        pass.draw(6, this.nodeCount);
      }
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      this.reportFailure(error);
    }
    return { cpuMilliseconds: performance.now() - started };
  }

  reportFailure(error) {
    if (this.destroyed || this.failureReported) return;
    this.failed = true;
    this.failureReported = true;
    this.onFailure?.(error instanceof Error ? error : new Error(String(error)));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.device.removeEventListener?.('uncapturederror', this.handleUncapturedError);
    this.depthTexture?.destroy();
    this.depthView = null;
    this.nodeBuffer?.destroy();
    this.edgeBuffer?.destroy();
    this.frameBuffer?.destroy();
    this.context.unconfigure?.();
    this.device.destroy();
  }
}

const NODE_SHADER = /* wgsl */`
struct Frame {
  viewProjection: mat4x4<f32>,
  viewport: vec4<f32>,
  params: vec4<f32>,
  effects: vec4<f32>,
};
struct Node { positionRadius: vec4<f32>, visual: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) @interpolate(flat) flags: u32,
  @location(3) @interpolate(flat) visible: u32,
};
fn palette(index: u32) -> vec3<f32> {
  let colors = array<vec3<f32>, 8>(
    vec3(0.247, 0.490, 0.447), vec3(0.749, 0.408, 0.251),
    vec3(0.471, 0.412, 0.612), vec3(0.541, 0.482, 0.306),
    vec3(0.322, 0.467, 0.612), vec3(0.608, 0.373, 0.424),
    vec3(0.396, 0.510, 0.357), vec3(0.553, 0.408, 0.298)
  );
  return colors[index % 8u];
}
@vertex fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
    vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0)
  );
  let node = nodes[instanceIndex];
  let center = frame.viewProjection * vec4(node.positionRadius.xyz, 1.0);
  let corner = corners[vertexIndex];
  let radius = clamp(node.positionRadius.w * frame.params.y, frame.params.z, frame.params.w) * frame.params.x;
  let selected = (u32(node.visual.z) & 1u) != 0u;
  let hovered = (u32(node.visual.z) & 8u) != 0u;
  let auraScale = select(select(1.0, frame.effects.y, hovered), frame.effects.x, selected);
  let offset = corner * radius * auraScale * vec2(2.0 * frame.viewport.z, 2.0 * frame.viewport.w);
  var output: VertexOutput;
  output.local = corner * auraScale;
  output.color = vec4(palette(u32(node.visual.x)), node.visual.y);
  output.flags = u32(node.visual.z);
  output.visible = 1u;
  if (center.w <= 0.0001) {
    output.position = vec4(2.0, 2.0, 2.0, 1.0);
    output.visible = 0u;
    return output;
  }
  output.position = vec4(center.xy + offset * center.w, center.zw);
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.visible == 0u) { discard; }
  let distance = length(input.local);
  let aa = max(fwidth(distance), 0.008);
  let selected = (input.flags & 1u) != 0u;
  let hovered = (input.flags & 8u) != 0u;
  let auraScale = select(select(1.0, frame.effects.y, hovered), frame.effects.x, selected);
  let auraAlpha = select(select(0.0, frame.effects.w, hovered), frame.effects.z, selected);
  let aura = select(0.0, (1.0 - smoothstep(auraScale - aa, auraScale + aa, distance)) * smoothstep(0.98 - aa, 0.98 + aa, distance) * auraAlpha, selected || hovered);
  let fill = 1.0 - smoothstep(0.82 - aa, 0.82 + aa, distance);
  let ring = select(0.0, 1.0 - smoothstep(1.0 - aa, 1.0 + aa, distance), selected || hovered)
    * select(1.0, smoothstep(0.72 - aa, 0.72 + aa, distance), selected || hovered);
  let alpha = max(max(fill * input.color.a, ring * select(0.78, 1.0, selected)), aura);
  var ringColor = vec3(0.247, 0.490, 0.447);
  if ((input.flags & 4u) != 0u) { ringColor = vec3(0.749, 0.408, 0.251); }
  let color = input.color.rgb * (1.0 - ring) + ringColor * ring;
  return vec4(color * alpha, alpha);
}`;

const EDGE_SHADER = /* wgsl */`
struct Frame {
  viewProjection: mat4x4<f32>,
  viewport: vec4<f32>,
  params: vec4<f32>,
  effects: vec4<f32>,
};
struct Node { positionRadius: vec4<f32>, visual: vec4<f32> };
struct Edge { nodes: vec2<u32>, visual: vec2<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> edges: array<Edge>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) opacity: f32,
  @location(1) width: f32,
  @location(2) @interpolate(flat) visible: u32,
  @location(3) side: f32,
};
@vertex fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let edge = edges[instanceIndex];
  let sourcePosition = nodes[edge.nodes.x].positionRadius.xyz;
  let destinationPosition = nodes[edge.nodes.y].positionRadius.xyz;
  var output: VertexOutput;
  output.opacity = edge.visual.y;
  output.width = edge.visual.x;
  output.visible = 1u;
  output.side = 0.0;
  let delta = destinationPosition - sourcePosition;
  let distance = max(length(delta), 0.001);
  var bendAxis = cross(delta / distance, vec3(0.0, 1.0, 0.0));
  if (length(bendAxis) < 0.01) { bendAxis = cross(delta / distance, vec3(1.0, 0.0, 0.0)); }
  let directionSign = select(-1.0, 1.0, (instanceIndex & 1u) == 0u);
  let control = (sourcePosition + destinationPosition) * 0.5 + normalize(bendAxis) * min(distance * 0.115, 34.0) * directionSign;
  let segment = vertexIndex / 6u;
  let localVertex = vertexIndex % 6u;
  let segmentStart = f32(segment) / ${EDGE_SEGMENTS}.0;
  let segmentEnd = f32(segment + 1u) / ${EDGE_SEGMENTS}.0;
  let along = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0)[localVertex];
  let t = mix(segmentStart, segmentEnd, along);
  let startA = mix(sourcePosition, control, segmentStart);
  let startB = mix(control, destinationPosition, segmentStart);
  let endA = mix(sourcePosition, control, segmentEnd);
  let endB = mix(control, destinationPosition, segmentEnd);
  let startPosition = mix(startA, startB, segmentStart);
  let endPosition = mix(endA, endB, segmentEnd);
  let curveA = mix(sourcePosition, control, t);
  let curveB = mix(control, destinationPosition, t);
  let curvePosition = mix(curveA, curveB, t);
  let source = frame.viewProjection * vec4(startPosition, 1.0);
  let destination = frame.viewProjection * vec4(endPosition, 1.0);
  let base = frame.viewProjection * vec4(curvePosition, 1.0);
  if (source.w <= 0.0001 || destination.w <= 0.0001 || base.w <= 0.0001) {
    output.position = vec4(2.0, 2.0, 2.0, 1.0);
    output.visible = 0u;
    return output;
  }
  let sourceNdc = source.xy / source.w;
  let destinationNdc = destination.xy / destination.w;
  let pixelDelta = (destinationNdc - sourceNdc) * frame.viewport.xy * vec2(0.5, -0.5);
  let direction = pixelDelta / max(length(pixelDelta), 0.001);
  let normal = vec2(-direction.y, direction.x);
  let side = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0)[localVertex];
  output.side = side;
  let offsetNdc = normal * side * edge.visual.x * frame.params.x * vec2(2.0 * frame.viewport.z, 2.0 * frame.viewport.w);
  output.position = vec4(base.xy + offsetNdc * base.w, base.zw);
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.visible == 0u) { discard; }
  let focused = input.width > 1.0;
  let path = input.width > 1.6;
  var color = vec3(0.46, 0.52, 0.48);
  if (focused) { color = vec3(0.247, 0.490, 0.447); }
  if (path) { color = vec3(0.749, 0.408, 0.251); }
  let edgeDistance = abs(input.side);
  let antialias = max(fwidth(edgeDistance), 0.035);
  let coverage = 1.0 - smoothstep(1.0 - antialias, 1.0, edgeDistance);
  let alpha = clamp(input.opacity * coverage, 0.0, 1.0);
  return vec4(color * alpha, alpha);
}`;

async function assertShaderCompiles(module, label) {
  if (!module.getCompilationInfo) return;
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === 'error');
  if (!errors.length) return;
  const details = errors.map((message) => {
    const location = message.lineNum ? `${message.lineNum}:${message.linePos || 1}` : 'unknown';
    return `${location} ${message.message}`;
  }).join('\n');
  throw new Error(`${label} shader failed to compile:\n${details}`);
}

function align(value, alignment) { return Math.ceil(value / alignment) * alignment; }
