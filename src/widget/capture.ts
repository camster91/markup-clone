// Viewport screenshot capture.
//
// The widget used to capture the full document scrollHeight, which made the
// xPercent/yPercent math (computed against window.innerWidth/innerHeight) land
// pins off-image on long pages. The fix: capture only the visible viewport
// so the screenshot's coordinate space matches the click coordinate space.
//
// The technique is the SVG-foreignObject trick — works in Chrome, Safari,
// Firefox, Edge. We clone the document, inline computed styles (so the
// foreignObject render matches the live page), and rasterize via <img> +
// <canvas> + canvas.toBlob(). The SVG must be loaded through a data URL: Chromium
// treats a blob-backed SVG containing foreignObject as non-origin-clean and
// canvas.toBlob() then throws SecurityError even when the document has no remote
// assets.
//
// Known limitation: an SVG rendered as an image never fetches external
// resources, so remote <img> sources, CSS background images and web fonts are
// missing from the capture unless they are already inlined as data: URLs.

export interface CaptureGeometry {
  /** Viewport size in CSS px (the captured image's size). */
  width: number;
  height: number;
  /** Current scroll offset of the page. */
  scrollX: number;
  scrollY: number;
  /** Full document size in CSS px (at least scroll + viewport). */
  docWidth: number;
  docHeight: number;
}

/**
 * Build the SVG wrapper for the serialized document.
 *
 * The cloned document is laid out in a foreignObject the size of the WHOLE
 * document at (0,0), so every element sits at its page coordinate, and the
 * viewBox selects the visible viewport region (scrollX, scrollY, w, h).
 * A foreignObject sized 100% (= the viewBox's w x h at the origin) is wrong:
 * on a scrolled page the viewBox points past it and the capture comes out
 * blank or shifted.
 */
export function buildCaptureSvg(geo: CaptureGeometry, serializedDoc: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    geo.width +
    '" height="' +
    geo.height +
    '" viewBox="' +
    geo.scrollX +
    ' ' +
    geo.scrollY +
    ' ' +
    geo.width +
    ' ' +
    geo.height +
    '" preserveAspectRatio="xMinYMin meet">' +
    '<foreignObject x="0" y="0" width="' +
    geo.docWidth +
    '" height="' +
    geo.docHeight +
    '">' +
    serializedDoc +
    '</foreignObject></svg>'
  );
}

/** Read the live viewport / scroll / document geometry. */
export function readCaptureGeometry(): CaptureGeometry {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const de = document.documentElement;
  const body = document.body;
  const docWidth = Math.max(de.scrollWidth, body ? body.scrollWidth : 0, scrollX + width);
  const docHeight = Math.max(de.scrollHeight, body ? body.scrollHeight : 0, scrollY + height);
  return { width, height, scrollX, scrollY, docWidth, docHeight };
}

export async function captureViewport(): Promise<Blob> {
  const geo = readCaptureGeometry();
  const w = geo.width;
  const h = geo.height;
  const dpr = window.devicePixelRatio || 1;

  // Clone the current document so we can mutate it without affecting the page
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  // Inline computed styles by walking the original and the clone in parallel
  inlineStyles(document.documentElement, clone);

  // Remove scripts, our own UI, and any iframes (we can't capture cross-origin
  // iframes reliably)
  clone.querySelectorAll('script, [id^="markup-"]').forEach((n) => n.remove());
  clone.querySelectorAll('iframe').forEach((n) => n.remove());

  // Render the full cloned document inside the SVG, then crop to the
  // visible viewport via viewBox. This keeps the captured image's
  // coordinate space aligned with the click coordinate space.
  const svg = buildCaptureSvg(geo, new XMLSerializer().serializeToString(clone));

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('svg data URL conversion failed'));
    };
    reader.onerror = () => reject(reader.error || new Error('svg data URL conversion failed'));
    reader.readAsDataURL(blob);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('svg load failed'));
    i.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(dpr, dpr);
  ctx.drawImage(img, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
      0.92
    );
  });
}

const INLINED_PROPS = [
  'color', 'background', 'background-color', 'background-image',
  'font', 'font-family', 'font-size', 'font-weight', 'line-height',
  'border', 'border-radius', 'box-shadow', 'opacity',
  'padding', 'margin', 'display', 'position',
  'width', 'height', 'max-width', 'max-height',
  'top', 'left', 'right', 'bottom',
  'transform', 'transition', 'animation',
  'color-scheme', 'filter', 'backdrop-filter',
  'text-align', 'text-decoration', 'text-transform',
  'flex', 'flex-direction', 'justify-content', 'align-items', 'gap', 'grid',
  'overflow', 'overflow-x', 'overflow-y',
  'visibility', 'z-index',
];

/**
 * Copy computed styles from the live tree onto its clone.
 *
 * `dst` was produced by `src.cloneNode(true)` and is not mutated until this
 * walk finishes, so both trees have identical element structure: the i-th
 * element child of a source node corresponds to the i-th element child of
 * its clone. Walking both in parallel visits each element once (O(n)); the
 * previous version re-derived every element's path from the root and
 * re-walked the clone along it, which is quadratic on large pages.
 */
export function inlineStyles(src: Element, dst: Element): void {
  const cs = window.getComputedStyle(src);
  let cssText = '';
  for (const prop of INLINED_PROPS) {
    const val = cs.getPropertyValue(prop);
    if (val) cssText += prop + ':' + val + ';';
  }
  // Inline all custom properties used in the document
  const all = cs.cssText || '';
  const varMatches = all.match(/--[a-zA-Z0-9-_]+:\s*[^;]+/g);
  if (varMatches) cssText += varMatches.join(';') + ';';
  dst.setAttribute('style', cssText);

  const srcChildren = src.children;
  const dstChildren = dst.children;
  const n = Math.min(srcChildren.length, dstChildren.length);
  for (let i = 0; i < n; i++) {
    inlineStyles(srcChildren[i], dstChildren[i]);
  }
}
