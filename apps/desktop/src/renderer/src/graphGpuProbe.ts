import type { GraphPresentationPlan } from "./graphPresentation";
import {
  GraphWebGpuRenderer,
  GraphWebGpuRendererError,
  runtimeGraphGpu,
  type GraphGpuAdapter,
  type GraphGpuDevice,
  type GraphGpuRuntime,
  type GraphWebGpuSurface,
} from "./graphWebGpuRenderer";

export type GraphGpuProbeStatus =
  | "success"
  | "navigator-gpu-absent"
  | "runtime-incomplete"
  | "adapter-unavailable"
  | "adapter-request-failure"
  | "device-failure"
  | "shader-compilation-failure"
  | "validation-failure"
  | "context-failure"
  | "draw-failure";

export interface GraphGpuProbeDeviceInfo {
  features: string[];
  limits: Record<string, number>;
}

export interface GraphGpuProbeAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  features: string[];
  limits: Record<string, number>;
}

export interface GraphGpuProbeResult {
  version: "0.1";
  status: GraphGpuProbeStatus;
  message: string;
  userAgent: string;
  adapter?: GraphGpuProbeAdapterInfo;
  device?: GraphGpuProbeDeviceInfo;
  draw?: {
    cpuMilliseconds: number;
    drawCalls: number;
    nodes: number;
    edges: number;
    width: number;
    height: number;
    dpr: number;
    submittedWorkCompleted: boolean;
  };
}

interface QueueWithCompletion {
  onSubmittedWorkDone?: () => Promise<void>;
}

interface AdapterWithInfo extends GraphGpuAdapter {
  info?: unknown;
  features?: Iterable<string>;
  limits?: Record<string, unknown>;
  requestAdapterInfo?: () => Promise<unknown>;
}

interface DeviceWithInfo extends GraphGpuDevice {
  features?: Iterable<string>;
  limits: { maxStorageBufferBindingSize: number } & Record<string, unknown>;
  queue: GraphGpuDevice["queue"] & QueueWithCompletion;
}

export async function probeGraphWebGpu(source: unknown = globalThis): Promise<GraphGpuProbeResult> {
  const userAgent = readUserAgent(source);
  if (!hasNavigatorGpu(source)) {
    return failure("navigator-gpu-absent", "navigator.gpu is absent.", userAgent);
  }

  const runtime = runtimeGraphGpu(source);
  if (!runtime) {
    return failure("runtime-incomplete", "WebGPU globals are incomplete.", userAgent);
  }

  let adapter: AdapterWithInfo | null;
  try {
    adapter = await runtime.gpu.requestAdapter({ powerPreference: "high-performance" }) as AdapterWithInfo | null;
  } catch (error) {
    return failure("adapter-request-failure", errorMessage(error, "WebGPU adapter request failed."), userAgent);
  }
  if (!adapter) {
    return failure("adapter-unavailable", "navigator.gpu returned no adapter.", userAgent);
  }

  const adapterInfo = await inspectAdapter(adapter);
  let capturedDevice: DeviceWithInfo | null = null;
  const probeRuntime: GraphGpuRuntime = {
    ...runtime,
    gpu: {
      getPreferredCanvasFormat: () => runtime.gpu.getPreferredCanvasFormat(),
      requestAdapter: async () => ({
        requestDevice: async () => {
          capturedDevice = await adapter.requestDevice() as DeviceWithInfo;
          return capturedDevice;
        },
      }),
    },
  };

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  let renderer: GraphWebGpuRenderer | null = null;
  try {
    renderer = await GraphWebGpuRenderer.create(canvas as unknown as GraphWebGpuSurface, probeRuntime);
    renderer.resize({ width: 64, height: 64, dpr: 1 });
    const measurement = renderer.render(probePresentationPlan());
    let submittedWorkCompleted = false;
    const device = capturedDevice as DeviceWithInfo | null;
    const completion = device?.queue.onSubmittedWorkDone;
    if (completion) {
      await completion.call(device.queue);
      submittedWorkCompleted = true;
    }
    return {
      version: "0.1",
      status: "success",
      message: "The production graph WebGPU pipeline compiled and submitted a bounded draw.",
      userAgent,
      adapter: adapterInfo,
      device: device ? inspectDevice(device) : undefined,
      draw: { ...measurement, submittedWorkCompleted },
    };
  } catch (error) {
    const classified = classifyGraphGpuProbeError(error);
    return {
      version: "0.1",
      ...classified,
      userAgent,
      adapter: adapterInfo,
      device: capturedDevice ? inspectDevice(capturedDevice) : undefined,
    };
  } finally {
    renderer?.destroy();
  }
}

export function classifyGraphGpuProbeError(error: unknown): Pick<GraphGpuProbeResult, "status" | "message"> {
  if (error instanceof GraphWebGpuRendererError) {
    switch (error.code) {
      case "adapter-unavailable":
        return { status: "adapter-unavailable", message: error.message };
      case "device-unavailable":
        return { status: "device-failure", message: error.message };
      case "shader-compilation":
        return { status: "shader-compilation-failure", message: error.message };
      case "validation":
        return { status: "validation-failure", message: error.message };
      case "context-unavailable":
        return { status: "context-failure", message: error.message };
      case "resource-limit":
      case "invalid-plan":
      case "draw-failed":
      case "device-lost":
        return { status: "draw-failure", message: error.message };
    }
  }
  return { status: "draw-failure", message: errorMessage(error, "WebGPU probe failed.") };
}

function failure(status: GraphGpuProbeStatus, message: string, userAgent: string): GraphGpuProbeResult {
  return { version: "0.1", status, message, userAgent };
}

function hasNavigatorGpu(source: unknown): boolean {
  const root = source as { navigator?: { gpu?: unknown } };
  return root.navigator?.gpu !== undefined && root.navigator.gpu !== null;
}

function readUserAgent(source: unknown): string {
  const root = source as { navigator?: { userAgent?: unknown } };
  return typeof root.navigator?.userAgent === "string" ? root.navigator.userAgent : "unknown";
}

async function inspectAdapter(adapter: AdapterWithInfo): Promise<GraphGpuProbeAdapterInfo> {
  let rawInfo = adapter.info;
  if (!rawInfo && adapter.requestAdapterInfo) {
    try {
      rawInfo = await adapter.requestAdapterInfo();
    } catch {
      rawInfo = undefined;
    }
  }
  const info = isRecord(rawInfo) ? rawInfo : {};
  return {
    ...optionalText("vendor", info.vendor),
    ...optionalText("architecture", info.architecture),
    ...optionalText("device", info.device),
    ...optionalText("description", info.description),
    features: stringList(adapter.features),
    limits: numericRecord(adapter.limits),
  };
}

function inspectDevice(device: DeviceWithInfo): GraphGpuProbeDeviceInfo {
  return {
    features: stringList(device.features),
    limits: numericRecord(device.limits),
  };
}

function stringList(value: Iterable<string> | undefined): string[] {
  if (!value || typeof value[Symbol.iterator] !== "function") return [];
  return Array.from(value, (entry) => String(entry)).sort();
}

function numericRecord(value: Record<string, unknown> | undefined): Record<string, number> {
  if (!value) return {};
  const result: Record<string, number> = {};
  const keys = new Set([
    ...Object.keys(value),
    "maxBindGroups",
    "maxBufferSize",
    "maxComputeInvocationsPerWorkgroup",
    "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupSizeY",
    "maxComputeWorkgroupSizeZ",
    "maxStorageBufferBindingSize",
    "maxStorageBuffersPerShaderStage",
    "maxUniformBufferBindingSize",
    "maxTextureDimension2D",
  ]);
  for (const key of Array.from(keys).sort()) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) result[key] = candidate;
  }
  return result;
}

function optionalText<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  if (typeof value !== "string" || value.length === 0) return {};
  return { [key]: value.slice(0, 256) } as Partial<Record<Key, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function probePresentationPlan(): GraphPresentationPlan {
  return {
    version: "0.1",
    topologyHash: "gpu-probe:topology",
    layoutEpochId: "gpu-probe:layout",
    viewport: { width: 64, height: 64 },
    profile: "exploration",
    clearColor: null,
    nodes: {
      indices: new Uint32Array([0, 1]),
      centers: new Float32Array([16, 32, 48, 32]),
      depths: new Float32Array([0.75, 0.25]),
      visualClasses: new Uint8Array([0, 1]),
      radii: new Float32Array([4, 5]),
      opacities: new Float32Array([0.8, 1]),
      fillColors: new Uint32Array([0x3f7d72ff, 0xbf6840ff]),
      strokeColors: new Uint32Array([0x3f7d72ff, 0xbf6840ff]),
      strokeWidths: new Float32Array([0, 1]),
      strokeOpacities: new Float32Array([0, 1]),
      emphasis: new Uint8Array([0, 1]),
    },
    edges: {
      indices: new Uint32Array([0]),
      curves: new Float32Array([16, 32, 32, 24, 48, 32]),
      depths: new Float32Array([0.5]),
      visualClasses: new Uint8Array([0]),
      widths: new Float32Array([1]),
      opacities: new Float32Array([0.5]),
      strokeColors: new Uint32Array([0x3f7d72aa]),
      emphasis: new Uint8Array([0]),
    },
    labels: { placements: [], omittedRequired: [] },
    labelStyle: {
      font: "11px monospace",
      requiredFont: "600 11px monospace",
      color: 0x202522ff,
      requiredColor: 0x3f7d72ff,
      opacity: 0.9,
    },
  };
}
