import { useRef, useState, type KeyboardEvent } from 'react';
import { Mic, Send, Square, Sparkles } from 'lucide-react';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export interface ThumbGlassBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (message: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onVoice?: () => void;
  busy?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 底部拇指输入舱。
 *
 * 顶层 UX：代理运行中不再把「发送」整键换成「中断」——那样用户填完字会发不出去。
 * busy 时保留发送键（App 层用 mode:'queue' 把指令排队），另给一个明确的
 * 「中断」按钮，并附一行状态说明，让用户知道当前会发生什么。
 */
export default function ThumbGlassBar({
  value,
  onValueChange,
  onSend,
  onInterrupt,
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
    <div className="z-20 shrink-0 px-3 pt-2.5">
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="语音输入"
          onClick={onVoice}
          className={cx(
            'mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#8E8E93] shadow-[0_1px_4px_rgba(16,30,60,0.07)]',
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
          placeholder={busy ? '追加指令将排队，或点中断停止当前任务' : placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          className={cx(
            'ios-fill min-h-[42px] max-h-[120px] min-w-0 flex-1 resize-none rounded-[22px] border border-white/80 px-4 py-2.5 text-[15px] leading-5 text-[#1C1C1E]',
            'placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/25 disabled:opacity-60',
            'select-text',
          )}
        />

        <button
          type="button"
          aria-label="发送"
          disabled={blocked || !value.trim()}
          onClick={() => void submit()}
          className={cx(
            'ios-btn-primary mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40',
            HIT_AREA_44,
            PRESS,
          )}
        >
          {submitting ? <Sparkles size={17} className="animate-pulse" /> : <Send size={17} />}
        </button>

        {busy && (
          <button
            type="button"
            aria-label="中断"
            disabled={readOnly || submitting}
            onClick={() => void onInterrupt()}
            className={cx(
              'ios-btn-red mb-0.5 flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-white disabled:opacity-50',
              PRESS,
            )}
          >
            <Square size={13} fill="currentColor" />
            中断
          </button>
        )}
      </div>

      {busy && !readOnly && (
        <p className="mt-1.5 text-center text-[11px] text-[#8E8E93]">
          代理运行中 · 发送的指令会排队，不会打断当前任务
        </p>
      )}

      {readOnly && (
        <p className="mt-1.5 text-center text-[11px] text-[#D70015]">
          只读模式：发送与中断已停用。
        </p>
      )}
    </div>
  );
}
