/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  buildSelectorCandidates,
  captureDeveloperContext,
  scrubElementSnippet,
} from '@/widget/context';

describe('widget developer context privacy', () => {
  it('builds bounded stable selector candidates without sensitive attributes', () => {
    document.body.innerHTML = '<button id="buy" data-testid="checkout" data-auth-token="secret" name="purchase" class="cta primary">Buy</button>';
    const button = document.querySelector('button')!;
    const selectors = buildSelectorCandidates(button, 'body > button.cta.primary');
    expect(selectors).toEqual([
      '#buy',
      '[data-testid="checkout"]',
      'button[name="purchase"]',
      'body > button.cta.primary',
    ]);
    expect(JSON.stringify(selectors)).not.toContain('secret');
  });

  it('scrubs values, token-like attributes, and URL queries from the element snippet', () => {
    document.body.innerHTML = '<form action="https://example.com/pay?session=secret"><input type="password" value="hunter2" data-token="abc"><a href="/account?auth=secret#x">Account</a></form>';
    const snippet = scrubElementSnippet(document.querySelector('form')!);
    expect(snippet).not.toContain('hunter2');
    expect(snippet).not.toContain('secret');
    expect(snippet).not.toContain('data-token');
    expect(snippet).toContain('action="https://example.com/pay"');
    expect(snippet).toContain('href="/account"');
  });

  it('captures a canonical query-free URL and viewport without storage or console data', () => {
    history.replaceState({}, '', '/pricing?token=secret#checkout');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const context = captureDeveloperContext(document.body, 'body');
    expect(context.pageUrl).toBe('http://localhost:3000/pricing');
    expect(context.viewportWidth).toBe(1280);
    expect(context.viewportHeight).toBe(720);
    expect(context.devicePixelRatio).toBe(2);
    expect(context).not.toHaveProperty('cookies');
    expect(context).not.toHaveProperty('localStorage');
    expect(context).not.toHaveProperty('console');
    expect(context).not.toHaveProperty('network');
  });
});
