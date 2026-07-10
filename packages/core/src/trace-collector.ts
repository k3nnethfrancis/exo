import type { CapabilityMetadata } from "./capabilities";
import type { ActivityTracePacket } from "./run";

export interface TraceCollectorContext {
  activityId: string;
  harnessId?: string;
}

export interface TraceCollector {
  metadata: CapabilityMetadata;
  collect(packet: ActivityTracePacket, context: TraceCollectorContext): Promise<ActivityTracePacket>;
}

export class TraceCollectorRegistry {
  private readonly collectors = new Map<string, TraceCollector>();

  constructor(collectors: TraceCollector[] = []) {
    this.registerMany(collectors);
  }

  register(collector: TraceCollector): void {
    const id = collector.metadata.id;
    if (this.collectors.has(id)) {
      throw new Error(`Trace collector already registered: ${id}`);
    }
    this.collectors.set(id, collector);
  }

  registerMany(collectors: TraceCollector[]): void {
    for (const collector of collectors) {
      this.register(collector);
    }
  }

  get(id: string): TraceCollector | undefined {
    return this.collectors.get(id);
  }

  require(id: string): TraceCollector {
    const collector = this.get(id);
    if (!collector) {
      throw new Error(`Trace collector is not registered: ${id}`);
    }
    return collector;
  }

  list(): TraceCollector[] {
    return [...this.collectors.values()];
  }
}
