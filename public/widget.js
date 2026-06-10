(function () {
  // Glow Feedback Widget
  console.log("Glow Feedback Widget Loaded.");

  // Derive API URL from the script src
  const scriptEl = document.currentScript || (function(){ const s = document.getElementsByTagName('script'); return s[s.length-1]; })();
  const SCRIPT_SRC = scriptEl ? scriptEl.src : '';
  const API_URL = SCRIPT_SRC.replace(/\/widget\.js.*$/, '') + '/api/comments';
  const API_KEY = scriptEl ? scriptEl.getAttribute('data-api-key') : '';

  let isFeedbackMode = false; // Default OFF

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

  // Intercept Clicks
  document.addEventListener('click', function (e) {
    if (!isFeedbackMode) return;

    // Ignore clicks on our own feedback UI
    if (e.target.closest('#glow-feedback-toggle')) return;

    e.preventDefault();
    e.stopPropagation();

    // Calculate percentages
    const xPercent = (e.clientX / window.innerWidth) * 100;
    const yPercent = (e.clientY / window.innerHeight) * 100;
    const xpath = getPathTo(e.target);

    // Ask for comment (MVP using native prompt, will upgrade to custom UI later)
    const commentText = prompt("Leave a comment on this element:");
    
    if (commentText) {
      // Draw a temporary pin
      renderPin(e.clientX, e.clientY);

      // Send to server
      submitComment({
        path: window.location.pathname,
        text: commentText,
        xPercent,
        yPercent,
        xpath,
        screenSize: `${window.innerWidth}x${window.innerHeight}`
      });
    }
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
    pin.style.zIndex = '999999';
    pin.style.pointerEvents = 'none';
    document.body.appendChild(pin);
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