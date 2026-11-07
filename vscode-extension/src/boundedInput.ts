export class InputLimitError extends Error {
  public readonly code = 'INPUT_LIMIT_EXCEEDED';

  public constructor(message: string) {
    super(message);
    this.name = 'InputLimitError';
  }
}

/**
 * Reads at most maxBytes of a byte stream and decodes only the accepted bytes.
 * The stream is never accumulated after the limit is crossed.
 */
export async function readUtf8WithinLimit(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) {
      throw new InputLimitError('Input exceeds the configured byte limit.');
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}
