import { probeGraphWebGpu, type GraphGpuProbeResult } from "./graphGpuProbe";

declare global {
  interface Window {
    __exographGraphGpuProbeResult?: GraphGpuProbeResult;
  }
}

void probeGraphWebGpu().then((result) => {
  window.__exographGraphGpuProbeResult = result;
  document.documentElement.dataset.probeStatus = result.status;
});
