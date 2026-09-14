export type MatchType = 'FULL' | 'PARTIAL' | 'NONE';
export type ResponseSource = 'LOCAL_MEMORY' | 'LOCAL_MEMORY_AND_AI' | 'AI';

export interface TechnicalContext {
  readonly technologies: readonly string[];
  readonly versions: Readonly<Record<string, string>>;
  readonly taskType?: string;
}

export interface ProjectTechnology {
  readonly name: string;
  readonly version?: string;
}

export interface ProjectContext {
  readonly languages: readonly ProjectTechnology[];
  readonly frameworks: readonly ProjectTechnology[];
  readonly buildTool?: string;
}

export interface AuthorizedAiRequest {
  readonly prompt: string;
  readonly technicalContext: TechnicalContext;
  readonly reusableSolution?: string;
  readonly requiredAdaptations: readonly string[];
}

export interface CompletedPromptResponse {
  readonly requestId: string;
  readonly status: 'COMPLETED';
  readonly response: string;
  readonly source: ResponseSource;
  readonly matchType: MatchType;
  readonly similarity?: number;
  readonly aiCalled: boolean;
  readonly externalSearchCalled: false;
  readonly memoryId: string;
}

export interface PendingPromptResponse {
  readonly requestId: string;
  readonly status: 'AI_REQUIRED';
  readonly matchType: 'PARTIAL' | 'NONE';
  readonly similarity?: number;
  readonly expiresAt: string;
  readonly aiRequest: AuthorizedAiRequest;
}

export type PromptPreparation = CompletedPromptResponse | PendingPromptResponse;

export interface AiExecutionMetrics {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export interface AiCompletion {
  readonly response: string;
  readonly executionMetrics: AiExecutionMetrics;
}

export interface AssistantBackend {
  prepare(prompt: string, projectContext?: ProjectContext): Promise<PromptPreparation>;

  complete(requestId: string, completion: AiCompletion): Promise<CompletedPromptResponse>;
}

export interface ProjectContextProvider {
  capture(): Promise<ProjectContext | undefined>;
}

export interface CopilotGateway {
  complete(request: AuthorizedAiRequest): Promise<AiCompletion>;
}
