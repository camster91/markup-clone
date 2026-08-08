export type CapturedDeveloperContext = {
  pageUrl: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  userAgent: string;
  platform: string;
  selectorCandidates: string[];
  elementHTML: string;
};

const SENSITIVE_ATTRIBUTE = /(?:^|[-_:])(value|token|secret|password|passwd|auth|authorization|cookie|session|nonce|key)(?:$|[-_:])/i;
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster']);

function escapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0)?.toString(16)} `);
}

function attributeSelector(name: string, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[${name}="${escaped}"]`;
}

export function buildSelectorCandidates(element: Element, structuralSelector: string): string[] {
  const candidates: string[] = [];
  const add = (candidate: string | null) => {
    if (candidate && candidate.length <= 500 && !candidates.includes(candidate) && candidates.length < 5) candidates.push(candidate);
  };
  if (element.id) add(`#${escapeCss(element.id)}`);
  for (const name of ['data-testid', 'data-test', 'data-cy']) {
    const value = element.getAttribute(name);
    if (value) add(attributeSelector(name, value));
  }
  const name = element.getAttribute('name');
  if (name) add(`${element.tagName.toLowerCase()}${attributeSelector('name', name)}`);
  add(structuralSelector);
  return candidates;
}

function scrubUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
    return url.pathname;
  } catch {
    return '';
  }
}

export function scrubElementSnippet(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  const nodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (const node of nodes) {
    for (const attribute of Array.from(node.attributes)) {
      if (SENSITIVE_ATTRIBUTE.test(attribute.name)) {
        node.removeAttribute(attribute.name);
      } else if (URL_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        const scrubbed = scrubUrl(attribute.value);
        if (scrubbed) node.setAttribute(attribute.name, scrubbed);
        else node.removeAttribute(attribute.name);
      }
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      node.removeAttribute('value');
      if (node instanceof HTMLTextAreaElement) node.textContent = '';
      if (node instanceof HTMLSelectElement) {
        for (const option of Array.from(node.options)) option.removeAttribute('selected');
      }
    }
  }
  return clone.outerHTML.slice(0, 4000);
}

export function captureDeveloperContext(element: Element, structuralSelector: string): CapturedDeveloperContext {
  const url = new URL(window.location.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return {
    pageUrl: url.toString(),
    viewportWidth: Math.max(1, Math.round(window.innerWidth)),
    viewportHeight: Math.max(1, Math.round(window.innerHeight)),
    devicePixelRatio: Math.max(0.25, Math.min(10, window.devicePixelRatio || 1)),
    userAgent: (navigator.userAgent || '').slice(0, 512),
    platform: (navigator.platform || '').slice(0, 128),
    selectorCandidates: buildSelectorCandidates(element, structuralSelector),
    elementHTML: scrubElementSnippet(element),
  };
}
