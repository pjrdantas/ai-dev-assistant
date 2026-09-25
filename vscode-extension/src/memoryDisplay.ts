const LEGACY_SAVE_MEMORY_PREFIX = /^\s*['"`]?ai-dev-assistant_saveMemory['"`]?\s+salve\s+como\s+conhecimento\s+reutiliz[aá]vel(?:\s+que)?\s*/iu;

/**
 * Returns a human-readable title for UI presentation without changing the
 * originalRequest persisted in MongoDB.
 */
export function memoryDisplayTitle(originalRequest: string): string {
  const compact = originalRequest.replace(/\s+/g, ' ').trim();
  const cleaned = compact.replace(LEGACY_SAVE_MEMORY_PREFIX, '').trim();

  if (cleaned.length === 0 || cleaned === compact) {
    return compact;
  }

  return capitalizeFirst(cleaned);
}

function capitalizeFirst(value: string): string {
  const [first, ...rest] = Array.from(value);
  return first === undefined ? value : `${first.toLocaleUpperCase('pt-BR')}${rest.join('')}`;
}
