/**
 * 复制自 React Native Reusables 官方 registry：
 * packages/registry/src/nativewind/components/ui/card.tsx
 * 导出与官方相同：Card / CardHeader / CardTitle / CardDescription /
 * CardContent / CardFooter；Card 用 TextClassContext.Provider 下发文字色。
 */
import { View } from 'react-native';

import { cn } from './utils';
import { Text, TextClassContext } from './text';

function Card({ className, ...props }: React.ComponentProps<typeof View>) {
  return (
    <TextClassContext.Provider value="text-[#1C1C1E]">
      <View
        className={cn('flex flex-col gap-3 rounded-2xl border border-[#E5E5EA]/70 bg-white p-4', className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn('flex flex-col gap-1', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text role="heading" aria-level={3} className={cn('text-[16px] font-semibold', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn('text-[13px] text-[#8E8E93]', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn('flex flex-col gap-2', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn('flex flex-row items-center', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
