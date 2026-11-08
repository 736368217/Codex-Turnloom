/**
 * 轻量本地键值存储：原生走 expo-secure-store，Web 预览走 localStorage。
 * 与 services/pairing.ts 保持同一套平台判定，避免 expo export web 时报错。
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const PREFIX = 'turnloom.ia.v4.';

function webGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 隐私模式下存储不可用，内存态仍可工作 */
  }
}

function webRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export async function localGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webGet(key);
  try {
    return await SecureStore.getItemAsync(PREFIX + key);
  } catch {
    return null;
  }
}

export async function localSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(PREFIX + key, value);
  } catch {
    /* ignore */
  }
}

export async function localRemove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webRemove(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(PREFIX + key);
  } catch {
    /* ignore */
  }
}
