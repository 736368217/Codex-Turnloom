/** Placeholder tab screens — real content lives in Home and the thread detail. */
import { Text, View } from 'react-native';

import { EmptyState } from '@/components/ui';

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7', paddingTop: 64 }}>
      <Text style={{ fontSize: 30, fontWeight: '700', color: '#1C1C1E', paddingHorizontal: 20 }}>{title}</Text>
      <EmptyState title={hint} />
    </View>
  );
}

export default function ThreadsScreen() {
  return <Placeholder title="Project · Threads" hint="会话列表在 Home 中展示" />;
}
