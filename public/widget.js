(function () {
  // Glow Feedback Widget
  console.log("Glow Feedback Widget Loaded.");

  // Derive API URL from the script src
  const scriptEl = document.currentScript || (function(){ const s = document.getElementsByTagName('script'); return s[s.length-1]; })();
  const SCRIPT_SRC = scriptEl ? scriptEl.src : '';
  const API_URL = SCRIPT_SRC.replace(/\/widget\.js.*$/, '') + '/api/comments';
  const API_KEY = scriptEl ? scriptEl.getAttribute('data-api-key') : '';

  let isFeedbackMode = false; // Default OFF
  let currentModal = null;
  let currentPin = null;
  let pendingClickData = null;

  // Create floating toggle button
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'glow-feedback-toggle';
    btn.textContent = 'Feedback';
    btn.style.position = 'fixed';
    btn.style.bottom = '20px';
    btn.style.right = '20px';
    btn.style.zIndex = '999999';
    btn.style.padding = '10px 16px';
    btn.style.backgroundColor = '#888888';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '20px';
    btn.style.cursor = 'pointer';
    btn.style.fontFamily = 'sans-serif';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = 'bold';
    btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      isFeedbackMode = !isFeedbackMode;
      if (isFeedbackMode) {
        btn.textContent = 'Stop Feedback';
        btn.style.backgroundColor = '#FF0055';
      } else {
        btn.textContent = 'Feedback';
        btn.style.backgroundColor = '#888888';
        // Clean up any open modal when disabling feedback mode
        if (currentModal) {
          hideCommentModal();
        }
      }
    });

    document.body.appendChild(btn);
  }

  createToggleButton();

  // Helper to get a unique CSS selector for an element
  function getPathTo(element) {
    if (element.id !== '') return 'id("' + element.id + '")';
    if (element === document.body) return element.tagName;

    var ix = 0;
    var siblings = element.parentNode.childNodes;
    for (var i = 0; i < siblings.length; i++) {
      var sibling = siblings[i];
      if (sibling === element)
        return getPathTo(element.parentNode) + '/' + element.tagName + '[' + (ix + 1) + ']';
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName)
        ix++;
    }
  }

  // Calculate modal position to stay within viewport
  function calculateModalPosition(clickX, clickY, modalWidth, modalHeight) {
    const margin = 16;
    const isMobile = window.innerWidth < 480;

    if (isMobile) {
      // On mobile, position near top with full width
      return {
        left: margin,
        top: margin,
        width: window.innerWidth - margin * 2
      };
    }

    let left = clickX + 16;
    let top = clickY + 16;

    // Check right edge
    if (left + modalWidth > window.innerWidth - margin) {
      left = clickX - modalWidth - 16;
    }

    // Check bottom edge - if doesn't fit below, show above
    if (top + modalHeight > window.innerHeight - margin) {
      top = clickY - modalHeight - 16;
    }

    // Check top edge
    if (top < margin) {
      top = margin;
    }

    // Check left edge
    if (left < margin) {
      left = margin;
    }

    // Final clamp to ensure within viewport
    left = Math.max(margin, Math.min(left, window.innerWidth - modalWidth - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - modalHeight - margin));

    return { left, top };
  }

  // Show comment modal near click position
  function showCommentModal(clickX, clickY, clickData) {
    // Remove any existing modal
    if (currentModal) {
      hideCommentModal();
    }

    pendingClickData = clickData;

    const modalWidth = 320;
    const modalHeight = 200; // approximate
    const pos = calculateModalPosition(clickX, clickY, modalWidth, modalHeight);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'glow-feedback-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999998;
    `;

    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'glow-feedback-modal';
    modal.style.cssText = `
      position: fixed;
      left: ${pos.left}px;
      top: ${pos.top}px;
      width: ${pos.width || modalWidth}px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 16px;
      z-index: 999999;
      font-family: sans-serif;
      font-size: 14px;
      box-sizing: border-box;
    `;

    // Create header with close button
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    `;

    const title = document.createElement('span');
    title.textContent = 'Leave a comment';
    title.style.cssText = `
      font-weight: 600;
      color: #333;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #999;
      padding: 0;
      line-height: 1;
    `;
    closeBtn.addEventListener('click', hideCommentModal);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.id = 'glow-feedback-textarea';
    textarea.placeholder = 'Type your feedback here...';
    textarea.style.cssText = `
      width: 100%;
      height: 80px;
      padding: 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      resize: none;
      font-family: sans-serif;
      font-size: 14px;
      box-sizing: border-box;
      outline: none;
    `;

    // Create button container
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    `;

    // Create Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      background: #e5e7eb;
      color: #374151;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-family: sans-serif;
      font-size: 14px;
    `;
    cancelBtn.addEventListener('click', hideCommentModal);

    // Create Save button
    const saveBtn = document.createElement('button');
    saveBtn.id = 'glow-feedback-save';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;
    saveBtn.style.cssText = `
      padding: 8px 16px;
      background: #FF0055;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-family: sans-serif;
      font-size: 14px;
      opacity: 0.5;
    `;

    // Enable/disable save button based on textarea content
    function updateSaveButton() {
      const text = textarea.value.trim();
      saveBtn.disabled = !text;
      saveBtn.style.opacity = text ? '1' : '0.5';
    }

    textarea.addEventListener('input', updateSaveButton);

    // Handle keyboard shortcuts
    textarea.addEventListener('keydown', function(e) {
      // Cmd+Enter or Ctrl+Enter to submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!saveBtn.disabled) {
          submitFromModal();
        }
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        hideCommentModal();
      }
      // Enter without modifier should insert newline (default behavior)
    });

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(saveBtn);

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(textarea);
    modal.appendChild(btnContainer);

    // Overlay click handler - just no-op (don't close on outside click)
    overlay.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    // Append to DOM
    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    currentModal = { overlay, modal, textarea, saveBtn };

    // Draw the pin at click position (before modal appears)
    currentPin = renderPin(clickX, clickY);

    // Focus textarea
    setTimeout(function() {
      textarea.focus();
    }, 0);
  }

  // Hide comment modal
  function hideCommentModal() {
    if (currentModal) {
      if (currentModal.overlay && currentModal.overlay.parentNode) {
        currentModal.overlay.parentNode.removeChild(currentModal.overlay);
      }
      if (currentModal.modal && currentModal.modal.parentNode) {
        currentModal.modal.parentNode.removeChild(currentModal.modal);
      }
      currentModal = null;
    }
    pendingClickData = null;
  }

  // Submit comment from modal
  function submitFromModal() {
    if (!currentModal || !pendingClickData) return;

    const commentText = currentModal.textarea.value.trim();
    if (!commentText) return;

    // Close modal
    hideCommentModal();

    // Pin stays drawn (currentPin is already set)

    // Send to server
    submitComment({
      path: pendingClickData.path,
      text: commentText,
      xPercent: pendingClickData.xPercent,
      yPercent: pendingClickData.yPercent,
      xpath: pendingClickData.xpath,
      screenSize: pendingClickData.screenSize
    });
  }

  // Intercept Clicks
  document.addEventListener('click', function (e) {
    if (!isFeedbackMode) return;

    // Ignore clicks on our own feedback UI
    if (e.target.closest('#glow-feedback-toggle')) return;
    if (e.target.closest('#glow-feedback-modal')) return;
    if (e.target.closest('#glow-feedback-overlay')) return;

    e.preventDefault();
    e.stopPropagation();

    // Calculate percentages
    const xPercent = (e.clientX / window.innerWidth) * 100;
    const yPercent = (e.clientY / window.innerHeight) * 100;
    const xpath = getPathTo(e.target);

    const clickData = {
      path: window.location.pathname,
      xPercent,
      yPercent,
      xpath,
      screenSize: `${window.innerWidth}x${window.innerHeight}`
    };

    // Show custom modal instead of prompt
    showCommentModal(e.clientX, e.clientY, clickData);
  }, true);

  function renderPin(x, y) {
    const pin = document.createElement('div');
    pin.style.position = 'fixed';
    pin.style.left = `${x - 12}px`;
    pin.style.top = `${y - 12}px`;
    pin.style.width = '24px';
    pin.style.height = '24px';
    pin.style.backgroundColor = '#FF0055';
    pin.style.borderRadius = '50%';
    pin.style.border = '2px solid white';
    pin.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    pin.style.zIndex = '999997';
    pin.style.pointerEvents = 'none';
    document.body.appendChild(pin);
    return pin;
  }

  async function submitComment(data) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (API_KEY) headers['X-Api-Key'] = API_KEY;
      const response = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...data, domain: window.location.hostname })
      });
      if (response.ok) {
        console.log("Feedback saved successfully.");
      } else {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (_) {}
        if (response.status === 400) {
          console.warn("Markup.io: no project registered for this domain. The feedback will not be saved.");
          console.error("Error:", errorData);
        } else {
          console.error("Failed to save feedback.", errorData);
        }
      }
    } catch (err) {
      console.error("Network error:", err);
    }
  }
})();