import { probeGraphWebGpu, type GraphGpuProbeResult } from "./graphGpuProbe";

declare global {
  interface Window {
    __stemGraphGpuProbeResult?: GraphGpuProbeResult;
  }
}

void probeGraphWebGpu().then((result) => {
  window.__stemGraphGpuProbeResult = result;
  document.documentElement.dataset.probeStatus = result.status;
});
