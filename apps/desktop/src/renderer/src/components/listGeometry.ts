export interface ListGeometry {
  indentStep: number;
  baseIndent: number;
  markerLaneWidth: number;
  markerTextGap: number;
}

export const LIST_GEOMETRY: ListGeometry = {
  // Keep the marker close enough to its text to read as one list item, while
  // leaving a repeatable lane for each nesting level.
  baseIndent: 30,
  indentStep: 28,
  markerLaneWidth: 26,
  markerTextGap: 8,
};

export function listGeometryStyleVariables(geometry: ListGeometry = LIST_GEOMETRY) {
  return [
    `--exograph-list-indent-step:${geometry.indentStep}px`,
    `--exograph-list-base-indent:${geometry.baseIndent}px`,
    `--exograph-list-marker-lane-width:${geometry.markerLaneWidth}px`,
    `--exograph-list-marker-text-gap:${geometry.markerTextGap}px`,
  ].join(";");
}
