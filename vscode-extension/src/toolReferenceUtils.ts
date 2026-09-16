/** Removes a VS Code internal tool reference from the beginning of a tool argument. */
export function stripToolReference(value: string, toolId: string): string {
  const escaped = toolId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^['\"]?${escaped}['\"]?\\s*`, 'i'), '');
}
