export interface ListGeometry {
  indentStep: number;
  baseIndent: number;
  markerLaneWidth: number;
}

export const LIST_GEOMETRY: ListGeometry = {
  baseIndent: 30,
  indentStep: 28,
  markerLaneWidth: 18,
};

export function listGeometryStyleVariables(geometry: ListGeometry = LIST_GEOMETRY) {
  return [
    `--exo-list-indent-step:${geometry.indentStep}px`,
    `--exo-list-base-indent:${geometry.baseIndent}px`,
    `--exo-list-marker-lane-width:${geometry.markerLaneWidth}px`,
  ].join(";");
}
