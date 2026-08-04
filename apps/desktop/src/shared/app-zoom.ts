export const DEFAULT_APP_ZOOM_FACTOR = 1;
export const MIN_APP_ZOOM_FACTOR = 0.5;
export const MAX_APP_ZOOM_FACTOR = 2;
export const APP_ZOOM_STEP = 0.1;

export function normalizeAppZoomFactor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_APP_ZOOM_FACTOR;
  }
  return Math.min(MAX_APP_ZOOM_FACTOR, Math.max(MIN_APP_ZOOM_FACTOR, Number(value.toFixed(2))));
}

export function nextAppZoomFactor(current: number, direction: -1 | 0 | 1): number {
  if (direction === 0) {
    return DEFAULT_APP_ZOOM_FACTOR;
  }
  return normalizeAppZoomFactor(current + direction * APP_ZOOM_STEP);
}
