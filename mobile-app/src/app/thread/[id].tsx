/** Placeholder replaced by the full remote-control screen in phase 3. */
import { Text, View } from 'react-native';

import { OptionA } from '@/constants/optionA';

export default function ThreadScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: OptionA.canvas, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: OptionA.ink }}>会话详情</Text>
    </View>
  );
}
