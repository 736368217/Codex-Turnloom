import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { motion } from 'motion/react';
import { ChevronDown, GitBranch, ShieldCheck } from 'lucide-react';
import {
  approvalItems,
  messageText,
  runningTimeLabel,
  type ApprovalItem,
  type MessagesStatus,
  type StreamMessage,
} from '../lib/turnloomApi';
import { PRESS, cx, truncate } from '../lib/ui';
import { highlightWithShiki } from '../lib/shikiHighlight';

export interface TaskStreamViewProps {
  messages: StreamMessage[];
  status: MessagesStatus | null;
  diff?: unknown;
  onApprove: (item: ApprovalItem) => void;
  onStartTask?: () => void;
  busy?: boolean;
}

// ---------------------------------------------------------------------------
// Markdown → sanitized HTML → lightweight code-token highlighting
// ---------------------------------------------------------------------------

/**
 * Wrap keyword/string/comment/number/function tokens inside `<code>` in
 * `.tok-*` spans. Quote entities are swapped for sentinels and all other
 * entities are parked, so e.g. the `39` in `&#39;` is never seen as a number.
 */
const CODE_TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|(\u0002[^\u0002]*\u0002|\u0003[^\u0003]*\u0003|`[^`]*`)|(\b(?:const|let|var|function|return|if|else|for|while|class|extends|new|import|export|from|default|async|await|try|catch|throw|typeof|interface|type|public|private|static|void|null|undefined|true|false|this|super|switch|case|break|continue|do|in|of|as|enum|implements|yield|delete|instanceof)\b)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\())/g;

function highlightCode(code: string): string {
  const entities: string[] = [];
  const safe = code
    .replace(/&quot;/g, '\u0002')
    .replace(/&#39;|&#x27;/gi, '\u0003')
    .replace(/&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/g, (entity) => {
      entities.push(entity);
      return `\u0001${entities.length - 1}\u0001`;
    });

  const highlighted = safe.replace(
    CODE_TOKEN,
    (
      token: string,
      comment?: string,
      stringToken?: string,
      keyword?: string,
      numberToken?: string,
      functionToken?: string,
    ) => {
      if (comment) return `<span class="tok-com">${comment}</span>`;
      if (stringToken) return `<span class="tok-str">${stringToken}</span>`;
      if (keyword) return `<span class="tok-kw">${keyword}</span>`;
      if (numberToken) return `<span class="tok-num">${numberToken}</span>`;
      if (functionToken) return `<span class="tok-fn">${functionToken}</span>`;
      return token;
    },
  );

  return highlighted
    .replace(/\u0001(\d+)\u0001/g, (_match, index: string) => entities[Number(index)] || '')
    .replace(/\u0002/g, '&quot;')
    .replace(/\u0003/g, '&#39;');
}

function renderMarkdown(markdown: string): string {
  const parsed = marked.parse(markdown || '', { async: false });
  const sanitized = DOMPurify.sanitize(parsed, { USE_PROFILES: { html: true } });
  // Only touch the text inside <code>…</code>. Attributes stay sanitized.
  return sanitized.replace(
    /<code([^>]*)>([\s\S]*?)<\/code>/gi,
    (_match, attrs: string, code: string) => {
      // Split around existing tags (never highlight inside markup).
      const parts = code.split(/(<[^>]+>)/g);
      const highlighted = parts
        .map((part) => (part.startsWith('<') ? part : highlightCode(part)))
        .join('');
      return `<code${attrs}>${highlighted}</code>`;
    },
  );
}

function isReasoning(message: StreamMessage): boolean {
  return (
    message.phase === 'thinking' ||
    message.kind === 'reasoning' ||
    message.kind === 'thinking' ||
    (message.role === 'assistant' && message.kind === 'thought')
  );
}

// ---------------------------------------------------------------------------
// Defensive /api/host/diff parsing (shape is not guaranteed by server.js)
// ---------------------------------------------------------------------------

interface DiffFile {
  name: string;
  status: string;
  additions: string;
  deletions: string;
  lines: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanLines(lines: string[]): string[] {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(0, 200);
}

function toLines(value: unknown): string[] {
  if (typeof value === 'string') return cleanLines(value.split(/\r?\n/));
  if (!Array.isArray(value)) return [];
  return cleanLines(
    value.flatMap((line): string[] => {
      if (typeof line === 'string') return line.split(/\r?\n/);
      if (typeof line === 'number') return [String(line)];
      const record = asRecord(line);
      if (!record) return [];
      if (typeof record.raw === 'string') return [record.raw];
      const text = record.text ?? record.content ?? record.line ?? record.value ?? '';
      const prefix = typeof record.type === 'string' && /^(add|added|\+)$/i.test(record.type)
        ? '+'
        : typeof record.type === 'string' && /^(del|deleted|remove|removed|-)$/i.test(record.type)
          ? '-'
          : '';
      const rendered = typeof text === 'string' || typeof text === 'number' ? String(text) : '';
      return rendered || prefix ? [`${prefix}${rendered}`] : [];
    }),
  );
}

function parseDiff(diff: unknown): { files: DiffFile[]; lines: string[] } {
  if (typeof diff === 'string') return { files: [], lines: toLines(diff) };
  const record = asRecord(diff);
  if (!record) return { files: [], lines: [] };

  const payload = record.diff ?? record.patch;
  const lines = toLines(
    typeof payload === 'string' || Array.isArray(payload) ? payload : record.lines,
  );

  const files: DiffFile[] = [];
  if (Array.isArray(record.files)) {
    let remaining = Math.max(0, 200 - lines.length);
    for (const entry of record.files) {
      const file = asRecord(entry);
      if (!file) continue;
      const rawLines = toLines(file.lines ?? file.patch ?? file.diff ?? file.hunks);
      const chosen = remaining > 0 ? rawLines.slice(0, remaining) : [];
      remaining -= chosen.length;
      const additions = file.additions ?? file.added ?? '';
      const deletions = file.deletions ?? file.deleted ?? file.removals ?? '';
      files.push({
        name: String(file.path ?? file.name ?? file.file ?? '未知文件'),
        status: String(file.status ?? file.change ?? ''),
        additions: additions === 0 || additions ? String(additions) : '',
        deletions: deletions === 0 || deletions ? String(deletions) : '',
        lines: chosen,
      });
    }
  }
  return { files, lines };
}

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-[#8E8E93]';
  if (line.startsWith('+')) return 'bg-[#E8F8EE] text-[#1E7E34]';
  if (line.startsWith('-')) return 'bg-[#FDECEC] text-[#C82333]';
  if (line.startsWith('@@')) return 'text-[#007AFF]';
  return 'text-[#1C1C1E]';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function decodeEntities(value: string): string {
  // renderMarkdown() 会给 <code> 内文本包上 <span class="tok-*"> 做即时着色。
  // Shiki 接管时需要的是纯源码；这里剥掉这些装饰标签（保留其文本内容）并解码实体，
  // 否则会把字面 "<span class=...>" 当成代码显示出来。
  const withoutTokens = value
    .replace(/<span\b[^>]*class="tok-[^"]*"[^>]*>/gi, '')
    .replace(/<\/span>/gi, '');
  const el = document.createElement('textarea');
  el.innerHTML = withoutTokens;
  return el.value;
}

/** 官方 Shiki codeToHtml + github-light，本地 bundle，无 CDN、无 WASM。 */
function ShikiCode({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    void highlightWithShiki(code, lang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);
  if (html) {
    return <div className="shiki-block" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
  }
  // 兜底同样剥掉装饰标签，避免降级时把 <span class="tok-*"> 当正文显示。
  const plain = code.replace(/<[^>]*>/g, '');
  return <pre className="shiki-fallback"><code>{plain}</code></pre>;
}

function MarkdownBody({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const segments = useMemo(() => {
    const out: Array<{ type: 'html' | 'code'; value: string; lang?: string }> = [];
    const re = /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/gi;
    let last = 0;
    for (const m of html.matchAll(re)) {
      const start = m.index || 0;
      if (start > last) out.push({ type: 'html', value: html.slice(last, start) });
      out.push({ type: 'code', value: decodeEntities(m[2]).replace(/\n$/, ''), lang: m[1] });
      last = start + m[0].length;
    }
    if (last < html.length) out.push({ type: 'html', value: html.slice(last) });
    return out;
  }, [html]);
  return (
    <div className="md-body">
      {segments.map((segment, index) =>
        segment.type === 'code' ? (
          <ShikiCode key={`code-${index}`} code={segment.value} lang={segment.lang} />
        ) : (
          <div key={`html-${index}`} dangerouslySetInnerHTML={{ __html: segment.value }} />
        ),
      )}
    </div>
  );
}

function DiffLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-[1.55]">
      <div className="min-w-max">
        {lines.map((line, index) => (
          <div
            key={`diff-${index}`}
            className={cx('min-w-max px-2', diffLineClass(line))}
          >
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function TaskStreamView(props: TaskStreamViewProps) {
  const { messages, status, diff, onApprove, onStartTask, busy = false } = props;
  const [expanded, setExpanded] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const thinking = Boolean(status?.thinking);
  useEffect(() => {
    // The 1s timer exists ONLY while the agent is thinking.
    if (!thinking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [thinking]);

  // Re-derive the elapsed label on each tick (and whenever status changes).
  const runningLabel = runningTimeLabel(status, now);

  const terminalLines = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'tool')
        .flatMap((message) => {
          const text = messageText(message) || message.title || '';
          return text ? text.split(/\r?\n/).filter((line) => line.trim() !== '') : [];
        })
        .slice(-40),
    [messages],
  );

  const thoughts = useMemo(
    () =>
      messages.filter(isReasoning).map((message) => messageText(message) || message.title || ''),
    [messages],
  );

  const parsedDiff = useMemo(() => parseDiff(diff), [diff]);
  const hasDiff =
    parsedDiff.lines.length > 0 || parsedDiff.files.length > 0;

  return (
    <div className="space-y-5 pb-6">
      {/* (A) Collapsible AI Thinking / Terminal Log */}
      <motion.section
        layout
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="ios-fill overflow-hidden rounded-[20px] border border-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cx(
            'flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left text-[15px] font-medium text-[#1C1C1E]',
            PRESS,
          )}
        >
          <span
            className={cx(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              thinking ? 'bg-[#34C759]' : 'bg-[#C7C7CC]',
            )}
          />
          <span className="min-w-0 flex-1 truncate">{thinking ? 'AI 正在思考…' : '空闲'}</span>
          <span className="text-[12px] text-[#8E8E93]">{runningLabel}</span>
          <ChevronDown
            size={18}
            className={cx('shrink-0 text-[#8E8E93] transition-transform duration-300', expanded && 'rotate-180')}
          />
        </button>

        <div
          className={cx(
            'overflow-hidden transition-all duration-300',
            expanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          <div className="border-t border-[#E5E5EA] px-4 pb-4 pt-3">
            <p className="mb-2 text-[12px] font-semibold text-[#1C1C1E]">终端日志</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white/70 p-3 font-mono text-[11px] leading-relaxed text-[#1C1C1E]">
              {terminalLines.length > 0
                ? terminalLines.join('\n')
                : '暂无终端输出'}
            </pre>
            <p className="mb-2 mt-3 text-[12px] font-semibold text-[#1C1C1E]">思考中</p>
            {thoughts.length > 0 ? (
              <div className="space-y-2 text-[12px] leading-relaxed text-[#6D6D72]">
                {thoughts.map((thought, index) => (
                  <p key={`thought-${index}`} className="whitespace-pre-wrap">
                    {thought}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[#8E8E93]">暂无思考记录</p>
            )}
          </div>
        </div>
      </motion.section>

      {/* (D) 空状态：可操作，引导直接发送或新建对话 */}
      {messages.length === 0 ? (
        <div className="ios-card p-6 text-center">
          <p className="text-[15px] font-semibold text-[#1C1C1E]">开始聊天</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#8E8E93]">
            在下方输入框直接发送即可开始，或新建一条任务会话。
          </p>
          {onStartTask && (
            <button
              type="button"
              onClick={onStartTask}
              className={cx('ios-btn-primary mt-4 min-h-[44px] w-full rounded-[14px] px-4 text-[14px] font-semibold text-white', PRESS)}
            >
              开始新对话
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message, index) => {
            const key = `${message.turnId || message.role}-${index}`;
            const text = messageText(message);
            const title = message.title || message.role;

            if (message.role === 'tool') return null;
            if (message.role === 'notice' && message.kind === 'parse_error') return null;

            if (message.role === 'interaction' && message.canApprove && message.requestId) {
              const item = approvalItems([message])[0];
              if (!item) return null;
              return (
                <div
                  key={key}
                  className="ios-card p-4"
                >
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1C1C1E]">
                    <ShieldCheck size={16} className="text-[#34C759]" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[#8E8E93]">
                    {truncate(item.content, 160)}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onApprove(item)}
                    className={cx(
                      'ios-btn-green mt-3 w-full rounded-[14px] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50',
                      PRESS,
                    )}
                  >
                    查看并批准
                  </button>
                </div>
              );
            }

            if (message.role === 'user') {
              return (
                <div key={key} className="flex justify-end">
                  <div className="ios-bubble-user max-w-[85%] whitespace-pre-wrap px-4 py-2.5 text-[15px] leading-relaxed text-white">
                    {text}
                  </div>
                </div>
              );
            }

            if (message.role === 'assistant') {
              return (
                <div
                  key={key}
                  className="ios-bubble-ai p-4"
                >
                  <MarkdownBody markdown={text} />
                </div>
              );
            }

            return (
              <div
                key={key}
                className="flex items-baseline gap-2 px-1 text-[12px] text-[#8E8E93]"
              >
                <span className="shrink-0 font-medium">{title}</span>
                <span className="min-w-0 flex-1 truncate">{truncate(text, 160)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* (C) Daylight Git Diff card */}
      <section className="ios-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[#E5E5EA]/80 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#34C759]/12 text-[#248A3D]">
            <GitBranch size={15} />
          </span>
          <h2 className="text-[14px] font-semibold text-[#1C1C1E]">代码改动</h2>
        </div>
        {hasDiff ? (
          <div className="p-3">
            {parsedDiff.files.map((file, index) => (
              <div key={`file-${index}`} className="mb-3 last:mb-0">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[#1C1C1E]">
                    {file.name}
                  </span>
                  {file.status && (
                    <span className="rounded-full bg-[#EFEFF4] px-2 py-0.5 text-[#8E8E93]">
                      {file.status}
                    </span>
                  )}
                  {file.additions && (
                    <span className="text-[#1E7E34]">+{file.additions}</span>
                  )}
                  {file.deletions && (
                    <span className="text-[#C82333]">−{file.deletions}</span>
                  )}
                </div>
                <DiffLines lines={file.lines} />
              </div>
            ))}
            <DiffLines lines={parsedDiff.lines} />
          </div>
        ) : (
          <p className="px-4 py-4 text-[13px] text-[#8E8E93]">暂无文件改动</p>
        )}
      </section>
    </div>
  );
}
