export type MatchType = 'FULL' | 'PARTIAL' | 'NONE';

export interface ProjectTechnology {
  readonly name: string;
  readonly version?: string;
}

export interface ProjectContext {
  readonly languages: readonly ProjectTechnology[];
  readonly frameworks: readonly ProjectTechnology[];
  readonly buildTool?: string;
}

export interface ProjectContextProvider {
  capture(): Promise<ProjectContext | undefined>;
}
