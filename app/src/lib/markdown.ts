import { marked } from 'marked';
import DOMPurify from 'dompurify';

import { safeExternalUrl } from './externalUrl';
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true });
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  // Parse the already sanitized result to reject relative, file, data, custom
  // protocols, credentials and obfuscated URLs. Remote images are never loaded.
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const link of template.content.querySelectorAll('a')) {
    const href = safeExternalUrl(link.getAttribute('href') || '');
    if (href) { link.setAttribute('href', href); link.setAttribute('rel', 'noopener noreferrer'); }
    else link.removeAttribute('href');
  }
  return template.innerHTML;
}
