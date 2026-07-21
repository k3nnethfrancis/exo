import { describe, expect, it } from "vitest";

import { GraphWebGpuRendererError } from "./graphWebGpuRenderer";
import { classifyGraphGpuProbeError, probeGraphWebGpu } from "./graphGpuProbe";

describe("packaged graph WebGPU probe", () => {
  it("distinguishes an absent navigator.gpu from an incomplete runtime", async () => {
    await expect(probeGraphWebGpu({ navigator: { userAgent: "test" } })).resolves.toMatchObject({
      status: "navigator-gpu-absent",
    });
    await expect(probeGraphWebGpu({ navigator: { userAgent: "test", gpu: {} } })).resolves.toMatchObject({
      status: "runtime-incomplete",
    });
  });

  it.each([
    ["adapter-unavailable", "adapter-unavailable"],
    ["device-unavailable", "device-failure"],
    ["shader-compilation", "shader-compilation-failure"],
    ["validation", "validation-failure"],
    ["context-unavailable", "context-failure"],
    ["resource-limit", "draw-failure"],
    ["invalid-plan", "draw-failure"],
    ["draw-failed", "draw-failure"],
    ["device-lost", "draw-failure"],
  ] as const)("classifies %s as %s", (code, expected) => {
    expect(classifyGraphGpuProbeError(new GraphWebGpuRendererError(code, code))).toEqual({
      status: expected,
      message: code,
    });
  });

  it("keeps adapter request rejection distinct from adapter absence", async () => {
    const result = await probeGraphWebGpu({
      navigator: {
        userAgent: "test",
        gpu: {
          requestAdapter: async () => { throw new Error("adapter crashed"); },
          getPreferredCanvasFormat: () => "bgra8unorm",
        },
      },
      GPUBufferUsage: { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 },
      GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
    });
    expect(result).toMatchObject({ status: "adapter-request-failure", message: "adapter crashed" });
  });
});
