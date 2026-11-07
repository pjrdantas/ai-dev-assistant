import * as vscode from 'vscode';

import { ProjectContext, ProjectContextProvider } from './contracts.js';
import { WorkspaceOrigin, manifestBelongsToWorkspaceOrigin, normalizeWorkspacePath, workspaceKey } from './interactionCapture.js';
import {
  AllowedManifest,
  detectProjectContext,
} from './projectContextDetection.js';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MANIFESTS = 20;

export class VscodeProjectContextProvider implements ProjectContextProvider {
  public currentWorkspaceKeys(): readonly string[] {
    return this.currentWorkspaceOrigins().map((origin) => origin.workspaceKey);
  }

  public currentWorkspaceOrigins(): readonly WorkspaceOrigin[] {
    return (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => ({ workspaceKey: workspaceKey(folder.uri.fsPath), normalizedPath: normalizeWorkspacePath(folder.uri.fsPath) }))
      .filter((origin): origin is WorkspaceOrigin => origin.workspaceKey !== undefined && origin.normalizedPath !== undefined);
  }

  public currentSearchWorkspaceKey(): string | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) return workspaceKey(folders[0]!.uri.fsPath);
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri === undefined) return undefined;
    return workspaceKey(vscode.workspace.getWorkspaceFolder(activeUri)?.uri.fsPath);
  }

  public async capture(originWorkspaceKey?: string): Promise<ProjectContext | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return undefined;
    }
    const folder = originWorkspaceKey === undefined
      ? (folders.length === 1 ? folders[0] : undefined)
      : folders.find((candidate) => workspaceKey(candidate.uri.fsPath) === originWorkspaceKey);
    if (folder === undefined) return undefined;
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/{pom.xml,package.json}'),
      '**/{node_modules,target,out,dist,build}/**',
      MAX_MANIFESTS,
    );
    const manifests: AllowedManifest[] = [];
    const origins = this.currentWorkspaceOrigins();
    const orderedUris = [...uris]
      .filter((uri) => manifestBelongsToWorkspaceOrigin(uri.fsPath, originWorkspaceKey, origins))
      .sort((left, right) => left.toString().localeCompare(right.toString()));
    for (const uri of orderedUris) {
      const name = manifestName(uri);
      if (name === undefined) {
        continue;
      }
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_MANIFEST_BYTES) {
          continue;
        }
        const content = new TextDecoder('utf-8', { fatal: true })
          .decode(await vscode.workspace.fs.readFile(uri));
        manifests.push({ name, content });
      } catch {
        // An unreadable or invalid manifest contributes no context and is never sent.
      }
    }
    return detectProjectContext(manifests);
  }
}

function manifestName(uri: vscode.Uri): AllowedManifest['name'] | undefined {
  const name = uri.path.split('/').at(-1);
  return name === 'pom.xml' || name === 'package.json' ? name : undefined;
}
