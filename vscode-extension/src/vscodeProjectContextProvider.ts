import * as vscode from 'vscode';

import { ProjectContext, ProjectContextProvider } from './contracts.js';
import {
  AllowedManifest,
  detectProjectContext,
} from './projectContextDetection.js';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MANIFESTS = 20;

export class VscodeProjectContextProvider implements ProjectContextProvider {
  public async capture(): Promise<ProjectContext | undefined> {
    if (vscode.workspace.workspaceFolders === undefined) {
      return undefined;
    }
    const uris = await vscode.workspace.findFiles(
      '**/{pom.xml,package.json}',
      '**/{node_modules,target,out,dist,build}/**',
      MAX_MANIFESTS,
    );
    const manifests: AllowedManifest[] = [];
    const orderedUris = [...uris].sort((left, right) =>
      left.toString().localeCompare(right.toString()));
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
