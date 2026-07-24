import { renameSync, rmSync } from "node:fs";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExoCommandServerInfo } from "@exo/core";

import { CommandServer } from "./command-server";

export interface CommandServerLifecycleStatus {
  listening: boolean;
  port: number | null;
}

export interface CommandServerLifecycleOptions {
  runtimeRoot: string;
  createServer: () => CommandServer;
  log?: (message: string, details?: unknown) => void;
}

export interface StagedCommandServerDiscovery {
  /** Atomically exposes an already-started server without yielding the event loop. */
  commit(): void;
  abort(): void;
}

/** Owns the one command server instance and its discovery record. */
export class CommandServerLifecycle {
  private readonly discoveryPath: string;
  private server: CommandServer | null = null;
  private generation = 0;
  private operations: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: CommandServerLifecycleOptions) {
    this.discoveryPath = path.join(options.runtimeRoot, "server.json");
  }

  start(options: { publishDiscovery?: boolean } = {}): Promise<CommandServerLifecycleStatus> {
    return this.enqueue(() => this.startLocked(options.publishDiscovery ?? true));
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopLocked());
  }

  restart(): Promise<CommandServerLifecycleStatus> {
    return this.enqueue(async () => {
      await this.stopLocked();
      return this.startLocked();
    });
  }

  status(): CommandServerLifecycleStatus {
    return {
      listening: this.server?.isListening() ?? false,
      port: this.server?.getPort() ?? null,
    };
  }

  async refreshDiscovery(): Promise<ExoCommandServerInfo & { path: string }> {
    return this.enqueue(async () => {
      const server = this.server;
      const generation = this.generation;
      if (!server || !server.isListening()) {
        throw new Error("Command server is not listening.");
      }
      const info = server.getServerInfo();
      await this.publishDiscovery(info, generation);
      return { ...info, path: this.discoveryPath };
    });
  }

  /**
   * Prepares a durable discovery record while the server is already listening.
   * Committing the prepared rename is synchronous so a coordinator can publish
   * the active Workspace in the same event-loop turn.
   */
  async prepareDiscovery(): Promise<StagedCommandServerDiscovery> {
    const server = this.server;
    const generation = this.generation;
    if (!server || !server.isListening()) {
      throw new Error("Command server is not listening.");
    }
    const info = server.getServerInfo();
    const temporaryPath = `${this.discoveryPath}.${process.pid}.${Date.now()}.staged`;
    await writePreparedDiscoveryFile(temporaryPath, info);
    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        if (generation !== this.generation || this.server?.getServerInfo().token !== info.token) {
          rmSync(temporaryPath, { force: true });
          settled = true;
          throw new Error("Command server generation is no longer current.");
        }
        renameSync(temporaryPath, this.discoveryPath);
        void syncDiscoveryDirectory(path.dirname(this.discoveryPath)).catch((error) => {
          this.options.log?.("command server discovery directory sync failed", { error });
        });
        settled = true;
      },
      abort: () => {
        if (settled) return;
        settled = true;
        rmSync(temporaryPath, { force: true });
      },
    };
  }

  private async startLocked(publishDiscovery = true): Promise<CommandServerLifecycleStatus> {
    if (this.server?.isListening()) {
      return this.status();
    }

    const generation = ++this.generation;
    const server = this.options.createServer();
    this.server = server;
    try {
      await server.start();
      if (generation !== this.generation || this.server !== server) {
        await server.stop();
        return this.status();
      }
      if (publishDiscovery) {
        await this.publishDiscovery(server.getServerInfo(), generation);
      }
      this.options.log?.("command server started", { port: server.getPort() });
      return this.status();
    } catch (error) {
      const token = server.isListening() ? server.getServerInfo().token : null;
      if (this.server === server) {
        this.server = null;
      }
      await server.stop().catch(() => {});
      if (token) {
        await this.removeOwnedDiscovery(token, generation);
      }
      throw error;
    }
  }

  private async stopLocked(): Promise<void> {
    const generation = ++this.generation;
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    const token = server.getServerInfo().token;
    await server.stop();
    await this.removeOwnedDiscovery(token, generation);
  }

  private async publishDiscovery(info: ExoCommandServerInfo, generation: number): Promise<void> {
    if (generation !== this.generation || this.server?.getServerInfo().token !== info.token) {
      throw new Error("Command server generation is no longer current.");
    }
    await writeDiscoveryFile(this.discoveryPath, info);
  }

  private async removeOwnedDiscovery(token: string, generation: number): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    try {
      const current = JSON.parse(await readFile(this.discoveryPath, "utf8")) as { token?: unknown };
      if (current.token === token) {
        await rm(this.discoveryPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.options.log?.("command server discovery cleanup failed", { error });
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operations.then(operation, operation);
    this.operations = run.then(() => undefined, () => undefined);
    return run;
  }
}

async function writeDiscoveryFile(discoveryPath: string, info: ExoCommandServerInfo): Promise<void> {
  const directory = path.dirname(discoveryPath);
  const temporaryPath = `${discoveryPath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(info, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
    const file = await open(temporaryPath, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, discoveryPath);
    try {
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EPERM") {
        throw error;
      }
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writePreparedDiscoveryFile(discoveryPath: string, info: ExoCommandServerInfo): Promise<void> {
  const body = `${JSON.stringify(info, null, 2)}\n`;
  try {
    await writeFile(discoveryPath, body, { encoding: "utf8", mode: 0o600 });
    const descriptor = await open(discoveryPath, "r+");
    try {
      await descriptor.sync();
    } finally {
      await descriptor.close();
    }
  } catch (error) {
    await rm(discoveryPath, { force: true });
    throw error;
  }
}

async function syncDiscoveryDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EPERM") throw error;
  }
}
