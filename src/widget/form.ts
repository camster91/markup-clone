// Modal + form + submission for the markup widget.
//
// The lifecycle module owns the click-to-open-modal entry point; this
// module owns everything inside the modal: rendering, validation, and
// the POST to /api/pins. State shared with lifecycle (currentModal,
// currentPin, pendingClick, pinCounter) is kept on this module and
// exposed via small getters so the test suite can inspect without
// going through DOM.

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
}

let currentModal: ModalHandles | null = null;
let currentPin: HTMLDivElement | null = null;
let pendingClick: PendingClick | null = null;
let _pinCounter = 0;

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
  header.style.cssText = 'padding:14px 16px;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center';
  header.innerHTML = '<div style="font-weight:600;color:#111;font-size:14px">Pin #' + pinNum + '</div>';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '×';
  closeBtn.style.cssText = 'background:none;border:none;font-size:22px;color:#9CA3AF;cursor:pointer;line-height:1;padding:0 4px';
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

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:10px 16px;border-top:1px solid #E5E7EB;display:flex;justify-content:flex-end;gap:8px';

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

  return { overlay, box, textarea, submitBtn, screenshotBlob };
}

function hideModal(): void {
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
export { hideModal };
