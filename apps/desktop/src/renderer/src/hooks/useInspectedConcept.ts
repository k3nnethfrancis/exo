import { useCallback, useReducer } from "react";

export type InspectionSource = "editor" | "graph" | "connections";

export interface InspectedConcept {
  conceptId?: string;
  filePath?: string;
}

export interface GraphFocusRequest {
  concept: InspectedConcept;
  sequence: number;
}

export interface InspectedConceptState {
  concept: InspectedConcept | null;
  source: InspectionSource;
  focusRequest: GraphFocusRequest | null;
}

type InspectedConceptAction =
  | { type: "inspect"; concept: InspectedConcept | null; source: InspectionSource }
  | { type: "focus"; concept: InspectedConcept; source: InspectionSource };

export const EMPTY_INSPECTED_CONCEPT_STATE: InspectedConceptState = {
  concept: null,
  source: "editor",
  focusRequest: null,
};

export function reduceInspectedConcept(
  state: InspectedConceptState,
  action: InspectedConceptAction,
): InspectedConceptState {
  if (action.type === "inspect") {
    return {
      ...state,
      concept: action.concept,
      source: action.source,
    };
  }
  return {
    concept: action.concept,
    source: action.source,
    focusRequest: {
      concept: action.concept,
      sequence: (state.focusRequest?.sequence ?? 0) + 1,
    },
  };
}

export function useInspectedConcept() {
  const [state, dispatch] = useReducer(reduceInspectedConcept, EMPTY_INSPECTED_CONCEPT_STATE);
  const inspect = useCallback((concept: InspectedConcept | null, source: InspectionSource) => {
    dispatch({ type: "inspect", concept, source });
  }, []);
  const focus = useCallback((concept: InspectedConcept, source: InspectionSource) => {
    dispatch({ type: "focus", concept, source });
  }, []);
  return { state, inspect, focus };
}
