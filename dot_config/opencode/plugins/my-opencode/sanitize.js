const STACK_LINE_RE = /^\s*at\s+.+$/gm;
const PATH_RE = /\/(?:Users|home|root|tmp|var|opt|etc|mnt|proc|sys)\/[^\s'"`)]+|C:\\[^\s'"`)]+/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_TRACE_RE = /\b[0-9a-f]{16,64}\b/gi;
const MAX_ERROR_LENGTH = 240;

// Remove exact configured identity strings before text reaches the calling agent.
export function redactIdentity(text, values) {
  let result = text;
  const unique = [...new Set(values.filter(value => typeof value === 'string' && value.length >= 4))];
  for (const value of unique.sort((a, b) => b.length - a.length)) {
    result = result.split(value).join('<redacted>');
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
  return message || 'Unknown error';
}