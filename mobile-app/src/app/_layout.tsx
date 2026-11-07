/**
 * Root Expo Router stack. Light-only by constitution.
 * The Home tab uses a native iOS large title with a system chrome material
 * light blur header; the thread detail uses a compact standard header.
 */
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
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
        <BottomSheetModalProvider>
          <ThemeProvider value={DefaultTheme}>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: OptionA.canvas },
                headerStyle: { backgroundColor: OptionA.canvas },
                headerTintColor: OptionA.blue,
                headerTitleStyle: { color: OptionA.ink },
                headerShadowVisible: false,
                headerLargeTitleEnabled: false,
              }}>
              <Stack.Screen
                name="(tabs)"
                options={{
                  headerShown: false,
                  // Native large title + translucent chrome-material-light blur.
                  headerLargeTitle: true,
                  headerBlurEffect: 'systemChromeMaterialLight',
                  headerTransparent: true,
                }}
              />
              <Stack.Screen
                name="thread/[id]"
                options={{
                  title: '会话详情',
                  headerLargeTitleEnabled: false,
                  headerBlurEffect: 'systemChromeMaterialLight',
                  headerTransparent: true,
                }}
              />
            </Stack>
          </ThemeProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
