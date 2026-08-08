export const DEVELOPER_CONTEXT_LIMITS = {
  PAGE_URL_MAX: 2048,
  VIEWPORT_MAX: 10_000,
  DPR_MIN: 0.25,
  DPR_MAX: 10,
  USER_AGENT_MAX: 512,
  PLATFORM_MAX: 128,
  SELECTOR_COUNT_MAX: 5,
  SELECTOR_MAX: 500,
} as const;

export type DeveloperContextInput = {
  pageUrl?: unknown;
  viewportWidth?: unknown;
  viewportHeight?: unknown;
  devicePixelRatio?: unknown;
  userAgent?: unknown;
  platform?: unknown;
  selectorCandidatesJson?: unknown;
};

export type DeveloperContextValue = {
  pageUrl: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  devicePixelRatio: number | null;
  userAgent: string | null;
  platform: string | null;
  selectorCandidatesJson: string | null;
};

type Result = { ok: true; value: DeveloperContextValue } | { ok: false; error: string };

function optionalText(value: unknown, max: number, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) return { ok: false, error: `${label} contains invalid characters` };
  if (trimmed.length > max) return { ok: false, error: `${label} must be ≤${max} chars` };
  return { ok: true, value: trimmed };
}

function optionalNumber(value: unknown, label: string, min: number, max: number, integer: boolean): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    return { ok: false, error: `${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}` };
  }
  return { ok: true, value: parsed };
}

function normalizedHost(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

function canonicalPageUrl(value: unknown, projectDomain: string, pagePath: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = optionalText(value, DEVELOPER_CONTEXT_LIMITS.PAGE_URL_MAX, 'pageUrl');
  if (!text.ok || text.value === null) return text;
  let url: URL;
  try {
    url = new URL(text.value);
  } catch {
    return { ok: false, error: 'pageUrl must be an absolute HTTP(S) URL' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'pageUrl must use HTTP(S)' };
  if (url.username || url.password) return { ok: false, error: 'pageUrl must not contain credentials' };
  if (normalizedHost(url.hostname) !== normalizedHost(projectDomain)) {
    return { ok: false, error: 'pageUrl host must match the project domain' };
  }
  if (url.pathname !== pagePath) return { ok: false, error: 'pageUrl path must match path' };
  url.search = '';
  url.hash = '';
  return { ok: true, value: url.toString().replace(/\/$/, pagePath === '/' ? '/' : '') };
}

function selectors(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = optionalText(value, 4_000, 'selectorCandidatesJson');
  if (!text.ok || text.value === null) return text;
  let parsed: unknown;
  try { parsed = JSON.parse(text.value); } catch { return { ok: false, error: 'selectorCandidatesJson must be valid JSON' }; }
  if (!Array.isArray(parsed)) return { ok: false, error: 'selectorCandidatesJson must be an array' };
  if (parsed.length > DEVELOPER_CONTEXT_LIMITS.SELECTOR_COUNT_MAX) return { ok: false, error: 'too many selector candidates' };
  const unique: string[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== 'string') return { ok: false, error: 'selector candidates must be strings' };
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length > DEVELOPER_CONTEXT_LIMITS.SELECTOR_MAX || /[\u0000\r\n]/.test(trimmed)) {
      return { ok: false, error: `selector candidates must be 1-${DEVELOPER_CONTEXT_LIMITS.SELECTOR_MAX} safe characters` };
    }
    if (!unique.includes(trimmed)) unique.push(trimmed);
  }
  return { ok: true, value: unique.length ? JSON.stringify(unique) : null };
}

export function parseDeveloperContext(input: DeveloperContextInput, projectDomain: string, pagePath: string): Result {
  const pageUrl = canonicalPageUrl(input.pageUrl, projectDomain, pagePath);
  if (!pageUrl.ok) return pageUrl;
  const viewportWidth = optionalNumber(input.viewportWidth, 'viewportWidth', 1, DEVELOPER_CONTEXT_LIMITS.VIEWPORT_MAX, true);
  if (!viewportWidth.ok) return viewportWidth;
  const viewportHeight = optionalNumber(input.viewportHeight, 'viewportHeight', 1, DEVELOPER_CONTEXT_LIMITS.VIEWPORT_MAX, true);
  if (!viewportHeight.ok) return viewportHeight;
  if ((viewportWidth.value === null) !== (viewportHeight.value === null)) return { ok: false, error: 'viewportWidth and viewportHeight must be provided together' };
  const devicePixelRatio = optionalNumber(input.devicePixelRatio, 'devicePixelRatio', DEVELOPER_CONTEXT_LIMITS.DPR_MIN, DEVELOPER_CONTEXT_LIMITS.DPR_MAX, false);
  if (!devicePixelRatio.ok) return devicePixelRatio;
  const userAgent = optionalText(input.userAgent, DEVELOPER_CONTEXT_LIMITS.USER_AGENT_MAX, 'userAgent');
  if (!userAgent.ok) return userAgent;
  const platform = optionalText(input.platform, DEVELOPER_CONTEXT_LIMITS.PLATFORM_MAX, 'platform');
  if (!platform.ok) return platform;
  const selectorCandidatesJson = selectors(input.selectorCandidatesJson);
  if (!selectorCandidatesJson.ok) return selectorCandidatesJson;
  return { ok: true, value: { pageUrl: pageUrl.value, viewportWidth: viewportWidth.value, viewportHeight: viewportHeight.value, devicePixelRatio: devicePixelRatio.value, userAgent: userAgent.value, platform: platform.value, selectorCandidatesJson: selectorCandidatesJson.value } };
}

export function normalizeBrowserContext(userAgent: string | null, platformValue: string | null): { browser: string; platform: string } {
  const ua = userAgent ?? '';
  const match = ua.match(/Edg\/(\d+)/) ?? ua.match(/Firefox\/(\d+)/) ?? ua.match(/(?:Chrome|CriOS)\/(\d+)/) ?? ua.match(/Version\/(\d+).+Safari\//);
  let browser = 'Unknown browser';
  if (match) {
    if (/Edg\//.test(ua)) browser = `Edge ${match[1]}`;
    else if (/Firefox\//.test(ua)) browser = `Firefox ${match[1]}`;
    else if (/(?:Chrome|CriOS)\//.test(ua)) browser = `Chrome ${match[1]}`;
    else if (/Safari\//.test(ua)) browser = `Safari ${match[1]}`;
  }
  const source = `${platformValue ?? ''} ${ua}`;
  const platform = /Windows|Win32|Win64/i.test(source)
    ? 'Windows'
    : /Android/i.test(source)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(source)
        ? 'iOS'
        : /Mac/i.test(source)
          ? 'macOS'
          : /Linux/i.test(source)
            ? 'Linux'
            : 'Unknown platform';
  return { browser, platform };
}

function scrubHtmlUrl(value: string): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const url = new URL(value, 'https://context.invalid');
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return absolute ? url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '') : url.pathname;
  } catch {
    return '';
  }
}

/**
 * Defense-in-depth for callers that bypass the widget's DOM scrubber. This is
 * deliberately conservative: it does not try to parse arbitrary HTML, it
 * removes fields likely to contain user input or credentials before storage.
 */
export function sanitizeElementSnippetHtml(value: string | null): string | null {
  if (!value) return null;
  let scrubbed = value
    .replace(/\s[^\s=<>]*(?:value|token|secret|password|passwd|auth|authorization|cookie|session|nonce|key)[^\s=<>]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi, '<textarea$1></textarea>')
    .replace(/\sselected(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
  scrubbed = scrubbed.replace(/(\s(?:href|src|action|formaction|poster)\s*=\s*)(["'])(.*?)\2/gi, (_match, prefix: string, quote: string, urlValue: string) => {
    const safe = scrubHtmlUrl(urlValue);
    return safe ? `${prefix}${quote}${safe}${quote}` : '';
  });
  return scrubbed.slice(0, 4000);
}
