export interface RedactionOptions {
  env?: Record<string, string | undefined>;
  extraSecrets?: readonly string[];
  maxChars?: number;
}

const redacted = "[redacted]";
const redactedToken = "[redacted-token]";
const secretKeyPattern =
  /(api[_-]?key|apikey|authorization|bearer|credential|password|private[_-]?key|provider[_-]?key|secret|session[_-]?token|token|webhook[_-]?secret)/iu;

const tokenPatterns: readonly [RegExp, string][] = [
  [/\bgrt_[A-Za-z0-9_-]{8,}\b/gu, redactedToken],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/gu, redacted],
  [/\bsk-ant-[A-Za-z0-9_-]{12,}\b/gu, redacted],
  [/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/gu, redacted],
  [/\bglpat-[A-Za-z0-9_-]{12,}\b/gu, redacted],
  [/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/gu, redacted],
];

export function redactDiagnostic(value: string, options: RedactionOptions = {}): string {
  const redactedValue = redactString(value, options);

  if (options.maxChars !== undefined && options.maxChars >= 0) {
    return tailString(redactedValue, options.maxChars);
  }

  return redactedValue;
}

function redactString(value: string, options: RedactionOptions): string {
  let output = value;

  for (const secret of knownSecrets(options)) {
    output = output.replaceAll(secret, redacted);
  }

  output = output
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}\b/giu, `Bearer ${redacted}`)
    .replaceAll(
      /\b(authorization|api[-_ ]?key|apikey|credential|password|provider[-_ ]?key|secret|token|mcp[-_ ]?token|harness[-_ ]?token)\b(\s*[:=]\s*)(["']?)[^"',\s;}]+/giu,
      (_match, key: string, separator: string, quote: string) =>
        `${key}${separator}${quote}${redacted}`,
    );

  for (const [pattern, replacement] of tokenPatterns) {
    output = output.replaceAll(pattern, replacement);
  }

  return output;
}

function knownSecrets(options: RedactionOptions): string[] {
  const values = new Set<string>();

  for (const value of options.extraSecrets ?? []) {
    addSecret(values, value);
  }

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value !== undefined && secretKeyPattern.test(key)) {
      addSecret(values, value);
    }
  }

  return [...values].sort((left, right) => right.length - left.length);
}

function addSecret(values: Set<string>, value: string): void {
  const trimmed = value.trim();

  if (trimmed.length >= 8) {
    values.add(trimmed);
  }
}

function tailString(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }

  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}
