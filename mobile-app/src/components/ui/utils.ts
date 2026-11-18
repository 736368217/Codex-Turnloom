/**
 * cn() — React Native Reusables registry 的 `lib/utils.ts` 对应文件。
 * 官方实现是 `import { clsx, type ClassValue } from 'clsx'; import { twMerge } from 'tailwind-merge';
 * export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }`
 * 本工程 node_modules 未装 clsx / tailwind-merge（且红线禁止 npm install），
 * 故按同一 API 形状做零依赖本地实现：过滤假值 + 拼接 + 同类 Tailwind 去重。
 * 见报告「缺哪些 peer 依赖」。
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(values: ClassValue[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) out.push(...flatten(value));
    else out.push(String(value));
  }
  return out;
}

/** 与 twMerge 的简化等价：同一 utility group 只保留最后一个类。 */
function mergeClasses(classes: string[]): string {
  const order: string[] = [];
  const groupOf = (token: string) => {
    const head = token.split(':').pop() || token;
    const match = /^-?([a-z]+(?:-[a-z]+)*)-/.exec(head);
    if (match) return match[1];
    return head.replace(/\/.*$/, '');
  };
  const byGroup = new Map<string, string>();
  for (const token of classes.join(' ').split(/\s+/).filter(Boolean)) {
    const group = groupOf(token);
    if (byGroup.has(group)) order.splice(order.indexOf(byGroup.get(group)!), 1);
    byGroup.set(group, token);
    order.push(token);
  }
  return order.join(' ');
}

export function cn(...inputs: ClassValue[]): string {
  return mergeClasses(flatten(inputs));
}

/**
 * cva() — class-variance-authority 的最小本地等价实现。
 * 官方 button.tsx / text.tsx / badge.tsx 依赖它生成 variant 类名；
 * 本工程未装该包，故按 `cva(base, { variants, defaultVariants })` 签名实现，
 * 返回值可像官方一样 `buttonVariants({ variant, size })` 调用。
 */
export type CvaVariantConfig = Record<string, Record<string, string>>;
export type CvaConfig<V extends CvaVariantConfig> = {
  variants?: V;
  defaultVariants?: { [K in keyof V]?: keyof V[K] & string };
};

export function cva<V extends CvaVariantConfig>(base: string, config: CvaConfig<V> = {}) {
  return (props: Partial<{ [K in keyof V]: keyof V[K] & string }> = {}) => {
    const parts = [base];
    for (const key of Object.keys(config.variants || {}) as string[]) {
      const variantTable: Record<string, string> = (config.variants as Record<string, Record<string, string>> | undefined)?.[key] || {};
      const chosen =
        (props as Record<string, string | undefined>)[key] ??
        (config.defaultVariants as Record<string, string | undefined> | undefined)?.[key] ??
        '';
      if (chosen && variantTable[chosen]) parts.push(variantTable[chosen]);
    }
    return cn(parts);
  };
}

export type VariantProps<T extends (...args: never[]) => string> = Parameters<T>[0];
