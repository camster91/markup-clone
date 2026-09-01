import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard accessibility baseline', () => {
  it('provides a visible keyboard focus fallback for every interactive element', () => {
    expect(source('src/app/globals.css')).toMatch(/:focus-visible/);
  });

  it('establishes readable mobile forms and 44px interaction targets', () => {
    const css = source('src/app/globals.css');
    expect(css).toContain('@media (max-width: 639px), (max-device-width: 639px)');
    expect(css).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="hidden"\]\),[\s\S]*select,[\s\S]*textarea[\s\S]*min-height: 44px;[\s\S]*font-size: 16px;/);
    expect(css).toMatch(/button,[\s\S]*\[role="button"\],[\s\S]*a\[href\][\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/);
  });

  it('keeps screenshot pin and thread-close targets explicitly touch sized', () => {
    const screenshot = source('src/components/ScreenshotView.tsx');
    expect(screenshot).toContain('width: 44');
    expect(screenshot).toContain('height: 44');

    const thread = source('src/components/PinThread.tsx');
    expect(thread).toContain('min-h-11 min-w-11');
  });

  it('associates new-project labels with their inputs', () => {
    const file = source('src/components/NewProjectForm.tsx');
    expect(file).toContain('htmlFor="project-name"');
    expect(file).toContain('id="project-name"');
    expect(file).toContain('htmlFor="project-domain"');
    expect(file).toContain('id="project-domain"');
  });

  it('names subscriber and integration form controls', () => {
    const subscribers = source('src/components/ProjectSubscribers.tsx');
    expect(subscribers).toContain('aria-expanded={expanded}');
    expect(subscribers).toContain('aria-label="Subscriber email"');
    expect(subscribers).toContain('External new-feedback alerts');

    const settings = source('src/components/ProjectSettings.tsx');
    expect(settings).toContain('htmlFor="integration-kind"');
    expect(settings).toContain('aria-label="Integration URL"');
    expect(settings).toContain('aria-label="Optional webhook headers as JSON"');
  });

  it('names the pin-thread close and reply fields and announces upload errors', () => {
    const file = source('src/components/PinThread.tsx');
    expect(file).toContain('aria-label="Close comment thread"');
    expect(file).toContain('aria-label="Reply to this feedback"');
    expect(file).toContain('aria-label="Your name"');
    expect(file).toContain('role="alert"');
  });

  it('stacks project card headers before the mobile title can collide with counts', () => {
    for (const path of [
      'src/components/DashboardProjects.tsx',
      'src/components/ProjectDetail.tsx',
    ]) {
      const file = source(path);
      expect(file).toContain('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between');
      expect(file).toContain('flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-sm');
      expect(file).toContain('whitespace-nowrap');
    }
  });

  it('provides an announced route-transition loading state', () => {
    const file = source('src/app/loading.tsx');
    expect(file).toContain('role="status"');
    expect(file).toContain('aria-live="polite"');
    expect(file).toContain('aria-busy="true"');
  });

  it('describes the actual visual feedback product in page metadata', () => {
    const file = source('src/app/layout.tsx');
    expect(file).toContain('Visual Feedback');
    expect(file).toContain('contextual website feedback');
    expect(file).not.toContain('Website cloning and template replication tool');
  });

  it('provides a main landmark on every user-facing page', () => {
    for (const path of [
      'src/app/page.tsx',
      'src/app/projects/[id]/page.tsx',
      'src/app/share/[token]/page.tsx',
      'src/app/workspaces/page.tsx',
      'src/app/workspaces/[id]/page.tsx',
      'src/app/workspaces/[id]/teams/[teamId]/page.tsx',
    ]) {
      expect(source(path), path).toContain('<main');
    }
  });
});
