/**
 * Root Expo Router stack. Light-only by constitution.
 * Phase 2 replaces the tab group; phase 3 adds the thread detail route.
 */
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';

import '@/../global.css';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: OptionA.canvas }}>
      <SafeAreaProvider>
        <ThemeProvider value={DefaultTheme}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: OptionA.canvas },
              headerStyle: { backgroundColor: OptionA.canvas },
              headerTintColor: OptionA.blue,
              headerTitleStyle: { color: OptionA.ink },
              headerShadowVisible: false,
            }}>
            <Stack.Screen name="index" options={{ title: 'Turnloom' }} />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
