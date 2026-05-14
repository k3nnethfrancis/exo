export interface ListGeometry {
  indentStep: number;
  baseIndent: number;
  markerLaneWidth: number;
  guideOffset: number;
}

export const LIST_GEOMETRY: ListGeometry = {
  baseIndent: 36,
  indentStep: 24,
  markerLaneWidth: 26,
  guideOffset: 13,
};

export function listGeometryStyleVariables(geometry: ListGeometry = LIST_GEOMETRY) {
  return [
    `--exo-list-indent-step:${geometry.indentStep}px`,
    `--exo-list-base-indent:${geometry.baseIndent}px`,
    `--exo-list-marker-lane-width:${geometry.markerLaneWidth}px`,
    `--exo-list-guide-offset:${geometry.guideOffset}px`,
  ].join(";");
}
