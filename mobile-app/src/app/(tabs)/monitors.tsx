import { Text, View } from 'react-native';

import { EmptyState } from '@/components/ui';

export default function MonitorsScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7', paddingTop: 64 }}>
      <Text style={{ fontSize: 30, fontWeight: '700', color: '#1C1C1E', paddingHorizontal: 20 }}>Monitors</Text>
      <EmptyState title="实时监控" hint="会话运行态在详情页实时刷新" />
    </View>
  );
}
