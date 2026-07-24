// Redact secrets from Integration.configJson before returning rows
// on GET /api/projects/[id]/integrations.
//
// Webhook URLs are credentials (Slack/Discord authenticate by URL
// path). Custom webhook `headers` often carry API keys. The dashboard
// only needs enough of the URL to recognize which integration is
// which (scheme + host + a short path prefix) — never the full token.

/**
 * Parse `configJson` and return a redacted JSON string safe for
 * dashboard list responses. On parse failure, returns the input
 * unchanged (the UI already tolerates malformed config).
 */
export function redactConfigJson(kind: string, configJson: string): string {
  void kind; // reserved for kind-specific redaction rules later
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return configJson;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return configJson;
  }

  const config = { ...(parsed as Record<string, unknown>) };

  for (const key of ['webhookUrl', 'url'] as const) {
    if (typeof config[key] === 'string') {
      config[key] = redactUrl(config[key] as string);
    }
  }

  if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
    const headers: Record<string, string> = {};
    for (const key of Object.keys(config.headers as Record<string, unknown>)) {
      headers[key] = '***';
    }
    config.headers = headers;
  }

  return JSON.stringify(config);
}

/** Keep scheme+host; show at most the first 12 chars of the path, then `…`. */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const pathPrefix = u.pathname.slice(0, 12);
    return `${u.protocol}//${u.host}${pathPrefix}…`;
  } catch {
    return '***';
  }
}
