import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { OptionA } from '@/constants/optionA';
import { DragHandle } from './ui';
import { useTerminalSelection } from '@/services/appState';
import { createRetryKey } from '@/services/threadGuards';
import { getTurnloomClient, uuid } from '@/services/turnloomClient';
import type { Project, SendResult } from '@/services/types';

export type NewTaskSheetHandle = { present: () => void; dismiss: () => void };
type Props = { readOnly: boolean; onCreated: (result: SendResult) => void | Promise<void> };
const client = getTurnloomClient();


export const NewTaskSheet = forwardRef<NewTaskSheetHandle, Props>(function NewTaskSheet({ readOnly, onCreated }, ref) {
  const sheet = useRef<BottomSheetModal>(null);
  const inFlight = useRef(false);
  const retryKey = useRef(createRetryKey(uuid)).current;
  const { terminal } = useTerminalSelection();
  const [message, setMessage] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useImperativeHandle(ref, () => ({
    present: () => {
      setError('');
      sheet.current?.present();
      void client.getProjects().then((result) => setProjects(result.projects || [])).catch(() => setProjects([]));
    },
    dismiss: () => sheet.current?.dismiss(),
  }));

  const submit = async () => {
    const text = message.trim();
    if (!text || readOnly || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    let result: SendResult | null = null;
    try {
      const clientRequestId = retryKey.get({ threadId: `new:${terminal?.id || ''}`, message: text, mode: projectId });
      result = await client.sendMessage({ message: text, newThread: true, ...(projectId ? { projectId } : {}), clientRequestId });
      if (result.ok === false) { result = null; throw new Error('创建失败，请重试'); }
      setMessage('');
      setProjectId('');
      retryKey.clear();
      sheet.current?.dismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败，请重试');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    if (result) {
      // Navigation/refresh runs after the sheet has closed; a failure here must
      // not become an unhandled rejection or discard the user's draft silently.
      try { await onCreated(result); } catch (caught) {
        setError(caught instanceof Error ? caught.message : '任务已创建，但打开会话失败');
        sheet.current?.present();
      }
    }
  };

  return (
    <BottomSheetModal
      ref={sheet}
      snapPoints={['60%', '90%']}
      enableDynamicSizing={false}
      enablePanDownToClose={!pending}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: OptionA.card }}
      handleComponent={() => <DragHandle />}
      backdropComponent={(props) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} pressBehavior={pending ? 'none' : 'close'} />}>
      <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}>
        <Text style={{ color: OptionA.ink, fontSize: 20, fontWeight: '700' }}>新建任务</Text>
        <BottomSheetTextInput
          accessibilityLabel="任务内容"
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={12000}
          placeholder="描述要交给电脑的任务"
          placeholderTextColor={OptionA.inkSoft}
          editable={!pending && !readOnly}
          style={{ minHeight: 112, maxHeight: 220, textAlignVertical: 'top', borderRadius: 12, backgroundColor: OptionA.fill, padding: 12, color: OptionA.ink, fontSize: 16 }}
        />
        {projects.length ? <Text style={{ color: OptionA.inkSoft, fontSize: 13, fontWeight: '600' }}>项目</Text> : null}
        {projects.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[{ id: '', name: '默认项目' }, ...projects].map((project) => (
              <Pressable
                key={project.id || 'default'}
                accessibilityRole="button"
                accessibilityState={{ selected: projectId === project.id, disabled: pending }}
                disabled={pending}
                onPress={() => setProjectId(project.id)}
                style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: projectId === project.id ? '#E5F1FF' : OptionA.fill }}>
                <Text style={{ color: projectId === project.id ? OptionA.blue : OptionA.ink, fontSize: 14 }}>{project.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {readOnly ? <Text style={{ color: OptionA.redInk, fontSize: 13 }}>当前电脑处于只读模式</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: OptionA.redInk, fontSize: 13 }}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="开始任务"
          accessibilityState={{ disabled: pending || readOnly || !message.trim() }}
          disabled={pending || readOnly || !message.trim()}
          onPress={() => void submit()}
          style={{ minHeight: 48, borderRadius: 12, backgroundColor: OptionA.blue, opacity: pending || readOnly || !message.trim() ? 0.5 : 1, alignItems: 'center', justifyContent: 'center' }}>
          {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>开始任务</Text>}
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
