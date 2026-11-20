# 生图渠道与用法（image2.6）

## 渠道

- Base `https://susu.wiki/v1`，OpenAI 兼容 `POST /images/generations`。
- 可用模型（2026-11-20 用 `GET /v1/models` 读到，共 9 个）：`gpt-image-2.6-sunburst`、`gpt-image-2.6-flare`、`gpt-image-2.6`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2.5`、`gpt-image-2-exact`、`gpt-image-2`、`gpt-image-1k-th`。**没有叫 `image2.6` 的**，`gpt-image-2.6` 这一代才是 Human 说的那个。
- 默认用 **`gpt-image-2.6-flare`**：同一提示词下最平、最接近我们的浅色 Cupertino 风格（`sunburst` 更饱和、边缘更硬，适合「产品主视觉」那种需要能量的地方；底座 `gpt-image-2.6` 介于两者之间）。
- 实测：1024×1024、约 **18–27 秒**/张，返回 `b64_json`，PNG 约 **0.7–0.85 MB**（进仓库前必须压到 ≤200 KB）。
- 密钥只放两处：环境变量 `SUSU_API_KEY`，或本机 `%USERPROFILE%\Desktop\认证\susu-image-token.txt`。**不进仓库、不进 Thread、不进日志、不进命令行参数**（`scripts/gen-image.mjs` 从 env 读）。
- 2026-11-20：Human 给的 key 曾被站点整体作废（401「全部旧 Key 已作废」），同日重新启用后实测可用；`scripts/gen-image.mjs --model gpt-image-2.6-flare --prompt ... --out ...` 已跑通。

## 用在哪

适用：
- 连接页 / 首次启动的整幅插画（手机与电脑"连着"的隐喻）；
- 空状态：没有会话、没有设备、没有运行中的任务；
- 更新说明、发布公告的配图；
- 设计报告里的示意插图。

不适用：
- **图标**——已统一 Lucide，生图图标只会毁掉一致性；
- **图里排中文**——模型渲染文字不可靠，必错；
- **替代真实截图**——截图必须来自模拟器/真机，不能是生成的。

## 落盘

`app/src/assets/art/<slot>-<variant>.png`，组件里 `import`（Vite 做 hash；`app/vite.config` 里 `assetsInlineLimit: 0`，不会内联进 JS）。

- hero 1024×1024 或 1536×1024，空状态 512×512；
- 单张 ≤ 200 KB，PNG；
- 一张图只服务一个槽位，不做「一张图哪儿都用」。
- **别指望模型给准色**：提示词里写 `#007AFF`，实测出的是 `rgb(0,73,223)` ≈ `#0049DF`，差一档会看着像 navy。单色线稿的做法是**按 alpha 保留、把 RGB 全刷成品牌色**（一次像素映射即可，边沿抗锯齿不丢），比反复重出可靠；彩色图则只做轻微色相偏移校正。

## 提示词配方（五段）

1. **主体**：一句话说清画什么。例：`a phone and a laptop linked by a thin curved line`。
2. **风格**：`flat vector illustration, soft shadows, minimal, Cupertino light palette (#F2F2F7 canvas, #007AFF accent, #E9E9EB separators)`。
3. **构图**：`centered subject, generous negative space, 1:1`（或按槽位给比例）。
4. **光与材质**：`matte surfaces, no gradients behind the subject, subtle depth`。
5. **约束**：`no text, no letters, no logo, no watermark, no photorealism, no faces`。

## 迭代纪律

- 一次只改一个变量（主体 / 风格 / 构图 / 约束），否则说不清哪句起了作用。
- 每轮出 4 张选 1；把 prompt 原文与产出文件名记进 `prompt.log`。
- 图进仓库时，最终 prompt 写进提交信息——下一个人要改图，先看得到它是怎么来的。
