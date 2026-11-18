/**
 * 插件 / 技能「引用」的文本拼装，逐字对齐原版 `public/app.js`：
 *
 *   插件 → `[@显示名](plugin://...)         （pluginMentionMarkdown）
 *   技能 → `Use skill: 名字.` / `Use skills: a, b.`（selectedSkillPrompt，builtin 不参与）
 *   发送 → [技能行, 插件行, 正文] 用空行连接 （composerSendMessage）
 *
 * 只拼文本、不改协议：真正的引用语义由电脑端宿主解析 markdown / prompt 获得，
 * 因此这里不需要新的接口，也不需要动 server.js。
 */

export type PluginRef = {
  name?: string;
  displayName?: string;
  uri?: string;
  description?: string;
  marketplace?: string;
};

export type SkillRef = {
  name?: string;
  displayName?: string;
  uri?: string;
  description?: string;
  kind?: string;
  source?: string;
};

export function pluginMarkdown(plugin: PluginRef): string {
  if (!plugin?.uri) return '';
  const label = plugin.displayName || plugin.name || 'Plugin';
  return `[@${label}](${plugin.uri})`;
}

export function skillPrompt(skills: SkillRef[]): string {
  const names = skills
    .filter((skill) => skill.kind !== 'builtin')
    .map((skill) => skill.displayName || skill.name)
    .filter((name): name is string => Boolean(name));
  if (!names.length) return '';
  return `${names.length === 1 ? 'Use skill' : 'Use skills'}: ${names.join(', ')}.`;
}

/** 与原版 composerSendMessage 一致的组装顺序。 */
export function composeMessage(args: {
  text: string;
  plugins?: PluginRef[];
  skills?: SkillRef[];
}): string {
  const plugins = (args.plugins || []).map(pluginMarkdown).filter(Boolean).join(' ');
  return [skillPrompt(args.skills || []), plugins, String(args.text || '').trim()]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** 只有真正能被宿主识别的引用才算「有内容」，用来决定发送键是否可用。 */
export function hasMentionContent(plugins: PluginRef[], skills: SkillRef[]): boolean {
  return plugins.length > 0 || skills.length > 0;
}
