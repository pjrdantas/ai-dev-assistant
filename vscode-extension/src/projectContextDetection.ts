import { ProjectContext, ProjectTechnology } from './contracts.js';

export interface AllowedManifest {
  readonly name: 'pom.xml' | 'package.json';
  readonly content: string;
}

export function detectProjectContext(
  manifests: readonly AllowedManifest[],
): ProjectContext | undefined {
  const languages = new Map<string, ProjectTechnology>();
  const frameworks = new Map<string, ProjectTechnology>();
  const buildTools = new Set<string>();

  for (const manifest of manifests) {
    if (manifest.name === 'pom.xml') {
      const javaVersion = firstXmlValue(
        manifest.content,
        ['java.version', 'maven.compiler.release', 'maven.compiler.target'],
      );
      add(languages, 'JAVA', javaVersion);
      const springBootVersion = springBootParentVersion(manifest.content);
      if (springBootVersion !== undefined
          || manifest.content.includes('spring-boot')) {
        add(frameworks, 'SPRING_BOOT', springBootVersion);
      }
      buildTools.add('MAVEN');
      continue;
    }

    const packageJson = parsePackageJson(manifest.content);
    if (packageJson === undefined) {
      continue;
    }
    const nodeVersion = stringProperty(packageJson.engines, 'node');
    add(languages, 'NODE', cleanVersion(nodeVersion));
    const dependencies = {
      ...recordProperty(packageJson, 'dependencies'),
      ...recordProperty(packageJson, 'devDependencies'),
    };
    const typescriptVersion = stringProperty(dependencies, 'typescript');
    if (typescriptVersion !== undefined) {
      add(languages, 'TYPESCRIPT', cleanVersion(typescriptVersion));
    }
    const angularVersion = stringProperty(dependencies, '@angular/core');
    if (angularVersion !== undefined) {
      add(frameworks, 'ANGULAR', cleanVersion(angularVersion));
    }
    buildTools.add('NPM');
  }

  if (languages.size === 0 && frameworks.size === 0 && buildTools.size === 0) {
    return undefined;
  }
  const context: ProjectContext = {
    languages: [...languages.values()],
    frameworks: [...frameworks.values()],
  };
  const buildTool = buildTools.size === 1 ? [...buildTools][0] : undefined;
  return buildTool === undefined ? context : { ...context, buildTool };
}

function add(
  target: Map<string, ProjectTechnology>,
  name: string,
  version?: string,
): void {
  const existing = target.get(name);
  if (existing?.version !== undefined || (existing !== undefined && version === undefined)) {
    return;
  }
  target.set(name, version === undefined ? { name } : { name, version });
}

function firstXmlValue(content: string, elements: readonly string[]): string | undefined {
  for (const element of elements) {
    const match = new RegExp(`<${escapeRegularExpression(element)}>([^<]+)</${escapeRegularExpression(element)}>`)
      .exec(content);
    const version = cleanVersion(match?.[1]);
    if (version !== undefined) {
      return version;
    }
  }
  return undefined;
}

function springBootParentVersion(content: string): string | undefined {
  const parent = /<parent>[\s\S]*?<\/parent>/.exec(content)?.[0];
  if (parent === undefined || !parent.includes('spring-boot-starter-parent')) {
    return undefined;
  }
  return firstXmlValue(parent, ['version']);
}

function parsePackageJson(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function recordProperty(
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> {
  const candidate = value[property];
  return isRecord(candidate) ? candidate : {};
}

function stringProperty(value: unknown, property: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[property];
  return typeof candidate === 'string' ? candidate : undefined;
}

function cleanVersion(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = value.trim().replace(/^[~^<>=\s]+/, '');
  if (cleaned === '' || cleaned.length > 100 || cleaned.includes('${')) {
    return undefined;
  }
  return cleaned;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
