import type { FolderIndexResult, FolderOverview, TreeNode } from "@exograph/core";

export interface WorkspaceFilesystemApi {
  listTree: (
    rootPath: string,
    options?: { markdownOnly?: boolean; maxDepth?: number; includeEmptyDirectories?: boolean; excludedPaths?: string[] },
  ) => Promise<TreeNode[]>;
  getFolderOverview: (directoryPath: string) => Promise<FolderOverview>;
  ensureFolderIndex: (directoryPath: string) => Promise<FolderIndexResult>;
  createFile: (targetPath: string, content?: string) => Promise<string>;
  createFolder: (targetPath: string) => Promise<FolderIndexResult>;
  renamePath: (sourcePath: string, nextPath: string) => Promise<string>;
  deletePath: (targetPath: string) => Promise<void>;
  onDidChange: (callback: (event: { rootPath: string; eventType: string; filePath: string | null }) => void) => () => void;
  onGraphChanged: (callback: () => void) => () => void;
  onOntologyCandidateChanged: (callback: () => void) => () => void;
}
