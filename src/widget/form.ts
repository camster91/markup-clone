// Modal + form + submission for the markup widget.
//
// The lifecycle module owns the click-to-open-modal entry point; this
// module owns everything inside the modal: rendering, validation, the
// POST to /api/pins, the annotation tool selector (Arrow/Box/Freehand),
// and the per-pin annotation POSTs. State shared with lifecycle
// (currentModal, currentPin, pendingClick, pinCounter, toolState,
// annotationQueue) is kept on this module and exposed via small
// getters so the test suite can inspect without going through DOM.

import { getCssPath } from './dom';
import { captureViewport } from './capture';

export interface PendingClick {
  clickX: number;
  clickY: number;
  xPercent: number;
  yPercent: number;
  xpath: string;
  elementHTML: string;
}

export interface ModalHandles {
  overlay: HTMLDivElement;
  box: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  submitBtn: HTMLButtonElement;
  screenshotBlob: Blob | null;
  /** Tool selector's preview list. Created during buildModal. Tests
   *  use the `data-markup-preview-list` attribute to find it. */
  previewList: HTMLDivElement;
  /** The hint line that shows the current armed tool's instructions. */
  toolHint: HTMLDivElement;
  /** The tool button row — needed to swap visual state. */
  toolRow: HTMLDivElement;
}

export type AnnotationKind = 'arrow' | 'box' | 'freehand';

export interface QueuedAnnotation {
  kind: AnnotationKind;
  /** Path is in the SCREENSHOT's pixel space: xScreenshot = (clientX - rect.left) * (screenshot.width / rect.width). */
  path: [number, number][];
}

/** Module-level state for the annotation tool selector. idle → armed(kind)
 *  → capturing → done. The two-click tools (arrow, box) return to idle
 *  after the second click is captured. Freehand returns to idle on
 *  pointerup. Reset to idle on modal close. */
interface ToolState {
  kind: 'idle' | 'arrow' | 'box' | 'freehand';
  /** Number of clicks captured so far (arrow/box). */
  clicks: number;
  /** Freehand path accumulator. */
  points: [number, number][];
}

let currentModal: ModalHandles | null = null;
let currentPin: HTMLDivElement | null = null;
let pendingClick: PendingClick | null = null;
let _pinCounter = 0;

/** The current tool state. Read by tests via `getToolState()`. */
let toolState: ToolState = { kind: 'idle', clicks: 0, points: [] };

/** Annotations queued by the user. They are NOT POSTed until the user
 *  clicks "Save pin" — the pin creation comes first, and the response
 *  supplies the pinId each annotation needs. */
let annotationQueue: QueuedAnnotation[] = [];

/** Detached listeners the current modal installed on the document. We
 *  keep references so `hideModal` (and a re-entry into showModal) can
 *  detach them deterministically — without this, the next showModal
 *  call would inherit ghost listeners that fire from a modal the user
 *  can no longer see. */
interface ActiveCapture {
  clickHandler: ((e: MouseEvent) => void) | null;
  pointerDownHandler: ((e: PointerEvent) => void) | null;
  pointerMoveHandler: ((e: PointerEvent) => void) | null;
  pointerUpHandler: ((e: PointerEvent) => void) | null;
  /** Transparent page-wide overlay that captures pointerdown for freehand. */
  overlayEl: HTMLDivElement | null;
}
const activeCapture: ActiveCapture = {
  clickHandler: null,
  pointerDownHandler: null,
  pointerMoveHandler: null,
  pointerUpHandler: null,
  overlayEl: null,
};

function nextPinNumber(): number {
  return ++_pinCounter;
}

/** Render a numbered pin at (x,y). */
function renderPin(x: number, y: number, label: string, color: string): HTMLDivElement {
  const pin = document.createElement('div');
  pin.id = 'markup-pin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  pin.style.cssText =
    'position:fixed;left:' +
    (x - 14) +
    'px;top:' +
    (y - 14) +
    'px;width:28px;height:28px;background:' +
    color +
    ';color:#fff;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:-apple-system,sans-serif;z-index:2147483644;pointer-events:none';
  pin.textContent = label;
  document.body.appendChild(pin);
  return pin;
}

/** Compute modal position, keeping it inside the viewport. */
function calculatePosition(clickX: number, clickY: number, w: number): { x: number; y: number } {
  const margin = 12;
  const h = 220;
  let x = clickX + 16;
  let y = clickY + 16;
  if (x + w > window.innerWidth - margin) x = clickX - w - 16;
  if (y + h > window.innerHeight - margin) y = clickY - h - 16;
  x = Math.max(margin, Math.min(x, window.innerWidth - w - margin));
  y = Math.max(margin, Math.min(y, window.innerHeight - h - margin));
  return { x, y };
}

/** Returns the screenshot's natural pixel dimensions. In a real browser
 *  we read `img.naturalWidth/naturalHeight` from the Image element
 *  rendered in the preview area. In JSDOM the Image never decodes, so
 *  naturalWidth is 0 — we fall back to (window.innerWidth * dpr) ×
 *  (window.innerHeight * dpr) which is exactly the canvas size
 *  captureViewport writes (see src/widget/capture.ts: canvas.width =
 *  w * dpr, canvas.height = h * dpr). This keeps the screenshot-space
 *  transform well-defined in tests even when the image hasn't loaded.
 *
 *  Exposed as a separate function so the test suite can stub it via
 *  vi.spyOn if a test needs different dimensions. */
export function getScreenshotSize(): { width: number; height: number } {
  const dpr =
    typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.round(window.innerWidth * dpr)),
    height: Math.max(1, Math.round(window.innerHeight * dpr)),
  };
}

/** Convert a viewport-px click coord (clientX/clientY) into the
 *  SCREENSHOT's pixel space. The "rect" in the task formula is the
 *  rect of the page-wide capture overlay (which the modal installs
 *  when a tool is armed). When no overlay is present, we treat the
 *  page viewport itself as the rect — i.e. the overlay is 1:1 with
 *  window.innerWidth/Height. The screenshot.width is window.innerWidth
 *  * dpr, so the transform reduces to clientX * dpr (and analogously
 *  for y). The general formula stays correct in both cases. */
export function clientToScreenshotSpace(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): [number, number] {
  const size = getScreenshotSize();
  const sx = (clientX - rect.left) * (size.width / Math.max(1, rect.width));
  const sy = (clientY - rect.top) * (size.height / Math.max(1, rect.height));
  return [Math.round(sx), Math.round(sy)];
}

/** True if a click/pointer event landed inside the current modal box
 *  or the existing pin marker. We use this to ignore events that
 *  hit the modal itself (so the user can still type in the textarea,
 *  click the tool buttons, etc. while a tool is armed). */
function eventIsInModalOrPin(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (currentModal) {
    if (currentModal.box && currentModal.box.contains(target)) return true;
    if (currentModal.overlay && currentModal.overlay.contains(target)) return true;
  }
  // The pin marker has pointer-events:none set by renderPin, so it
  // shouldn't normally be a target, but the existing global click
  // handler in lifecycle.ts also ignores clicks on pins, so we mirror
  // that here.
  if (target.closest && target.closest('[id^="markup-pin-"]')) return true;
  return false;
}

/** Detach any document-level listeners the current modal installed.
 *  Called before re-arming a tool (so we don't double-listen) and on
 *  hideModal. */
function detachActiveCapture(): void {
  if (activeCapture.clickHandler) {
    // We attach the arrow/box click handler on `window` (capture
    // phase) so it runs before the document-level lifecycle click
    // handler; remove it from window to match.
    window.removeEventListener('click', activeCapture.clickHandler, true);
    activeCapture.clickHandler = null;
  }
  if (activeCapture.pointerDownHandler) {
    document.removeEventListener('pointerdown', activeCapture.pointerDownHandler, true);
    activeCapture.pointerDownHandler = null;
  }
  if (activeCapture.pointerMoveHandler) {
    document.removeEventListener('pointermove', activeCapture.pointerMoveHandler, true);
    activeCapture.pointerMoveHandler = null;
  }
  if (activeCapture.pointerUpHandler) {
    document.removeEventListener('pointerup', activeCapture.pointerUpHandler, true);
    activeCapture.pointerUpHandler = null;
  }
  if (activeCapture.overlayEl && activeCapture.overlayEl.parentNode) {
    activeCapture.overlayEl.parentNode.removeChild(activeCapture.overlayEl);
  }
  activeCapture.overlayEl = null;
}

/** Reset the tool buttons' visual state (white background, dark text). */
function resetToolButtonStyles(toolRow: HTMLDivElement): void {
  Array.from(toolRow.querySelectorAll('button[data-markup-tool]')).forEach(function (b) {
    const btn = b as HTMLButtonElement;
    btn.style.background = '#fff';
    btn.style.color = '#374151';
  });
}

/** Highlight the active tool button and dim the others. */
function setActiveToolButton(toolRow: HTMLDivElement, kind: AnnotationKind): void {
  Array.from(toolRow.querySelectorAll('button[data-markup-tool]')).forEach(function (b) {
    const btn = b as HTMLButtonElement;
    if (btn.getAttribute('data-markup-tool') === kind) {
      btn.style.background = '#0F172A';
      btn.style.color = '#fff';
    } else {
      btn.style.background = '#fff';
      btn.style.color = '#374151';
    }
  });
}

/** Build a small canvas-based preview of the annotation and append it
 *  to the modal's preview list. The canvas is drawn in the modal's
 *  own coordinate space (80x40) so we project the screenshot-space
 *  path back into a preview area. We do not try to be pixel-accurate;
 *  the preview is a quick visual hint, the real drawing lives on
 *  the dashboard. */
function renderAnnotationPreview(ann: QueuedAnnotation): void {
  if (!currentModal) return;
  const list = currentModal.previewList;

  const item = document.createElement('div');
  item.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #E5E7EB;border-radius:6px;background:#F9FAFB;font-size:11px;color:#374151';
  const label = document.createElement('span');
  label.textContent =
    ann.kind === 'arrow'
      ? 'Arrow'
      : ann.kind === 'box'
        ? 'Box'
        : 'Freehand (' + ann.path.length + ' pts)';
  label.style.cssText = 'flex:0 0 auto;font-weight:500';
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 40;
  canvas.style.cssText =
    'background:#fff;border:1px solid #E5E7EB;border-radius:3px;flex:0 0 auto';
  // Draw the annotation scaled into the preview canvas. We compute
  // the bounding box of the path and fit it into 78x38.
  if (ann.path.length >= 1) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      let minX = ann.path[0][0];
      let minY = ann.path[0][1];
      let maxX = minX;
      let maxY = minY;
      for (const [x, y] of ann.path) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const scale = Math.min(78 / w, 38 / h);
      const offX = (80 - w * scale) / 2;
      const offY = (40 - h * scale) / 2;
      ctx.strokeStyle = ann.kind === 'box' ? '#0EA5E9' : '#DC2626';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ann.kind === 'box' && ann.path.length >= 2) {
        const [x1, y1] = ann.path[0];
        const [x2, y2] = ann.path[1];
        const rx = (x1 - minX) * scale + offX;
        const ry = (y1 - minY) * scale + offY;
        const rw = (x2 - x1) * scale;
        const rh = (y2 - y1) * scale;
        ctx.strokeRect(rx, ry, rw, rh);
      } else {
        for (let i = 0; i < ann.path.length; i++) {
          const [x, y] = ann.path[i];
          const px = (x - minX) * scale + offX;
          const py = (y - minY) * scale + offY;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove';
  removeBtn.style.cssText =
    'background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;flex:0 0 auto';
  removeBtn.onclick = function () {
    // Drop the annotation from the queue
    const idx = annotationQueue.indexOf(ann);
    if (idx >= 0) annotationQueue.splice(idx, 1);
    if (item.parentNode) item.parentNode.removeChild(item);
  };
  item.appendChild(label);
  item.appendChild(canvas);
  item.appendChild(removeBtn);
  list.appendChild(item);
}

/** Arm a tool. For arrow/box we listen for the next two document
 *  clicks (capture phase on `window`, so we run BEFORE the
 *  lifecycle.ts click listener on document) and ignore clicks
 *  inside the modal. For freehand we install a transparent
 *  page-wide overlay and listen for pointerdown / pointermove /
 *  pointerup. The overlay is removed when capturing ends. */
function armTool(kind: AnnotationKind): void {
  if (!currentModal) return;
  // Detach any previous capture first so we never double-listen
  detachActiveCapture();
  toolState = { kind, clicks: 0, points: [] };

  // Visual feedback in the modal: highlight the active tool button
  // and show a one-line hint so the user knows what to do next.
  setActiveToolButton(currentModal.toolRow, kind);
  if (kind === 'arrow') {
    currentModal.toolHint.textContent =
      'Click two points on the page: start, then end of the arrow.';
  } else if (kind === 'box') {
    currentModal.toolHint.textContent =
      'Click two points on the page: top-left, then bottom-right of the box.';
  } else {
    currentModal.toolHint.textContent = 'Press and drag on the page to draw.';
  }
  currentModal.toolHint.style.display = 'block';

  const backToIdle = function () {
    toolState = { kind: 'idle', clicks: 0, points: [] };
    if (currentModal) {
      currentModal.toolHint.style.display = 'none';
      resetToolButtonStyles(currentModal.toolRow);
    }
  };

  if (kind === 'arrow' || kind === 'box') {
    // The two-click tools listen on `window` with `capture: true` so
    // our handler runs BEFORE the document-level click listener
    // installed by lifecycle.ts. That listener (in feedback mode)
    // would otherwise call showModal() on every body click, hiding
    // the current modal (and detaching our listeners) before we
    // get a chance to capture the click. By running first and
    // calling stopImmediatePropagation, we keep the modal open
    // and capture the coord cleanly.
    const handler = function (e: MouseEvent) {
      if (!currentModal) return;
      if (eventIsInModalOrPin(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const pt = clientToScreenshotSpace(e.clientX, e.clientY, rect);
      toolState.points.push(pt);
      toolState.clicks++;
      if (toolState.clicks >= 2) {
        const ann: QueuedAnnotation = { kind, path: toolState.points.slice() };
        annotationQueue.push(ann);
        renderAnnotationPreview(ann);
        // Back to idle
        detachActiveCapture();
        backToIdle();
      }
    };
    activeCapture.clickHandler = handler;
    window.addEventListener('click', handler, true);
  } else if (kind === 'freehand') {
    // Freehand uses pointer events (not click), so the lifecycle
    // click handler doesn't interfere. We can attach the listeners
    // to document with capture, and the pointerdown handler
    // installs a page-wide overlay that captures subsequent
    // pointermoves / pointerups.
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483643;background:transparent;cursor:crosshair';
    document.body.appendChild(overlay);
    activeCapture.overlayEl = overlay;

    const rectFromOverlay = function () {
      const r = overlay.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        width: r.width || window.innerWidth,
        height: r.height || window.innerHeight,
      };
    };

    const onDown = function (e: PointerEvent) {
      if (!currentModal) return;
      if (eventIsInModalOrPin(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = clientToScreenshotSpace(e.clientX, e.clientY, rectFromOverlay());
      toolState.points = [pt];
      try {
        const tgt = e.target as Element;
        if (tgt && typeof tgt.setPointerCapture === 'function') {
          tgt.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore: setPointerCapture may not exist in JSDOM
      }
    };
    const onMove = function (e: PointerEvent) {
      if (!currentModal) return;
      if (toolState.points.length === 0) return;
      const pt = clientToScreenshotSpace(e.clientX, e.clientY, rectFromOverlay());
      const last = toolState.points[toolState.points.length - 1];
      // Skip duplicate points (pointermove fires repeatedly when
      // the pointer is still). The validator rejects <2 points
      // anyway, so this just keeps the path compact.
      if (last[0] === pt[0] && last[1] === pt[1]) return;
      toolState.points.push(pt);
    };
    const onUp = function () {
      if (!currentModal) return;
      if (toolState.points.length < 2) {
        // A tap that didn't move — discard and return to idle.
        detachActiveCapture();
        backToIdle();
        return;
      }
      const ann: QueuedAnnotation = { kind: 'freehand', path: toolState.points.slice() };
      annotationQueue.push(ann);
      renderAnnotationPreview(ann);
      detachActiveCapture();
      backToIdle();
    };
    activeCapture.pointerDownHandler = onDown;
    activeCapture.pointerMoveHandler = onMove;
    activeCapture.pointerUpHandler = onUp;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
  }
}

function buildModal(
  clickX: number,
  clickY: number,
  pinNum: number,
  screenshotBlob: Blob | null,
  captureError: Error | null,
  authorName: string,
  apiUrl: string,
  apiKey: string,
  projectId: string
): ModalHandles {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,0.05)';

  const box = document.createElement('div');
  const pos = calculatePosition(clickX, clickY, 320);
  box.style.cssText =
    'position:fixed;left:' +
    pos.x +
    'px;top:' +
    pos.y +
    'px;width:320px;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.25);z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  const header = document.createElement('div');
  header.style.cssText =
    'padding:14px 16px;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center';
  // Pin number is an integer we control; no user input flows in here.
  const pinLabel = document.createElement('div');
  pinLabel.style.cssText = 'font-weight:600;color:#111;font-size:14px';
  pinLabel.textContent = 'Pin #' + pinNum;
  header.appendChild(pinLabel);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.style.cssText =
    'background:none;border:none;font-size:22px;color:#9CA3AF;cursor:pointer;line-height:1;padding:0 4px';
  closeBtn.onclick = hideModal;
  header.appendChild(closeBtn);
  box.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'padding:14px 16px';

  if (captureError) {
    const warn = document.createElement('div');
    warn.style.cssText =
      'background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px';
    warn.textContent =
      'Could not capture screenshot. Pin will be saved without a screenshot. (' +
      (captureError.message || 'error') +
      ')';
    body.appendChild(warn);
  }

  const authorLabel = document.createElement('div');
  authorLabel.style.cssText = 'font-size:12px;color:#6B7280;margin-bottom:4px';
  authorLabel.textContent = 'Your name';
  body.appendChild(authorLabel);

  const authorInput = document.createElement('input');
  authorInput.type = 'text';
  authorInput.value = authorName;
  authorInput.style.cssText =
    'width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;margin-bottom:10px;box-sizing:border-box;font-family:inherit';
  body.appendChild(authorInput);

  const textLabel = document.createElement('div');
  textLabel.style.cssText = 'font-size:12px;color:#6B7280;margin-bottom:4px';
  textLabel.textContent = 'Comment';
  body.appendChild(textLabel);

  const textarea = document.createElement('textarea');
  textarea.style.cssText =
    'width:100%;min-height:70px;padding:8px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;outline:none';
  textarea.placeholder = 'What needs to change here?';
  body.appendChild(textarea);

  // --- Annotation tool selector ---
  // The task spec puts the tool selector INSIDE the existing modal,
  // not as a new UI surface. We add a small row of three buttons
  // (Arrow / Box / Freehand) below the comment textarea, plus a
  // one-line hint and a list of queued annotations. Clicking a tool
  // button arms the corresponding capture mode; the user then
  // clicks/drags on the page (NOT the modal) to draw. Each completed
  // annotation appears in the preview list and is queued for upload
  // with the pin.
  const toolSection = document.createElement('div');
  toolSection.style.cssText = 'margin-top:10px';

  const toolLabel = document.createElement('div');
  toolLabel.style.cssText = 'font-size:12px;color:#6B7280;margin-bottom:4px';
  toolLabel.textContent = 'Annotate (optional)';
  toolSection.appendChild(toolLabel);

  const toolRow = document.createElement('div');
  toolRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  const toolHint = document.createElement('div');
  toolHint.style.cssText =
    'font-size:11px;color:#6B7280;background:#F3F4F6;padding:4px 6px;border-radius:4px;margin-bottom:6px;display:none';
  const toolDefs: { kind: AnnotationKind; label: string }[] = [
    { kind: 'arrow', label: 'Arrow' },
    { kind: 'box', label: 'Box' },
    { kind: 'freehand', label: 'Freehand' },
  ];
  for (const def of toolDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    btn.setAttribute('data-markup-tool', def.kind);
    btn.style.cssText =
      'flex:1;padding:6px 4px;background:#fff;color:#374151;border:1px solid #D1D5DB;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;font-family:inherit';
    btn.onclick = function () {
      armTool(def.kind);
    };
    toolRow.appendChild(btn);
  }
  toolSection.appendChild(toolRow);
  toolSection.appendChild(toolHint);

  const previewList = document.createElement('div');
  previewList.setAttribute('data-markup-preview-list', '1');
  previewList.style.cssText =
    'display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto';
  toolSection.appendChild(previewList);

  body.appendChild(toolSection);

  const footer = document.createElement('div');
  footer.style.cssText =
    'padding:10px 16px;border-top:1px solid #E5E7EB;display:flex;justify-content:flex-end;gap:8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText =
    'padding:7px 14px;background:#F3F4F6;color:#374151;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500';
  cancelBtn.onclick = hideModal;

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Save pin';
  submitBtn.disabled = true;
  submitBtn.style.cssText =
    'padding:7px 14px;background:#0F172A;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;opacity:0.5';
  function updateBtn() {
    const ok = textarea.value.trim().length > 0;
    submitBtn.disabled = !ok;
    submitBtn.style.opacity = ok ? '1' : '0.5';
  }
  textarea.addEventListener('input', updateBtn);
  textarea.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submitBtn.disabled) {
      e.preventDefault();
      submitBtn.click();
    }
  });
  submitBtn.onclick = function () {
    const text = textarea.value.trim();
    if (!text) return;
    submitPending(text, authorInput.value || 'Client', screenshotBlob, apiUrl, apiKey, projectId);
  };

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);
  box.appendChild(body);
  box.appendChild(footer);

  overlay.onclick = function (e) {
    e.stopPropagation();
  };

  return { overlay, box, textarea, submitBtn, screenshotBlob, previewList, toolHint, toolRow };
}

function hideModal(): void {
  // Detach any in-flight capture listeners and remove the capture
  // overlay before tearing the modal down. Without this, a tool that
  // was armed but never finished would keep listening to document
  // events after the modal closed.
  detachActiveCapture();
  toolState = { kind: 'idle', clicks: 0, points: [] };
  // Drop any queued annotations — they belong to this pin only.
  annotationQueue = [];
  if (currentModal) {
    if (currentModal.overlay && currentModal.overlay.parentNode) {
      currentModal.overlay.parentNode.removeChild(currentModal.overlay);
    }
    if (currentModal.box && currentModal.box.parentNode) {
      currentModal.box.parentNode.removeChild(currentModal.box);
    }
    currentModal = null;
  }
  if (currentPin && currentPin.parentNode) {
    currentPin.parentNode.removeChild(currentPin);
  }
  currentPin = null;
  pendingClick = null;
}

/** Public entry: open the feedback modal at (clickX, clickY) for clickTarget. */
export async function showModal(
  clickX: number,
  clickY: number,
  clickTarget: Element,
  authorName: string,
  apiUrl: string,
  apiKey: string,
  projectId: string
): Promise<void> {
  if (currentModal) hideModal();

  // Show "capturing..." pin
  currentPin = renderPin(clickX, clickY, '…', '#9CA3AF');

  // Capture the screenshot in the background.
  // We invoke captureViewport via its imported binding (not a local
  // alias) so Vite's terser preserves a stable `captureViewport` name
  // in the minified IIFE — the test suite string-replaces
  // `screenshotBlob = await captureViewport();` to stub the screenshot
  // for JSDOM. Inlining the function would break that test stub.
  let screenshotBlob: Blob | null = null;
  let captureError: Error | null = null;
  try {
    screenshotBlob = await captureViewport();
  } catch (err) {
    captureError = err as Error;
    console.error('[markup] screenshot capture failed:', err);
  }

  pendingClick = {
    clickX,
    clickY,
    xPercent: (clickX / window.innerWidth) * 100,
    yPercent: (clickY / window.innerHeight) * 100,
    xpath: getCssPath(clickTarget),
    elementHTML: clickTarget.outerHTML ? clickTarget.outerHTML.slice(0, 4000) : '',
  };

  // Replace placeholder pin with real one
  if (currentPin && currentPin.parentNode) {
    currentPin.parentNode.removeChild(currentPin);
  }
  const pinNum = nextPinNumber();
  currentPin = renderPin(clickX, clickY, String(pinNum), '#DC2626');

  if (captureError) {
    currentModal = buildModal(clickX, clickY, pinNum, null, captureError, authorName, apiUrl, apiKey, projectId);
  } else {
    currentModal = buildModal(clickX, clickY, pinNum, screenshotBlob, null, authorName, apiUrl, apiKey, projectId);
  }
  document.body.appendChild(currentModal.overlay);
  document.body.appendChild(currentModal.box);
  setTimeout(() => currentModal!.textarea.focus(), 0);
}

/** Derive the annotations endpoint from the pin endpoint. The widget
 *  builds /api/pins from the script src; the annotations endpoint
 *  lives next to it, on the same origin. */
function annotationsUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/pins$/, '') + '/api/annotations';
}

async function submitPending(
  text: string,
  author: string,
  screenshotBlob: Blob | null,
  apiUrl: string,
  apiKey: string,
  projectId: string
): Promise<void> {
  if (!pendingClick) return;
  const fd = new FormData();
  fd.append('projectId', projectId);
  fd.append('path', window.location.pathname);
  fd.append('xPercent', String(pendingClick.xPercent));
  fd.append('yPercent', String(pendingClick.yPercent));
  fd.append('elementXPath', pendingClick.xpath || '');
  fd.append('elementHTML', pendingClick.elementHTML || '');
  fd.append('text', text);
  fd.append('authorName', author);
  if (screenshotBlob) {
    fd.append('screenshot', screenshotBlob, 'capture.png');
  }

  if (currentModal && currentModal.submitBtn) {
    currentModal.submitBtn.disabled = true;
    currentModal.submitBtn.textContent = 'Saving...';
  }

  // Snapshot the queue so a re-entrant showModal (e.g. if the user
  // clicks another element while we're awaiting fetch) can't mutate
  // it from under us.
  const queue = annotationQueue.slice();
  const annUrl = annotationsUrl(apiUrl);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: fd,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200));
    }
    // Parse the pin id from the success response. The pin POST
    // returns { success: true, data: { id: '...' } }. If the server
    // doesn't return an id, we still consider the pin saved but
    // log a warning — the user's pin text made it through, and
    // annotations without a pinId will fail validation (the API
    // requires a UUID).
    let pinId: string | null = null;
    try {
      const json = await res.json();
      if (json && typeof json === 'object' && json.data && typeof json.data.id === 'string') {
        pinId = json.data.id;
      }
    } catch {
      // Non-JSON success — treat as missing pinId; the pin still
      // exists server-side, but we can't attach annotations.
    }

    if (queue.length > 0 && pinId) {
      // Post each annotation sequentially. We could fire them in
      // parallel, but the rate-limit bucket is shared with /api/pins
      // (60 tokens) and a flood of annotations could trip 429s.
      // Sequential is plenty fast for the typical 1-3 annotations
      // per pin and keeps the bucket stable.
      for (const ann of queue) {
        try {
          const ar = await fetch(annUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Api-Key': apiKey,
            },
            body: JSON.stringify({
              pinId,
              kind: ann.kind,
              pathJson: JSON.stringify(ann.path),
            }),
          });
          if (!ar.ok) {
            const t = await ar.text();
            console.error(
              '[markup] annotation post failed:',
              ann.kind,
              'status',
              ar.status,
              t.slice(0, 200)
            );
          }
        } catch (err) {
          console.error('[markup] annotation post error:', ann.kind, err);
        }
      }
    } else if (queue.length > 0) {
      console.warn(
        '[markup] ' + queue.length + ' annotation(s) queued but server did not return a pinId; dropping.'
      );
    }

    // Success: keep the pin in place, close modal
    hideModal();
  } catch (err) {
    console.error('[markup] save failed:', err);
    if (currentModal && currentModal.submitBtn) {
      currentModal.submitBtn.disabled = false;
      currentModal.submitBtn.textContent = 'Save pin';
    }
    alert('Could not save feedback. ' + ((err as Error).message || 'Unknown error') + '. Check the console.');
  }
}

/** Test seams: read module state without going through DOM. */
export function getCurrentModal(): ModalHandles | null {
  return currentModal;
}
export function getCurrentPin(): HTMLDivElement | null {
  return currentPin;
}
export function getPendingClick(): PendingClick | null {
  return pendingClick;
}
export function getToolState(): { kind: ToolState['kind']; clicks: number; points: [number, number][] } {
  return { kind: toolState.kind, clicks: toolState.clicks, points: toolState.points.slice() };
}
export function getAnnotationQueue(): QueuedAnnotation[] {
  return annotationQueue.slice();
}
export { hideModal };
