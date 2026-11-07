import { ChevronLeft, RefreshCw } from 'lucide-react';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export interface ChatDetailHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
  onRefresh: () => void;
}

/**
 * 方案 A · 聊天详情页紧凑顶栏（微信/QQ 模型）。
 * 只有「返回会话列表 + 当前会话标题/状态 + 刷新」，不放全局跳转入口，
 * 不放大标题，把垂直空间还给消息流。
 */
export default function ChatDetailHeader({ title, subtitle, onBack, onRefresh }: ChatDetailHeaderProps) {
  return (
    <div className="glass-chrome z-20 flex shrink-0 items-center gap-2 border-b px-2 pt-[max(0.7rem,env(safe-area-inset-top))] pb-2">
      <button
        type="button"
        aria-label="返回会话"
        onClick={onBack}
        className={cx(
          'flex h-10 shrink-0 items-center gap-0.5 rounded-full px-2 text-[15px] font-medium text-[#007AFF]',
          HIT_AREA_44,
          PRESS,
        )}
      >
        <ChevronLeft size={22} strokeWidth={2.2} />
        <span>会话</span>
      </button>
      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-[15px] font-semibold text-[#1C1C1E]">{title}</p>
        <p className="truncate text-[11px] text-[#8E8E93]">{subtitle}</p>
      </div>
      <button
        type="button"
        aria-label="刷新"
        onClick={onRefresh}
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#007AFF]',
          HIT_AREA_44,
          PRESS,
        )}
      >
        <RefreshCw size={18} />
      </button>
    </div>
  );
}
