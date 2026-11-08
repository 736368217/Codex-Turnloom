/* ============================================================================
 * Codex-Turnloom Option A · 离线演示数据层（V7 / shared）
 * ----------------------------------------------------------------------------
 * 目标：零联网、自包含。拦截 window.fetch，用内存演示数据应答所有 /api/*。
 * 业务代码（React Web / Expo RN）一行不改，所有页面与功能真实可点、有状态反馈。
 *
 * 这份文件是「单一数据源」，Web 演示 APK 与 RN 演示 APK 都用它；由打包脚本分别
 * 内联进 HTML / 注入 JS bundle，不产生任何外部请求。
 *
 * 覆盖：会话列表（多状态）、消息流（代码块/工具调用/审批/Diff/图片）、
 *       排队 queue、插队 steer、带图附件 images[]、中断、审批、队列管理、
 *       新建会话、项目、账户、健康、长轮询 changes。
 * ========================================================================== */
(function (global) {
  'use strict';

  var now = Date.now();
  // RN 客户端用 /^[0-9a-fA-F-]{20,}$/ 校验会话 id，演示 id 必须是纯 hex/连字符。
  // Web 与 RN 两端共用同一实现，避免数据不一致。
  var tid = function (n) {
    var hex = String(n).replace(/[^0-9a-fA-F]/g, '').toLowerCase() || '1';
    return '00000000-0000-4000-8000-' + ('000000000000' + hex).slice(-12);
  };
  var T = {
    RUNNING: tid(1),    // 运行中（busy，排队/插队/中断场景）
    APPROVAL: tid(2),   // 等待审批
    ENDED: tid(3),      // 已完成（带代码块 / Diff / 图片）
    EMPTY: tid(4),      // 空会话（展示空状态 + 直接发第一条）
    QUEUED: tid(5),     // 有排队消息（队列长度）
    PINNED: tid(6),     // 置顶已归档
  };

  function iso(msAgo) { return new Date(now - msAgo).toISOString(); }
  function line(role, kind, content, extra) {
    var m = {
      id: null, role: role, kind: kind || 'message', timestamp: iso(120000),
      content: content, turnId: 'turn-demo', lineNumber: 1,
    };
    if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
    return m;
  }

  // ---- 会话列表 -------------------------------------------------------------
  var threads = [
    { id: T.RUNNING, title: '修复登录网关超时', preview: '已定位到反向代理 readTimeout，正在补充回归测试', cwd: 'D:/work/gateway', updatedAtMs: now - 60000, createdAtMs: now - 3600000, pinned: true, project: { name: '网关重构' },
      status: { state: 'running', thinking: true, interactionRequired: false, turnId: 'turn-demo-1', startedAtMs: now - 42000, staleTurn: false, queueLength: 0 } },
    { id: T.APPROVAL, title: '等待审批：数据库迁移脚本', preview: '需要在桌面端确认执行 ALTER TABLE', cwd: 'D:/work/api', updatedAtMs: now - 180000, createdAtMs: now - 7200000, pinned: false, project: null,
      status: { state: 'waiting', thinking: false, interactionRequired: true, turnId: null, startedAtMs: null, staleTurn: false, queueLength: 0 } },
    { id: T.ENDED, title: '首页性能优化', preview: '首屏 LCP 从 3.2s 降到 1.4s', cwd: 'D:/work/web', updatedAtMs: now - 3600000, createdAtMs: now - 86400000, pinned: false, project: { name: '前端体验' },
      status: { state: 'ended', thinking: false, interactionRequired: false, turnId: null, startedAtMs: null, staleTurn: false, queueLength: 0 } },
    { id: T.QUEUED, title: '补一组边界用例', preview: '排队了 2 条追加指令，等待当前任务结束后依次执行', cwd: 'D:/work/api', updatedAtMs: now - 7200000, createdAtMs: now - 90000000, pinned: false, project: null,
      status: { state: 'running', thinking: true, interactionRequired: false, turnId: 'turn-demo-2', startedAtMs: now - 90000, staleTurn: false, queueLength: 2,
        queuedMessages: [
          { id: 'q1', text: '再补一个并发场景的用例', deliveryState: 'queued', position: 1 },
          { id: 'q2', text: '跑完把覆盖率报告发我', deliveryState: 'queued', position: 2 },
        ] } },
    { id: T.EMPTY, title: '新建的空白会话', preview: '', cwd: 'D:/work/scratch', updatedAtMs: now - 86400000, createdAtMs: now - 86400000, pinned: false, project: null,
      status: { state: 'ended', thinking: false, interactionRequired: false, turnId: null, startedAtMs: null, staleTurn: false, queueLength: 0 } },
    { id: T.PINNED, title: '文档整理', preview: 'README 与部署说明已同步', cwd: 'D:/work/docs', updatedAtMs: now - 172800000, createdAtMs: now - 172800000, pinned: true, project: null,
      status: { state: 'ended', thinking: false, interactionRequired: false, turnId: null, startedAtMs: null, staleTurn: false, queueLength: 0 } },
  ];

  // ---- 每个会话的消息流 -----------------------------------------------------
  var CODE_FENCE = [
    '定位到 `src/gateway/proxy.ts` 的 readTimeout 过短。建议改为 60000，并新增超时回归用例。',
    '',
    '```ts',
    'export function proxyConfig(env: Env) {',
    '  return {',
    '    readTimeout: 60_000,      // 原 30_000，网关上游偶发慢响应',
    '    connectTimeout: 5_000,',
    '    retries: 2,',
    '  };',
    '}',
    '```',
    '',
    '已按 iOS 日光雾白风格更新按钮配色：',
    '',
    '```css',
    '.ios-btn-primary {',
    '  background: linear-gradient(170deg, #3395ff, #007aff);',
    '  border-radius: 999px;',
    '}',
    '```',
  ].join('\n');

  var messages = {};
  messages[T.RUNNING] = [
    line('user', 'message', '帮我修复登录网关的超时问题，并补一组回归测试。'),
    line('tool', 'tool_call', 'rg "timeout" src/gateway', { title: 'exec_command' }),
    line('tool', 'tool_output', 'src/gateway/proxy.ts:42:  readTimeout: 30000\nsrc/gateway/proxy.ts:88:  connectTimeout: 5000', { title: 'tool_output' }),
    line('assistant', 'message', '思考中：超时来自反向代理的 readTimeout 与上游连接池不匹配，需要同时调整并补压测。', { phase: 'commentary' }),
    line('assistant', 'message', CODE_FENCE, { phase: 'commentary' }),
    line('interaction', 'approval', 'Prompt: 应用以下补丁？\n\nCommand: apply_patch\nPath: src/gateway/proxy.ts\n\n@@ -39,7 +39,7 @@\n-  readTimeout: 30000,\n+  readTimeout: 60000,', { title: '补丁审批请求', requestId: 'req-demo-001', approvalKind: 'file', canApprove: true, requiresDesktopAction: true }),
  ];
  messages[T.APPROVAL] = [
    line('user', 'message', '给 users 表加一个 last_login_at 字段，做一次迁移。'),
    line('assistant', 'message', '已生成迁移脚本，需要你确认后才会执行：'),
    line('assistant', 'message', '```sql\nALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;\nCREATE INDEX idx_users_last_login ON users(last_login_at);\n```'),
    line('interaction', 'approval', 'Prompt: 是否执行数据库迁移？\n\nCommand: apply_patch\nPath: migrations/0042_add_last_login.sql', { title: '数据库迁移审批', requestId: 'req-demo-002', approvalKind: 'command', canApprove: true, requiresDesktopAction: false }),
  ];
  messages[T.ENDED] = [
    line('user', 'message', '首页太慢，帮我看看 LCP。'),
    line('tool', 'tool_call', 'lighthouse --only-categories=performance', { title: 'exec_command' }),
    line('tool', 'tool_output', 'LCP: 3.2s  |  TBT: 410ms  |  CLS: 0.08', { title: 'tool_output' }),
    line('assistant', 'message', '```ts\n// 首屏图片改为预加载 + 响应式\n<link rel="preload" as="image" href="/hero.webp" />\n```\n\n调整后 **LCP 3.2s → 1.4s**，TBT 410ms → 120ms。', { images: ['data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiIGZpbGw9IiNlZ2Y0ZmUiLz48dGV4dCB4PSI2MCIgeT0iMzUiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiMwMDdBZkYiPkxDUCDmmL7npLozouAgMTpQMOeOiA8L3RleHQ+PC9zdmc+'] }),
  ];
  messages[T.QUEUED] = [
    line('user', 'message', '补一组边界用例，覆盖空输入和超长输入。'),
    line('assistant', 'message', '正在补齐，已排队 2 条追加指令等待执行。', { phase: 'commentary' }),
  ];
  messages[T.EMPTY] = [];
  messages[T.PINNED] = [
    line('user', 'message', '整理一下 README 和部署说明。'),
    line('assistant', 'message', '已同步 README.md 与 docs/deploy.md，补充了环境变量表与回滚步骤。'),
  ];

  var diffs = {};
  diffs[T.RUNNING] = {
    repo: 'D:/work/gateway', clean: false,
    files: [{ path: 'src/gateway/proxy.ts', status: 'modified', additions: 3, deletions: 2, binary: false }],
    diff: 'diff --git a/src/gateway/proxy.ts b/src/gateway/proxy.ts\n--- a/src/gateway/proxy.ts\n+++ b/src/gateway/proxy.ts\n@@ -39,9 +39,10 @@\n export function proxyConfig(env: Env) {\n   return {\n-    readTimeout: 30000,\n+    readTimeout: 60_000,\n     connectTimeout: 5000,\n-    retries: 0,\n+    retries: 2,\n+    poolSize: env.poolSize ?? 16,\n   };\n }',
  };
  diffs[T.ENDED] = {
    repo: 'D:/work/web', clean: false,
    files: [{ path: 'src/pages/home.tsx', status: 'modified', additions: 2, deletions: 1, binary: false }],
    diff: 'diff --git a/src/pages/home.tsx b/src/pages/home.tsx\n--- a/src/pages/home.tsx\n+++ b/src/pages/home.tsx\n@@ -1,5 +1,6 @@\n export default function Home() {\n   return (\n-    <img src="/hero.png" />\n+    <link rel="preload" as="image" href="/hero.webp" />\n+    <img src="/hero.webp" loading="eager" />\n   );\n }',
  };

  // ---- 运行时状态（写操作真的改这里）---------------------------------------
  var state = {
    allowWrite: true,
    revision: 1,
    sent: 0, interrupted: 0, approvals: 0, queueActions: 0, authSessions: 0,
    lastSend: null,
    log: [],
  };

  function findThread(id) {
    for (var i = 0; i < threads.length; i++) if (threads[i].id === id) return threads[i];
    return null;
  }
  function messageList(id) {
    if (!messages[id]) messages[id] = [];
    return messages[id];
  }
  function statusOf(id) {
    var t = findThread(id);
    var base = t ? (t.status || {}) : {};
    return {
      thinking: Boolean(base.thinking), interactionRequired: Boolean(base.interactionRequired),
      turnId: base.turnId || null, startedAtMs: base.startedAtMs || null,
      queueLength: base.queueLength || 0,
      queuedMessages: base.queuedMessages || [],
      state: base.state || 'ended', staleTurn: false,
      possibleDesktopAttention: false,
    };
  }
  function record(method, path, body) {
    state.log.push({ at: new Date().toISOString(), method: method, path: path, body: body || null });
    if (state.log.length > 200) state.log.shift();
  }

  // 模拟代理「思考一会儿后自动完成」，让 busy → 空闲这个变化看得见
  function scheduleTurnEnd(id, delayMs) {
    setTimeout(function () {
      var t = findThread(id);
      if (!t || !t.status || !t.status.thinking) return;
      t.status.thinking = false;
      t.status.state = 'ended';
      t.status.startedAtMs = null;
      t.updatedAtMs = Date.now();
      messageList(id).push(line('assistant', 'message', '已完成本轮处理' + (state.sent ? '，你刚才的指令我已收到并纳入。' : '。'), { phase: 'commentary' }));
      state.revision++;
    }, delayMs || 14000);
  }

  function send(body) {
    var id = body.threadId || T.RUNNING;
    var text = String(body.message || '').trim();
    var imgs = Array.isArray(body.images) ? body.images : [];
    if (!text && !imgs.length) return { ok: false, error: '消息内容为空' };
    var mode = String(body.mode || 'start');
    state.sent++;
    state.lastSend = { mode: mode, message: text, images: imgs.length, at: Date.now() };
    record('POST', '/api/send', body);

    if (mode === 'queue' || mode === 'steer') {
      // 排队/插队：追加一条系统回执，队列长度 +1，不打断当前任务
      var t = findThread(id);
      if (t && t.status) {
        t.status.queueLength = (t.status.queueLength || 0) + 1;
        var q = t.status.queuedMessages || (t.status.queuedMessages = []);
        q.push({ id: 'q' + (q.length + 1), text: text || ('[图片 ×' + imgs.length + ']'), deliveryState: 'queued', position: q.length + 1 });
      }
      messageList(id).push(line('notice', 'message',
        mode === 'steer'
          ? '⚡ 已直接插入当前任务：' + (text || '[图片]') + (imgs.length ? '（含 ' + imgs.length + ' 张图片）' : '')
          : '已加入队列，将在当前任务结束后执行：' + (text || '[图片]') + (imgs.length ? '（含 ' + imgs.length + ' 张图片）' : ''),
        { title: mode === 'steer' ? '插队成功' : '排队成功', phase: 'commentary' }));
    } else {
      messageList(id).push(line('user', 'message', text, imgs.length
        ? { images: imgs.map(function (im) { return 'data:' + (im.mimeType || 'image/png') + ';base64,' + String(im.data || '').slice(0, 64); }) }
        : {}));
      if (imgs.length) {
        messageList(id).push(line('notice', 'message', '已收到 ' + imgs.length + ' 张图片附件', { title: '附件' }));
      }
      // 给一条助理回执，让「发送 → 消息流更新」立刻可见
      setTimeout(function () {
        messageList(id).push(line('assistant', 'message',
          '收到指令：' + (text || '[图片]') + '。这是离线演示数据，我会把它当作一条真实的后续任务来处理。',
          { phase: 'commentary' }));
        var th = findThread(id);
        if (th) { th.updatedAtMs = Date.now(); th.preview = text || '[图片]'; }
        state.revision++;
      }, 900);
    }
    var th2 = findThread(id);
    if (th2) { th2.updatedAtMs = Date.now(); th2.preview = text || '[图片]'; }
    state.revision++;
    return { ok: true, mode: mode, threadId: id, turnId: 'turn-demo-' + state.sent, sent: true, sentAt: new Date().toISOString(), images: imgs.map(function (i) { return i.name; }) };
  }

  // ---- 路由：把 /api/* 映射到演示数据 --------------------------------------
  function route(method, rawUrl, body) {
    var u = String(rawUrl || '');
    var path = u;
    var query = '';
    var qi = u.indexOf('?');
    if (qi >= 0) { path = u.slice(0, qi); query = u.slice(qi + 1); }
    // 允许绝对 URL（RN 端 buildUrl 会拼 http://...）；只取 /api/ 之后的部分
    var ai = path.indexOf('/api/');
    if (ai >= 0) path = path.slice(ai);
    body = body || {};
    record(method, path, body);

    // 健康
    if (method === 'GET' && path === '/api/health') {
      return { status: 200, body: {
        ok: true, backend: { kind: '离线演示数据', label: '离线演示数据', demo: true }, profile: { id: 'demo', label: '离线演示', backend: 'demo' },
        authRequired: false, allowWrite: state.allowWrite, codexHome: 'demo://offline', codexHomeVersion: 1,
        models: [
          { id: 'gpt-5-codex', label: 'GPT-5 Codex', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', supportsImages: true },
          { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', supportsImages: true },
        ],
        defaultModel: 'gpt-5-codex', defaultEffort: 'medium', now: new Date().toISOString(),
        apkAvailable: false, apkUrl: '/api/apk', appVersionCode: 72, appVersionName: '1.20.0-demo',
        demo: true,
      } };
    }
    // 会话列表
    if (method === 'GET' && path === '/api/threads') {
      return { status: 200, etag: 'W/"demo-' + state.revision + '"', body: { threads: threads, total: threads.length, nextCursor: null, codexHome: 'demo', codexHomeVersion: 1 } };
    }
    // 消息流
    var mm = path.match(/^\/api\/threads\/([^/]+)\/messages$/);
    if (method === 'GET' && mm) {
      var id = decodeURIComponent(mm[1]);
      var t = findThread(id);
      if (!t) return { status: 404, body: { error: '会话不存在' } };
      return { status: 200, body: {
        thread: t, goal: null, meta: {}, file: null, size: 0, mtimeMs: Date.now(),
        status: statusOf(id), messages: messageList(id).slice(), totalMessages: messageList(id).length,
        truncated: false, hasOlderMessages: false, limit: 80, omittedMessages: 0, olderCursor: null, hiddenMessages: 0,
      } };
    }
    // 长轮询：写操作后第一次返回 changed:true，之后平稳 idle（不空转耗电）
    var cm = path.match(/^\/api\/threads\/([^/]+)\/changes$/);
    if (method === 'GET' && cm) {
      var changed = false;
      var cursorNum = (/cursor=(\d+)/.exec(query) || [])[1];
      var seen = Number(cursorNum || 0);
      if (state.revision > seen) changed = true;
      setTimeout(function () {}, 0);
      return { status: 200, body: { cursor: String(state.revision), changed: changed } };
    }
    // Diff
    if (method === 'GET' && path === '/api/host/diff') {
      var thId = (/threadId=([^&]+)/.exec(query) || [])[1];
      var did = thId ? decodeURIComponent(thId) : '';
      if (diffs[did]) return { status: 200, body: diffs[did] };
      return { status: 200, body: { repo: 'demo', clean: true, files: [], diff: '' } };
    }
    if (method === 'GET' && path === '/api/host/file') return { status: 200, body: { content: '// 离线演示文件内容' } };
    if (method === 'GET' && path === '/api/projects') return { status: 200, body: { projects: [
      { id: 'p1', name: '网关重构', root: 'D:/work/gateway', threadCount: 2 },
      { id: 'p2', name: '前端体验', root: 'D:/work/web', threadCount: 1 },
    ] } };
    if (method === 'GET' && path === '/api/account') return { status: 200, body: { user: { name: '离线演示账号', email: 'demo@localhost', label: '离线演示' }, plan: { type: 'demo', label: '演示模式' }, usage: null } };
    // 鉴权
    if (method === 'POST' && path === '/api/auth/session') { state.authSessions++; return { status: 200, body: { ok: true, profile: null, expiresAtMs: Date.now() + 28800000 } }; }
    // 发送（排队 / 插队 / 带图）
    if (method === 'POST' && path === '/api/send') return { status: 200, body: send(body) };
    // 新会话
    if (method === 'POST' && path === '/api/new-thread') {
      var nid = tid('n' + Date.now());
      threads.unshift({ id: nid, title: String(body.message || '新会话').slice(0, 24) || '新会话', preview: String(body.message || ''), cwd: 'D:/work', updatedAtMs: Date.now(), createdAtMs: Date.now(), pinned: false, project: null,
        status: { state: 'running', thinking: true, interactionRequired: false, turnId: 'turn-demo-new', startedAtMs: Date.now(), staleTurn: false, queueLength: 0 } });
      messages[nid] = [line('user', 'message', String(body.message || '开始新会话'))];
      scheduleTurnEnd(nid, 12000);
      state.revision++;
      return { status: 200, body: { ok: true, mode: 'demo', threadId: nid, turnId: 'turn-demo-new', sent: true, sentAt: new Date().toISOString() } };
    }
    // 中断
    if (method === 'POST' && path === '/api/interrupt') {
      state.interrupted++;
      var iid = body.threadId || T.RUNNING;
      var it = findThread(iid);
      if (it && it.status) { it.status.thinking = false; it.status.state = 'ended'; it.status.startedAtMs = null; }
      messageList(iid).push(line('notice', 'message', '已中断当前任务。', { title: '任务中断' }));
      state.revision++;
      return { status: 200, body: { ok: true, mode: 'demo', threadId: iid, interruptedAt: new Date().toISOString() } };
    }
    // 审批
    if (method === 'POST' && path === '/api/approval') {
      state.approvals++;
      var aid = body.threadId || T.APPROVAL;
      var list = messageList(aid);
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].kind === 'approval' && list[i].canApprove) { list[i].canApprove = false; list[i].resolved = true; break; }
      }
      var at = findThread(aid);
      if (at && at.status) at.status.interactionRequired = false;
      messageList(aid).push(line('notice', 'message', '审批已' + (body.decision === 'accept' ? '通过' : '拒绝') + '（离线演示）。', { title: '审批结果' }));
      state.revision++;
      return { status: 200, body: { ok: true, mode: 'demo', threadId: aid, requestId: body.requestId, decision: body.decision, decidedAt: new Date().toISOString() } };
    }
    // 队列管理
    var qm = path.match(/^\/api\/queue\/(cancel|steer|retry)$/);
    if (method === 'POST' && qm) {
      state.queueActions++;
      var qid = body.threadId || T.QUEUED;
      var qt = findThread(qid);
      if (qt && qt.status) {
        var act = qm[1];
        if (act === 'cancel') {
          qt.status.queuedMessages = (qt.status.queuedMessages || []).filter(function (x) { return x.id !== body.itemId; });
          qt.status.queueLength = qt.status.queuedMessages.length;
        } else if (act === 'steer') {
          messageList(qid).push(line('notice', 'message', '已把排队消息提前插入当前任务。', { title: '插队' }));
        } else {
          messageList(qid).push(line('notice', 'message', '已重试排队消息。', { title: '重试' }));
        }
      }
      state.revision++;
      return { status: 200, body: { ok: true, threadId: qid, itemId: body.itemId, queueLength: qt ? (qt.status.queueLength || 0) : 0 } };
    }
    if (method === 'GET' && path === '/api/queue/image') return { status: 200, body: '' };
    // 置顶
    var pm = path.match(/^\/api\/threads\/([^/]+)\/pin$/);
    if (method === 'POST' && pm) {
      var pt = findThread(decodeURIComponent(pm[1]));
      if (pt) { pt.pinned = Boolean(body.pinned); state.revision++; }
      return { status: 200, body: { ok: true } };
    }
    // 演示探针：让 QA 能读到写操作日志，验证「真的点到了」
    if (method === 'GET' && path === '/__demo/log') return { status: 200, body: { count: state.log.length, log: state.log.slice(), state: state } };
    if (method === 'GET' && path === '/__demo/reset') { state.log.length = 0; return { status: 200, body: { ok: true } }; }

    return { status: 200, body: { ok: true, demo: true, note: '离线演示：未实现的端点返回空成功' } };
  }

  // ---- fetch 拦截 -----------------------------------------------------------
  function makeResponse(result) {
    var payload = result.body;
    var text = typeof payload === 'string' ? payload : JSON.stringify(payload === undefined ? {} : payload);
    var headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (result.etag) headers['etag'] = result.etag;
    // 用真实 Response（浏览器 / WebView / RN 都有）；失败时退回最小鸭子类型
    if (typeof Response !== 'undefined') {
      try { return new Response(text, { status: result.status || 200, headers: headers }); } catch (e) {}
    }
    return {
      ok: (result.status || 200) >= 200 && (result.status || 200) < 300,
      status: result.status || 200,
      headers: { get: function (k) { return headers[k.toLowerCase()] || null; } },
      json: function () { return Promise.resolve(JSON.parse(text)); },
      text: function () { return Promise.resolve(text); },
    };
  }

  function install() {
    if (global.__TURNLOOM_DEMO_INSTALLED__) return;
    global.__TURNLOOM_DEMO_INSTALLED__ = true;
    var nativeFetch = global.fetch;
    global.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var method = (init && init.method) || (input && input.method) || 'GET';
      // 只接管 /api/* 与演示探针；其它（如 data: / blob: / 静态资源）交回原生
      if (url.indexOf('/api/') === -1 && url.indexOf('/__demo/') === -1) {
        if (typeof nativeFetch === 'function') return nativeFetch.apply(global, arguments);
        return Promise.reject(new Error('fetch unavailable for ' + url));
      }
      var body = null;
      try {
        if (init && init.body) body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        else if (input && input.body) body = typeof input.body === 'string' ? JSON.parse(input.body) : input.body;
      } catch (e) { body = null; }
      var result;
      try { result = route(method.toUpperCase(), url, body); }
      catch (e) { result = { status: 500, body: { error: String(e && e.message || e) } }; }
      // 模拟 30~90ms 网络延迟，让 loading/骨架屏可见，但不拖慢体验
      var delay = 30 + Math.floor(Math.random() * 50);
      return new Promise(function (resolve) { setTimeout(function () { resolve(makeResponse(result)); }, delay); });
    };
    global.__TURNLOOM_DEMO__ = { route: route, state: state, threads: threads, messages: messages, diffs: diffs };
  }

  // 预置 localStorage 键，跳过冷启动「选终端」，直接落会话列表
  function seedStorage() {
    try {
      var ls = global.localStorage;
      if (!ls) return;
      ls.setItem('option-a:terminals:v1', JSON.stringify([
        { id: 'demo-terminal', name: '离线演示 · 本机', url: '', token: 'demo', },
      ]));
      ls.setItem('option-a:selected-terminal:v1', 'demo-terminal');
      ls.setItem('option-a:connection:v1', JSON.stringify({ url: '', token: 'demo', name: '离线演示 · 本机' }));
    } catch (e) {}
  }

  // RN 侧不自动 install：由 demoBootstrap.ts 依构建开关决定是否注入，
  // 保证正式 APK 行为完全不变。seedStorage 在 RN 无 localStorage 时静默跳过。
  if (typeof global !== 'undefined') {
    global.__TURNLOOM_DEMO_API__ = {
      install: install,
      seedStorage: seedStorage,
      route: route,
      state: state,
      pairing: { serverUrl: 'http://demo.invalid', token: 'demo', machineName: '离线演示 · 本机' },
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);