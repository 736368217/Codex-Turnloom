/**
 * React Native Reusables 复制式组件入口（`~/components/ui/*`）。
 * 来源：github.com/founded-labs/react-native-reusables
 *   packages/registry/src/nativewind/components/ui/{button,text,card,badge,input}.tsx
 * 依赖：官方用 class-variance-authority / clsx / tailwind-merge / @rn-primitives/slot；
 * 本工程未装这些 peer，utils.ts 提供同签名零依赖 cn/cva，详见各文件注释。
 */
export { Button, buttonVariants, buttonTextVariants } from './button';
export type { ButtonProps } from './button';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
export { Badge, badgeVariants, badgeTextVariants } from './badge';
export { Text, TextClassContext, textVariants } from './text';
export { Input } from './input';
export { cn, cva } from './utils';
