import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Image as ImageIcon, Paperclip, Square, X } from 'lucide-react';
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

export interface QueuedItem {
  id: string;
  text?: string;
  deliveryState?: string;
  position?: number;
}

export interface ThumbGlassBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (payload: SendPayload) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  busy?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 运行中时已排队消息；有值才显示队列条（空闲不占位）。 */
  queueLength?: number;
  queuedMessages?: QueuedItem[];
  onQueueAction?: (action: 'steer' | 'cancel', itemId: string) => void | Promise<void>;
  onClearQueue?: () => void | Promise<void>;
}

function readAsImage(file: File): Promise<SendImage> {
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
 * 贴底输入舱（贴合原版 public/index.html 的 composer 语义，但更紧凑）：
 *
 * 单行主结构：`[附件] [输入框] [发送 / 停止]`
 * - 语音输入原版就没有（原版 voice 相关命中 0），已删除；
 * - 附件还原原版的「回形针 → 相册 / 文件浏览」二级菜单；
 * - 发送与停止互斥，同一位置只渲染一个：
 *   有内容 → 发送（运行中即排队，不打断）；空且运行中 → 停止；
 * - 排队/插队不再常驻占一行，改为「运行中 + 有排队消息」时才出现的紧凑队列条，
 *   在队列条里逐条排序/插队/删除，或清空；
 * - 附件缩略图只在真的选了图时才占一行。
 */
export default function ThumbGlassBar({
  value,
  onValueChange,
  onSend,
  onInterrupt,
  busy = false,
  readOnly = false,
  disabled = false,
  placeholder = '输入消息…',
  queueLength = 0,
  queuedMessages = [],
  onQueueAction,
  onClearQueue,
}: ThumbGlassBarProps) {
  const [submitting, setSubmitting] = useState(false);
  const [images, setImages] = useState<SendImage[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const blocked = disabled || readOnly || submitting;
  const hasPayload = Boolean(value.trim() || images.length);
  /** 互斥：有内容就是「发送」；空且运行中才是「停止」。 */
  const showStop = busy && !hasPayload && !readOnly;

  // 点空白处关闭附件菜单（原版也是点击外部收起）
  useEffect(() => {
    if (!attachMenu) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setAttachMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [attachMenu]);

  const submit = async () => {
    const message = value.trim();
    if ((!message && images.length === 0) || blocked) return;
    setSubmitting(true);
    setNotice('');
    try {
      // 运行中默认排队（不打断当前任务）；要插队去队列条里操作。
      await onSend({ message, ...(busy && !readOnly ? { mode: 'queue' as const } : {}), ...(images.length ? { images } : {}) });
      onValueChange('');
      setImages([]);
      if (photoRef.current) photoRef.current.value = '';
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

  /**
   * 「相册 / 文件」两个入口最终都产出图片附件：
   * 服务端 /api/send 只接受 images[]，原版 fileToImageAttachment 同样只接受图片格式。
   * 选了非图片文件时给明确提示，而不是静默丢弃。
   */
  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const imgs = all.filter((file) => file.type.startsWith('image/'));
    if (imgs.length < all.length) {
      setNotice(`已忽略 ${all.length - imgs.length} 个非图片文件（当前只支持图片附件）`);
    }
    const loaded = await Promise.all(imgs.map(readAsImage));
    if (loaded.length) setImages((current) => [...current, ...loaded]);
  };

  const queueCount = Math.max(queueLength, queuedMessages.length);

  return (
    <div className="z-20 shrink-0 px-3 pb-1 pt-2">
      {/* 队列条：仅「运行中 + 有排队消息」出现，默认折叠成一行，不常驻占用 */}
      {queueCount > 0 && (
        <div
          data-qa="queue-bar"
          className="mb-1.5 rounded-[14px] border border-[#007AFF]/18 bg-[#007AFF]/[0.06] px-2 py-[3px]"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="展开排队"
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen((v) => !v)}
              className={cx(
                'flex min-h-[26px] min-w-0 flex-1 items-center gap-1 text-left text-[12px] font-semibold leading-none text-[#007AFF]',
                PRESS,
              )}
            >
              <span className={cx('transition-transform', queueOpen && 'rotate-90')}>▸</span>
              <span className="truncate">{queueCount} 条排队，完成后自动发送</span>
            </button>
            {onClearQueue && (
              <button
                type="button"
                aria-label="清空排队"
                onClick={() => void onClearQueue()}
                className={cx('shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold leading-none text-[#D70015]', PRESS)}
              >
                清空
              </button>
            )}
          </div>
          {queueOpen && (
            <ul className="mt-1 space-y-1">
              {queuedMessages.length === 0 && (
                <li className="text-[11px] text-[#8E8E93]">排队中（明细暂不可用，可清空后重发）</li>
              )}
              {queuedMessages.map((item, index) => (
                <li
                  key={item.id || `q-${index}`}
                  className="flex items-center gap-1.5 rounded-[10px] bg-white/70 px-2 py-1"
                >
                  <span className="w-4 shrink-0 text-[11px] font-bold text-[#8E8E93]">{item.position ?? index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[#1C1C1E]">
                    {item.text || '（无预览）'}
                  </span>
                  {onQueueAction && (
                    <>
                      <button
                        type="button"
                        aria-label={`插队-${index + 1}`}
                        onClick={() => void onQueueAction('steer', item.id)}
                        className={cx('shrink-0 rounded-full bg-[#007AFF]/12 px-2 py-1 text-[11px] font-semibold text-[#007AFF]', PRESS)}
                      >
                        插队
                      </button>
                      <button
                        type="button"
                        aria-label={`删除排队-${index + 1}`}
                        onClick={() => void onQueueAction('cancel', item.id)}
                        className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8E8E93]', PRESS)}
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 附件预览：仅选了图时占一行 */}
      {images.length > 0 && (
        <div data-qa="attachment" className="mb-1.5 flex items-center gap-1.5 overflow-x-auto">
          {images.map((image, index) => (
            <div
              key={`${image.name}-${index}`}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E5E5EA] bg-[#EFEFF4]"
            >
              <img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="移除图片"
                title="移除图片"
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                className={cx('absolute inset-0 flex items-start justify-end p-0.5', PRESS)}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1C1C1E]/70 text-white">
                  <X size={12} />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {notice && <p className="mb-1 truncate text-[11px] text-[#B26A00]">{notice}</p>}

      {/* 单行主结构：附件 · 输入 · 发送/停止（互斥） */}
      <div className="flex items-end gap-1.5">
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-label="添加附件"
            title="添加图片或文件"
            disabled={blocked}
            aria-expanded={attachMenu}
            onClick={() => setAttachMenu((v) => !v)}
            className={cx(
              'ios-fill mb-0.5 flex h-10 w-10 items-center justify-center rounded-full text-[#007AFF] disabled:opacity-40',
              HIT_AREA_44,
              PRESS,
            )}
          >
            <Paperclip size={18} />
          </button>
          {attachMenu && (
            <div
              role="menu"
              className="absolute bottom-12 left-0 z-30 w-[152px] overflow-hidden rounded-[14px] border border-[#E5E5EA] bg-white shadow-[0_10px_30px_rgba(16,30,60,0.22)]"
            >
              <button
                type="button"
                role="menuitem"
                aria-label="相册"
                onClick={() => {
                  setAttachMenu(false);
                  photoRef.current?.click();
                }}
                className={cx('flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] text-[#1C1C1E]', PRESS)}
              >
                <ImageIcon size={16} className="text-[#007AFF]" />
                相册
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="文件"
                onClick={() => {
                  setAttachMenu(false);
                  fileRef.current?.click();
                }}
                className={cx(
                  'flex w-full items-center gap-2 border-t border-[#E5E5EA] px-3 py-2.5 text-left text-[14px] text-[#1C1C1E]',
                  PRESS,
                )}
              >
                <Paperclip size={16} className="text-[#007AFF]" />
                文件
              </button>
            </div>
          )}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="从相册选择图片"
            onChange={(event) => void pick(event.target.files)}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            aria-label="从文件选择"
            onChange={(event) => void pick(event.target.files)}
          />
        </div>

        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          disabled={blocked}
          placeholder={readOnly ? '只读模式' : busy ? '追加消息（排队，不打断）' : placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          className={cx(
            'ios-fill min-h-[40px] max-h-[112px] min-w-0 flex-1 resize-none rounded-[20px] border border-white/80 px-4 py-2.5 text-[15px] leading-5 text-[#1C1C1E]',
            'placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/25 disabled:opacity-60',
            'select-text',
          )}
        />

        {showStop ? (
          <button
            type="button"
            aria-label="中断"
            title="停止当前任务"
            disabled={submitting}
            onClick={() => void onInterrupt()}
            className={cx(
              'ios-btn-red mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white',
              HIT_AREA_44,
              PRESS,
            )}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="发送"
            title="发送"
            disabled={blocked || !hasPayload}
            onClick={() => void submit()}
            className={cx(
              'ios-btn-primary mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40',
              HIT_AREA_44,
              PRESS,
            )}
          >
            {submitting ? <Square size={14} className="animate-pulse" fill="currentColor" /> : <ArrowUp size={19} strokeWidth={2.6} />}
          </button>
        )}
      </div>

      {readOnly && <p className="mt-1 text-center text-[11px] text-[#D70015]">只读模式：发送与中断已停用</p>}
    </div>
  );
}
