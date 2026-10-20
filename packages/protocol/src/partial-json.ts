const MAX_CUT_ATTEMPTS = 600;
const FULL_SCAN_TAIL = 64;

function closeOpenStructures(text: string): string | undefined {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      closers.push("}");
      continue;
    }

    if (char === "[") {
      closers.push("]");
      continue;
    }

    if (char === "}" || char === "]") {
      if (closers.at(-1) !== char) {
        return undefined;
      }

      closers.pop();
    }
  }

  let repaired = escaped ? text.slice(0, -1) : text;

  if (inString) {
    repaired += '"';
  }

  repaired = repaired.replace(/,\s*$/, "");
  repaired += closers.reverse().join("");

  return repaired;
}

interface ParseResult {
  value: unknown;
  complete: boolean;
}

function tryParse(text: string): ParseResult | undefined {
  const repaired = closeOpenStructures(text);

  if (repaired === undefined) {
    return undefined;
  }

  try {
    return { value: JSON.parse(repaired), complete: repaired === text };
  } catch {
    return undefined;
  }
}

function isEmptyContainer(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 0
  );
}

export function parsePartialJson(input: string): unknown | undefined {
  const text = input.trim();

  if (!text) {
    return undefined;
  }

  const direct = tryParse(text);

  if (direct && (direct.complete || !isEmptyContainer(direct.value))) {
    return direct.value;
  }

  let attempts = 0;

  for (let cut = text.length - 1; cut > 0; cut -= 1) {
    attempts += 1;

    if (attempts > MAX_CUT_ATTEMPTS) {
      break;
    }

    const char = text[cut - 1];
    const withinTail = text.length - cut <= FULL_SCAN_TAIL;
    const isStructural =
      char === "," ||
      char === ":" ||
      char === "{" ||
      char === "[" ||
      char === '"' ||
      /\s/.test(char ?? "");

    if (!withinTail && !isStructural) {
      continue;
    }

    const result = tryParse(text.slice(0, cut));

    if (result && !isEmptyContainer(result.value)) {
      return result.value;
    }
  }

  return undefined;
}
