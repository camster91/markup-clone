// Entry point for the markup widget. Built by Vite into a single IIFE
// at public/widget.js. The host page embeds it with:
//   <script src="/widget.js" data-api-key="..." data-project-id="..."></script>
// The IIFE name "MarkupWidget" matches what tests/widget/widget.test.ts
// loads via `new Function('MarkupWidget', ...)`. We expose a small
// surface for debugging and tests; the widget itself runs side-effectful
// (it auto-boots).

import { boot, init, destroy, startFeedback, stopFeedback, getState, getConfig, getIsFeedbackMode } from './lifecycle';
import { showModal, hideModal, getCurrentModal, getPendingClick } from './form';
import { readConfig, parseHost, findScriptEl } from './config';
import { createToggleButton, getCssPath, clearHoverOutline } from './dom';
import { captureViewport } from './capture';

const MarkupWidget = {
  // Lifecycle
  boot,
  init,
  destroy,
  startFeedback,
  stopFeedback,
  getState,
  getConfig,
  getIsFeedbackMode,
  // Config
  readConfig,
  parseHost,
  findScriptEl,
  // DOM
  createToggleButton,
  getCssPath,
  clearHoverOutline,
  // Capture
  captureViewport,
  // Form
  showModal,
  hideModal,
  getCurrentModal,
  getPendingClick,
};

// The browser SDK intentionally calls a small, stable lifecycle surface on
// window. Rollup's IIFE wrapper does not publish module exports by itself when
// the entry is consumed only for side effects, so make that contract explicit.
if (typeof window !== 'undefined') window.MarkupWidget = MarkupWidget;

export default MarkupWidget;
export {
  boot,
  init,
  destroy,
  startFeedback,
  stopFeedback,
  getState,
  getConfig,
  getIsFeedbackMode,
  readConfig,
  parseHost,
  findScriptEl,
  createToggleButton,
  getCssPath,
  clearHoverOutline,
  captureViewport,
  showModal,
  hideModal,
  getCurrentModal,
  getPendingClick,
};

// Auto-boot: matches the original IIFE's behavior of running the
// DOMContentLoaded dance as soon as the script is parsed.
boot();

// Side-effect: ensure tests can detect the bundle even when not driven
// through the global name. Vite IIFE assigns `MarkupWidget` to the
// global object; we don't need to do that here.
