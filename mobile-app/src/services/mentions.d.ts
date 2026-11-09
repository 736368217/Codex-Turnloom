export type PluginRef = { name?: string; displayName?: string; uri?: string; description?: string; marketplace?: string };
export type SkillRef = { name?: string; displayName?: string; uri?: string; description?: string; kind?: string; source?: string };
export declare function pluginMarkdown(plugin: PluginRef): string;
export declare function skillPrompt(skills: SkillRef[]): string;
export declare function composeMessage(args: { text: string; plugins?: PluginRef[]; skills?: SkillRef[] }): string;
export declare function hasMentionContent(plugins: PluginRef[], skills: SkillRef[]): boolean;
