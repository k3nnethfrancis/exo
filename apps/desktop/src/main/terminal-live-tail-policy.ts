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
    if (maxLines && captured.length > 0) {
      return {
        text: tailLines(captured, maxLines),
        cacheCapturedTail: false,
      };
    }
    if (captured.length > buffered.length) {
      return {
        text: captured,
        cacheCapturedTail: true,
      };
    }
  }

  return {
    text: maxLines ? tailLines(buffered, maxLines) : buffered,
    cacheCapturedTail: false,
  };
}
