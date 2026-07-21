export interface HardwareAccelerationController {
  disableHardwareAcceleration(): void;
}

export type GpuStartupPolicy = "electron-default" | "diagnostic-disabled";

/**
 * Exo follows Electron's hardware policy by default. The environment escape
 * hatch is diagnostic-only and deliberately adds no Chromium feature switches.
 */
export function configureGpuStartup(
  controller: HardwareAccelerationController,
  env: Readonly<Record<string, string | undefined>> = process.env,
): GpuStartupPolicy {
  if (env.EXO_DISABLE_GPU !== "1") return "electron-default";
  controller.disableHardwareAcceleration();
  return "diagnostic-disabled";
}
