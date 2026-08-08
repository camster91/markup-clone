import path from 'node:path';
import { expect, test } from '@playwright/test';

const WIDGET_PATH = path.resolve(process.cwd(), 'public/widget.js');

function mobileHostPage(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Accessible widget host</title></head>
  <body style="margin:0">
    <main>
      <h1>Mobile review page</h1>
      <button id="target" type="button" style="margin:24px;width:180px;height:64px">Review this element</button>
    </main>
    <script src="/widget.js" data-project-id="e2e-accessibility-project" data-api-key="mk_e2e_accessibility_key"></script>
  </body>
</html>`;
}

test.describe('markup widget — mobile keyboard and accessibility contract', () => {
  test('uses a labeled modal, usable touch targets, focus management, and no horizontal overflow', async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
    await page.route(/\/widget\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({ path: WIDGET_PATH, contentType: 'application/javascript' });
    });

    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/recapture-test.html');
    await page.setContent(mobileHostPage());

    const toggle = page.getByRole('button', { name: 'Feedback' });
    await expect(toggle).toBeVisible();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox?.width).toBeGreaterThanOrEqual(44);
    expect(toggleBox?.height).toBeGreaterThanOrEqual(44);

    const target = page.locator('#target');
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    const focusOutline = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusOutline.style).not.toBe('none');
    expect(focusOutline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAccessibleName(/Click anywhere to leave feedback/);

    await target.click();
    const dialog = page.getByRole('dialog', { name: 'Pin #1' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Your name')).toBeVisible();
    expect(await page.getByLabel('Your name').evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    )).toBeGreaterThanOrEqual(16);
    const comment = page.getByLabel('Comment');
    await expect(comment).toBeVisible();
    await expect(comment).toBeFocused();
    const closeButton = page.getByRole('button', { name: 'Close feedback' });
    await expect(closeButton).toBeVisible();

    const commentLabelBox = await page.getByText('Comment', { exact: true }).boundingBox();
    const commentBox = await comment.boundingBox();
    expect((commentBox?.y ?? 0) - ((commentLabelBox?.y ?? 0) + (commentLabelBox?.height ?? 0)))
      .toBeGreaterThanOrEqual(8);

    const dialogFont = await dialog.evaluate((element) => getComputedStyle(element).fontFamily);
    for (const button of [
      closeButton,
      page.getByRole('button', { name: 'Cancel' }),
      page.getByRole('button', { name: 'Save pin' }),
    ]) {
      expect(await button.evaluate((element) => getComputedStyle(element).fontFamily)).toBe(dialogFont);
    }

    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.focus();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    await comment.focus();

    const controls = dialog.locator('button, input, textarea');
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      expect(box?.height, `control ${index} should be at least 44px high`).toBeGreaterThanOrEqual(44);
    }

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);

    await page.screenshot({ path: testInfo.outputPath('widget-mobile-dialog.png'), fullPage: false });
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(target).toBeFocused();

    await page.setViewportSize({ width: 375, height: 812 });
    await target.click();
    const dialog375 = page.getByRole('dialog', { name: 'Pin #2' });
    await expect(dialog375).toBeVisible();
    const viewport375 = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport375.scrollWidth).toBe(viewport375.clientWidth);
    await page.screenshot({ path: testInfo.outputPath('widget-375-dialog.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(dialog375).toBeHidden();
  });
});
