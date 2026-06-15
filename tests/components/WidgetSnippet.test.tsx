/* @vitest-environment jsdom */
// Audit A-4: WidgetSnippet must render data-project-id using the project's
// actual UUID, AND must not emit the redundant data-project-key attribute
// (the widget reads only data-api-key + data-project-id — emitting
// data-project-key would be misleading dead code).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import WidgetSnippet from '@/components/WidgetSnippet';

// Silence React 19's "current testing environment is not configured to
// support act(...)" warning when not running under @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WidgetSnippet (audit A-4)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // The snippet renders a <CopyButton> that calls navigator.clipboard on
    // click. JSDOM does not implement it; stub so the click handler doesn't
    // throw. (We never actually click the button in these tests — but the
    // stub is cheap insurance against the test environment being the one
    // place a stray click path is exercised.)
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
    }
  });

  it('embeds the project UUID in a data-project-id attribute (and drops data-project-key)', () => {
    const projectId = 'b0a6f8c2-1234-4d5e-8abc-0123456789ab';
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(WidgetSnippet, {
          apiKey: 'mk_test_abc',
          projectId,
          dashboardHost: 'https://markup.ashbi.ca',
        })
      );
    });

    const code = container.querySelector('code');
    const snippet = code?.textContent ?? '';
    expect(snippet).toContain(`data-project-id="${projectId}"`);
    expect(snippet).toContain('data-api-key="mk_test_abc"');
    // The widget (public/widget.js) only reads data-api-key and
    // data-project-id. data-project-key was a leftover from an earlier
    // schema; emitting it would be dead code that misleads embedders.
    expect(snippet).not.toContain('data-project-key');
  });

  it('uses the dashboardHost in the script src and produces a single <script> tag', () => {
    const projectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(WidgetSnippet, {
          apiKey: 'k1',
          projectId,
          dashboardHost: 'https://example.com',
        })
      );
    });

    const snippet = container.querySelector('code')?.textContent ?? '';
    expect(snippet).toMatch(/^<script src="https:\/\/example\.com\/widget\.js" /);
    // Exactly one <script> open tag, one </script> close tag.
    expect((snippet.match(/<script\b/g) ?? []).length).toBe(1);
    expect((snippet.match(/<\/script>/g) ?? []).length).toBe(1);
  });
});
