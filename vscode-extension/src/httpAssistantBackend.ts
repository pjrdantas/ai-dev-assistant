import {
  AiCompletion,
  AssistantBackend,
  AuthorizedAiRequest,
  CompletedPromptResponse,
  MatchType,
  PendingPromptResponse,
  ProjectContext,
  PromptPreparation,
  ResponseSource,
  TechnicalContext,
} from './contracts.js';
import { UserFacingError } from './userFacingError.js';

export interface BackendSettings {
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

type BackendSettingsProvider = () => BackendSettings;
type FetchImplementation = typeof fetch;

const MAX_BACKEND_RESPONSE_CHARACTERS = 300_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HttpAssistantBackend implements AssistantBackend {
  public constructor(
    private readonly settings: BackendSettingsProvider,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  public async prepare(
    prompt: string,
    projectContext?: ProjectContext,
  ): Promise<PromptPreparation> {
    const payload = await this.post('/api/v1/prompts', {
      prompt,
      projectContext: projectContext ?? null,
    });
    return parsePreparation(payload);
  }

  public async complete(
    requestId: string,
    completion: AiCompletion,
  ): Promise<CompletedPromptResponse> {
    const payload = await this.post(
      `/api/v1/prompts/${encodeURIComponent(requestId)}/ai-response`,
      completion,
    );
    return parseCompletedResponse(payload);
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const settings = this.settings();
    const baseUrl = validateLocalBackendUrl(settings.baseUrl);
    if (!Number.isInteger(settings.timeoutMs)
        || settings.timeoutMs < 1_000
        || settings.timeoutMs > 120_000) {
      throw new UserFacingError('O tempo limite configurado para o backend é inválido.');
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), settings.timeoutMs);
    try {
      const response = await this.fetchImplementation(new URL(path, `${baseUrl}/`), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw await toBackendError(response);
      }
      return await readJsonBody(response);
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new UserFacingError('O backend local não respondeu dentro do tempo limite.');
      }
      throw new UserFacingError(
        'Não foi possível conectar ao backend local do AI Dev Assistant.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function validateLocalBackendUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserFacingError('A URL configurada para o backend é inválida.');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const hasUnexpectedPath = url.pathname !== '' && url.pathname !== '/';
  if (url.protocol !== 'http:'
      || !localHosts.has(url.hostname)
      || url.username !== ''
      || url.password !== ''
      || hasUnexpectedPath
      || url.search !== ''
      || url.hash !== '') {
    throw new UserFacingError(
      'O backend deve usar uma URL HTTP de localhost, sem credenciais ou caminho adicional.',
    );
  }
  return url.origin;
}

async function toBackendError(response: Response): Promise<UserFacingError> {
  let code: string | undefined;
  try {
    const payload = await readJsonBody(response);
    if (isRecord(payload) && typeof payload.code === 'string') {
      code = payload.code;
    }
  } catch {
    // The response body is intentionally not exposed to the user or logs.
  }
  const messages: Readonly<Record<string, string>> = {
    MEMORY_UNAVAILABLE: 'A memória local não pôde ser consultada. A IA não foi chamada.',
    SENSITIVE_CONTEXT_REJECTED: 'O conteúdo foi bloqueado antes da chamada ao Copilot.',
    AI_INVOCATION_EXPIRED: 'A autorização para o Copilot expirou. Envie a solicitação novamente.',
    AI_INVOCATION_MISMATCH: 'A conclusão recebida não corresponde à autorização existente.',
    AI_INVOCATION_REJECTED: 'A solicitação externa não pôde ser autorizada com segurança.',
    MEMORY_PERSISTENCE_FAILURE: 'A resposta externa não pôde ser salva na memória local.',
    INVALID_PROMPT: 'A solicitação é inválida ou excede os limites permitidos.',
  };
  return new UserFacingError(
    code === undefined
      ? `O backend recusou a solicitação com status ${response.status}.`
      : (messages[code] ?? `O backend recusou a solicitação (${code}).`),
  );
}

function parsePreparation(value: unknown): PromptPreparation {
  if (!isRecord(value) || typeof value.status !== 'string') {
    throw protocolError();
  }
  if (value.status === 'COMPLETED') {
    return parseCompletedResponse(value);
  }
  if (value.status !== 'AI_REQUIRED') {
    throw protocolError();
  }
  const requestId = requiredUuid(value.requestId);
  const matchType = parseMatchType(value.matchType);
  if (matchType === 'FULL') {
    throw protocolError();
  }
  const response: PendingPromptResponse = {
    requestId,
    status: 'AI_REQUIRED',
    matchType,
    expiresAt: requiredString(value.expiresAt),
    aiRequest: parseAuthorizedRequest(value.aiRequest),
  };
  const similarity = optionalSimilarity(value.similarity);
  if ((matchType === 'PARTIAL') !== (similarity !== undefined)) {
    throw protocolError();
  }
  if (matchType === 'PARTIAL' && response.aiRequest.reusableSolution === undefined) {
    throw protocolError();
  }
  if (matchType === 'NONE'
      && (response.aiRequest.reusableSolution !== undefined
        || response.aiRequest.requiredAdaptations.length > 0)) {
    throw protocolError();
  }
  return similarity === undefined ? response : { ...response, similarity };
}

function parseCompletedResponse(value: unknown): CompletedPromptResponse {
  if (!isRecord(value)
      || value.status !== 'COMPLETED'
      || typeof value.aiCalled !== 'boolean'
      || value.externalSearchCalled !== false) {
    throw protocolError();
  }
  const response: CompletedPromptResponse = {
    requestId: requiredUuid(value.requestId),
    status: 'COMPLETED',
    response: requiredString(value.response),
    source: parseSource(value.source),
    matchType: parseMatchType(value.matchType),
    aiCalled: value.aiCalled,
    externalSearchCalled: false,
    memoryId: requiredUuid(value.memoryId),
  };
  const similarity = optionalSimilarity(value.similarity);
  const completed = similarity === undefined ? response : { ...response, similarity };
  if (!hasValidCompletedInvariants(completed)) {
    throw protocolError();
  }
  return completed;
}

function parseAuthorizedRequest(value: unknown): AuthorizedAiRequest {
  if (!isRecord(value) || !Array.isArray(value.requiredAdaptations)) {
    throw protocolError();
  }
  const reusableSolution = optionalString(value.reusableSolution);
  const request: AuthorizedAiRequest = {
    prompt: requiredString(value.prompt),
    technicalContext: parseTechnicalContext(value.technicalContext),
    requiredAdaptations: value.requiredAdaptations.map(requiredString),
  };
  return reusableSolution === undefined ? request : { ...request, reusableSolution };
}

function parseTechnicalContext(value: unknown): TechnicalContext {
  if (!isRecord(value)
      || !Array.isArray(value.technologies)
      || !isRecord(value.versions)) {
    throw protocolError();
  }
  const versionEntries: Array<[string, string]> = [];
  for (const [key, entry] of Object.entries(value.versions)) {
    versionEntries.push([requiredString(key), requiredString(entry)]);
  }
  const context: TechnicalContext = {
    technologies: value.technologies.map(requiredString),
    versions: Object.fromEntries(versionEntries),
  };
  const taskType = optionalString(value.taskType);
  return taskType === undefined ? context : { ...context, taskType };
}

function parseMatchType(value: unknown): MatchType {
  if (value === 'FULL' || value === 'PARTIAL' || value === 'NONE') {
    return value;
  }
  throw protocolError();
}

function parseSource(value: unknown): ResponseSource {
  if (value === 'LOCAL_MEMORY' || value === 'LOCAL_MEMORY_AND_AI' || value === 'AI') {
    return value;
  }
  throw protocolError();
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw protocolError();
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : requiredString(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw protocolError();
  }
  return value;
}

function optionalSimilarity(value: unknown): number | undefined {
  const similarity = optionalNumber(value);
  if (similarity !== undefined && (similarity < 0 || similarity > 1)) {
    throw protocolError();
  }
  return similarity;
}

function requiredUuid(value: unknown): string {
  const uuid = requiredString(value);
  if (!UUID_PATTERN.test(uuid)) {
    throw protocolError();
  }
  return uuid;
}

function hasValidCompletedInvariants(response: CompletedPromptResponse): boolean {
  if (response.matchType === 'NONE') {
    return response.source === 'AI'
      && response.aiCalled
      && response.similarity === undefined;
  }
  if (response.matchType === 'PARTIAL') {
    return response.source === 'LOCAL_MEMORY_AND_AI'
      && response.aiCalled
      && response.similarity !== undefined;
  }
  return response.source === 'LOCAL_MEMORY'
    && !response.aiCalled
    && response.similarity !== undefined;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_BACKEND_RESPONSE_CHARACTERS) {
      throw new UserFacingError('O backend retornou uma resposta acima do limite permitido.');
    }
  }
  const body = await response.text();
  if (body.length > MAX_BACKEND_RESPONSE_CHARACTERS) {
    throw new UserFacingError('O backend retornou uma resposta acima do limite permitido.');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new UserFacingError('O backend retornou uma resposta inválida.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(): UserFacingError {
  return new UserFacingError('O backend retornou um contrato incompatível.');
}
