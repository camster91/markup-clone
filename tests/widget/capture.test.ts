/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { buildCaptureSvg, inlineStyles, readCaptureGeometry } from '../../src/widget/capture';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>hi</p></body></html>';

function parseSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const fo = doc.getElementsByTagNameNS(SVG_NS, 'foreignObject')[0];
  return { root, fo };
}

describe('widget/capture geometry', () => {
  afterEach(() => {
    for (const key of ['innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset']) {
      delete (window as unknown as Record<string, unknown>)[key];
    }
  });

  it('renders the whole document in the foreignObject and crops to the scrolled viewport via viewBox', () => {
    const svg = buildCaptureSvg(
      { width: 800, height: 600, scrollX: 40, scrollY: 1200, docWidth: 1000, docHeight: 5000 },
      XHTML
    );
    const { root, fo } = parseSvg(svg);

    expect(root.getAttribute('width')).toBe('800');
    expect(root.getAttribute('height')).toBe('600');
    expect(root.getAttribute('viewBox')).toBe('40 1200 800 600');

    // The foreignObject starts at the document origin and spans the full
    // document, so page coordinates == SVG user coordinates...
    expect(fo.getAttribute('x')).toBe('0');
    expect(fo.getAttribute('y')).toBe('0');
    expect(fo.getAttribute('width')).toBe('1000');
    expect(fo.getAttribute('height')).toBe('5000');
    // ...and the viewBox region lies entirely inside it. (A 100% sized
    // foreignObject covered only 0..800 x 0..600 — nothing at y=1200.)
    const [vx, vy, vw, vh] = root.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vx + vw).toBeLessThanOrEqual(Number(fo.getAttribute('width')));
    expect(vy + vh).toBeLessThanOrEqual(Number(fo.getAttribute('height')));
    expect(fo.getAttribute('width')).not.toMatch(/%/);
    expect(fo.getAttribute('height')).not.toMatch(/%/);
  });

  it('readCaptureGeometry sizes the document to at least scroll offset + viewport', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 1500, configurable: true });
    // JSDOM has no layout, so scrollWidth/scrollHeight are 0; the scroll
    // offset + viewport lower bound must still hold.
    const geo = readCaptureGeometry();
    expect(geo).toMatchObject({ width: 800, height: 600, scrollX: 0, scrollY: 1500 });
    expect(geo.docWidth).toBeGreaterThanOrEqual(800);
    expect(geo.docHeight).toBeGreaterThanOrEqual(2100);
  });
});

describe('widget/capture inlineStyles', () => {
  it('copies computed styles onto the matching clone element in one parallel walk', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<section><p>a</p><!-- c --><p style="color: rgb(255, 0, 0)">b<span style="font-weight: 700">s</span></p></section>' +
      '<ul><li>1</li><li style="display: none">2</li></ul>';
    document.body.appendChild(root);
    try {
      const clone = root.cloneNode(true) as HTMLElement;
      // Clear the clone's inline styles so we can see what the walk wrote.
      clone.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));

      inlineStyles(root, clone);

      const srcEls = [root, ...Array.from(root.querySelectorAll('*'))];
      const dstEls = [clone, ...Array.from(clone.querySelectorAll('*'))];
      expect(dstEls).toHaveLength(srcEls.length);
      dstEls.forEach((el) => expect(el.getAttribute('style')).toBeTruthy());

      const redP = clone.querySelectorAll('p')[1];
      expect(redP.getAttribute('style')).toContain('color:rgb(255, 0, 0)');
      expect(clone.querySelectorAll('p')[0].getAttribute('style')).not.toContain('rgb(255, 0, 0)');
      expect(clone.querySelector('span')!.getAttribute('style')).toContain('font-weight:700');
      expect(clone.querySelectorAll('li')[1].getAttribute('style')).toContain('display:none');
      expect(clone.querySelectorAll('li')[0].getAttribute('style')).not.toContain('display:none');
    } finally {
      root.remove();
    }
  });
});
