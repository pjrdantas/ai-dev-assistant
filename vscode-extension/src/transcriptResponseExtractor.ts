import { createReadStream } from 'node:fs';
import { readUtf8WithinLimit, InputLimitError } from './boundedInput.js';

export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
export const MAX_TRANSCRIPT_LINES = 10_000;
export const MAX_JSON_DEPTH = 100;
export const MAX_JSON_NODES = 50_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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
      const stream = createReadStream(path, {
        highWaterMark: 64 * 1024,
      });
      try {
        content = await readUtf8WithinLimit(stream, MAX_TRANSCRIPT_BYTES);
      } catch (error) {
        stream.destroy();
        throw error;
      }
    } catch (error) {
      if (error instanceof InputLimitError) {
        return {
          kind: 'UNAVAILABLE',
          reason: 'TRANSCRIPT_TOO_LARGE',
        };
      }
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

    if (values.kind !== 'VALUES') {
      return {
        kind: 'UNAVAILABLE',
        reason: values.reason,
      };
    }

    const response = findAssistantTexts(values.values).at(-1)?.trim();

    if (response === undefined || response === '') {
      return {
        kind: 'UNAVAILABLE',
        reason: 'FINAL_RESPONSE_NOT_FOUND',
      };
    }

    if (Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_BYTES) {
      return {
        kind: 'UNAVAILABLE',
        reason: 'FINAL_RESPONSE_TOO_LARGE',
      };
    }

    return {
      kind: 'FOUND',
      response,
    };
  }
}

type ParsedValues =
  | { readonly kind: 'VALUES'; readonly values: readonly unknown[] }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: string };

function parseValues(content: string): ParsedValues {
  const wholeDocumentShape = jsonShapeLimit(content);
  if (wholeDocumentShape !== undefined) {
    return { kind: 'UNAVAILABLE', reason: wholeDocumentShape };
  }

  try {
    return { kind: 'VALUES', values: [JSON.parse(content)] };
  } catch {
    // JSONL is a common transcript transport, but not an API contract.
  }

  const values: unknown[] = [];
  let lineCount = 0;
  let nodeCount = 0;

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }

    lineCount += 1;
    if (lineCount > MAX_TRANSCRIPT_LINES) {
      return { kind: 'UNAVAILABLE', reason: 'TRANSCRIPT_TOO_MANY_LINES' };
    }

    const lineShape = jsonShapeLimit(line);
    if (lineShape !== undefined) {
      return { kind: 'UNAVAILABLE', reason: lineShape };
    }
    nodeCount += countJsonNodes(line);
    if (nodeCount > MAX_JSON_NODES) {
      return { kind: 'UNAVAILABLE', reason: 'TRANSCRIPT_TOO_MANY_OBJECTS' };
    }

    try {
      values.push(JSON.parse(line));
    } catch {
      return { kind: 'UNAVAILABLE', reason: 'TRANSCRIPT_UNRECOGNIZED' };
    }
  }

  return values.length === 0
    ? { kind: 'UNAVAILABLE', reason: 'TRANSCRIPT_UNRECOGNIZED' }
    : { kind: 'VALUES', values };
}

function jsonShapeLimit(content: string): 'TRANSCRIPT_TOO_DEEP' | 'TRANSCRIPT_TOO_MANY_OBJECTS' | undefined {
  let depth = 0;
  let nodeCount = 0;
  let inString = false;
  let escaped = false;

  for (const character of content) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        return 'TRANSCRIPT_TOO_DEEP';
      }
      nodeCount += 1;
      if (nodeCount > MAX_JSON_NODES) {
        return 'TRANSCRIPT_TOO_MANY_OBJECTS';
      }
    } else if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1);
    }
  }

  return undefined;
}

function countJsonNodes(content: string): number {
  let nodeCount = 0;
  let inString = false;
  let escaped = false;

  for (const character of content) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') nodeCount += 1;
  }

  return nodeCount;
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
