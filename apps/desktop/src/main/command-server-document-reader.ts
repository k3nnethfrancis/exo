import path from "node:path";

import {
  WorkspaceFiles,
  type IndexReadOptions,
  type IndexReadResponse,
  type WorkspaceModel,
} from "@exo/core";

export interface CommandServerDocumentReaderOptions {
  getContext: () => CommandServerDocumentReadContext;
  readDocument: (
    context: CommandServerDocumentReadContext,
    target: string,
    options: IndexReadOptions,
    authorizeResolvedPath: (filePath: string) => Promise<void>,
  ) => Promise<IndexReadResponse>;
}

export interface CommandServerDocumentReadContext {
  model: WorkspaceModel;
  runtimeRoot: string;
}

export function commandServerDocumentReadContext(
  model: WorkspaceModel,
  env: NodeJS.ProcessEnv = process.env,
): CommandServerDocumentReadContext {
  return {
    model,
    runtimeRoot: env.EXO_RUNTIME_ROOT ?? path.join(model.workspaceRoot, ".exo"),
  };
}

export class CommandServerDocumentReader {
  constructor(private readonly options: CommandServerDocumentReaderOptions) {}

  async read(target: string, options: IndexReadOptions = {}): Promise<IndexReadResponse> {
    const context = this.options.getContext();
    const { model } = context;
    const files = new WorkspaceFiles(model.noteRoots.map((root) => root.path));
    if (path.isAbsolute(target)) {
      await files.existing(target);
    }
    const authorizeResolvedPath = async (filePath: string): Promise<void> => {
      await files.existing(filePath);
    };
    const result = await this.options.readDocument(context, target, options, authorizeResolvedPath);
    await files.existing(result.filePath);
    return result;
  }
}
