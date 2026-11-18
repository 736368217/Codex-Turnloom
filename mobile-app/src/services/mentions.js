'use strict';
function pluginMarkdown(plugin) { if (!plugin || !plugin.uri) return ''; return `[@${plugin.displayName || plugin.name || 'Plugin'}](${plugin.uri})`; }
function skillPrompt(skills) { const names = (skills || []).filter((skill) => skill.kind !== 'builtin').map((skill) => skill.displayName || skill.name).filter(Boolean); return names.length ? `${names.length === 1 ? 'Use skill' : 'Use skills'}: ${names.join(', ')}.` : ''; }
function composeMessage({ text, plugins = [], skills = [] }) { return [skillPrompt(skills), plugins.map(pluginMarkdown).filter(Boolean).join(' '), String(text || '').trim()].filter(Boolean).join('\n\n').trim(); }
function hasMentionContent(plugins, skills) { return plugins.length > 0 || skills.length > 0; }
module.exports = { pluginMarkdown, skillPrompt, composeMessage, hasMentionContent };
