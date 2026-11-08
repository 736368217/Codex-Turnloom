/**
 * 复制自 React Native Reusables 官方 registry：
 * packages/registry/src/nativewind/components/ui/button.tsx
 * 结构完全照官方：`buttonVariants = cva(...)`、`buttonTextVariants = cva(...)`、
 * `Button` 用 `TextClassContext.Provider` 把文字 variant 下发、Pressable role="button"。
 * 差异：cn/cva 用本地零依赖实现（未装 clsx/tailwind-merge/class-variance-authority），
 * 颜色改为 Option A 浅色 token，其余 API 与官方一致。
 */
import { Pressable } from 'react-native';

import { cn, cva } from './utils';
import { TextClassContext } from './text';

const buttonVariants = cva('shrink-0 flex-row items-center justify-center gap-2 rounded-xl', {
  variants: {
    variant: {
      default: 'bg-[#007AFF] active:opacity-90',
      destructive: 'bg-[#FF3B30] active:opacity-90',
      outline: 'border border-[#E5E5EA] bg-white active:opacity-80',
      secondary: 'bg-[#EFEFF4] active:opacity-80',
      ghost: 'active:opacity-70',
      link: '',
    },
    size: {
      default: 'h-11 px-4',
      sm: 'h-9 px-3',
      lg: 'h-12 px-6',
      icon: 'h-11 w-11',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

const buttonTextVariants = cva('text-[15px] font-semibold', {
  variants: {
    variant: {
      default: 'text-white',
      destructive: 'text-white',
      outline: 'text-[#007AFF]',
      secondary: 'text-[#1C1C1E]',
      ghost: 'text-[#007AFF]',
      link: 'text-[#007AFF]',
    },
    size: { default: '', sm: '', lg: '', icon: '' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

type ButtonProps = React.ComponentProps<typeof Pressable> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(props.disabled && 'opacity-45', buttonVariants({ variant, size }), className)}
        role="button"
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button, buttonVariants, buttonTextVariants };
export type { ButtonProps };
