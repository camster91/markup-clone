(function () {
  'use strict';

  // Config
  const scriptEl = document.currentScript || (function () {
    const s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  const SCRIPT_SRC = scriptEl ? scriptEl.src : '';
  const API_URL = SCRIPT_SRC.replace(/\/widget\.js.*$/, '') + '/api/pins';
  const API_KEY = scriptEl ? (scriptEl.getAttribute('data-api-key') || scriptEl.getAttribute('data-project-key') || '') : '';
  const PROJECT_ID = scriptEl ? scriptEl.getAttribute('data-project-id') || '' : '';
  const AUTHOR_NAME = scriptEl ? scriptEl.getAttribute('data-author-name') || 'Client' : 'Client';

  if (!API_KEY || !PROJECT_ID) {
    console.warn('[markup] widget missing data-api-key or data-project-id attribute. Not active.');
    return;
  }

  // State
  let isFeedbackMode = false;
  let currentModal = null;
  let currentPin = null;
  let pendingClick = null;

  // ---------- Toggle button ----------
  let lastHoveredEl = null;

  function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'markup-toggle';
    btn.type = 'button';
    btn.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;margin-right:6px;vertical-align:middle"></span>Feedback';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483646;padding:10px 16px;background:#0F172A;color:#fff;border:none;border-radius:24px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:background 0.15s';

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      isFeedbackMode = !isFeedbackMode;
      if (isFeedbackMode) {
        btn.style.background = '#DC2626';
        btn.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;margin-right:6px;vertical-align:middle;animation:markup-pulse 1.2s infinite"></span>Click anywhere to leave feedback';
        if (!document.getElementById('markup-pulse-style')) {
          const style = document.createElement('style');
          style.id = 'markup-pulse-style';
          style.textContent = '@keyframes markup-pulse{0%,100%{opacity:1}50%{opacity:0.4}}';
          document.head.appendChild(style);
        }
      } else {
        btn.style.background = '#0F172A';
        btn.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;margin-right:6px;vertical-align:middle"></span>Feedback';
        cleanupAll();
      }
    });

    document.body.appendChild(btn);
  }

  function cleanupAll() {
    if (currentModal) hideModal();
    document.querySelectorAll('[id^="markup-pin-"]').forEach(p => p.remove());
    clearHoverOutline();
  }

  function clearHoverOutline() {
    if (lastHoveredEl) {
      lastHoveredEl.style.outline = '';
      lastHoveredEl.style.outlineOffset = '';
      lastHoveredEl.style.transition = '';
      lastHoveredEl = null;
    }
  }

  // ---------- Element path (CSS selector) ----------

  function getCssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.classList && cur.classList.length > 0) {
        part += '.' + Array.from(cur.classList).slice(0, 2).join('.');
      } else {
        const parent = cur.parentNode;
        if (parent) {
          let i = 1;
          for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
            if (sib.tagName === cur.tagName) i++;
          }
          part += ':nth-of-type(' + i + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentNode;
    }
    return parts.join(' > ');
  }

  // ---------- Screenshot capture ----------
  // SVG-foreignObject trick. Works in most modern browsers (Chrome, Safari, Firefox, Edge).
  // Renders the full scrollable page (not just the viewport) into a canvas, then to a PNG blob.

  async function captureViewport() {
    // Capture the viewport (innerWidth x innerHeight) — not the full document
    // scrollHeight. The xPercent/yPercent we send to the server are computed
    // against window.innerWidth/innerHeight, so the captured image must live
    // in the same coordinate space; otherwise pins land off-image on scrollable
    // pages (audit A-5).
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const dpr = window.devicePixelRatio || 1;

    // Clone the current document body so we can mutate it without affecting the page
    const clone = document.documentElement.cloneNode(true);
    // Inline computed styles for the visible region by walking the original
    inlineStyles(document.documentElement, clone, document.documentElement);

    // Remove scripts, our own UI, and any iframes (we can't capture cross-origin iframes reliably)
    clone.querySelectorAll('script, [id^="markup-"]').forEach(n => n.remove());
    clone.querySelectorAll('iframe').forEach(n => n.remove());

    // Render the full cloned document inside the SVG, then crop to the
    // visible viewport via viewBox (x=scrollX, y=scrollY, w=innerWidth,
    // h=innerHeight). This keeps the captured image's coordinate space
    // aligned with the click coordinate space the user interacts with.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="' + scrollX + ' ' + scrollY + ' ' + w + ' ' + h + '" preserveAspectRatio="xMinYMin meet">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      new XMLSerializer().serializeToString(clone) +
      '</foreignObject></svg>';

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('svg load failed'));
        i.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('canvas.toBlob returned null')),
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
  function inlineStyles(srcRoot, dstRoot, srcRef) {
    if (srcRef.nodeType === 1) {
      const dstNode = srcRef === document.documentElement ? dstRoot : findCorrespondingNode(srcRef, dstRoot, srcRoot);
      if (dstNode) {
        const cs = window.getComputedStyle(srcRef);
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
        dstNode.setAttribute('style', cssText);
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
  function findCorrespondingNode(srcNode, dstRoot, srcRoot) {
    // Build a path of child indices from the root
    const path = [];
    let n = srcNode;
    while (n && n !== srcRoot) {
      let i = 0;
      let sib = n.previousSibling;
      while (sib) { if (sib.nodeType === 1) i++; sib = sib.previousSibling; }
      path.unshift(i);
      n = n.parentNode;
    }
    // Walk the dst tree
    let cur = dstRoot;
    for (const idx of path) {
      let i = 0;
      let child = cur.firstChild;
      while (child) {
        if (child.nodeType === 1) {
          if (i === idx) { cur = child; break; }
          i++;
        }
        child = child.nextSibling;
      }
    }
    return cur;
  }

  // ---------- Modal + pin ----------

  async function showModal(clickX, clickY, clickTarget) {
    if (currentModal) hideModal();

    // Show "capturing..." pin
    currentPin = renderPin(clickX, clickY, '…', '#9CA3AF');

    // Capture the screenshot in the background
    let screenshotBlob = null;
    let captureError = null;
    try {
      screenshotBlob = await captureViewport();
    } catch (err) {
      captureError = err;
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
      currentModal = buildModal(clickX, clickY, pinNum, null, captureError);
    } else {
      currentModal = buildModal(clickX, clickY, pinNum, screenshotBlob, null);
    }
    document.body.appendChild(currentModal.overlay);
    document.body.appendChild(currentModal.box);
    setTimeout(() => currentModal.textarea.focus(), 0);
  }

  let _pinCounter = 0;
  function nextPinNumber() { return ++_pinCounter; }

  function buildModal(clickX, clickY, pinNum, screenshotBlob, captureError) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,0.05)';

    const box = document.createElement('div');
    const pos = calculatePosition(clickX, clickY, 320);
    box.style.cssText = 'position:fixed;left:' + pos.x + 'px;top:' + pos.y + 'px;width:320px;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.25);z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

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
      warn.style.cssText = 'background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px';
      warn.textContent = 'Could not capture screenshot. Pin will be saved without a screenshot. (' + (captureError.message || 'error') + ')';
      body.appendChild(warn);
    }

    const authorLabel = document.createElement('div');
    authorLabel.style.cssText = 'font-size:12px;color:#6B7280;margin-bottom:4px';
    authorLabel.textContent = 'Your name';
    body.appendChild(authorLabel);

    const authorInput = document.createElement('input');
    authorInput.type = 'text';
    authorInput.value = AUTHOR_NAME;
    authorInput.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;margin-bottom:10px;box-sizing:border-box;font-family:inherit';
    body.appendChild(authorInput);

    const textLabel = document.createElement('div');
    textLabel.style.cssText = 'font-size:12px;color:#6B7280;margin-bottom:4px';
    textLabel.textContent = 'Comment';
    body.appendChild(textLabel);

    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'width:100%;min-height:70px;padding:8px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;outline:none';
    textarea.placeholder = 'What needs to change here?';
    body.appendChild(textarea);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 16px;border-top:1px solid #E5E7EB;display:flex;justify-content:flex-end;gap:8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:7px 14px;background:#F3F4F6;color:#374151;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500';
    cancelBtn.onclick = hideModal;

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = 'Save pin';
    submitBtn.disabled = true;
    submitBtn.style.cssText = 'padding:7px 14px;background:#0F172A;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;opacity:0.5';
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
      submitPending(text, authorInput.value || 'Client', screenshotBlob);
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);
    box.appendChild(body);
    box.appendChild(footer);

    overlay.onclick = function (e) { e.stopPropagation(); };

    return { overlay, box, textarea, submitBtn, screenshotBlob };
  }

  function calculatePosition(clickX, clickY, w) {
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

  function renderPin(x, y, label, color) {
    const pin = document.createElement('div');
    pin.id = 'markup-pin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pin.style.cssText = 'position:fixed;left:' + (x - 14) + 'px;top:' + (y - 14) + 'px;width:28px;height:28px;background:' + color + ';color:#fff;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:-apple-system,sans-serif;z-index:2147483644;pointer-events:none';
    pin.textContent = label;
    document.body.appendChild(pin);
    return pin;
  }

  function hideModal() {
    if (currentModal) {
      if (currentModal.overlay && currentModal.overlay.parentNode) currentModal.overlay.parentNode.removeChild(currentModal.overlay);
      if (currentModal.box && currentModal.box.parentNode) currentModal.box.parentNode.removeChild(currentModal.box);
      currentModal = null;
    }
    if (currentPin && currentPin.parentNode) {
      currentPin.parentNode.removeChild(currentPin);
    }
    currentPin = null;
    pendingClick = null;
  }

  // ---------- Submit ----------

  async function submitPending(text, author, screenshotBlob) {
    if (!pendingClick) return;
    const fd = new FormData();
    fd.append('projectId', PROJECT_ID);
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
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'X-Api-Key': API_KEY },
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
      alert('Could not save feedback. ' + (err.message || 'Unknown error') + '. Check the console.');
    }
  }

  // ---------- Click capture ----------

  document.addEventListener('click', function (e) {
    if (!isFeedbackMode) return;
    if (e.target.closest('#markup-toggle')) return;
    if (currentModal && e.target.closest('[id^="markup-pin-"]')) return;
    if (currentModal && currentModal.box && currentModal.box.contains(e.target)) return;
    if (currentModal && currentModal.overlay && currentModal.overlay.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    // Clear hover outline on click so pin doesn't sit on a stale outline
    clearHoverOutline();

    showModal(e.clientX, e.clientY, e.target);
  }, true);

  // Hover outline: draw a subtle dashed outline around the element under the cursor
  document.addEventListener('mousemove', function (e) {
    if (!isFeedbackMode) return;
    if (currentModal) return; // don't show outline while modal is open

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === lastHoveredEl) return;
    if (el.closest('#markup-toggle')) return;

    clearHoverOutline();

    lastHoveredEl = el;
    el.style.outline = '2px dashed #FF0055';
    el.style.outlineOffset = '2px';
    el.style.transition = 'outline 0.1s';
  });

  // ---------- Boot ----------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createToggleButton);
  } else {
    createToggleButton();
  }
})();
