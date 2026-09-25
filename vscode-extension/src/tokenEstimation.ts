const APPROXIMATE_BYTES_PER_TOKEN = 4;

export interface EstimatedTokenUsage {
  readonly request: number;
  readonly response: number;
  readonly total: number;
}

/**
 * Produces a model-independent local estimate only.
 *
 * GitHub Copilot does not expose the exact billed/model token usage to this
 * extension, and the user may select different models with different
 * tokenizers. This estimate therefore represents only the stored text and
 * must never be presented as exact Copilot consumption.
 */
export function estimateTokenCount(text: string): number {
  const bytes = Buffer.byteLength(text.trim(), 'utf8');
  return bytes === 0 ? 0 : Math.ceil(bytes / APPROXIMATE_BYTES_PER_TOKEN);
}

export function estimateStoredMemoryTokens(originalRequest: string, response: string): EstimatedTokenUsage {
  const request = estimateTokenCount(originalRequest);
  const responseTokens = estimateTokenCount(response);
  return {
    request,
    response: responseTokens,
    total: request + responseTokens,
  };
}
