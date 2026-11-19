const STACK_LINE_RE = /^\s*at\s+.+$/gm;
const PATH_RE = /\/(?:Users|home|root|tmp|var|opt|etc|mnt|proc|sys)\/[^\s'"`)]+|C:\\[^\s'"`)]+/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_TRACE_RE = /\b[0-9a-f]{16,64}\b/gi;
const MAX_ERROR_LENGTH = 240;

// Remove exact configured identity strings before text reaches the calling agent.
// Short identifiers (1-3 chars) are masked when the characters outside them are
// not identifier characters, so punctuation-edged ids like "+ai" or "m-" match
// while "ai" inside "said" does not; longer ones use exact substitution.
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortIdPattern = (value, flags = '') => new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, flags);

// The marker must not itself match any configured identity, and replacements
// must not recreate an identity across the marker boundary (e.g. 'other' +
// 'foo' forming a configured 'redacted>foo' after a readable marker like
// '<redacted>'). Identities are whitespace-free and finite, so a marker built
// from a character that appears in none of them cannot contain or
// boundary-match any identity, nor join with neighboring text to form one.
// This terminates for any finite identity set.
function safeMarker(values) {
  const used = new Set(values.join(''));
  const candidates = ['*', '#', '@', '!', '~', '^', '%', '&', '=', '?', ':', ';', ',', '(', ')', '[', ']', '{', '}', '|', '`', '$', '€', '§', '¶', '•', '→', '█', '✱', '❖'];
  let ch = candidates.find(candidate => !used.has(candidate));
  if (ch === undefined) {
    for (let cp = 0x2600; ; cp++) {
      const candidate = String.fromCodePoint(cp);
      if (!used.has(candidate)) { ch = candidate; break; }
    }
  }
  return ch.repeat(3);
}

export function redactIdentity(text, values) {
  const unique = [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => b.length - a.length);
  const marker = safeMarker(unique);
  let result = text;
  // Masking one identity can change the boundary around another (e.g. 'b' in
  // 'ai-b' exposes 'ai-'), so re-run the passes until the text stops changing.
  // Termination: every replacement removes identity characters and inserts
  // only marker characters, which appear in no identity.
  let changed = true;
  while (changed) {
    changed = false;
    for (const value of unique) {
      const next = value.length >= 4
        ? result.split(value).join(marker)
        : result.replace(shortIdPattern(value, 'g'), marker);
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
}

export function sanitizeErrorMessage(input, redactions = []) {
  let message;
  if (input instanceof Error) {
    message = input.message || input.name || 'Unknown error';
  } else if (typeof input === 'string') {
    message = input;
  } else if (input === null || input === undefined) {
    message = 'Unknown error';
  } else {
    try {
      message = JSON.stringify(input);
    } catch {
      message = String(input);
    }
  }
  message = message.replace(STACK_LINE_RE, '');
  message = message.replace(PATH_RE, '<path>');
  message = message.replace(UUID_RE, '<id>');
  message = message.replace(HEX_TRACE_RE, '<id>');
  message = redactIdentity(message, redactions);
  message = message.replace(/\s+/g, ' ').trim();
  if (message.length > MAX_ERROR_LENGTH) {
    message = `${message.slice(0, MAX_ERROR_LENGTH)}…`;
  }
  // Truncation can cut the character that kept a short identity embedded
  // (e.g. 'aiX' → 'ai…'), so recheck the final formatted error.
  message = redactIdentity(message, redactions);
  return message || 'Unknown error';
}