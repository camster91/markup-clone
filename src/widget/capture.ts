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
// <canvas> + canvas.toBlob().

export async function captureViewport(): Promise<Blob> {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const dpr = window.devicePixelRatio || 1;

  // Clone the current document so we can mutate it without affecting the page
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  // Inline computed styles for the visible region by walking the original
  inlineStyles(document.documentElement, clone, document.documentElement);

  // Remove scripts, our own UI, and any iframes (we can't capture cross-origin
  // iframes reliably)
  clone.querySelectorAll('script, [id^="markup-"]').forEach((n) => n.remove());
  clone.querySelectorAll('iframe').forEach((n) => n.remove());

  // Render the full cloned document inside the SVG, then crop to the
  // visible viewport via viewBox. This keeps the captured image's
  // coordinate space aligned with the click coordinate space.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    w +
    '" height="' +
    h +
    '" viewBox="' +
    scrollX +
    ' ' +
    scrollY +
    ' ' +
    w +
    ' ' +
    h +
    '" preserveAspectRatio="xMinYMin meet">' +
    '<foreignObject x="0" y="0" width="100%" height="100%">' +
    new XMLSerializer().serializeToString(clone) +
    '</foreignObject></svg>';

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
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
    URL.revokeObjectURL(url);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/png',
        0.92
      );
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// Recursively copy computed styles from src tree to dst tree.
// Walks the actual live DOM so we get the real rendered styles (including media queries).
function inlineStyles(
  srcRoot: HTMLElement,
  dstRoot: HTMLElement,
  srcRef: Node
): void {
  if (srcRef.nodeType === 1) {
    const srcEl = srcRef as HTMLElement;
    const dstNode =
      srcEl === document.documentElement
        ? dstRoot
        : findCorrespondingNode(srcEl, dstRoot, srcRoot);
    if (dstNode) {
      const cs = window.getComputedStyle(srcEl);
      const important = [
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
      let cssText = '';
      for (const prop of important) {
        const val = cs.getPropertyValue(prop);
        if (val) cssText += prop + ':' + val + ';';
      }
      // Inline all custom properties used in the document
      const all = cs.cssText || '';
      const varMatches = all.match(/--[a-zA-Z0-9-_]+:\s*[^;]+/g);
      if (varMatches) cssText += varMatches.join(';') + ';';
      (dstNode as HTMLElement).setAttribute('style', cssText);
    }
  }
  const srcChildren = srcRef.childNodes;
  for (let i = 0; i < srcChildren.length; i++) {
    const srcChild = srcChildren[i];
    if (srcChild.nodeType === 1) {
      inlineStyles(srcRoot, dstRoot, srcChild);
    }
  }
}

// Walk dst and src in parallel to find the node at the same path
function findCorrespondingNode(
  srcNode: Node,
  dstRoot: HTMLElement,
  srcRoot: HTMLElement
): HTMLElement | null {
  const path: number[] = [];
  let n: Node | null = srcNode;
  while (n && n !== srcRoot) {
    let i = 0;
    let sib: ChildNode | null = n.previousSibling;
    while (sib) {
      if (sib.nodeType === 1) i++;
      sib = sib.previousSibling;
    }
    path.unshift(i);
    n = n.parentNode;
  }
  let cur: Node = dstRoot;
  for (const idx of path) {
    let i = 0;
    let child: ChildNode | null = cur.firstChild;
    while (child) {
      if (child.nodeType === 1) {
        if (i === idx) {
          cur = child;
          break;
        }
        i++;
      }
      child = child.nextSibling;
    }
  }
  return cur as HTMLElement;
}
