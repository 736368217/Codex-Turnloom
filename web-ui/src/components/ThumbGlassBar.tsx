import { useRef, useState, type KeyboardEvent } from 'react';
import { Mic, Send, Square, Sparkles } from 'lucide-react';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export const QUICK_COMMANDS = ['检查报错', '查看改动 Diff', '继续执行', '运行测试'] as const;

export interface ThumbGlassBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (message: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onQuickCommand: (command: string) => void;
  onVoice?: () => void;
  busy?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Bottom thumb-zone glass bar. Idle → blue Send (POST /api/send),
 * running → red Interrupt (POST /api/interrupt).
 * No hamburger, no top nav, no footer — all secondary actions live in sheets.
 */
export default function ThumbGlassBar({
  value,
  onValueChange,
  onSend,
  onInterrupt,
  onQuickCommand,
  onVoice,
  busy = false,
  readOnly = false,
  disabled = false,
  placeholder = '输入指令…',
}: ThumbGlassBarProps) {
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const blocked = disabled || readOnly || submitting;

  const submit = async () => {
    const message = value.trim();
    if (!message || blocked) return;
    setSubmitting(true);
    try {
      await onSend(message);
      onValueChange('');
      inputRef.current?.blur();
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="z-20 shrink-0 px-3 pt-2">
      {/* Quick-command capsule row — single-hand reachable, horizontally scrollable. */}
      <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 py-0.5">
        {QUICK_COMMANDS.map((command) => (
          <button
            key={command}
            type="button"
            disabled={blocked}
            onClick={() => onQuickCommand(command)}
            className={cx(
              'flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border border-[#E5E5EA] bg-white px-3 text-[12px] font-medium text-[#1C1C1E] disabled:opacity-50',
              PRESS,
            )}
          >
            {command}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="语音输入"
          onClick={onVoice}
          className={cx(
            'mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#8E8E93]',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <Mic size={18} />
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          disabled={blocked}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          className={cx(
            'min-h-[40px] max-h-[120px] min-w-0 flex-1 resize-none rounded-full bg-[#EFEFF4] px-4 py-2.5 text-[15px] leading-5 text-[#1C1C1E]',
            'placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/20 disabled:opacity-60',
            'select-text',
          )}
        />

        {busy ? (
          <button
            type="button"
            disabled={readOnly || submitting}
            onClick={() => void onInterrupt()}
            className={cx(
              'mb-0.5 flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#FF3B30] px-4 text-[14px] font-semibold text-white disabled:opacity-50',
              PRESS,
            )}
          >
            <Square size={14} fill="currentColor" />
            中断
          </button>
        ) : (
          <button
            type="button"
            aria-label="发送"
            disabled={blocked || !value.trim()}
            onClick={() => void submit()}
            className={cx(
              'mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white disabled:opacity-40',
              HIT_AREA_44,
              PRESS,
            )}
          >
            {submitting ? <Sparkles size={17} className="animate-pulse" /> : <Send size={17} />}
          </button>
        )}
      </div>

      {readOnly && (
        <p className="mt-1.5 text-center text-[11px] text-[#D70015]">
          只读模式：发送与中断已停用。
        </p>
      )}
    </div>
  );
}
