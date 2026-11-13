/**
 * Compact, render-safe chat message styling. The 20px line box is pinned in CSS
 * and all descendants are reset: Konsta/Tailwind/Typography rules cannot inflate
 * a paragraph, add min-height, or distribute lines with equal-space flex gaps.
 * Intentional line breaks are preserved by `white-space: pre-wrap`; pathological
 * blank-line runs are capped in chatContract.compactMessageText before render.
 */

import { COLORS } from './optionATokens';

export const CHAT_BUBBLE_LINE_HEIGHT = 21;
export const CHAT_BUBBLE_FONT_SIZE = 14;
export const CHAT_BUBBLE_MAX_WIDTH_PERCENT = 88;
export const CHAT_MESSAGE_GAP = 6;

export const chatMessageRow = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  gap: `${CHAT_MESSAGE_GAP}px`,
  margin: '0 0 6px',
  minHeight: 0,
} as const;

export function chatBubbleStyle(isUser: boolean): Record<string, string | number> {
  return {
    display: 'block',
    maxWidth: `${CHAT_BUBBLE_MAX_WIDTH_PERCENT}%`,
    minWidth: 0,
    minHeight: 0,
    padding: '8px 11px',
    borderRadius: '16px',
    background: isUser ? COLORS.blue : COLORS.fillSecondary,
    color: isUser ? '#FFFFFF' : COLORS.labelPrimary,
    fontFamily: 'inherit',
    fontSize: `${CHAT_BUBBLE_FONT_SIZE}px`,
    fontWeight: '400',
    lineHeight: `${CHAT_BUBBLE_LINE_HEIGHT}px`,
    letterSpacing: 'normal',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    margin: '0',
  };
}

export const CHAT_COMPACT_CSS = `
.tl-chat-list,
.tl-chat-list *,
.tl-chat-list *::before,
.tl-chat-list *::after {
  box-sizing: border-box;
  font-family: inherit;
  font-size: ${CHAT_BUBBLE_FONT_SIZE}px;
  font-weight: 400;
  line-height: ${CHAT_BUBBLE_LINE_HEIGHT}px;
  letter-spacing: normal;
  text-align: left;
  text-indent: 0;
  text-transform: none;
  min-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  justify-content: flex-start;
  align-content: flex-start;
  align-items: flex-start;
  gap: 0;
  flex-grow: 0;
  white-space: pre-wrap;
}
.tl-chat-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 6px;
  min-height: 0;
  margin: 0 0 6px;
  padding: 0;
}
.tl-chat-row--user { justify-content: flex-end; }
.tl-chat-bubble {
  display: block;
  width: fit-content;
  max-width: ${CHAT_BUBBLE_MAX_WIDTH_PERCENT}%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 8px 11px;
  border-radius: 16px;
  font-size: ${CHAT_BUBBLE_FONT_SIZE}px;
  line-height: ${CHAT_BUBBLE_LINE_HEIGHT}px;
  letter-spacing: normal;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  /* Explicitly forbid equal-space distribution of paragraphs or lines. */
  justify-content: flex-start;
  align-content: flex-start;
  align-items: flex-start;
  flex: 0 1 auto;
}
.tl-chat-bubble *,
.tl-chat-bubble *::before,
.tl-chat-bubble *::after {
  display: inline;
  float: none;
  clear: none;
  position: static;
  width: auto;
  height: auto;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  font: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  white-space: inherit;
  overflow-wrap: inherit;
  word-break: inherit;
  background: transparent;
  color: inherit;
  justify-content: flex-start;
  align-content: flex-start;
  align-items: flex-start;
  flex: 0 0 auto;
}
.tl-chat-bubble--user { background: ${COLORS.blue}; color: #FFFFFF; }
.tl-chat-bubble--assistant { background: ${COLORS.fillSecondary}; color: ${COLORS.labelPrimary}; }
.tl-chat-attachment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-height: 0;
  margin: 4px 0 0;
  padding: 0;
  font-size: 12px;
  line-height: 17px;
  color: inherit;
  opacity: .9;
  white-space: normal;
}
.tl-chat-attachment img {
  display: block;
  width: 44px;
  height: 44px;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  object-fit: cover;
  border-radius: 8px;
}
@media (max-width: 393px) {
  .tl-chat-bubble { max-width: 90%; padding: 7px 10px; }
  .tl-chat-row { gap: 4px; margin-bottom: 5px; }
}
@media (max-width: 320px) {
  .tl-chat-bubble { max-width: 92%; padding: 6px 9px; }
  .tl-chat-list { padding-left: 8px; padding-right: 8px; }
}
`;
