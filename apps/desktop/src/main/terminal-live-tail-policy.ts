import { tailLines } from "./terminal-tail-cache";

export interface TerminalLiveTailSelection {
  text: string;
  cacheCapturedTail: boolean;
}

export function selectTerminalLiveTail(options: {
  buffered: string;
  captured: string | null;
  maxLines?: number;
}): TerminalLiveTailSelection {
  const { buffered, captured, maxLines } = options;

  if (captured !== null) {
    if (maxLines) {
      return {
        text: tailLines(captured, maxLines),
        cacheCapturedTail: false,
      };
    }
    return {
      text: captured,
      cacheCapturedTail: true,
    };
  }

  return {
    text: maxLines ? tailLines(buffered, maxLines) : buffered,
    cacheCapturedTail: false,
  };
}
