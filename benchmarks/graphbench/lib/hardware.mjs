import os from 'node:os';

export async function hardwareStamp(browser, page) {
  const browserGpu = await page.evaluate(async () => {
    const result = {
      userAgent: navigator.userAgent,
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      webgpu: null,
      webgl: null,
    };
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const info = adapter.info || {};
        result.webgpu = {
          vendor: info.vendor || null,
          architecture: info.architecture || null,
          device: info.device || null,
          description: info.description || null,
          features: [...adapter.features].sort(),
          limits: {
            maxBufferSize: adapter.limits.maxBufferSize,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          },
        };
      }
    }
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      result.webgl = {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    }
    return result;
  });
  const cpus = os.cpus();
  return {
    capturedAt: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: cpus.length ? { model: cpus[0].model, logicalCores: cpus.length } : null,
    memoryBytes: os.totalmem(),
    node: process.version,
    browser: browser.version(),
    ...browserGpu,
  };
}
