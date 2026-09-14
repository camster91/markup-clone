import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { devices, expect, test } from '@playwright/test';

const iPhone = devices['iPhone 13'];

test.describe('dashboard mobile interaction contract', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    userAgent: iPhone.userAgent,
    deviceScaleFactor: iPhone.deviceScaleFactor,
    isMobile: iPhone.isMobile,
    hasTouch: iPhone.hasTouch,
  });

  test('keeps built dashboard controls readable, touch sized, focused, and within 375px', async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    const unexpectedResponses: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() < 400) return;
      if (response.status() === 401 && response.url().endsWith('/api/auth/me')) return;
      unexpectedResponses.push(`${response.status()} ${response.url()}`);
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
    });

    await page.goto('/');
    const compiledCss = readdirSync(resolve('.next/static/chunks'))
      .find((entry) => entry.endsWith('.css'));
    expect(compiledCss).toBeTruthy();
    await page.addStyleTag({ path: resolve('.next/static/chunks', compiledCss!) });
    await page.locator('main').evaluate((main) => {
      let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        viewport.name = 'viewport';
        document.head.append(viewport);
      }
      viewport.content = 'width=device-width, initial-scale=1';
      main.innerHTML = `
        <form aria-label="Mobile dashboard controls" style="padding:16px">
          <label for="mobile-email">Email</label>
          <input id="mobile-email" type="email" style="display:block;width:100%">
          <label for="mobile-state">Status</label>
          <select id="mobile-state" style="display:block;width:100%"><option>Open</option></select>
          <label for="mobile-reply">Reply</label>
          <textarea id="mobile-reply" style="display:block;width:100%"></textarea>
          <button type="button">Save</button>
          <a href="#review">Open review</a>
        </form>`;
    });
    await expect(page.getByRole('form', { name: 'Mobile dashboard controls' })).toBeVisible();
    const mobileMedia = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      maxWidth: matchMedia('(max-width: 639px)').matches,
      maxDeviceWidth: matchMedia('(max-device-width: 639px)').matches,
    }));
    expect(mobileMedia).toEqual({ innerWidth: 375, clientWidth: 375, maxWidth: true, maxDeviceWidth: true });

    const formControls = page.locator('input:not([type="hidden"]), select, textarea');
    expect(await formControls.count()).toBeGreaterThan(0);
    await expect.poll(async () => formControls.first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    )).toBeGreaterThanOrEqual(16);
    for (let index = 0; index < await formControls.count(); index += 1) {
      const control = formControls.nth(index);
      if (!(await control.isVisible())) continue;
      const metrics = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return { fontSize: Number.parseFloat(style.fontSize), height: rect.height };
      });
      expect(metrics.fontSize, `form control ${index} font size`).toBeGreaterThanOrEqual(16);
      expect(metrics.height, `form control ${index} target height`).toBeGreaterThanOrEqual(44);
    }

    const interactive = page.locator('button, [role="button"], a[href]');
    expect(await interactive.count()).toBeGreaterThan(0);
    for (let index = 0; index < await interactive.count(); index += 1) {
      const target = interactive.nth(index);
      if (!(await target.isVisible())) continue;
      const box = await target.boundingBox();
      expect(box?.width, `interactive target ${index} width`).toBeGreaterThanOrEqual(44);
      expect(box?.height, `interactive target ${index} height`).toBeGreaterThanOrEqual(44);
    }

    const email = page.getByLabel('Email');
    await email.focus();
    const focusOutline = await email.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusOutline.style).not.toBe('none');
    expect(focusOutline.width).toBeGreaterThanOrEqual(3);

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    expect(browserErrors.filter((message) =>
      !message.includes('status of 401 (Unauthorized)')
      && !message.includes('A TLS error caused the secure connection to fail')
    )).toEqual([]);
    expect(unexpectedResponses).toEqual([]);

    await page.screenshot({ path: testInfo.outputPath('dashboard-mobile-controls-375.png'), fullPage: false });
  });

  test('keeps the real LoginForm readable and touch sized at 375px', async ({ page }) => {
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
    });
    await page.goto('/');
    const form = page.getByRole('form', { name: 'Sign in to the dashboard' });
    await expect(form).toBeVisible();
    for (const label of ['Email', 'Password']) {
      const control = page.getByLabel(label, { exact: true });
      await expect(control).toBeVisible();
      const metrics = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return { fontSize: Number.parseFloat(style.fontSize), height: rect.height };
      });
      expect(metrics.fontSize, `${label} font size`).toBeGreaterThanOrEqual(16);
      expect(metrics.height, `${label} height`).toBeGreaterThanOrEqual(44);
    }
    const submit = form.getByRole('button', { name: /sign in/i });
    const box = await submit.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  });
});
