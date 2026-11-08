/**
 * V7 离线演示开关（默认关闭）。
 * 只有构建时带 EXPO_PUBLIC_TURNLOOM_DEMO=1 才注入离线演示数据层；
 * 正式 APK 完全不加载 demo 脚本、fetch 不 patch、行为不变。
 *
 * 演示包：patch globalThis.fetch 接管所有 /api/* 请求，用内存演示数据应答，
 * 同时给 pairing/appState 提供「离线演示 · 本机」预置终端，跳过冷启动选终端页。
 */
declare global {
  // eslint-disable-next-line no-var
  var __TURNLOOM_DEMO_API__: {
    install: () => void;
    seedStorage: () => void;
    route: (method: string, url: string, body: unknown) => unknown;
    state: Record<string, unknown>;
    pairing: { serverUrl: string; token: string; machineName: string };
  } | undefined;
  // eslint-disable-next-line no-var
  var __TURNLOOM_DEMO__: unknown;
}

export const DEMO_MODE = process.env.EXPO_PUBLIC_TURNLOOM_DEMO === '1';

export const DEMO_PAIRING = {
  serverUrl: 'http://demo.invalid',
  token: 'demo',
  machineName: '离线演示 · 本机',
} as const;

if (DEMO_MODE) {
  // 静态 import 保证打包时 demo 数据层进入 bundle，且在业务代码前执行。
  require('./offlineDemo.js');
  const api = globalThis.__TURNLOOM_DEMO_API__;
  if (api) {
    api.install();
    api.seedStorage();
  }
}

export const DEMO_LABEL = '离线演示 · 演示数据 · 无需联网';
