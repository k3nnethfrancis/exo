export type GraphNodeClickDecision =
  | { kind: "inspect"; index: number }
  | { kind: "route"; index: number }
  | { kind: "clear-route" };

export function graphNodeClickDecision(
  picked: number,
  selected: number,
  shiftKey: boolean,
): GraphNodeClickDecision {
  if (picked < 0) return { kind: "clear-route" };
  if (shiftKey && selected >= 0 && picked !== selected) return { kind: "route", index: picked };
  return { kind: "inspect", index: picked };
}

export type GraphNodeDoubleClickDecision = "none" | "open" | "focus";

export function graphNodeDoubleClickDecision(target: string | null, alreadyOpen: boolean): GraphNodeDoubleClickDecision {
  if (!target) return "none";
  return alreadyOpen ? "focus" : "open";
}

export type GraphEscapeDecision = "clear-route" | "restore-editor" | "none";

export function graphEscapeDecision(
  hasRoute: boolean,
  activeEditorPath: string | null | undefined,
  inspectedPath: string | null | undefined,
): GraphEscapeDecision {
  if (hasRoute) return "clear-route";
  if (activeEditorPath && activeEditorPath !== inspectedPath) return "restore-editor";
  return "none";
}
