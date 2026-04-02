(function () {
  // Glow Feedback Widget
  console.log("Glow Feedback Widget Loaded.");

  let isFeedbackMode = true; // Toggle this via a floating UI button later

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
    if (e.target.closest('#glow-feedback-container')) return;

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
    // In production, this URL will be dynamic based on the script src
    const API_URL = 'http://localhost:3000/api/comments';
    
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, projectId: 'dev-project' })
      });
      if (response.ok) {
        console.log("Feedback saved successfully.");
      } else {
        console.error("Failed to save feedback.");
      }
    } catch (err) {
      console.error("Network error:", err);
    }
  }
})();
