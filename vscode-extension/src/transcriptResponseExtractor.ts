import { readFile } from 'node:fs/promises';

export type TranscriptExtraction =
  | { readonly kind: 'FOUND'; readonly response: string }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: string };

/**
 * The VS Code transcript format is not a stable API. This adapter intentionally accepts
 * only explicitly-shaped assistant messages and never fabricates text from unknown data.
 */
export class TranscriptResponseExtractor {
  public async extractFinalAssistantResponse(
    path: string | undefined,
  ): Promise<TranscriptExtraction> {
    if (path === undefined || path.trim() === '') {
      return {
        kind: 'UNAVAILABLE',
        reason: 'TRANSCRIPT_PATH_MISSING',
      };
    }

    let content: string;

    try {
      content = await readFile(path, 'utf8');
    } catch (error) {
      return {
        kind: 'UNAVAILABLE',
        reason: fileReason(error),
      };
    }

    if (content.trim() === '') {
      return {
        kind: 'UNAVAILABLE',
        reason: 'TRANSCRIPT_EMPTY',
      };
    }

    const values = parseValues(content);

    if (values === undefined) {
      return {
        kind: 'UNAVAILABLE',
        reason: 'TRANSCRIPT_UNRECOGNIZED',
      };
    }

    const response = findAssistantTexts(values).at(-1)?.trim();

    if (response === undefined || response === '') {
      return {
        kind: 'UNAVAILABLE',
        reason: 'FINAL_RESPONSE_NOT_FOUND',
      };
    }

    return {
      kind: 'FOUND',
      response,
    };
  }
}

function parseValues(content: string): readonly unknown[] | undefined {
  try {
    return [JSON.parse(content)];
  } catch {
    // JSONL is a common transcript transport, but not an API contract.
  }

  const values: unknown[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }

    try {
      values.push(JSON.parse(line));
    } catch {
      return undefined;
    }
  }

  return values.length === 0 ? undefined : values;
}

function findAssistantTexts(values: readonly unknown[]): string[] {
  const results: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value !== 'object' || value === null) {
      return;
    }

    const record = value as Record<string, unknown>;

    /*
     * Formato atual do transcript do VS Code/Copilot:
     *
     * {
     *   type: 'assistant.message',
     *   data: {
     *     content: 'resposta...',
     *     parentToolCallId: null
     *   }
     * }
     */
    if (record.type === 'assistant.message') {
      const data =
        typeof record.data === 'object' && record.data !== null
          ? (record.data as Record<string, unknown>)
          : undefined;

      const text =
        data !== undefined && typeof data.content === 'string'
          ? data.content
          : undefined;

      const isTopLevel =
        data !== undefined &&
        (
          data.parentToolCallId === undefined ||
          data.parentToolCallId === null
        );

      if (
        isTopLevel &&
        text !== undefined &&
        text.trim() !== ''
      ) {
        results.push(text);
      }

      return;
    }

    /*
     * Compatibilidade com formato anterior:
     *
     * {
     *   role: 'assistant',
     *   content: '...'
     * }
     */
    if (record.role === 'assistant') {
      const text =
        typeof record.content === 'string'
          ? record.content
          : typeof record.text === 'string'
            ? record.text
            : undefined;

      if (text !== undefined && text.trim() !== '') {
        results.push(text);
      }
    }

    Object.values(record).forEach(visit);
  };

  values.forEach(visit);

  return results;
}

function fileReason(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
    ? 'TRANSCRIPT_NOT_FOUND'
    : 'TRANSCRIPT_READ_FAILED';
}