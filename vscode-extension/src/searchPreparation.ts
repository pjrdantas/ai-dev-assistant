import { sanitizeDiagnosticText } from './mongoConnectionManager.js';

export interface SearchPromotionDiagnostic {
  readonly reason: 'PROMOTION_FAILED';
  readonly message?: string;
}

export async function runBeforeSearch(
  beforeSearch: (() => Promise<void>) | undefined,
  onFailure: ((diagnostic: SearchPromotionDiagnostic) => void) | undefined,
): Promise<void> {
  try {
    await beforeSearch?.();
  } catch (error) {
    const message = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
    onFailure?.({ reason: 'PROMOTION_FAILED', ...(message === undefined ? {} : { message }) });
  }
}
