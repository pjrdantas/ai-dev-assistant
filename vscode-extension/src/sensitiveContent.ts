const SENSITIVE_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/iu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/iu,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/iu,
  /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/u,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/iu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:xox[baprs]|npm|pypi)-[A-Za-z0-9_-]{16,}\b/iu,
  /\bAIza[A-Za-z0-9_-]{30,}\b/u,
  /\bya29\.[A-Za-z0-9_-]{20,}\b/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  /-----BEGIN(?: RSA| EC| OPENSSH)? PRIVATE KEY-----/iu,
  /\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{16,}/iu,
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s/@:]+:[^\s/@]+@/iu,
];

const SECRET_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|credential(?:s)?|private[_-]?key|token)\b\s*[:=]\s*["']?([^\s"']{12,})["']?/giu;
const ENV_SECRET_ASSIGNMENT = /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?)\b\s*=\s*["']?([^\s"']{12,})["']?/gu;

/** Detects high-confidence credential material without attempting universal secret discovery. */
export function containsSensitiveContent(value: string): boolean {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  return [...value.matchAll(SECRET_ASSIGNMENT), ...value.matchAll(ENV_SECRET_ASSIGNMENT)]
    .some((match) => !isPlaceholder(match[1] ?? ''));
}

function isPlaceholder(value: string): boolean {
  const normalized = value.replace(/[<>{}()[\]$]/g, '').toLocaleLowerCase('und');
  return /^(?:example|sample|dummy|fake|test|changeme|replace[-_ ]?me|your[-_ ]?(?:token|secret|password|key)|password|secret|token|value|xxx+|redacted|placeholder)$/.test(normalized);
}
