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
 *
 * 标题居中的关键：左右两侧必须是**等宽容器**。
 * 之前左侧「‹ 会话」宽约 70px、右侧刷新按钮只有 40px，中间 flex-1 虽然
 * text-center，但被不等宽的两侧夹住，视觉中心必然偏右——这就是「标题不居中」。
 * 现在左右各占同一个固定宽度，中间区域才是真正的页面中心。
 */
const SIDE_WIDTH = 'w-[72px]';

export default function ChatDetailHeader({ title, subtitle, onBack, onRefresh }: ChatDetailHeaderProps) {
  return (
    <div className="glass-chrome z-20 flex shrink-0 items-center border-b px-2 pt-[max(0.7rem,env(safe-area-inset-top))] pb-2">
      <div className={cx('flex shrink-0 items-center justify-start', SIDE_WIDTH)}>
        <button
          type="button"
          aria-label="返回会话"
          onClick={onBack}
          className={cx(
            'flex h-10 items-center gap-0.5 rounded-full px-1.5 text-[15px] font-medium text-[#007AFF]',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
          <span>会话</span>
        </button>
      </div>
      <div className="min-w-0 flex-1 text-center" data-qa="chat-title">
        <p className="truncate text-[15px] font-semibold text-[#1C1C1E]">{title}</p>
        <p className="truncate text-[15px] font-semibold text-[#1C1C1E]">{title}</p>
        <p className="truncate text-[11px] text-[#8E8E93]">{subtitle}</p>
      </div>

      <div className={cx('flex shrink-0 items-center justify-end', SIDE_WIDTH)}>
        <button
          type="button"
          aria-label="刷新"
          onClick={onRefresh}
          className={cx(
            'flex h-10 w-10 items-center justify-center rounded-full text-[#007AFF]',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <RefreshCw size={18} />
        </button>
      </div>
    </div>
  );
}
