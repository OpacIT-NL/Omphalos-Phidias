'use strict';

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function inlineMarkdown(value) {
  const code = [];
  value = String(value).replace(/`([^`]+)`/g, (_match, contents) => `\u0000CODE${code.push(`<code>${escapeHTML(contents)}</code>`) - 1}\u0000`);
  value = escapeHTML(value);
  value = value.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_match, label, url, title) => {
    const decodedURL = url.replaceAll('&amp;', '&');
    if (/^(?:javascript|data|vbscript):/i.test(decodedURL)) return label;
    return `<a href="${url}"${title ? ` title="${title}"` : ''}>${label}</a>`;
  });
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  value = value.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  value = value.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  return value.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => code[Number(index)]);
}
function markdownToHTML(markdown) {
  if (typeof markdown !== 'string') throw new Error('Markdown input is required');
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n'), output = [];
  let index = 0, paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`); paragraph = []; } };
  while (index < lines.length) {
    const line = lines[index];
    if (/^```/.test(line)) {
      flushParagraph();
      const language = line.slice(3).trim().replace(/[^a-zA-Z0-9_-]/g, ''), contents = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) contents.push(lines[index++]);
      if (index < lines.length) index++;
      output.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHTML(contents.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); index++; continue; }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); output.push('<hr>'); index++; continue; }
    if (/^>\s?/.test(line)) {
      flushParagraph(); const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      output.push(`<blockquote><p>${inlineMarkdown(quote.join(' '))}</p></blockquote>`); continue;
    }
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/), ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(); const tag = unordered ? 'ul' : 'ol', items = [];
      const pattern = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      while (index < lines.length) { const item = lines[index].match(pattern); if (!item) break; items.push(`<li>${inlineMarkdown(item[1])}</li>`); index++; }
      output.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    if (!line.trim()) { flushParagraph(); index++; continue; }
    paragraph.push(line.trim()); index++;
  }
  flushParagraph();
  return output.join('\n');
}

module.exports = {
  type: 'markdown_to_html',
  name: 'Markdown to HTML',
  category: 'Data',
  description: 'Converts Markdown text to escaped HTML with headings, formatting, links, lists, quotes, and code blocks.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'markdown', name: 'Markdown', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', markdownToHTML(inputs.markdown));
    return 'next';
  },
  markdownToHTML,
  inlineMarkdown
};
