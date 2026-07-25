import { describe, expect, it } from "vitest";
import ts from "typescript";

import source from "./NoteEditor.tsx?raw";

describe("NoteEditor canonical body writes", () => {
  it("never gives canonical document bytes transition priority", () => {
    const sourcePath = "NoteEditor.tsx";
    const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const transitionedBodyWrites: number[] = [];

    function containsBodyWrite(node: ts.Node): boolean {
      let found = false;
      function visit(candidate: ts.Node): void {
        if (
          ts.isCallExpression(candidate)
          && ts.isPropertyAccessExpression(candidate.expression)
          && candidate.expression.name.text === "current"
          && ts.isIdentifier(candidate.expression.expression)
          && candidate.expression.expression.text === "bodyChangeRef"
        ) {
          found = true;
          return;
        }
        ts.forEachChild(candidate, visit);
      }
      visit(node);
      return found;
    }

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "startTransition"
        && node.arguments.some(containsBodyWrite)
      ) {
        transitionedBodyWrites.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    expect(
      transitionedBodyWrites,
      `Canonical body writes must update the open-document owner synchronously; found transition-priority writes on lines ${transitionedBodyWrites.join(", ")}.`,
    ).toEqual([]);
  });
});
