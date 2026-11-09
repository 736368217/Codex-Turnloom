/**
 * 根 Expo Router Stack（light-only）。
 * (tabs) 三个一级页各自在页内渲染唯一大标题，因此彻底隐藏根 Stack 的
 * 透明大标题（headerShown:false），避免与页内「对话/终端管理/设置」重叠裁切。
 * thread/[id] 详情页保留紧凑返回头，不受影响。
 */
import '@/services/demoBootstrap';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccessCodeSheet } from '@/components/AccessCodeSheet';
import { TerminalProvider } from '@/services/appState';
import { OptionA } from '@/constants/optionA';

import '@/../global.css';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: OptionA.canvas }}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <TerminalProvider>
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
                }}
              />
              <Stack.Screen
                name="thread/[id]"
                options={{
                  title: '会话详情',
                  headerLargeTitleEnabled: false,
                  headerTransparent: false,
                }}
              />
            </Stack>
          </ThemeProvider>
          <AccessCodeSheet />
          </TerminalProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
