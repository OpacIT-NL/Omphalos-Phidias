'use strict';

(function exposeWireColors(root) {
  const colors = Object.freeze({
    object: '#3b82f6',
    html: '#22d3ee',
    list: '#eab308',
    number: '#f97316',
    text: '#a855f7',
    action: '#23a559',
    'encrypted-data': '#ef4444',
    undefined: '#8b949e'
  });
  const aliases = Object.freeze({ string: 'text', array: 'list', unspecified: 'undefined', unknown: 'undefined' });

  function canonicalType(value) {
    const type = aliases[String(value || '').toLowerCase()] || String(value || '').toLowerCase();
    return Object.hasOwn(colors, type) ? type : 'undefined';
  }

  function typeForPort(port = {}) {
    if (port.kind === 'action') return 'action';
    const identity = `${port.id || ''} ${port.name || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (/\bencrypted data\b/.test(identity)) return 'encrypted-data';
    if (/\bhtml\d*\b/.test(identity)) return 'html';
    return canonicalType(Array.isArray(port.types) ? port.types[0] : port.type);
  }

  function typeForConnection(kind, outputType, inputType) {
    if (kind === 'action') return 'action';
    const output = canonicalType(outputType), input = canonicalType(inputType);
    return output === 'undefined' ? input : output;
  }

  function colorForType(type) { return colors[canonicalType(type)]; }
  function colorForConnection(kind, outputType, inputType) { return colors[typeForConnection(kind, outputType, inputType)]; }

  const api = Object.freeze({ colors, canonicalType, typeForPort, typeForConnection, colorForType, colorForConnection });
  root.PhidiasWireColors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
