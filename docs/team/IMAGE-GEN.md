# 生图渠道与用法（image2.6）

## 渠道

- Base `https://susu.wiki/v1`，模型名 `image2.6`，OpenAI 兼容 `POST /images/generations`。
- 密钥只放两处：环境变量 `SUSU_API_KEY`，或本机 `%USERPROFILE%\Desktop\认证\susu-image-token.txt`。**不进仓库、不进 Thread、不进日志、不进命令行参数**（`scripts/gen-image.mjs` 从 env 读）。
- 2026-11-20 状态：Human 在主对话给的 key 已被站点作废。站点原话：「全部旧 Key 已作废。站点出了问题，非常抱歉。请登录 https://susu.wiki 重新创建 Key，不用再买解锁卡。」`GET /v1` 就返回这段 401，三种鉴权形状（Bearer / raw / `x-api-key`）结果一致，`GET https://susu.wiki/` 本身 200 —— 是 key 的问题，不是网络或端点。
- `scripts/gen-image.mjs` 已写好，**尚未对活接口跑通**；拿到新 key 后第一件事是跑一张 smoke，再让下游依赖它。

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
