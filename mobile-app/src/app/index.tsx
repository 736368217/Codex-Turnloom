import { Text, View } from 'react-native';

import { OptionA } from '@/constants/optionA';

export default function HomePlaceholder() {
  return (
    <View style={{ flex: 1, backgroundColor: OptionA.canvas, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: OptionA.ink }}>Turnloom</Text>
    </View>
  );
}
