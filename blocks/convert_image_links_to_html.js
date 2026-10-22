'use strict';

const IMAGE_PATH = /\.(?:jpe?g|png|gif|webp|bmp)$/i;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function decodeHTMLAttribute(value) {
  return String(value).replace(/&(?:amp|quot|#39|lt|gt);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' })[entity]);
}

function supportedImageURL(value) {
  try {
    const raw = decodeHTMLAttribute(value);
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    let pathname = url.pathname;
    try { pathname = decodeURIComponent(pathname); } catch {}
    return IMAGE_PATH.test(pathname) ? raw : null;
  } catch { return null; }
}

function imageTag(url, label = '') {
  const alt = String(label).trim() === String(url).trim() ? '' : String(label).trim();
  return `<img class="phidias-linked-image" src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" loading="lazy" decoding="async">`;
}

function convertImageLinksToHTML(value) {
  let content = String(value ?? '');
  const images = [];
  const hold = html => `\u0000PHIDIASIMAGE${images.push(html) - 1}\u0000`;

  content = content.replace(/<a\s+href="([^"]+)"(?:\s+title="[^"]*")?\s*>([^<]*)<\/a>/gi, (match, href, label) => {
    const url = supportedImageURL(href);
    return url ? hold(imageTag(url, decodeHTMLAttribute(label))) : match;
  });
  content = content.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi, (match, label, href) => {
    const url = supportedImageURL(href);
    return url ? hold(imageTag(url, label)) : match;
  });
  content = content.replace(/https?:\/\/[^\s<>"']+?\.(?:jpe?g|png|gif|webp|bmp)(?:\?[^\s<>"']*)?(?:#[^\s<>"']*)?/gi, match => {
    const url = supportedImageURL(match);
    return url ? hold(imageTag(url)) : match;
  });
  return content.replace(/\u0000PHIDIASIMAGE(\d+)\u0000/g, (_match, index) => images[Number(index)]);
}

module.exports = {
  type: 'convert_image_links_to_html',
  name: 'Convert Image Links to HTML',
  category: 'HTML',
  description: 'Converts Markdown links, HTML links, and bare HTTP(S) URLs ending in JPG, JPEG, PNG, GIF, WebP, or BMP into lazy-loaded image tags.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'content', name: 'Content', kind: 'value', types: ['text'], required: true }
  ],
  fields: [],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Converted', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'] }
  ],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', convertImageLinksToHTML(inputs.content));
    return 'next';
  },
  convertImageLinksToHTML,
  supportedImageURL
};
