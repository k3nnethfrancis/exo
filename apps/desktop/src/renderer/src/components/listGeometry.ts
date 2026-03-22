export interface ListGeometry {
  indentStep: number;
  baseIndent: number;
  markerLaneWidth: number;
  prefixBoxWidth: number;
  prefixGap: number;
  markerWidth: number;
  orderedMarkerWidth: number;
  taskMarkerWidth: number;
  guideOffset: number;
}

export const LIST_GEOMETRY: ListGeometry = {
  baseIndent: 36,
  indentStep: 24,
  markerLaneWidth: 26,
  prefixBoxWidth: 14,
  prefixGap: 6,
  markerWidth: 14,
  orderedMarkerWidth: 14,
  taskMarkerWidth: 14,
  guideOffset: 13,
};

export function listGeometryStyleVariables(geometry: ListGeometry = LIST_GEOMETRY) {
  return [
    `--exo-list-indent-step:${geometry.indentStep}px`,
    `--exo-list-base-indent:${geometry.baseIndent}px`,
    `--exo-list-marker-lane-width:${geometry.markerLaneWidth}px`,
    `--exo-list-prefix-box-width:${geometry.prefixBoxWidth}px`,
    `--exo-list-prefix-gap:${geometry.prefixGap}px`,
    `--exo-list-marker-width:${geometry.markerWidth}px`,
    `--exo-list-ordered-marker-width:${geometry.orderedMarkerWidth}px`,
    `--exo-list-task-marker-width:${geometry.taskMarkerWidth}px`,
    `--exo-list-guide-offset:${geometry.guideOffset}px`,
  ].join(";");
}
