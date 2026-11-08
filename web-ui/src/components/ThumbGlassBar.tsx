import { useRef, useState, type KeyboardEvent } from 'react';
import { ImagePlus, Mic, Send, Sparkles, Square, X } from 'lucide-react';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export interface SendImage {
  name: string;
  mimeType: string;
  /** base64，不带 data: 前缀（服务端 normalizeSendImages 处理）。 */
  data: string;
}

export interface SendPayload {
  message: string;
  mode?: 'start' | 'queue' | 'steer';
  images?: SendImage[];
}

export interface ThumbGlassBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (payload: SendPayload) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onVoice?: () => void;
  busy?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

type SendMode = 'queue' | 'steer';

function readImage(file: File): Promise<SendImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const comma = raw.indexOf(',');
      resolve({
        name: file.name || '图片',
        mimeType: file.type || 'image/png',
        data: comma >= 0 ? raw.slice(comma + 1) : raw,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 贴底拇指输入舱：
 * - placeholder 任何状态都保持超短，避免窄 textarea 截断；
 * - busy 时才出现「排队发送 / 直接插队」分段控件，空闲完全隐藏；
 * - 图片附件支持多选、预览、移除，只有图无文字也可发送。
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
  const [sendMode, setSendMode] = useState<SendMode>('queue');
  const [images, setImages] = useState<SendImage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const blocked = disabled || readOnly || submitting;

  const submit = async () => {
    const message = value.trim();
    // 只有图片、没有文字也允许发送（服务端契约允许）。
    if ((!message && images.length === 0) || blocked) return;
    setSubmitting(true);
    try {
      await onSend({
        message,
        ...(busy && !readOnly ? { mode: sendMode } : {}),
        ...(images.length ? { images } : {}),
      });
      onValueChange('');
      setImages([]);
      if (fileRef.current) fileRef.current.value = '';
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

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((file) => file.type.startsWith('image/'));
    const loaded = await Promise.all(picked.map(readImage));
    setImages((current) => [...current, ...loaded]);
  };

  return (
    <div className="z-20 shrink-0 px-3 pt-2.5">
      {/* 顶部工具行：添加图片 / 语音 + 缩略图预览（不占输入行宽度） */}
      <div className="mb-1 flex min-h-[44px] items-center gap-1.5">
        <button
          type="button"
          aria-label="添加图片"
          title="添加图片"
          disabled={blocked}
          onClick={() => fileRef.current?.click()}
          className={cx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#007AFF] shadow-[0_1px_4px_rgba(16,30,60,0.07)] disabled:opacity-40',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <ImagePlus size={19} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="选择图片文件"
          onChange={(event) => void onPickFiles(event.target.files)}
        />
        <button
          type="button"
          aria-label="语音输入"
          title="语音输入"
          disabled={blocked}
          onClick={onVoice}
          className={cx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#8E8E93] shadow-[0_1px_4px_rgba(16,30,60,0.07)] disabled:opacity-40',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <Mic size={18} />
        </button>
        <div data-qa="attachment" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {images.map((image, index) => (
            <div
              key={`${image.name}-${index}`}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E5E5EA] bg-[#EFEFF4]"
            >
              <img
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={image.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label="移除图片"
                title="移除图片"
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                className={cx(
                  'absolute inset-0 flex h-11 w-11 items-start justify-end p-0.5 text-transparent',
                  PRESS,
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1C1C1E]/70 text-white">
                  <X size={12} />
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* busy 时才出现的发送方式分段控件，空闲完全隐藏 */}
      {busy && !readOnly && (
        <div className="mb-1 flex min-h-[44px] items-center gap-2 overflow-hidden">
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/80 p-1 shadow-[0_1px_4px_rgba(16,30,60,0.07)]">
            <button
              type="button"
              aria-label="发送方式-排队"
              aria-pressed={sendMode === 'queue'}
              onClick={() => setSendMode('queue')}
              className={cx(
                'min-h-[44px] whitespace-nowrap rounded-full px-3 text-[12px] font-semibold',
                sendMode === 'queue' ? 'bg-[#007AFF] text-white' : 'text-[#8E8E93]',
                PRESS,
              )}
            >
              排队发送
            </button>
            <button
              type="button"
              aria-label="发送方式-插队"
              aria-pressed={sendMode === 'steer'}
              onClick={() => setSendMode('steer')}
              className={cx(
                'min-h-[44px] whitespace-nowrap rounded-full px-3 text-[12px] font-semibold',
                sendMode === 'steer' ? 'bg-[#007AFF] text-white' : 'text-[#8E8E93]',
                PRESS,
              )}
            >
              直接插队
            </button>
          </div>
          <span className="min-w-0 flex-1 truncate text-right text-[11px] leading-none text-[#8E8E93]">
            {sendMode === 'queue' ? '排队不打断当前任务' : '直接插入当前任务'}
          </span>
        </div>
      )}

      {/* 输入行：textarea + 发送 + 独立中断 */}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          disabled={blocked}
          placeholder={busy ? '追加指令…' : placeholder}
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
          disabled={blocked || (!value.trim() && images.length === 0)}
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

      {readOnly && (
        <p className="mt-1.5 text-center text-[11px] text-[#D70015]">
          只读模式：发送与中断已停用。
        </p>
      )}
    </div>
  );
}
