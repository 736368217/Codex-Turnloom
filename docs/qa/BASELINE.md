# 基线（2026-11-18 16:37）

commit: 6fbc3ef
node/npm/java:
- node: v24.22.3
- npm: 11.19.1
- java: openjdk version "21.0.12.1" 2026-08-18 LTS
- adb: C:\Users\Administrator\tools\platform-tools\adb.exe
- C:\Users\Administrator\tools\android-sdk: EXISTS

| 命令 | 退出码 | 耗时 | 结果摘要 |
| --- | ---: | ---: | --- |
| `npm test` | 1 | 6.977s | 失败：2 个测试因 `dist-native\delivery.html` 不存在而报 ENOENT |
| `npm run check` | 0 | 1.321s | 通过：所有 JS 文件语法检查通过 |
| `npm run app:typecheck` | 0 | 3.302s | 通过：`tsc --noEmit` 无错误 |
| `npm run app:build` | 0 | 5.428s | 通过：Vite 生产构建完成，存在 chunk > 500 kB 警告 |
| `npm run desktop:check` | 0 | 1.927s | 通过：desktop JS 文件语法检查通过 |

通过：4 条；失败：1 条。

## 失败详情

### npm test（最后 30 行）

```text
      at TestContext.<anonymous> (D:\Turn-DSH\Codex-Turnloom\test\native-client-baseline.test.cjs:34:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    errno: -4058,
    code: 'ENOENT',
    syscall: 'open',
    path: 'D:\\Turn-DSH\\Codex-Turnloom\\dist-native\\delivery.html'
  }

test at test\native-client-baseline.test.cjs:40:1
✖ delivery page identifies the RN client and rejects the Flutter one-code experiment (0.2986ms)
  Error: ENOENT: no such file or directory, open 'D:\Turn-DSH\Codex-Turnloom\dist-native\delivery.html'
      at Object.readFileSync (node:fs:483:20)
      at read (D:\Turn-DSH\Codex-Turnloom\test\native-client-baseline.test.cjs:9:31)
      at TestContext.<anonymous> (D:\Turn-DSH\Codex-Turnloom\test\native-client-baseline.test.cjs:41:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:7)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    errno: -4058,
    code: 'ENOENT',
    syscall: 'open',
    path: 'D:\\Turn-DSH\\Codex-Turnloom\\dist-native\\delivery.html'
  }
```
