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
 * 底部拇指输入舱。空闲 → 蓝色发送（POST /api/send），
 * 运行中 → 红色中断（POST /api/interrupt）。
 * 快捷指令胶囊排已按 v5 规范删减：规范只要求「提供胶囊」却未定义点击行为，
 * 现有实现仅回填文字属半成品，故整排移除，把空间还给聊天与输入。
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
    <div className="z-20 shrink-0 px-3 pt-2">
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
