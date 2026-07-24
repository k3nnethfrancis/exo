import { probeGraphWebGpu, type GraphGpuProbeResult } from "./graphGpuProbe";

declare global {
  interface Window {
    __exoGraphGpuProbeResult?: GraphGpuProbeResult;
  }
}

void probeGraphWebGpu().then((result) => {
  window.__exoGraphGpuProbeResult = result;
  document.documentElement.dataset.probeStatus = result.status;
});
