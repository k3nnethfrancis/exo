import type { TerminalGeometryRecord } from "../shared/api";

// Renderer-owned xterm measurements are the source of truth: main records them
// on the session, and tmux follows that recorded geometry. Attach paths must
// never fall back to initial defaults when a valid record exists, because doing
// so forces SIGWINCH repaint at the wrong size and corrupts cursor-relative
// terminal UIs during resize and refresh.
export class TerminalGeometryService {
  constructor(private readonly initialCols: number, private readonly initialRows: number) {}

  initialDefault(reportedAt = new Date().toISOString()): TerminalGeometryRecord {
    return {
      cols: protocolCellCount(this.initialCols),
      rows: protocolCellCount(this.initialRows),
      reportedAt,
      source: "initial-default",
    };
  }

  fromPersisted(value: unknown): TerminalGeometryRecord {
    if (isTerminalGeometryRecord(value)) {
      return value;
    }
    return this.initialDefault();
  }

  rendererFit(cols: number, rows: number, reportedAt = new Date().toISOString()): TerminalGeometryRecord {
    return {
      cols: protocolCellCount(cols),
      rows: protocolCellCount(rows),
      reportedAt,
      source: "renderer-fit",
    };
  }

  attachSize(record: TerminalGeometryRecord): { cols: number; rows: number } {
    return {
      cols: protocolCellCount(record.cols),
      rows: protocolCellCount(record.rows),
    };
  }
}

export function isTerminalGeometryRecord(value: unknown): value is TerminalGeometryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<TerminalGeometryRecord>;
  const { cols, rows, reportedAt, source } = record;
  return (
    Number.isInteger(cols) &&
    typeof cols === "number" &&
    cols >= 1 &&
    Number.isInteger(rows) &&
    typeof rows === "number" &&
    rows >= 1 &&
    typeof reportedAt === "string" &&
    !Number.isNaN(Date.parse(reportedAt)) &&
    (source === "renderer-fit" || source === "initial-default")
  );
}

function protocolCellCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
