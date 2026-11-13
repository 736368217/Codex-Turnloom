import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { openLinkSheet } from '../state/sheetStore';

export default function MarkdownMessage({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="tl-markdown" onClick={event => {
    const link = (event.target as Element).closest?.('a[href]');
    if (!link) return;
    event.preventDefault();
    openLinkSheet(link.getAttribute('href') || '');
  }} dangerouslySetInnerHTML={{ __html: html }} />;
}
