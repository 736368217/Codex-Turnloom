/**
 * Option A 底部抽屉族（原生）。
 *
 * 为什么自己写而不是全用 gorhom：审批抽屉已经用 gorhom（需要 GestureHandler +
 * 全局 Provider），但这些选择器是「一次性弹出、无需拖拽手势」的简单场景，
 * 用 RN 的 `Modal` + 半透明遮罩更稳：不依赖手势根节点、不受列表滚动冲突影响，
 * 在真机上也不会出现「抽屉盖住键盘无法关闭」。
 *
 * 视觉仍遵守宪法 §3：只有底部抽屉，没有居中 Modal；顶部有 36×6 的拖拽条；
 * 主色 #007AFF、分隔线 #E5E5EA、次级文字 #6D6D72。
 */
import { SymbolView } from './ui/icon';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import type { PluginRef, SkillRef } from '@/services/mentions';

export type ModelOption = {
  id: string;
  label?: string;
  efforts?: string[];
  defaultEffort?: string;
  supportsImages?: boolean;
};

const EFFORT_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
  ultra: '极致',
};

export function effortLabel(effort?: string): string {
  if (!effort) return '';
  return EFFORT_LABEL[effort] || effort;
}

function SheetShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxHeightRatio = 0.72,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxHeightRatio?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.28)' }}
        />
        <View
          style={{
            maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
            backgroundColor: OptionA.card,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingBottom: Math.max(insets.bottom, 12),
            shadowColor: '#101E3C',
            shadowOffset: { width: 0, height: -6 },
            shadowOpacity: 0.12,
            shadowRadius: 20,
            elevation: 16,
          }}>
          <View style={{ paddingTop: 8, alignItems: 'center' }}>
            <View style={{ width: 36, height: 6, borderRadius: 3, backgroundColor: OptionA.drag }} />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 18,
              paddingTop: 12,
              paddingBottom: 10,
            }}>
            <View style={{ flex: 1, justifyContent: "flex-end" }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: OptionA.ink }}>{title}</Text>
              {subtitle ? (
                <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 17, color: OptionA.inkSoft }}>{subtitle}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => ({
                minHeight: 44,
                minWidth: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: OptionA.blue }}>关闭</Text>
            </Pressable>
          </View>
          <View style={{ height: 0.5, backgroundColor: OptionA.separator }} />
          <ScrollView
            style={{ flexShrink: 1, flexGrow: 0 }}
            contentContainerStyle={{ paddingVertical: 4, paddingHorizontal: 18 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

function Row({
  title,
  subtitle,
  trailing,
  selected,
  onPress,
  first,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  selected?: boolean;
  onPress: () => void;
  first?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 2,
        borderRadius: 12,
        borderTopWidth: first ? 0 : 0.5,
        borderTopColor: OptionA.separator,
        backgroundColor: pressed ? OptionA.fill : 'transparent',
      })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: selected ? '700' : '600', color: OptionA.ink }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 13, lineHeight: 16, color: OptionA.inkSoft }} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: OptionA.inkSoft }} numberOfLines={1}>
          {trailing}
        </Text>
      ) : null}
      {selected ? (
        <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={OptionA.blue} />
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * 1. 模型 + 思考强度
 * ------------------------------------------------------------------ */

export function ModelEffortSheet({
  visible,
  models,
  model,
  effort,
  onApply,
  onClose,
}: {
  visible: boolean;
  models: ModelOption[];
  model?: string;
  effort?: string;
  onApply: (modelId: string, effort: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<'model' | 'effort'>('model');
  const [draftModel, setDraftModel] = useState<string>(model || '');

  useEffect(() => {
    if (!visible) return;
    setStage('model');
    setDraftModel(model || models[0]?.id || '');
  }, [visible, model, models]);

  const active = useMemo(
    () => models.find((item) => item.id === draftModel) || models.find((item) => item.id === model) || models[0],
    [models, draftModel, model]
  );
  const efforts = active?.efforts?.length ? active.efforts : [active?.defaultEffort || 'medium'];

  if (stage === 'effort') {
    return (
      <SheetShell
        visible={visible}
        title={active?.label || active?.id || '思考强度'}
        subtitle="选择这个模型使用的思考强度"
        onClose={onClose}
        maxHeightRatio={0.6}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 18 }}>
          {efforts.map((level) => {
            const selected = level === (effort || active?.defaultEffort || 'medium');
            return (
              <Pressable
                key={level}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (active?.id) onApply(active.id, level);
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  paddingHorizontal: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  borderWidth: 0.5,
                  borderColor: selected ? OptionA.blue : OptionA.separator,
                  backgroundColor: selected ? 'rgba(0,122,255,0.10)' : OptionA.fill,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: selected ? '700' : '600',
                    color: selected ? OptionA.blue : OptionA.ink,
                  }}>
                  {effortLabel(level)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setStage('model')}
          style={({ pressed }) => ({ minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: OptionA.blue }}>返回模型列表</Text>
        </Pressable>
      </SheetShell>
    );
  }

  return (
    <SheetShell
      visible={visible}
      title="模型与思考强度"
      subtitle="选择后立即生效，并记住这个会话的选择"
      onClose={onClose}>
      {models.length === 0 ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: OptionA.inkSoft }}>服务器没有返回可用模型</Text>
        </View>
      ) : (
        models.map((item, index) => {
          const selected = item.id === (model || models[0]?.id);
          const trailing =
            selected && effort ? effortLabel(effort) : effortLabel(item.defaultEffort || item.efforts?.[0]);
          return (
            <Row
              key={item.id}
              first={index === 0}
              title={item.label || item.id}
              subtitle={item.id}
              trailing={trailing}
              selected={selected}
              onPress={() => {
                setDraftModel(item.id);
                setStage('effort');
              }}
            />
          );
        })
      )}
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ *
 * 2. 插件 / 技能引用
 * ------------------------------------------------------------------ */

export function MentionSheet({
  visible,
  plugins,
  skills,
  loading,
  error,
  selectedPlugins,
  selectedSkills,
  onTogglePlugin,
  onToggleSkill,
  onClose,
}: {
  visible: boolean;
  plugins: PluginRef[];
  skills: SkillRef[];
  loading: boolean;
  error: string;
  selectedPlugins: PluginRef[];
  selectedSkills: SkillRef[];
  onTogglePlugin: (plugin: PluginRef) => void;
  onToggleSkill: (skill: SkillRef) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'plugin' | 'skill'>('skill');
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (visible) setKeyword('');
  }, [visible]);

  const source = tab === 'plugin' ? plugins : skills;
  const filtered = source.filter((item) => {
    const term = keyword.trim().toLowerCase();
    if (!term) return true;
    return `${item.displayName || ''} ${item.name || ''} ${item.description || ''}`.toLowerCase().includes(term);
  });

  const isSelected = (item: PluginRef | SkillRef) => {
    const list = tab === 'plugin' ? selectedPlugins : selectedSkills;
    return list.some((selected) => (selected.uri || selected.name) === (item.uri || item.name));
  };

  return (
    <SheetShell
      visible={visible}
      title="引用插件 / 技能"
      subtitle="选中后会随下一条消息一起发给电脑端"
      onClose={onClose}
      maxHeightRatio={0.8}>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 }}>
        {(['skill', 'plugin'] as const).map((key) => {
          const active = tab === key;
          const count = key === 'skill' ? selectedSkills.length : selectedPlugins.length;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(key)}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: 14,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                backgroundColor: active ? OptionA.card : 'transparent',
                borderWidth: 0.5,
                borderColor: active ? OptionA.separator : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: active ? '700' : '500',
                  color: active ? OptionA.ink : OptionA.inkSoft,
                }}>
                {key === 'skill' ? '技能' : '插件'}
                {count ? ` · ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder={tab === 'skill' ? '搜索技能' : '搜索插件'}
          placeholderTextColor={OptionA.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            height: 38,
            borderRadius: 10,
            paddingHorizontal: 12,
            backgroundColor: OptionA.fill,
            fontSize: 14,
            color: OptionA.ink,
          }}
        />
      </View>
      {loading ? (
        <View style={{ paddingVertical: 28, alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={OptionA.blue} />
          <Text style={{ fontSize: 13, color: OptionA.inkSoft }}>正在加载…</Text>
        </View>
      ) : error ? (
        <View style={{ padding: 20 }}>
          <Text style={{ fontSize: 13, color: OptionA.redInk }}>{error}</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: OptionA.inkSoft }}>
            {source.length === 0 ? '服务器没有返回可引用的项目' : '没有匹配项'}
          </Text>
        </View>
      ) : (
        filtered.map((item, index) => (
          <Row
            key={`${tab}-${item.uri || item.name || index}`}
            first={index === 0}
            title={item.displayName || item.name || '未命名'}
            subtitle={item.description || item.uri || ''}
            selected={isSelected(item)}
            onPress={() => (tab === 'plugin' ? onTogglePlugin(item as PluginRef) : onToggleSkill(item as SkillRef))}
          />
        ))
      )}
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ *
 * 3. 消息长按菜单
 * ------------------------------------------------------------------ */
export function MessageActionSheet({
  visible,
  preview,
  onCopy,
  onClose,
}: {
  visible: boolean;
  preview: string;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <SheetShell visible={visible} title="消息操作" onClose={onClose} maxHeightRatio={0.5}>
      <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
        <Text style={{ fontSize: 13, lineHeight: 18, color: OptionA.inkSoft }} numberOfLines={4}>
          {preview || '（空消息）'}
        </Text>
      </View>
      <Row first title="复制全文" onPress={onCopy} />
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ *
 * 4. 新建会话（可选归档到项目）
 * ------------------------------------------------------------------ */

export type ProjectOption = { id: string; name?: string; root?: string };

export function NewThreadSheet({
  visible,
  projects,
  projectsLoading,
  projectId,
  draft,
  creating,
  error,
  onChangeDraft,
  onSelectProject,
  onCreate,
  onClose,
}: {
  visible: boolean;
  projects: ProjectOption[];
  projectsLoading: boolean;
  projectId: string;
  draft: string;
  creating: boolean;
  error: string;
  onChangeDraft: (value: string) => void;
  onSelectProject: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const canCreate = Boolean(draft.trim()) && !creating;
  return (
    <SheetShell
      visible={visible}
      title="新建会话"
      subtitle="选择归档项目（可不选），再输入第一条指令"
      onClose={onClose}
      maxHeightRatio={0.86}>
      <View style={{ paddingHorizontal: 18, paddingTop: 12, gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: OptionA.inkSoft }}>归档到项目</Text>
        {projectsLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
            <ActivityIndicator color={OptionA.blue} />
            <Text style={{ fontSize: 13, color: OptionA.inkSoft }}>正在读取项目列表…</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[{ id: '', name: '不归档' }, ...projects].map((project) => {
              const selected = (project.id || '') === (projectId || '');
              return (
                <Pressable
                  key={project.id || 'none'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectProject(project.id || '')}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    maxWidth: 190,
                    paddingHorizontal: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 10,
                    borderWidth: 0.5,
                    borderColor: selected ? OptionA.blue : OptionA.separator,
                    backgroundColor: selected ? 'rgba(0,122,255,0.10)' : OptionA.fill,
                    opacity: pressed ? 0.7 : 1,
                  })}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 13,
                      fontWeight: selected ? '700' : '600',
                      color: selected ? OptionA.blue : OptionA.ink,
                    }}>
                    {project.name || '未命名项目'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Text style={{ marginTop: 4, fontSize: 13, fontWeight: '600', color: OptionA.inkSoft }}>第一条消息</Text>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          placeholder="描述要电脑端代理完成的事…"
          placeholderTextColor={OptionA.inkSoft}
          multiline
          textAlignVertical="top"
          style={{
            minHeight: 92,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: OptionA.fill,
            fontSize: 14,
            lineHeight: 20,
            color: OptionA.ink,
          }}
        />
        {error ? <Text style={{ fontSize: 13, color: OptionA.redInk }}>{error}</Text> : null}
      </View>

      <View style={{ paddingHorizontal: 18, paddingTop: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="创建会话"
          disabled={!canCreate}
          onPress={onCreate}
          style={({ pressed }) => ({
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: OptionA.blue,
            opacity: !canCreate ? 0.4 : pressed ? 0.8 : 1,
          })}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
            {creating ? '正在创建…' : '创建会话'}
          </Text>
        </Pressable>
      </View>
    </SheetShell>
  );
}
