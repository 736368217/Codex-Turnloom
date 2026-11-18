# Codex-Turnloom 一机一码协议规范（v2）

> 适用组件：机器网关 `server/machine-gateway.cjs`、Windows 托盘控制台、手机客户端。
> 本文所有 token、URL、机器名均为**占位示例**（`REPLACE_WITH_*` 或 `.example.com` 等明显假值），不含任何真实访问码、密钥或公网地址。

## 1. 版本与唯一实现

| 项 | 值 |
| :--- | :--- |
| 协议名 `PROTOCOL` | `codex-turnloom` |
| 版本 `VERSION` | `2`（「一机一码」v2） |
| 二维码 scheme / host / path | `codex-turnloom://pair/add` |
| 发现路径 `HARNESS_PATH` | `/api/harnesses` |
| 单台机器最多 harness 数 `MAX_HARNESSES` | 24 |
| token 最大长度 `MAX_TOKEN_LENGTH` | 256 |
| 机器名/标识最大长度 `MAX_NAME_LENGTH` | 120 |
| 协议编解码唯一实现 | `shared/machine-pairing.cjs`（Node 侧 CJS，无第三方依赖） |

`shared/machine-pairing.cjs` 导出 `machinePairingPayload`、`parseMachinePairingPayload`、
`normalizeDiscovery`、`normalizeHarnesses`、`normalizeBaseUrl`、`HARNESS_PATH`、
`PROTOCOL`、`VERSION`，以及 `QR_HOST`、`QR_ACTION`、`MACHINE_QR_PREFIX`、
`LEGACY_QR_PREFIX`、`MAX_HARNESSES`、`MAX_TOKEN_LENGTH`、`MAX_NAME_LENGTH`、
`QR_PARAMS`、`REQUIRED_QR_PARAMS`、`cleanString`、`machineIdentity`、
`machineDisplayName`、`firstValidUrl`、`isLegacyPayload`、`redactPairing`。
错误以 `{ ok:false, code, error }` 形式返回（`code` 为机器可读错误码，
如 `unsupported-version` / `machine-mismatch` / `machine-token-reuse`），
`redactPairing()` 提供日志脱敏副本，错误文本固定且**不回显 token**。


> **硬性规则：服务端/控制台/手机端都以此为准，不要各自复制一份解析逻辑。**
> 二维码拼装与解析、URL 归一化、发现响应校验、harness 表归一化在 Node 侧只能有这一份
> 实现；ESM 侧用 `createRequire(import.meta.url)` 引入，CJS 侧直接 `require`。
> 手机 Flutter 客户端在 `lib/turnloom/turnloom_hosts.dart` 镜像同样的字段规则（须与
> 本模块保持同步），但不得改写协议常量或放宽校验；复制一份正则、一份宽松的
> `new URL(...)` 判断，都会产生三端不一致的解析结果。

**术语**

| 术语 | 含义 |
| :--- | :--- |
| 机器访问码 `machineToken` | 二维码里携带的**机器级**凭据；仅用于 `GET /api/harnesses` 发现。 |
| `harness token` | 发现响应里每个 harness 自带的**路由级**凭据；用于该 harness 的全部 `/api/*` 请求。 |
| 机器网关 | `server/machine-gateway.cjs`，读取 `deploy/machine.json`，单端口对外，按 harness token 代理到各后端 `127.0.0.1` 端口，并守护后端进程。 |
| 后端 / harness | 一台机器上并行运行的 Codex 或 PI-Desktop 服务实例（各自有独立端口与数据目录）。 |

## 2. 机器二维码

**规范形式**（`machinePairingPayload()` 的输出）：

```
codex-turnloom://pair/add?v=2&protocol=codex-turnloom&machine=<显示名>&mid=<机器标识>&url=<http(s)根地址>&token=<机器访问码>&discover=/api/harnesses
```

示例（**全部为占位值**）：

```
codex-turnloom://pair/add?v=2&protocol=codex-turnloom&machine=Office+PC&mid=office-pc&url=https%3A%2F%2Fturnloom.example.com&token=REPLACE_WITH_RANDOM_MACHINE_TOKEN&discover=%2Fapi%2Fharnesses
```

**最低兼容形式**（6 个必填参数，`mid` 省略时以 `machine` 作为 `machineId`）：

```
codex-turnloom://pair/add?v=2&protocol=codex-turnloom&machine=office-pc&url=https%3A%2F%2Fturnloom.example.com&token=REPLACE_WITH_RANDOM_MACHINE_TOKEN&discover=%2Fapi%2Fharnesses
```

| 参数 | 必填 | 取值与校验 | 说明 |
| :--- | :--- | :--- | :--- |
| `v` | 是 | 必须严格等于字符串 `2` | 版本号；缺失或其它值返回 `unsupported-version` / `missing-parameter`。 |
| `protocol` | 是 | 必须等于 `codex-turnloom` | 与 URL scheme 共同防止把其它协议的码误解析。 |
| `machine` | 是 | 非空字符串、最长 120 字符、无控制字符 | **机器显示名**；缺失返回 `missing-parameter`，无效返回 `invalid-machine`。 |
| `mid` | 否（推荐填） | 稳定机器标识，同样有长度/控制字符校验 | `machinePairingPayload` 总是输出它。`machineId` 优先取 `mid`，否则回退 `machine`；须与发现响应 `machineId` 一致。 |
| `name` | 否 | 显示名别名，供旧字段兼容读取 | 允许的额外参数，不得重复。 |
| `url` | 是 | 经 `normalizeBaseUrl` 归一化后的 **http(s) origin** | 允许裸 `host[:port]`（补 `http://`）；拒绝带路径、查询、片段、userinfo、非 http(s) scheme 与超过 2048 字符的 payload。 |
| `token` | 是 | 非空、最长 256 字符、无控制字符 | 机器访问码（**不是**任何 harness token）。二维码等价于 bearer 凭据。 |
| `discover` | 是 | 必须恰好等于 `/api/harnesses` | 发现接口路径，防止把客户端引到任意 URL；缺失返回 `missing-parameter`。 |

**规范 QR 约束（解析端全部强制）**：前缀必须严格是 `codex-turnloom://pair/add?`（仅 scheme 大小写可放宽）；
`protocol === "codex-turnloom:"`、`host === "pair"`、`pathname === "/add"`；
参数**集合固定**为 `v, protocol, machine, mid, name, url, token, discover`，
未知参数（`unknown-parameter`）与重复参数（`duplicate-parameter`）一律拒绝；
不得带 userinfo 或 `#fragment`；整体长度 <= 2048 且不含控制字符。
任何不满足都由 `parseMachinePairingPayload` 返回 `{ ok:false, code, error }`，
客户端**不得保存任何凭据**。旧 `codexpocket://add` / `/login?token=` 由
`isLegacyPayload()` 判定为 `legacy-qr`，交给旧解析路径处理。

## 3. 发现接口

| 项 | 值 |
| :--- | :--- |
| 方法 / 路径 | `GET <url>/api/harnesses` |
| 鉴权头 | `x-access-token: <机器访问码>`（二维码里的 `token`） |
| 请求体 | 无 |
| 响应 | `application/json`，`ok:true` 时如下 |
| 用途 | 一次请求拿到这台机器上的**全部** harness 及其路由 token |

**响应字段表**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `ok` | boolean | 是 | 必须严格为 `true`（`ok !== true` → `invalid-response`）。 |
| `protocol` | string | 是 | 必须等于 `codex-turnloom`（否则 `invalid-protocol`）。 |
| `version` | number | 是 | 必须严格等于数字 `2`（不做 `Number()` 宽松转换）。 |
| `machineId` | string | **是** | 非空；必须**严格等于**二维码解析出的 `machineId`（即 `mid`，或回退 `machine`），否则 `machine-mismatch`；缺失返回 `invalid-machine`。 |
| `machineName` | string | 否 | 展示用机器名；若出现必须是字符串且无控制字符。 |
| `defaultHarnessId` | string / null | 否 | 若提供则必须是字符串，且指向某个存在的 harness；`normalizeHarnesses(list, defaultHarnessId)` 据此**重算并强制恰好一个** `defaultHarness:true`。 |
| `harnesses[]` | array | 是 | 非空、最多 24 项；`normalizeHarnesses` 遇到任何非法项会**抛错**（`normalizeDiscovery` 转成 `invalid-harnesses`），不允许「部分保存」。 |

`harnesses[]` 每项字段：

| 字段 | 类型 | 校验与说明 |
| :--- | :--- | :--- |
| `id` | string | 稳定标识；`normalizeHarnesses` 做小写化/非法字符替换、最长 64 字符、冲突时加后缀去重。 |
| `name` | string | 展示名，最长 80 字符；缺失回退 `label` / `key` / `id`；不得含控制字符。 |
| `token` | string | **该 harness 的路由凭据**；必须是字符串、非空、最长 256 字符、无控制字符，且**全表不得重复**（`harness token 重复` 直接抛错）。 |
| `kind` | string | 后端类型，如 `codex`；缺失回退 `codex`；不得含控制字符。 |
| `defaultHarness` | boolean | 仅 `true` 被视为真（严格布尔）；最终由 `defaultHarnessId` / 首项规则重算，保证恰好一个默认。 |
| `online` | boolean / null | 只能是布尔值或 `null`；缺失/`null` 归一化成 `null`，其它类型抛错。 |

> `normalizeDiscovery` 额外强制：多 harness 模式下任一 `harnesses[].token` 等于机器访问码时，
> 返回 `machine-token-reuse` 并拒绝保存（单 harness 兼容例外见 §6）。
> 校验通过前**不得**把任何凭据写入手机本地存储。

示例响应（**token 全部替换为占位符，仅示意结构与字段**）：

```json
{
  "ok": true,
  "protocol": "codex-turnloom",
  "version": 2,
  "machineId": "office-pc",
  "machineName": "Office PC",
  "defaultHarnessId": "codex",
  "harnesses": [
    {
      "id": "codex",
      "name": "Codex",
      "token": "REPLACE_WITH_CODEX_HARNESS_TOKEN",
      "kind": "codex",
      "defaultHarness": true,
      "online": true
    },
    {
      "id": "pidesk",
      "name": "PI-Desktop",
      "token": "REPLACE_WITH_PIDESK_HARNESS_TOKEN",
      "kind": "codex",
      "defaultHarness": false,
      "online": true
    }
  ]
}
```

> **私有字段不得出机**：`deploy/machine.json` 里的 `port`、`entry`、`codexHome`、
> `spawn`、`extraArgs` 只允许存在于机器本地配置，发现响应中不得出现。

## 4. 发现之后的请求

```
扫码 → GET <url>/api/harnesses（x-access-token: 机器访问码）
     → 手机在同一机器身份下保存 N 个连接，每个连接持有自己的 harness token
     → 后续 <url>/api/* 一律带 x-access-token: <对应 harness 的 token>
     → 机器网关按 token 路由到 127.0.0.1:<该 harness 的 port>
```

- 所有业务接口沿用同一根地址 `<url>` 与 `/api/*` 路径，客户端**不需要**为每个 harness 记不同主机/端口。
- **机器访问码本身只用于发现，不下发给 harness 请求**：网关在 `/api/harnesses` 之外的路径上不得接受机器访问码鉴权（单 harness 兼容例外见 §6）。
- 后端不可用时网关不得静默把请求回退到默认 harness，必须返回 502，避免把指令发错后端。

## 5. 错误码

| HTTP | 语义 | 触发场景 | 客户端处理 |
| :--- | :--- | :--- | :--- |
| `401` | 未知机器码 | `GET /api/harnesses` 的 `x-access-token` 缺失、错误、已轮换，或误把 harness token 当机器码 | 提示「机器访问码已失效，请重新扫码」；保留已保存连接，不清空本地数据；按限速退避重试。 |
| `502` | 后端不可用 | 发现成功后，某 harness 对应后端进程未启动、端口不通、代理超时 | 把该 harness 标为 `offline`，提示重试或「重新发现」；**不得**改用机器码重试，也不得回退到默认 harness。 |

补充约定（实现应遵守）：`400` 参数/二维码非法（客户端通常先用
`parseMachinePairingPayload` 本地拦截）、`403` 网关鉴权通过但操作被拒绝（如 `--readonly`）、
`404` 未知路径或未知 harness、网关正在拉起后端时 `503`、`429` 触发限速。
错误体建议形如 `{"ok":false,"error":"机器访问码无效"}`，**不得回显收到的 token**。

**客户端本地校验错误码**（`parseMachinePairingPayload` / `normalizeDiscovery` 的 `code`）：

| `code` | 含义 |
| :--- | :--- |
| `empty` / `invalid-qr` / `invalid-scheme` / `invalid-action` | 空码、非规范前缀、userinfo/片段/控制字符、scheme/host/path 不匹配。 |
| `unknown-parameter` / `duplicate-parameter` / `missing-parameter` | 参数集合不合规（未知项、重复项、缺必填项）。 |
| `legacy-qr` | 旧 `codexpocket://add` 或 `/login?token=`；交给旧流程，不要喂给 v2 解析。 |
| `unsupported-version` / `invalid-protocol` / `invalid-discover` | 版本、协议标识、发现路径不匹配。 |
| `invalid-server-url` / `invalid-token` / `invalid-machine` | URL / 机器访问码 / 机器名或标识不合规。 |
| `invalid-response` / `invalid-harnesses` / `invalid-default` | 发现响应结构或 harness 表非法（不得部分保存）。 |
| `machine-mismatch` / `machine-token-reuse` / `missing-pairing` | 机器身份不一致、多 harness 复用机器码、缺少配对上下文。 |

所有 `code` 对应固定文案且不回显 token；写日志前用 `redactPairing()` 脱敏。

## 6. 安全要求

1. **机器码与 harness token 分离**：`machineToken` 只在发现接口使用；`harnesses[].token`
   只用于该 harness 的业务请求。`deploy/machine.json` 中所有 harness token 必须互不相同，
   且不得等于 `machineToken`（本节第 6 点的兼容例外除外）。
2. **不得把机器码当 harness token**：v2 多 harness 部署中，网关在 `/api/*`（除发现接口）
   上必须拒绝 `machineToken`；模板里的 `REPLACE_WITH_*` 占位值不允许进入生产配置。
3. **恒时比较**：所有 token 比较用 `crypto.timingSafeEqual`，先把双方做 `sha256` 摘要成定长再比较；
   禁止 `===`、`includes()`、普通字符串 `localeCompare`。主服务 `server.js` 已有该模式，网关复用同一口径。
4. **限速**：按来源对「带了显式 token 但被拒绝」的请求限速（失败后指数退避、成功清零，
   例如 10 次失败后最长退避 30 分钟），`/api/harnesses` 与业务接口同样适用；cookie 会话轮询不计入。
5. **日志脱敏**：不得记录 `x-access-token`、二维码 payload、`machine.json` 原文或任何 token 明文；
   只记录 token 指纹（如 `sha256` 前 8 位）或掩码。二维码截图、错误上报、issue 里同样不得出现明文凭据。
6. **凭据保护**：二维码即 bearer 凭据；公网部署必须用 HTTPS 反向代理并配合 `--public-url`；
   配置文件权限 `0600`（Linux）/ 仅当前用户 ACL（Windows），不要提交到版本库。
7. **响应最小化**：发现响应只包含 §3 列出的公共字段，不泄漏本地端口、路径、启动参数。
8. **单 harness 兼容例外**：单 harness 部署时 `/api/harnesses` 返回 1 项，且
   `machineToken == accessCode`（即与唯一 harness 的 token 相同）。这是**显式声明的兼容配置**，
   除此之外禁止复用同一个值；网关仍不得把该码用于其它机器的路由。

## 7. 向后兼容

| 场景 | 规则 |
| :--- | :--- |
| 旧二维码 `codexpocket://add?name=&url=&token=` | **仍可用**（`scripts/print-device-qr.js`、`desktop/service/config.cjs` 等旧路径）。`isLegacyPayload()` 判定为 `legacy-qr`，`parseMachinePairingPayload` 返回该错误码并拒绝解析，必须由旧解析路径处理。 |
| `/login?token=` | **仍可用**：沿用既有访问码交换 HttpOnly 会话 cookie 的流程；手机端手动输入地址 + 访问码的路径保留。`isLegacyPayload()` 同样把它归入旧流程。 |
| `mid` 参数 | 规范 QR 新增的稳定机器标识；旧 v2 客户端若只识别 6 个必填参数，`machine` 会被当作 `machineId`，仍能连通。 |
| 旧客户端遇到 `codex-turnloom://pair/add` | 提示升级 App；**不得**降级为「每个 harness 一张二维码」。 |
| 单 harness 部署 | `/api/harnesses` 返回 1 项且 `machineToken == accessCode`；`normalizeDiscovery` 只在**多 harness** 时拒绝复用（`machine-token-reuse`）。v2 客户端仍走「扫码 → 发现 → 用 harness token 请求」，体验与旧版一致。 |
| 业务接口 | `/api/*` 的路径、参数、响应格式不变；v2 只是新增机器级发现层与路由层。 |

历史上「一台机器两个后端、每个 harness 一个访问码、手机扫两个二维码」的做法
（`turnloom-pidesktop/dual/server.js` 分流）由 v2 的**一次扫码 + 一次发现**取代；
旧部署不必立即迁移，两套入口可以并存。

## 8. 升级与轮换步骤

| 步骤 | 操作 | 手机端是否需要重新扫码 |
| :--- | :--- | :--- |
| 1. 备份 | 备份 `deploy/machine.json` / 安装后的配置（保持 `0600` 或原 ACL）与二维码截图；确认没有把 token 写进日志。 | — |
| 2. 新增 / 删除 harness | 编辑配置中的 `harnesses[]`，保证 id 唯一、token 互不相同且不等于 `machineToken`，`defaultHarness` 指向存在的 id；重启网关。 | 否，只需**重新发现**（`GET /api/harnesses`）。 |
| 3. 仅轮换 harness token | 用 `openssl rand -hex 24` 生成新值，替换对应 `token`；重启网关；旧 harness token 立即失效。 | 否，只需重新发现。 |
| 4. 轮换机器访问码 `machineToken` | 生成新随机值 → 写入配置 → 重启网关 → 用 `machinePairingPayload` 生成新机器二维码 → 手机重新扫码 → 确认全部手机可用 → 销毁旧二维码/截图。 | **是**，旧二维码立即失效。 |
| 5. 升级三端 | 先升网关与控制台（共用 `shared/machine-pairing.cjs` 的 `VERSION`），再升手机端；升级前后核对 `/api/health` 与 `/api/harnesses`。 | 通常否；若同时换了 `machineToken` 则是。 |
| 6. 应急撤销 | 停机或直接更换 `machineToken` 与相关 harness token；手机端清除已保存连接；复核日志中的 401 / 502 峰值。 | 是。 |

轮换顺序建议：先让网关支持新值 → 客户端重新发现 / 重新扫码 → 全部连通后再停止使用旧值。
任何一步都不要把旧 token 打印到控制台或写进日志文件。

## 9. 版本协商规则

| 检查点 | 规则 |
| :--- | :--- |
| 二维码 `v` | 必须严格等于字符串 `2`；`1`、`3`、缺失均拒绝（`unsupported-version` / `missing-parameter`），文案为「仅支持 v2 一机一码协议」。 |
| 二维码 `protocol` / scheme / host / path / 前缀 | 同时匹配 `codex-turnloom` / `codex-turnloom:` / `pair` / `/add` 与规范前缀 `codex-turnloom://pair/add?`。 |
| 参数集合 | 只允许 `v, protocol, machine, mid, name, url, token, discover`；必填 6 项齐全，未知项/重复项直接拒绝。 |
| 发现响应 | `ok === true`、`protocol === "codex-turnloom"`、`version === 2`（**严格数字**，不做 `Number()` 转换）；否则不保存任何凭据。 |
| 机器身份 | 响应 `machineId` 必填且必须严格等于二维码解析出的 `machineId`（`mid` 优先，否则 `machine`），否则 `machine-mismatch`。 |
| 未知字段 | 发现响应中的未知字段忽略（向前兼容），但二维码**不允许**未知参数；上述必填字段不得缺失。 |
| `discover` 参数 | 只允许 `/api/harnesses`；未来若更换发现路径，必须递增 `VERSION` 并发布新二维码。 |
| 旧码 | `isLegacyPayload()` 判为 `legacy-qr`，走旧连接流程；**禁止**静默降级到 v1、自动改写 `v` 重新扫码或按猜测字段解析。 |
| 未来版本（如 v3） | 明确报错并要求三端升级；错误 `code` 固定，不回显 token。 |
| 三端一致性 | 服务端、控制台、手机端都以 `shared/machine-pairing.cjs` 的 `PROTOCOL` / `VERSION` / `HARNESS_PATH` / `QR_PARAMS` 为准，不在各处硬编码 `"2"` 或 `"/api/harnesses"`；Flutter 侧镜像字段规则须同步。 |

---

相关文档：`docs/INSTALL.zh-CN.md`（三端安装与发布矩阵）、`deploy/machine.example.json`
（网关配置模板）、`installer/README.md`（Windows 安装包与计划任务）。
