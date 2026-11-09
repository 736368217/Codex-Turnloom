/**
 * 复制自 React Native Reusables 官方 registry：
 * packages/registry/src/nativewind/components/ui/badge.tsx
 * 导出 Badge / badgeVariants / badgeTextVariants，用 TextClassContext 下发文字色。
 * 差异：未装 @rn-primitives/slot，asChild 以 View 渲染；variant 类映射为 Option A 色板。
 */
import { View } from 'react-native';

import { cn, cva } from './utils';
import { TextClassContext } from './text';

const badgeVariants = cva('shrink-0 flex-row items-center justify-center overflow-hidden rounded-full px-[10px] py-1', {
  variants: {
    variant: {
      default: 'bg-[#E5F1FF]',
      secondary: 'bg-[#EFEFF4]',
      destructive: 'bg-[#FDECEC]',
      outline: 'border border-[#E5E5EA] bg-white',
      success: 'bg-[#E4F8E9]',
    },
  },
  defaultVariants: { variant: 'default' },
});

const badgeTextVariants = cva('text-[13px] font-semibold', {
  variants: {
    variant: {
      default: 'text-[#0065D1]',
      secondary: 'text-[#6D6D72]',
      destructive: 'text-[#D70015]',
      success: 'text-[#16713A]',
      outline: 'text-[#1C1C1E]',
    },
  },
  defaultVariants: { variant: 'default' },
});
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'outline';
type BadgeProps = React.ComponentProps<typeof View> & { variant?: BadgeVariant; asChild?: boolean };

function Badge({ className, variant, asChild: _asChild = false, ...props }: BadgeProps) {
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <View className={cn(badgeVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  );
}

export { Badge, badgeVariants, badgeTextVariants };
export type { BadgeProps };
