'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const root = path.resolve(__dirname, '../app/src/lib');
function load(name, values = {}) {
  let js = stripTypeScriptTypes(fs.readFileSync(path.join(root, name + '.ts'), 'utf8'));
  const names = [...js.matchAll(/export function (\w+)/g)].map(m => m[1]);
  js = js.replace(/^import .*;$/gm, '').replace(/export function /g, 'function ');
  return new Function(...Object.keys(values), js + '\nreturn {' + names.join(',') + '};')(...Object.values(values));
}
test('safe Markdown renders structure while removing active content and unsafe links', async () => {
  const dom = new JSDOM('');
  const { marked } = await import('marked');
  const { safeExternalUrl } = load('externalUrl');
  const { renderMarkdown } = load('markdown', { marked, DOMPurify: createDOMPurify(dom.window), document: dom.window.document, safeExternalUrl });
  const html = renderMarkdown('## Heading\n\n**bold**\n\n- list\n\n```js\nconst x = 1;\n```\n\n[web](https://example.com/docs)\n\n<img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:alert(1)">bad</a><iframe src="https://example.com"></iframe>');
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('h2').textContent, 'Heading');
  assert.equal(doc.querySelector('strong').textContent, 'bold');
  assert.equal(doc.querySelector('li').textContent, 'list');
  assert.match(doc.querySelector('pre code').textContent, /const x = 1/);
  assert.equal(doc.querySelector('a[href]').href, 'https://example.com/docs');
  assert.equal(doc.querySelector('a[href]').rel, 'noopener noreferrer');
  assert.equal(doc.querySelectorAll('script,img,iframe,[onerror],[style]').length, 0);
  assert.equal(doc.querySelectorAll('a[href]').length, 1);
  dom.window.close();
});
test('external links reject custom schemes, relative paths, credentials and controls', () => {
  const { safeExternalUrl } = load('externalUrl');
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///private', 'intent://test', '//example.com', '/api/send', 'https://user:secret@example.com', 'https://example.com\n.evil']) assert.equal(safeExternalUrl(value), null, value);
  assert.equal(safeExternalUrl('https://example.com/a?x=1#part'), 'https://example.com/a?x=1#part');
});
