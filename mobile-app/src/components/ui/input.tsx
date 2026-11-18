/**
 * 复制自 React Native Reusables 官方 registry：
 * packages/registry/src/nativewind/components/ui/input.tsx
 * 官方为 `function Input({ className, ...props }) { return <TextInput className={cn(...)} {...props} /> }`
 * 这里把色板换成 Option A 浅色 token，其余 API 一致。
 */
import { TextInput } from 'react-native';

import { cn } from './utils';

function Input({ className, ...props }: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      className={cn(
        'min-h-[44px] w-full rounded-full border border-[#E5E5EA] bg-[#EFEFF4] px-4 text-[15px] text-[#1C1C1E]',
        props.editable === false && 'opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Input };
