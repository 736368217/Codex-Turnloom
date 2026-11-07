/**
 * 复制自 React Native Reusables 官方 registry：
 * packages/registry/src/nativewind/components/ui/text.tsx
 * 用法差异（如实记录）：官方 import `@rn-primitives/slot` 的 Slot 支持 asChild；
 * 本工程未装该 peer，故 asChild 用 RN Text 直接渲染，其余
 * `textVariants` / `TextClassContext` / `ROLE` / `ARIA_LEVEL` 与官方一致。
 */
import * as React from 'react';
import { Platform, Text as RNText, type Role } from 'react-native';

import { cn, cva } from './utils';

const textVariants = cva(
  cn('text-[#1C1C1E] text-[15px]', Platform.select({ web: 'select-text' }) || ''),
  {
    variants: {
      variant: {
        default: '',
        h1: cn('text-[34px] font-extrabold tracking-tight', Platform.select({ web: 'scroll-m-20' }) || ''),
        h2: 'text-3xl font-semibold tracking-tight',
        h3: 'text-2xl font-semibold tracking-tight',
        h4: 'text-xl font-semibold tracking-tight',
        p: 'text-[15px] leading-6',
        large: 'text-[17px] font-semibold',
        small: 'text-[12px] font-medium leading-none',
        muted: 'text-[#8E8E93] text-[13px]',
        lead: 'text-[#8E8E93] text-[17px]',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

type TextVariant = 'default' | 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'large' | 'small' | 'muted' | 'lead';

const ROLE: Partial<Record<TextVariant, Role>> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = { h1: '1', h2: '2', h3: '3', h4: '4' };

/** 官方同名导出；Button / Badge 通过它把文字 variant 传给子 Text。 */
const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentProps<typeof RNText> & {
  variant?: TextVariant;
  asChild?: boolean;
};

function Text({ className, asChild: _asChild = false, variant = 'default', ...props }: TextProps) {
  const textClass = React.useContext(TextClassContext);
  return (
    <RNText
      className={cn(textVariants({ variant }), textClass, className)}
      role={ROLE[variant]}
      aria-level={ARIA_LEVEL[variant]}
      {...props}
    />
  );
}

export { Text, TextClassContext, textVariants };
