import { describe, expect, it, vi } from "vitest";

import { configureGpuStartup } from "./gpu-startup-policy";

describe("GPU startup policy", () => {
  it("keeps Electron hardware acceleration and feature selection untouched by default", () => {
    const disableHardwareAcceleration = vi.fn();
    expect(configureGpuStartup({ disableHardwareAcceleration }, {})).toBe("electron-default");
    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it("offers only an explicit diagnostic hardware-acceleration disable", () => {
    const disableHardwareAcceleration = vi.fn();
    expect(configureGpuStartup({ disableHardwareAcceleration }, { EXO_DISABLE_GPU: "1" })).toBe("diagnostic-disabled");
    expect(disableHardwareAcceleration).toHaveBeenCalledOnce();
  });
});
