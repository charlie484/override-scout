// Allow-list HTML sanitizer for Q&A content coming from the VEX API.
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'IMG', 'BLOCKQUOTE', 'CODE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'HR', 'SUB', 'SUP', 'FIGURE', 'FIGCAPTION']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'SVG', 'MATH']);
const ATTRS = { A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'] };
const ORIGIN = 'https://events.vex.com';

function absolute(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return ORIGIN + url;
  return url;
}

function walk(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 1) {
      const tag = child.tagName;
      if (DROP.has(tag)) { child.remove(); continue; }
      if (!ALLOWED.has(tag)) { walk(child); child.replaceWith(...child.childNodes); continue; }
      for (const a of [...child.attributes]) if (!(ATTRS[tag] || []).includes(a.name)) child.removeAttribute(a.name);
      if (tag === 'A') {
        const href = absolute(child.getAttribute('href') || '');
        if (/^(https?:|mailto:)/i.test(href)) { child.setAttribute('href', href); child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
        else child.removeAttribute('href');
      }
      if (tag === 'IMG') {
        const src = absolute(child.getAttribute('src') || '');
        if (!/^https:/i.test(src)) { child.remove(); continue; }
        child.setAttribute('src', src); child.setAttribute('loading', 'lazy'); child.setAttribute('referrerpolicy', 'no-referrer');
      }
      walk(child);
    } else if (child.nodeType !== 3) {
      child.remove();
    }
  }
}

export function sanitize(input) {
  if (!input) return '';
  const doc = new DOMParser().parseFromString(`<div>${input}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  walk(root);
  return root.innerHTML;
}

export function plainText(input, max = 220) {
  if (!input) return '';
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
