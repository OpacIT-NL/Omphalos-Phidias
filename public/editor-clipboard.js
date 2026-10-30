'use strict';
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhidiasClipboard = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function clientToWorld(point, viewport, view) {
    return {
      x: (point.clientX - viewport.left - view.x) / view.zoom,
      y: (point.clientY - viewport.top - view.y) / view.zoom
    };
  }

  function pasteOffset(blocks, target) {
    if (!Array.isArray(blocks) || !blocks.length) return { x: 0, y: 0 };
    const left = Math.min(...blocks.map(block => Number(block.x) || 0));
    const top = Math.min(...blocks.map(block => Number(block.y) || 0));
    return { x: Math.round(target.x - left), y: Math.round(target.y - top) };
  }

  return Object.freeze({ clientToWorld, pasteOffset });
});
