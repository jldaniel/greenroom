export interface RedactionOptions {
  env?: Record<string, string | undefined>;
  extraSecrets?: readonly string[];
  maxChars?: number;
}

const redacted = "[redacted]";
const redactedToken = "[redacted-token]";
const redactedFieldCountKey = "redactedFieldCount";
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

export function isSecretLikeKey(key: string): boolean {
  return secretKeyPattern.test(key);
}

export function redactDiagnostic(value: string, options: RedactionOptions = {}): string {
  const redactedValue = redactString(value, options);

  if (options.maxChars !== undefined && options.maxChars >= 0) {
    return tailString(redactedValue, options.maxChars);
  }

  return redactedValue;
}

export function redactString(value: string, options: RedactionOptions = {}): string {
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

export function redactJsonValue(value: unknown, options: RedactionOptions = {}): unknown {
  return redactJsonValueInternal(value, options, 0);
}

export function redactWorkflowMetadata(
  metadata: Record<string, unknown> | undefined,
  options: RedactionOptions = {},
): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }

  const output: Record<string, unknown> = {};
  let redactedSecretFields = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (isSecretLikeKey(key)) {
      redactedSecretFields += 1;
      continue;
    }

    output[key] = redactJsonValue(value, options);
  }

  if (redactedSecretFields > 0) {
    const existing = output[redactedFieldCountKey];
    output[redactedFieldCountKey] =
      (typeof existing === "number" && Number.isFinite(existing) ? existing : 0) +
      redactedSecretFields;
  }

  return output;
}

function redactJsonValueInternal(
  value: unknown,
  options: RedactionOptions,
  depth: number,
): unknown {
  if (typeof value === "string") {
    return redactString(value, options);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (depth > 20) {
    return "[redacted-depth-limit]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValueInternal(entry, options, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = isSecretLikeKey(key)
        ? redacted
        : redactJsonValueInternal(nestedValue, options, depth + 1);
    }

    return output;
  }

  return redacted;
}

function knownSecrets(options: RedactionOptions): string[] {
  const values = new Set<string>();

  for (const value of options.extraSecrets ?? []) {
    addSecret(values, value);
  }

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value !== undefined && isSecretLikeKey(key)) {
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
