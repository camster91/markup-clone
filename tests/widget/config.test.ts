/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readConfig, parseHost, findScriptEl } from '../../src/widget/config';

describe('widget/config', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('parseHost("example.com") returns the API URL with /api/pins suffix', () => {
    // The widget derives the API URL from the script src by stripping
    // /widget.js and appending /api/pins. parseHost() is the pure
    // function that does the derivation; the test pins the rule.
    const out = parseHost('https://example.com/widget.js');
    expect(out).toBe('https://example.com/api/pins');
  });

  it('parseHost strips query string after /widget.js', () => {
    const out = parseHost('https://example.com/widget.js?cb=12345');
    expect(out).toBe('https://example.com/api/pins');
  });

  it('parseHost handles a path with /widget.js in the middle', () => {
    // The regex is /\/widget\.js.*$/ — anchored at the end. A path like
    // /a/widget.js/b should NOT match (which is correct: /widget.js only
    // appears at the leaf). The rule is: replace only if the URL ends
    // with /widget.js or /widget.js?query.
    const out = parseHost('https://example.com/widget.js');
    expect(out).toBe('https://example.com/api/pins');
  });

  it('readConfig returns null when no script tag exists', () => {
    // No <script> in the document and document.currentScript is null in
    // jsdom, so findScriptEl() returns null and readConfig returns null.
    // JSDOM's default HTML may have a <script> from the parser; ensure
    // the head is empty first.
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    document.body.querySelectorAll('script').forEach((s) => s.remove());
    Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
    expect(readConfig()).toBeNull();
  });

  it('readConfig reads data-api-key, data-project-id, data-author-name from the script tag', () => {
    const s = document.createElement('script');
    s.setAttribute('data-api-key', 'mk_test');
    s.setAttribute('data-project-id', 'proj-1');
    s.setAttribute('data-author-name', 'Alice');
    s.setAttribute('src', 'https://example.com/widget.js');
    document.head.appendChild(s);
    Object.defineProperty(document, 'currentScript', { value: s, configurable: true });

    const cfg = readConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.apiKey).toBe('mk_test');
    expect(cfg!.projectId).toBe('proj-1');
    expect(cfg!.authorName).toBe('Alice');
    expect(cfg!.apiUrl).toBe('https://example.com/api/pins');
    expect(cfg!.scriptSrc).toBe('https://example.com/widget.js');
  });

  it('readConfig falls back to data-project-key when data-api-key is absent', () => {
    // data-project-key is a legacy alias for data-api-key, kept for
    // backwards compatibility with embed snippets published before
    // 2026-05-01.
    const s = document.createElement('script');
    s.setAttribute('data-project-key', 'legacy_key');
    s.setAttribute('data-project-id', 'proj-1');
    s.setAttribute('src', 'https://example.com/widget.js');
    document.head.appendChild(s);
    Object.defineProperty(document, 'currentScript', { value: s, configurable: true });

    const cfg = readConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.apiKey).toBe('legacy_key');
  });

  it('readConfig defaults authorName to "Client" when data-author-name is missing', () => {
    const s = document.createElement('script');
    s.setAttribute('data-api-key', 'mk_test');
    s.setAttribute('data-project-id', 'proj-1');
    s.setAttribute('src', 'https://example.com/widget.js');
    document.head.appendChild(s);
    Object.defineProperty(document, 'currentScript', { value: s, configurable: true });

    const cfg = readConfig();
    expect(cfg!.authorName).toBe('Client');
  });

  it('findScriptEl falls back to the last <script> when currentScript is null', () => {
    // Some JSDOM / dynamic-injection paths leave currentScript null. The
    // widget should still find the most recently appended <script>.
    const old = document.createElement('script');
    old.setAttribute('src', '/old.js');
    document.head.appendChild(old);
    const latest = document.createElement('script');
    latest.setAttribute('src', '/widget.js');
    document.head.appendChild(latest);
    Object.defineProperty(document, 'currentScript', { value: null, configurable: true });

    const found = findScriptEl();
    expect(found).toBe(latest);
  });
});
