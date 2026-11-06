import { MESSAGE_PAGE_SIZE, messageScrollMode, nextMessageLimit, reconcilePendingMessages, retainedScrollTop, shouldHydrateConversationCache } from "./history.js";
import { renderMarkdown } from "./markdown.js";
import { filterVisibleThreads, groupedVisibleThreads, threadDeepLink, threadStatusKind, threadStatusCounts } from "./threads.js";
import { resolveAuthToken } from "./auth.js";
import { runningTimeLabel } from "./runtime.js";
import { clearConversationCache, conversationCacheKey, isConversationCacheFresh, readConversationCache, writeConversationCache } from "./conversation-cache.js";

const state = {
  threads: [],
  selectedId: null,
  draftThread: null,
  messagesSignature: "",
  filter: "",
  statusFilter: "",
  showTools: false,
  expandedNotices: {},
  threadDrafts: {},
  queueExpanded: safeStorageGet(localStorage, "codex-queue-expanded") === "1",
  sidebarCollapsed: false,
  modelFilter: "",
  showAllModels: false,
    threadSortMode: (() => { const saved = safeStorageGet(localStorage, "codex-thread-sort-mode"); return saved === "recent" ? "recent" : "project"; })(),
  /** Projects (folders) a new conversation can be filed into, and the remembered choice. */
  projects: [],
  draftProjectId: safeStorageGet(localStorage, "codex-draft-project") || "",
  collapsedThreadGroups: JSON.parse(safeStorageGet(localStorage, "codex-collapsed-thread-groups") || "{}"),
  messageRequestSeq: 0,
  activeMessageRequest: null,
  messageLoading: false,
  messageLimit: MESSAGE_PAGE_SIZE,
  messageBeforeCursor: "",
  messageHistoryLoading: false,
  account: null,
  accountExpanded: false,
  config: null,
  codexHome: "",
  codexHomeVersion: null,
  threadListCache: null,
  draftStartedAt: 0,
  authToken: "",
  authLocked: false,
  threadStatus: null,
  goal: null,
  goalEditing: false,
  composerBusy: false,
  uncertainSend: null,
  reminders: {},
  contextThreadId: null,
  model: "",
  effort: "",
  modelPanelOpen: false,
  modelThreadId: null,
  modelPreferences: {},
  followUpMode: "queue",
  imageAttachments: [],
  pendingMessages: [],
  approvalSubmissions: {},
  lastMessagesData: null,
  plugins: [],
  pluginsLoaded: false,
  pluginsLoading: false,
  pluginMenuOpen: false,
  pluginQuery: "",
  pluginTriggerStart: -1,
  pluginActiveIndex: 0,
  selectedPlugins: [],
  skills: [],
  skillsLoaded: false,
  skillsLoading: false,
  skillMenuOpen: false,
  skillQuery: "",
  skillTriggerStart: -1,
  skillActiveIndex: 0,
  selectedSkills: [],
  threadSyncBackoffMs: 0,
  messageSyncBackoffMs: 0,
  messageStreamController: null,
  messageStreamGeneration: 0,
  accountSyncBackoffMs: 0,
  lastSyncActivityAt: Date.now()
};

const THREAD_SYNC_INTERVAL_MS = 12000;
const MESSAGE_SYNC_THINKING_MS = 2000;
const MESSAGE_SYNC_IDLE_MS = 6000;
const MESSAGE_REQUEST_TIMEOUT_MS = 25000;
// The thread list and the health probe gate the very first paint. Unbounded, a stalled
// connection left the drawer on 「加载中」 forever with no error and no retry affordance.
const THREADS_REQUEST_TIMEOUT_MS = 20000;
const HEALTH_REQUEST_TIMEOUT_MS = 15000;
const ACCOUNT_SYNC_INTERVAL_MS = 30000;
const THREAD_SYNC_BACKOFF_MAX_MS = 60000;
const MESSAGE_SYNC_BACKOFF_MAX_MS = 30000;
const ACCOUNT_SYNC_BACKOFF_MAX_MS = 120000;
const IMAGE_INPUT_ACCEPT = "image/*";
const IMAGE_FILE_INPUT_ACCEPT = "*/*";

const els = {
  shell: document.querySelector("#shell"),
  threadCount: document.querySelector("#threadCount"),
  threadList: document.querySelector("#threadList"),
  draftProjectRow: document.querySelector("#draftProjectRow"),
  draftProjectSelect: document.querySelector("#draftProjectSelect"),
  threadSortSegments: document.querySelector(".thread-sort-segments"),
  threadContextMenu: document.querySelector("#threadContextMenu"),
  threadContextTitle: document.querySelector("#threadContextTitle"),
  threadPinAction: document.querySelector("#threadPinAction"),
  threadReminderAction: document.querySelector("#threadReminderAction"),
  threadCopyLinkAction: document.querySelector("#threadCopyLinkAction"),
  threadTitle: document.querySelector("#threadTitle"),
  threadMeta: document.querySelector("#threadMeta"),
  goalPanel: document.querySelector("#goalPanel"),
  goalView: document.querySelector("#goalView"),
  goalEditDialog: document.querySelector("#goalEditDialog"),
  goalDialogTitle: document.querySelector("#goalEditDialogTitle"),
  goalDetailView: document.querySelector("#goalDetailView"),
  goalDetailObjective: document.querySelector("#goalDetailObjective"),
  goalDetailStatus: document.querySelector("#goalDetailStatus"),
  goalDetailBackButton: document.querySelector("#goalDetailBackButton"),
  goalDialogClose: document.querySelector("#goalDialogClose"),
  goalForm: document.querySelector("#goalForm"),
  goalObjective: document.querySelector("#goalObjective"),
  goalObjectiveInput: document.querySelector("#goalObjectiveInput"),
  goalStatus: document.querySelector("#goalStatus"),
  goalStatusInput: document.querySelector("#goalStatusInput"),
  goalEditButton: document.querySelector("#goalEditButton"),
  goalCancelButton: document.querySelector("#goalCancelButton"),
  goalClearButton: document.querySelector("#goalClearButton"),
  goalContextMenu: document.querySelector("#goalContextMenu"),
  goalPauseAction: document.querySelector("#goalPauseAction"),
  goalEditAction: document.querySelector("#goalEditAction"),
  goalDeleteAction: document.querySelector("#goalDeleteAction"),
  messageList: document.querySelector("#messageList"),
  scrollToBottomButton: document.querySelector("#scrollToBottomButton"),
  refreshButton: document.querySelector("#refreshButton"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  drawerOverlay: document.querySelector("#drawerOverlay"),
  sidebarCloseButton: document.querySelector("#sidebarCloseButton"),
  searchInput: document.querySelector("#searchInput"),
  newThreadButton: document.querySelector("#newThreadButton"),
  toolToggle: document.querySelector("#toolToggle"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  pluginMentionTray: document.querySelector("#pluginMentionTray"),
  pluginMentionMenu: document.querySelector("#pluginMentionMenu"),
  skillMentionTray: document.querySelector("#skillMentionTray"),
  skillMentionMenu: document.querySelector("#skillMentionMenu"),
  imageInput: document.querySelector("#imageInput"),
  imageFileInput: document.querySelector("#imageFileInput"),
  imagePickerMenu: document.querySelector("#imagePickerMenu"),
  attachmentTray: document.querySelector("#attachmentTray"),
  attachButton: document.querySelector("#attachButton"),
  pickPhotoButton: document.querySelector("#pickPhotoButton"),
  pickFileButton: document.querySelector("#pickFileButton"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  followUpMode: document.querySelector("#followUpMode"),
  queueStatusBar: document.querySelector("#queueStatusBar"),
  queueToggleButton: document.querySelector("#queueToggleButton"),
  queueStatusHeader: document.querySelector("#queueStatusHeader"),
  queueStatusText: document.querySelector("#queueStatusText"),
  queueStatusList: document.querySelector("#queueStatusList"),
  clearQueueButton: document.querySelector("#clearQueueButton"),
  sendStatus: document.querySelector("#sendStatus"),
  messageActionSheet: document.querySelector("#messageActionSheet"),
  messageActionBackdrop: document.querySelector("#messageActionBackdrop"),
  messageCopyItem: document.querySelector("#messageCopyItem"),
  messageSelectItem: document.querySelector("#messageSelectItem"),
  messageBranchItem: document.querySelector("#messageBranchItem"),
  modelSummary: document.querySelector("#modelSummary"),
  modelName: document.querySelector("#modelName"),
  modelEffort: document.querySelector("#modelEffort"),
  modelPanel: document.querySelector("#modelPanel"),
  modelSelect: document.querySelector("#modelSelect"),
  effortSelect: document.querySelector("#effortSelect"),
  modelSelectLabel: document.querySelector("#modelSelectLabel"),
  modelFilter: document.querySelector("#modelFilter"),
  effortSelectLabel: document.querySelector("#effortSelectLabel"),
  pluginPickerButton: document.querySelector("#pluginPickerButton"),
  skillPickerButton: document.querySelector("#skillPickerButton"),
  mentionButton: document.querySelector("#mentionButton"),
  mentionMenu: document.querySelector("#mentionMenu"),
  mentionPluginItem: document.querySelector("#mentionPluginItem"),
  mentionSkillItem: document.querySelector("#mentionSkillItem"),
  guideButton: document.querySelector("#guideButton"),
  guideButtonLabel: document.querySelector("#guideButtonLabel"),
  privacyNote: document.querySelector("#privacyNote"),
  welcomeDialog: document.querySelector("#welcomeDialog"),
  welcomeClose: document.querySelector("#welcomeClose"),
  welcomeStart: document.querySelector("#welcomeStart"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authInput: document.querySelector("#authInput"),
  authButton: document.querySelector("#authButton"),
  authReveal: document.querySelector("#authReveal"),
  rememberDevice: document.querySelector("#rememberDevice"),
  authError: document.querySelector("#authError")
};

const I18N = {
  zh: {
    documentTitle: "Codex-Turnloom",
    authTitle: "Codex-Turnloom",
    authHelp: "连接这台电脑，继续查看和控制正在运行的 Codex。",
    accessCode: "访问码",
    showAccessCode: "显示访问码",
    hideAccessCode: "隐藏访问码",
    rememberDevice: "记住这台设备",
    enter: "进入",
    verifying: "验证中",
    showThreads: "显示对话列表",
    closeThreads: "关闭对话列表",
    hideThreads: "隐藏对话列表",
    refresh: "刷新",
    loading: "加载中",
    searchThreads: "搜索对话",
    newConversation: "新对话",
    newConversationDraft: "新对话",
    newConversationReady: "输入消息开始新对话。",
    newConversationFailed: "新建对话失败：{message}",
    threadList: "对话列表",
    selectThread: "选择一个对话",
    syncEvery: "每 3 秒自动同步",
    pickThread: "从左侧选择一个 Codex 对话。",
    tool: "工具",
    roleTool: "工具",
    roleInteraction: "交互",
    roleNotice: "提示",
    expandNotice: "展开",
    collapseNotice: "收起",
    interactionRequired: "需要处理",
    interactionDesktopAction: "等待确认",
    approvalYes: "允许本次",
    approvalNo: "拒绝",
    approvalAlways: "始终允许",
    approvalYesSub: "是",
    approvalAlwaysSub: "一直是",
    approvalNoSub: "否",
    approvalQuestionCommand: "允许 Codex 执行以下命令吗？",
    approvalQuestionFile: "允许 Codex 访问以下路径吗？",
    approvalQuestionGeneric: "允许 Codex 继续这次操作吗？",
    approvalCommandLabel: "目标命令",
    approvalPathLabel: "目标路径",
    approvalWorkdirLabel: "工作目录",
    authHostPill: "这台电脑 · 在线",
    approvalSending: "正在提交审批...",
    approvalDone: "审批已提交",
    approvalFailed: "审批提交失败：{message}",
    desktopMayNeedAttention: "可能需要桌面处理",
    showUsage: "显示套餐用量",
    send: "发送",
    stop: "停止",
    stopCurrentTask: "停止当前任务",
    queue: "排队（完成后发）",
    steer: "插入（立即打断）",
    followUpMode: "运行中发送方式",
    followUpLabel: "发送方式",
    queueFollowUp: "当前任务完成后发送",
    steerFollowUp: "立即插入当前任务",
    queuedCount: "⏳ 共享候发队列（{count} 条）· 与 PI 桌面端同一顺序（#1 先发）",
    queueUnavailableStatus: "共享候发队列暂时不可用，请稍后刷新；本次消息未写入第二份队列。",
    imageModelUnsupported: "当前模型不支持图片，请切换到「支持图片」的模型，或移除图片只发文字。",
    modelSupportsImages: "支持图片",
    modelTextOnly: "仅文字",
    queuedWithPreview: "已排队 {count} 条 · {preview}",
    queueAccepted: "已加入队列，当前任务完成后发送。",
    steerAccepted: "已插入当前任务。",
    clearQueue: "取消全部排队消息",
    queueCleared: "已取消 {count} 条排队消息。",
    queueClearFailed: "取消队列失败：{message}",
    queuedItem: "排队中",
    queuedItemPriority: "优先发送",
    insertQueued: "⚡ 设为优先",
    editQueued: "编辑",
    cancelQueued: "取消",
    steerBecameNewTurn: "原任务刚好完成，这条消息已作为下一步发送。",
    modelSettings: "选择模型和思考强度",
    modelLabel: "模型",
    filterModels: "搜索模型或供应商",
    effortLabel: "思考强度",
    effortLow: "低",
    effortMedium: "中",
    effortHigh: "高",
    effortXhigh: "超高",
    effortMax: "最大",
    effortUltra: "极致",
    addImage: "添加图片",
    attachNeedsText: "新对话请先发送一条文字，之后就能添加图片",
    pickPhoto: "相册",
    pickFile: "文件浏览",
    removeImage: "移除图片",
    attachedImages: "已添加 {count} 张图片",
    imageTooLarge: "图片过大，单张不能超过 {size} MB。",
    imageUnsupported: "不支持此图片格式，请换 JPEG、PNG、WebP、GIF、HEIC 或 BMP。",
    imageDimensionsInvalid: "图片尺寸不支持，宽高需在 {min}-{max}px 之间。",
    tooManyImages: "最多只能添加 {count} 张图片。",
    sendToCodex: "输入消息…",
    readonlyPlaceholder: "只读模式：重启时不要加 --readonly 才能发送",
    readonly: "只读模式",
    needAccessCode: "需要访问码",
    enterAccessCode: "请输入访问码。",
    accessCodeWrong: "访问码不正确，请重新输入。",
    syncFailed: "同步失败",
    syncTemporaryFailed: "同步暂时失败",
    emptyThread: "这个对话暂时没有可展示内容。",
    contents: "{count} 条内容",
    messageSending: "正在发送中",
    messageFailed: "发送失败",
    retrySend: "重发",
    thinking: "思考中...",
    processing: "正在处理",
    sent: "已发送",
    processed: "耗时",
    primaryUsage: "主要用量",
    longTermUsage: "长期用量",
    credit: "额度",
    unlimitedCredit: "额度无限",
    balance: "余额 {balance}",
    noExtraCredit: "无额外额度",
    updated: "更新 {time}",
    latestLocalRecord: "本地最近记录",
    noUsage: "还没有读取到本地套餐用量记录。",
    conversationsCount: "{count} 个对话",
    statusRunning: "运行中",
    statusThinking: "思考中",
    statusWaiting: "等待处理",
    statusEnded: "已结束",
    statusUnknown: "状态未知",
    statusStale: "长时间无输出",
    staleTurnHelp: "该任务已长时间没有新输出，桌面端可能已经中断；消息仍会按所选方式排队或插入。",
    reminderOn: "关闭完成提醒",
    reminderOff: "开启完成提醒",
    reminderEnabledLabel: "提醒已开",
    copyThreadLink: "复制深度链接",
    threadLinkCopied: "已复制对话深度链接",
    threadLinkCopyFailed: "复制深度链接失败：{message}",
    branchFromHere: "从这里创建分支",
    copyMessage: "复制",
    copyMessageFull: "复制全文",
    selectMessageText: "选择文字",
    textSelected: "已选中文字，长按选区即可复制",
    copiedMessage: "已复制到剪贴板",
    copyFailed: "复制失败，请改用「选择文字」",
    branchCreated: "分支已创建",
    branchCreatedAtEnd: "分支已创建（这条会话没有轮次标记，已在末尾分叉）",
    branchFailed: "创建分支失败：{message}",
    branchNeedsIdle: "会话正在运行，等它结束或先点停止再创建分支",
    messageQueued: "排队中",
    pinThread: "置顶",
    unpinThread: "取消置顶",
    pinnedGroup: "置顶",
    attentionGroup: "需要关注",
    otherConversations: "其他对话",
    pinFailed: "置顶操作失败：{message}",
    window: "窗口",
    weekWindow: "{count} 周窗口",
    dayWindow: "{count} 天窗口",
    hourWindow: "{count} 小时窗口",
    minuteWindow: "{count} 分钟窗口",
    resetAt: "重置 {time}",
    sendFailed: "发送失败：{message}",
    sendUncertain: "桌面端没有及时确认，已刷新且不会重复发送；请先确认对话内容。",
    sendUncertainFailed: "发送未确认，可能未到达桌面端。请重试。",
    sendUncertainAccepted: "桌面端已接收这条消息，正在刷新状态。",
    interruptFailed: "停止失败：{message}",
    stoppingTask: "正在停止当前任务…",
    taskStopped: "已停止",
    busyCannotSend: "Codex 正在处理。请先停止当前任务，再发送这条消息。",
    pluginPickerTitle: "引用插件",
    pluginPickerLoading: "正在加载插件...",
    pluginPickerEmpty: "没有找到匹配插件",
    skillPickerTitle: "引用技能",
    skillPickerLoading: "正在加载技能...",
    skillPickerEmpty: "没有找到匹配技能",
    mentionTitle: "引用插件或技能",
    mentionPlugin: "插件",
    mentionSkill: "技能",
    goalLabel: "目标",
    goalDetail: "目标详情",
    goalBack: "返回",
    goalEdit: "编辑目标",
    goalSave: "保存",
    goalCancel: "取消",
    goalClear: "删除",
    goalEmpty: "尚未设置目标",
    goalStatusActive: "进行中",
    goalStatusPaused: "已暂停",
    goalStatusBlocked: "已阻塞",
    goalStatusUsageLimited: "用量受限",
    goalStatusBudgetLimited: "预算受限",
    goalStatusComplete: "已完成",
    compactContext: "压缩上下文",
    compactContextDescription: "调用 Codex Desktop 的上下文压缩操作",
    compactStarted: "已请求压缩上下文。",
    planPrompt: "请先制定执行计划，再开始操作。",
    goalSaveFailed: "目标保存失败：{message}",
    goalClearFailed: "目标删除失败：{message}",
    guide: "使用指引",
    privacyNote: "连接保持在你的设备之间",
    welcomeTitle: "把电脑上的 Codex，延续到手机",
    welcomeDescription: "电脑仍是数据源，手机负责查看会话、发送消息和处理等待中的操作。",
    welcomeStepOneTitle: "选择一个对话",
    welcomeStepOneCopy: "从对话列表继续已有工作，或新建一次会话。",
    welcomeStepTwoTitle: "直接在手机上继续",
    welcomeStepTwoCopy: "发送文字、图片或文件，并按需选择模型和思考强度。",
    welcomeStepThreeTitle: "只看需要的细节",
    welcomeStepThreeCopy: "工具记录默认收起，点击右上角工具按钮后显示。",
    welcomePrivacy: "所有内容仍保存在你的电脑上",
    welcomeStart: "开始使用",
    networkUnreachable: "连不上这台电脑。请确认电脑上的 Codex 仍在运行、网络可达，然后重试。",
    serverError: "电脑端返回了异常（HTTP {status}），请稍后重试。",
    requestFailed: "读取失败：{message}",
    retryLoad: "重试",
    requestTimedOut: "读取超时，请点重试。",
    untitled: "Untitled",
    separator: " · "
  },
  en: {
    documentTitle: "Codex-Turnloom",
    authTitle: "Codex-Turnloom",
    authHelp: "Connect to this computer and continue the Codex work already in progress.",
    accessCode: "Access code",
    showAccessCode: "Show access code",
    hideAccessCode: "Hide access code",
    rememberDevice: "Remember this device",
    enter: "Enter",
    verifying: "Verifying",
    showThreads: "Show conversations",
    closeThreads: "Close conversations",
    hideThreads: "Hide conversations",
    refresh: "Refresh",
    loading: "Loading",
    searchThreads: "Search conversations",
    newConversation: "New chat",
    newConversationDraft: "New chat",
    newConversationReady: "Type a message to start a new chat.",
    newConversationFailed: "Could not start a new chat: {message}",
    threadList: "Conversation list",
    selectThread: "Select a conversation",
    syncEvery: "Auto-syncs every 3 seconds",
    pickThread: "Select a Codex conversation from the left.",
    tool: "Tools",
    roleTool: "Tool",
    roleInteraction: "Interaction",
    roleNotice: "Notice",
    expandNotice: "Expand",
    collapseNotice: "Collapse",
    interactionRequired: "Action required",
    interactionDesktopAction: "Approval pending",
    approvalYes: "Allow once",
    approvalNo: "Deny",
    approvalAlways: "Always allow",
    approvalYesSub: "Yes",
    approvalAlwaysSub: "Always",
    approvalNoSub: "No",
    approvalQuestionCommand: "Allow Codex to run this command?",
    approvalQuestionFile: "Allow Codex to access this path?",
    approvalQuestionGeneric: "Allow Codex to continue?",
    approvalCommandLabel: "Command",
    approvalPathLabel: "Target path",
    approvalWorkdirLabel: "Working directory",
    authHostPill: "This computer · Online",
    approvalSending: "Submitting approval...",
    approvalDone: "Approval submitted",
    approvalFailed: "Approval failed: {message}",
    desktopMayNeedAttention: "Desktop may need attention",
    showUsage: "Show plan usage",
    send: "Send",
    stop: "Stop",
    stopCurrentTask: "Stop current task",
    queue: "Queue (send after)",
    steer: "Insert (interrupt now)",
    followUpMode: "Send while running",
    followUpLabel: "Send mode",
    queueFollowUp: "Send after the current task",
    steerFollowUp: "Insert into the current task",
    queuedCount: "⏳ Shared queue ({count}) · same PI desktop order (#1 sends first)",
    queueUnavailableStatus: "Shared queue is temporarily unavailable. Refresh in a moment; this message was not written to a second queue.",
    imageModelUnsupported: "The selected model does not support images. Choose an image-capable model or remove the images.",
    modelSupportsImages: "Images",
    modelTextOnly: "Text only",
    queuedWithPreview: "{count} queued · {preview}",
    queueAccepted: "Queued for after the current task.",
    steerAccepted: "Inserted into the current task.",
    clearQueue: "Cancel all queued messages",
    queueCleared: "Cancelled {count} queued messages.",
    queueClearFailed: "Could not cancel queue: {message}",
    queuedItem: "Queued",
    queuedItemPriority: "Priority",
    insertQueued: "⚡ Prioritize",
    editQueued: "Edit",
    cancelQueued: "Cancel",
    steerBecameNewTurn: "The previous task finished, so this message was sent as the next step.",
    modelSettings: "Choose model and reasoning effort",
    modelLabel: "Model",
    filterModels: "Search models or providers",
    effortLabel: "Reasoning effort",
    effortLow: "Low",
    effortMedium: "Medium",
    effortHigh: "High",
    effortXhigh: "Extra high",
    effortMax: "Maximum",
    effortUltra: "Ultra",
    addImage: "Add image",
    attachNeedsText: "Send a text message first — images can be added once the conversation exists",
    pickPhoto: "Photos",
    pickFile: "Files",
    removeImage: "Remove image",
    attachedImages: "{count} image(s) attached",
    imageTooLarge: "Image is too large. Each image must be under {size} MB.",
    imageUnsupported: "Unsupported image format. Use JPEG, PNG, WebP, GIF, HEIC, or BMP.",
    imageDimensionsInvalid: "Unsupported image dimensions. Width and height must be {min}-{max}px.",
    tooManyImages: "You can attach up to {count} images.",
    sendToCodex: "Type a message…",
    readonlyPlaceholder: "Read-only: restart without --readonly to send",
    readonly: "Read-only",
    needAccessCode: "Access code required",
    enterAccessCode: "Enter the access code.",
    accessCodeWrong: "Incorrect access code. Try again.",
    syncFailed: "Sync failed",
    syncTemporaryFailed: "Sync temporarily failed",
    emptyThread: "This conversation has no displayable content yet.",
    contents: "{count} items",
    messageSending: "Sending",
    messageFailed: "Send failed",
    retrySend: "Retry",
    thinking: "Thinking...",
    processing: "Processing",
    sent: "Sent",
    processed: "Took",
    primaryUsage: "Primary usage",
    longTermUsage: "Long-term usage",
    credit: "Credit",
    unlimitedCredit: "Unlimited",
    balance: "Balance {balance}",
    noExtraCredit: "No extra credit",
    updated: "Updated {time}",
    latestLocalRecord: "Latest local record",
    noUsage: "No local plan usage record found yet.",
    conversationsCount: "{count} conversations",
    statusRunning: "Running",
    statusThinking: "Thinking",
    statusWaiting: "Waiting",
    statusEnded: "Ended",
    statusUnknown: "Unknown",
    statusStale: "No recent output",
    staleTurnHelp: "This task has produced no new output for a long time, so Desktop may have dropped it. Messages will still be queued or inserted as chosen.",
    reminderOn: "Disable completion reminder",
    reminderOff: "Enable completion reminder",
    reminderEnabledLabel: "Reminder on",
    copyThreadLink: "Copy deep link",
    threadLinkCopied: "Conversation deep link copied",
    threadLinkCopyFailed: "Could not copy deep link: {message}",
    branchFromHere: "Create branch from here",
    copyMessage: "Copy",
    copyMessageFull: "Copy text",
    selectMessageText: "Select text",
    textSelected: "Text selected — long-press the selection to copy",
    copiedMessage: "Copied to clipboard",
    copyFailed: "Copy failed — use “Select text” instead",
    branchCreated: "Branch created",
    branchCreatedAtEnd: "Branch created (no turn markers here, so it branched at the end)",
    branchFailed: "Could not create branch: {message}",
    branchNeedsIdle: "This conversation is still running — stop it first, then branch",
    messageQueued: "Queued",
    pinThread: "Pin",
    unpinThread: "Unpin",
    pinnedGroup: "Pinned",
    attentionGroup: "Needs attention",
    otherConversations: "Other conversations",
    pinFailed: "Could not update pin: {message}",
    window: "Window",
    weekWindow: "{count} week window",
    dayWindow: "{count} day window",
    hourWindow: "{count} hour window",
    minuteWindow: "{count} minute window",
    resetAt: "resets {time}",
    sendFailed: "Send failed: {message}",
    sendUncertain: "Desktop did not confirm in time. Refreshed without sending a duplicate; verify the conversation before retrying.",
    sendUncertainFailed: "The send was not confirmed and may not have reached Desktop. Retry it.",
    sendUncertainAccepted: "Desktop accepted the message. Refreshing the conversation state.",
    interruptFailed: "Stop failed: {message}",
    stoppingTask: "Stopping the current task…",
    taskStopped: "Stopped",
    busyCannotSend: "Codex is still processing. Stop the current task before sending this message.",
    pluginPickerTitle: "Mention plugin",
    pluginPickerLoading: "Loading plugins...",
    pluginPickerEmpty: "No matching plugins",
    skillPickerTitle: "Mention skill",
    skillPickerLoading: "Loading skills...",
    skillPickerEmpty: "No matching skills",
    mentionTitle: "Mention a plugin or skill",
    mentionPlugin: "Plugin",
    mentionSkill: "Skill",
    goalLabel: "Goal",
    goalDetail: "Goal details",
    goalBack: "Back",
    goalEdit: "Edit goal",
    goalSave: "Save",
    goalCancel: "Cancel",
    goalClear: "Delete",
    goalEmpty: "No goal set",
    goalStatusActive: "Active",
    goalStatusPaused: "Paused",
    goalStatusBlocked: "Blocked",
    goalStatusUsageLimited: "Usage limited",
    goalStatusBudgetLimited: "Budget limited",
    goalStatusComplete: "Complete",
    compactContext: "Compact context",
    compactContextDescription: "Run Codex Desktop context compaction",
    compactStarted: "Context compaction requested.",
    planPrompt: "Create an execution plan before starting.",
    goalSaveFailed: "Could not save goal: {message}",
    goalClearFailed: "Could not delete goal: {message}",
    guide: "Quick guide",
    privacyNote: "The connection stays between your devices",
    welcomeTitle: "Continue your desktop Codex work from your phone",
    welcomeDescription: "Your computer remains the source of truth. Your phone lets you view conversations, send messages, and handle waiting actions.",
    welcomeStepOneTitle: "Choose a conversation",
    welcomeStepOneCopy: "Continue existing work from the conversation list or start a new chat.",
    welcomeStepTwoTitle: "Keep working from your phone",
    welcomeStepTwoCopy: "Send text, images, or files and choose a model and reasoning effort when needed.",
    welcomeStepThreeTitle: "Reveal details when needed",
    welcomeStepThreeCopy: "Tool records stay hidden until you enable them from the top-right control.",
    welcomePrivacy: "Your content remains on your computer",
    welcomeStart: "Get started",
    networkUnreachable: "Can't reach this computer. Check that Codex is still running on it and the network is reachable, then try again.",
    serverError: "The computer returned an error (HTTP {status}). Please try again shortly.",
    requestFailed: "Could not load: {message}",
    retryLoad: "Try again",
    requestTimedOut: "Loading timed out. Tap to retry.",
    untitled: "Untitled",
    separator: " · "
  }
};

function detectLocale() {
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

state.locale = detectLocale();
const dateFormatter = new Intl.DateTimeFormat(state.locale === "zh" ? "zh-CN" : "en-US", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;
const MIN_IMAGE_EDGE = 16;
const IMAGE_JPEG_QUALITY = 0.86;
const DRAFT_THREAD_ID = "__new_thread__";
const DRAFT_LOCK_MS = 10 * 60 * 1000;
const requestedThreadId = new URLSearchParams(window.location.search).get("selectedId") || "";
if (requestedThreadId) state.selectedId = requestedThreadId;

function hasActiveDraft() {
  return state.selectedId === DRAFT_THREAD_ID && state.draftThread && Date.now() - state.draftStartedAt < DRAFT_LOCK_MS;
}

function clearDraftThread() {
  state.draftThread = null;
  state.draftStartedAt = 0;
  syncDraftProjectRow();
}

function t(key, values = {}) {
  const text = I18N[state.locale][key] || I18N.en[key] || key;
  return text.replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? "");
}

function applyStaticText() {
  document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
  document.title = t("documentTitle");
  document.querySelector(".auth-card h2").textContent = t("authTitle");
  document.querySelector(".auth-card p").textContent = t("authHelp");
  els.authInput.placeholder = t("accessCode");
  els.authReveal.setAttribute("title", t("showAccessCode"));
  els.authReveal.setAttribute("aria-label", t("showAccessCode"));
  document.querySelector(".remember-toggle span").textContent = t("rememberDevice");
  els.authButton.textContent = t("enter");
  els.sidebarToggle.setAttribute("title", t("showThreads"));
  els.sidebarToggle.setAttribute("aria-label", t("showThreads"));
  els.drawerOverlay.setAttribute("title", t("closeThreads"));
  els.drawerOverlay.setAttribute("aria-label", t("closeThreads"));
  els.threadCount.textContent = t("loading");
  els.refreshButton.setAttribute("title", t("refresh"));
  els.refreshButton.setAttribute("aria-label", t("refresh"));
  els.sidebarCloseButton?.setAttribute("title", t("hideThreads"));
  els.sidebarCloseButton?.setAttribute("aria-label", t("hideThreads"));
  els.searchInput.placeholder = t("searchThreads");
  document.querySelector("#newThreadLabel").textContent = t("newConversation");
  els.threadList.setAttribute("aria-label", t("threadList"));
  els.threadTitle.textContent = t("selectThread");
  els.threadMeta.textContent = t("syncEvery");
  els.goalDetailBackButton.textContent = t("goalBack");
  els.goalEditButton.textContent = t("goalEdit");
  document.querySelector(".toggle").setAttribute("title", t("tool"));
  document.querySelector(".toggle").setAttribute("aria-label", t("tool"));
  els.toolToggle.checked = state.showTools;
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("pickThread"))}</div>`;
  els.modelSummary.setAttribute("title", t("modelSettings"));
  els.modelSummary.setAttribute("aria-label", t("modelSettings"));
  els.modelSelectLabel.textContent = t("modelLabel");
  if (els.modelFilter) els.modelFilter.placeholder = t("filterModels");
  els.effortSelectLabel.textContent = t("effortLabel");
  els.pluginPickerButton.setAttribute("title", t("pluginPickerTitle"));
  els.pluginPickerButton.setAttribute("aria-label", t("pluginPickerTitle"));
  els.skillPickerButton.setAttribute("title", t("skillPickerTitle"));
  els.skillPickerButton.setAttribute("aria-label", t("skillPickerTitle"));
  if (els.mentionButton) {
    els.mentionButton.setAttribute("title", t("mentionTitle"));
    els.mentionButton.setAttribute("aria-label", t("mentionTitle"));
  }
  if (els.mentionPluginItem) els.mentionPluginItem.textContent = t("mentionPlugin");
  if (els.mentionSkillItem) els.mentionSkillItem.textContent = t("mentionSkill");
  els.attachButton.setAttribute("title", t("addImage"));
  els.attachButton.setAttribute("aria-label", t("addImage"));
  els.pickPhotoButton.textContent = t("pickPhoto");
  els.pickFileButton.textContent = t("pickFile");
  if (els.messageCopyItem) els.messageCopyItem.textContent = t("copyMessageFull");
  if (els.messageSelectItem) els.messageSelectItem.textContent = t("selectMessageText");
  if (els.messageBranchItem) els.messageBranchItem.textContent = t("branchFromHere");
  els.sendButton.setAttribute("title", t("send"));
  els.sendButton.setAttribute("aria-label", t("send"));
  els.stopButton.setAttribute("title", t("stopCurrentTask"));
  els.stopButton.setAttribute("aria-label", t("stopCurrentTask"));
  els.followUpMode.setAttribute("aria-label", t("followUpMode"));
  els.followUpMode.querySelector('[data-follow-up-mode="queue"]').textContent = t("queue");
  els.followUpMode.querySelector('[data-follow-up-mode="queue"]').setAttribute("title", t("queueFollowUp"));
  els.followUpMode.querySelector('[data-follow-up-mode="steer"]').textContent = t("steer");
  els.followUpMode.querySelector('[data-follow-up-mode="steer"]').setAttribute("title", t("steerFollowUp"));
  const followUpLabel = document.querySelector("#followUpLabel");
  if (followUpLabel) followUpLabel.textContent = t("followUpLabel");
  const authHostPillLabel = document.querySelector("#authHostPillLabel");
  if (authHostPillLabel) authHostPillLabel.textContent = t("authHostPill");
  els.clearQueueButton.setAttribute("title", t("clearQueue"));
  els.clearQueueButton.setAttribute("aria-label", t("clearQueue"));
  els.composerInput.placeholder = t("sendToCodex");
  if (els.guideButtonLabel) els.guideButtonLabel.textContent = t("guide");
  if (els.privacyNote) els.privacyNote.textContent = t("privacyNote");
  document.querySelector("#welcomeTitle").textContent = t("welcomeTitle");
  document.querySelector("#welcomeDescription").textContent = t("welcomeDescription");
  document.querySelector("#welcomeStepOneTitle").textContent = t("welcomeStepOneTitle");
  document.querySelector("#welcomeStepOneCopy").textContent = t("welcomeStepOneCopy");
  document.querySelector("#welcomeStepTwoTitle").textContent = t("welcomeStepTwoTitle");
  document.querySelector("#welcomeStepTwoCopy").textContent = t("welcomeStepTwoCopy");
  document.querySelector("#welcomeStepThreeTitle").textContent = t("welcomeStepThreeTitle");
  document.querySelector("#welcomeStepThreeCopy").textContent = t("welcomeStepThreeCopy");
  document.querySelector("#welcomePrivacy").textContent = t("welcomePrivacy");
  els.welcomeStart.textContent = t("welcomeStart");
}

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in some mobile privacy modes.
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in some mobile privacy modes.
  }
}

state.followUpMode = safeStorageGet(localStorage, "codex-follow-up-mode") === "steer" ? "steer" : "queue";
state.model = safeStorageGet(localStorage, "codex-model");
state.effort = safeStorageGet(localStorage, "codex-effort");
try {
  state.reminders = JSON.parse(safeStorageGet(localStorage, "codex-thread-reminders") || "{}");
} catch {
  state.reminders = {};
}
try {
  state.modelPreferences = JSON.parse(safeStorageGet(localStorage, "codex-model-preferences") || "{}");
} catch {
  state.modelPreferences = {};
}

function availableModels() {
  return Array.isArray(state.config?.models) ? state.config.models : [];
}

const MODEL_FILTER_THRESHOLD = 20;

function filteredModels(models, term) {
  const needle = String(term || "").trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) =>
    `${model.label || ""} ${model.id || ""}`.toLowerCase().includes(needle)
  );
}

function effortLabel(effort) {
  const normalized = String(effort || "");
  const key = `effort${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  return t(key);
}

function persistModelSettings() {
  safeStorageSet(localStorage, "codex-model", state.model);
  safeStorageSet(localStorage, "codex-effort", state.effort);
}

function rememberModelSettingsForCurrentThread() {
  if (!state.selectedId) return;
  state.modelPreferences[state.selectedId] = { model: state.model, effort: state.effort };
  safeStorageSet(localStorage, "codex-model-preferences", JSON.stringify(state.modelPreferences));
}

function normalizeModelSettings(preferredModel = state.model) {
  const models = availableModels();
  if (!models.length) return;
  const selectedModel = models.find((model) => model.id === preferredModel) ||
    models.find((model) => model.id === state.config?.defaultModel) || models[0];
  const efforts = Array.isArray(selectedModel.efforts) ? selectedModel.efforts : [];
  state.model = selectedModel.id;
  state.effort = efforts.includes(state.effort)
    ? state.effort
    : efforts.includes(state.config?.defaultEffort)
      ? state.config.defaultEffort
      : efforts[0] || "medium";
  persistModelSettings();
  renderModelSettings();
}

function renderModelSettings() {
  const models = availableModels();
  if (!models.length) return;
  const selectedModel = models.find((model) => model.id === state.model) || models[0];
  // usedModelIds 是会话里记录的裸 slug（deepseek-v4.1-flash），目录 id 是
  // 「供应商/模型」。两种写法都要认，否则常用列表会空掉。
  const usedIds = (Array.isArray(state.config?.usedModelIds) ? state.config.usedModelIds : [])
    .map((id) => String(id).toLowerCase());
  const usedRank = new Map(usedIds.map((id, index) => [id, index]));
  const usedSet = new Set(usedIds);
  const rankOf = (model) => {
    const id = String(model.id || "").toLowerCase();
    const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    const a = usedRank.has(id) ? usedRank.get(id) : Infinity;
    const b = usedRank.has(tail) ? usedRank.get(tail) : Infinity;
    return Math.min(a, b);
  };
  const isUsed = (model) => Number.isFinite(rankOf(model));
  // 供应商自动发现的模型可能上百个，默认只列这台电脑上真正在用的，
  // 并按使用频次排序取前 20；同名模型散落在多个供应商时不再全部铺开。
  const scopeAll = state.showAllModels || Boolean(String(state.modelFilter || "").trim());
  const scoped = usedSet.size && !scopeAll
    ? (() => {
        const seen = new Set();
        return models
          .filter((model) => isUsed(model) || model.id === selectedModel.id)
          .sort((a, b) => rankOf(a) - rankOf(b))
          .filter((model) => {
            // 同一个模型名散落在多个供应商时，常用视图只留使用频次最高的那条，
            // 其余仍可在「显示全部」/搜索里找到，避免列表里三个同名看不出区别。
            const key = String(model.label || model.id).split(" · ")[0].toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 20);
      })()
    : models;
  const filtered = filteredModels(scoped, state.modelFilter);
  const rows = filtered.length && !filtered.some((model) => model.id === selectedModel.id)
    ? [selectedModel, ...filtered]
    : filtered.length
      ? filtered
      : [selectedModel];

  const list = document.querySelector("#modelList");
  const empty = document.querySelector("#modelEmpty");
  const count = document.querySelector("#modelCount");
  const scopeButton = document.querySelector("#modelScopeButton");
  if (list) {
    list.replaceChildren(...rows.map((model) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "model-row" + (model.id === selectedModel.id ? " active" : "");
      row.dataset.modelId = model.id;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(model.id === selectedModel.id));
      const name = document.createElement("span");
      name.className = "model-row-name";
      name.textContent = String(model.label || model.id).split(" · ")[0];
      const provider = document.createElement("span");
      provider.className = "model-row-provider";
      provider.textContent = String(model.label || "").includes(" · ")
        ? String(model.label).split(" · ").slice(1).join(" · ")
        : model.id;
      const capability = document.createElement("span");
      capability.className = "model-row-capability";
      capability.textContent = model.supportsImages === false ? t("modelTextOnly") : "";
      row.append(name, provider, capability);
      return row;
      return row;
    }));
  }
  if (empty) empty.hidden = rows.length > 0 || !String(state.modelFilter || "").trim();
  if (count) count.textContent = scopeAll ? `共 ${rows.length} 个` : `常用 ${rows.length} 个`;
  if (scopeButton) {
    scopeButton.textContent = state.showAllModels ? "只看常用模型" : "显示全部模型";
    scopeButton.hidden = usedIds.size === 0;
  }

  // 隐藏 select 保留给表单/兼容路径，但不作为用户可见控件。
  els.modelSelect.replaceChildren(...rows.map((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label || model.id;
    return option;
  }));
  els.modelSelect.value = selectedModel.id;
  const efforts = Array.isArray(selectedModel.efforts) ? selectedModel.efforts : [];
  const chips = document.querySelector("#effortChips");
  if (chips) {
    chips.replaceChildren(...efforts.map((effort) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "effort-chip" + (effort === state.effort ? " active" : "");
      chip.dataset.effort = effort;
      chip.textContent = effortLabel(effort);
      return chip;
    }));
  }
  els.effortSelect.replaceChildren(...efforts.map((effort) => {
    const option = document.createElement("option");
    option.value = effort;
    option.textContent = effortLabel(effort);
    return option;
  }));
  // catalog label; keep the full "model · provider" string in the tooltip.
  const modelLabel = selectedModel.label || selectedModel.id;
  const [modelTitle, providerTitle = ""] = modelLabel.split(" · ");
  const friendlyName = /^[a-z]{2}:[a-z0-9._-]+$/i.test(modelTitle)
    ? `模型 · ${modelTitle.split(":")[1]?.toUpperCase() || modelTitle}`
    : modelTitle;
  els.modelName.textContent = friendlyName;
  els.modelSummary.setAttribute("title", `${modelLabel} · ${effortLabel(state.effort)}`);
  els.modelSummary.setAttribute("aria-label", `${t("modelSettings")}：${modelLabel}，${effortLabel(state.effort)}`);
  if (providerTitle) els.modelName.setAttribute("title", providerTitle);
  else els.modelName.removeAttribute("title");
  els.modelEffort.textContent = effortLabel(state.effort);
  els.modelSummary.setAttribute("aria-expanded", String(state.modelPanelOpen));
  els.modelSummary.classList.toggle("expanded", state.modelPanelOpen);
  els.modelPanel.hidden = !state.modelPanelOpen;
}

function closeModelPanel() {
  if (!state.modelPanelOpen) return;
  state.modelPanelOpen = false;
  state.modelFilter = "";
  if (els.modelFilter) els.modelFilter.value = "";
  renderModelSettings();
}

function adoptSelectedThreadModel() {
  const thread = state.threads.find((entry) => entry.id === state.selectedId);
  const preference = state.modelPreferences[state.selectedId];
  state.modelThreadId = state.selectedId;
  if (preference?.effort) state.effort = preference.effort;
  normalizeModelSettings(preference?.model || thread?.model || state.model);
}


function rememberedTokenKey() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const device = url.searchParams.get("device") || hashParams.get("d") || hashParams.get("device") || "";
  return device ? `codexLanToken:${encodeURIComponent(device)}` : "codexLanToken";
}
function initAuthToken() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const urlToken = url.searchParams.get("login") || url.searchParams.get("token") || hashParams.get("login") || hashParams.get("token") || "";
  if (urlToken) {
    url.searchParams.delete("login");
    url.searchParams.delete("token");
    hashParams.delete("login");
    hashParams.delete("token");
    url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
  safeStorageRemove(sessionStorage, "codexLanToken");
  let nativeToken = "";
  try {
    nativeToken = globalThis.CodexPocket?.getAccessToken?.() || "";
  } catch {
    // The desktop browser has no native bridge.
  }
  state.authToken = resolveAuthToken({
    urlToken,
    rememberedToken: safeStorageGet(localStorage, rememberedTokenKey()),
    nativeToken
  });
  els.rememberDevice.checked = Boolean(safeStorageGet(localStorage, rememberedTokenKey()));
  exchangeAuthSession(state.authToken);
}

function exchangeAuthSession(token) {
  if (!token) return;
  fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token })
  }).catch(() => {});
}

function authHeaders(extra = {}) {
  return state.authToken ? { ...extra, "x-access-token": state.authToken } : extra;
}

function showAuthGate(message = "") {
  els.authGate.hidden = false;
  els.authError.textContent = message;
  window.setTimeout(() => els.authInput.focus(), 0);
}

function hideAuthGate() {
  els.authGate.hidden = true;
  els.authError.textContent = "";
  state.authLocked = false;
}

function lockApp(message = "") {
  if (state.authLocked && els.authGate.hidden === false) {
    if (message) els.authError.textContent = message;
    return;
  }
  safeStorageRemove(sessionStorage, "codexLanToken");
  safeStorageRemove(localStorage, rememberedTokenKey());
  state.authToken = "";
  state.authLocked = true;
  state.config = null;
  state.threadListCache = null;
  state.messagesSignature = "";
  state.pendingMessages = [];
  state.lastMessagesData = null;
  void clearConversationCache();
  els.rememberDevice.checked = false;
  els.authInput.value = "";
  els.threadCount.textContent = t("needAccessCode");
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("enterAccessCode"))}</div>`;
  showAuthGate(message);
}

function handleUnauthorized(error) {
  if (error?.status !== 401) return false;
  lockApp(state.authToken ? t("accessCodeWrong") : t("enterAccessCode"));
  return true;
}

function shouldSync() {
  return Boolean(state.config && !state.authLocked);
}

function formatDate(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function formatMessageDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

// One duration vocabulary everywhere. The header pill, the drawer rows and the
// per-answer caption used to spell the same span three ways (02:06 / 1分45秒 / 1m8s).
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return state.locale === "zh" ? `${hours}小时${minutes}分` : `${hours}h ${minutes}m`;
  if (minutes <= 0) return state.locale === "zh" ? `${seconds}秒` : `${seconds}s`;
  return state.locale === "zh" ? `${minutes}分${seconds}秒` : `${minutes}m ${seconds}s`;
}
function renderApprovalActions(message) {
  if (message.role !== "interaction" || !message.canApprove || !message.requestId) return "";
  const submission = state.approvalSubmissions[approvalSubmissionKey(state.selectedId, message.requestId)];
  if (submission?.status === "submitted") {
    return `<div class="approval-result">${escapeHtml(t("approvalDone"))}</div>`;
  }
  if (submission?.status === "submitting") {
    return `<div class="approval-result pending">${escapeHtml(t("approvalSending"))}</div>`;
  }
  const requestId = escapeHtml(String(message.requestId));
  const approvalKind = escapeHtml(String(message.approvalKind || "command"));
  const buttons = [
    ["accept", "approvalYes", "approvalYesSub", "approve-once"],
    ["acceptForSession", "approvalAlways", "approvalAlwaysSub", "approve-always"],
    ["decline", "approvalNo", "approvalNoSub", "approve-deny"]
  ];
  return `
    <div class="approval-actions" data-request-id="${requestId}" data-approval-kind="${approvalKind}">
      ${buttons
        .map(
          ([decision, labelKey, subKey, tone]) =>
            `<button class="approval-action ${tone}" type="button" data-decision="${escapeHtml(decision)}" aria-label="${escapeHtml(`${t(labelKey)} · ${t(subKey)}`)}"><span class="approval-action-label">${escapeHtml(t(labelKey))}</span><span class="approval-action-sub">${escapeHtml(t(subKey))}</span></button>`
        )
        .join("")}
    </div>
  `;
}

function approvalSubmissionKey(threadId, requestId) {
  return `${threadId || ""}:${requestId || ""}`;
}

function interactionFields(message) {
  const fields = {};
  const pattern = /^(Prompt|Command|Path|Workdir|Options):\s*(.+)$/gim;
  const text = String(message?.content || "");
  let match;
  while ((match = pattern.exec(text))) {
    const key = match[1].toLowerCase();
    if (!fields[key]) fields[key] = match[2].trim();
  }
  return fields;
}

function approvalQuestion(message) {
  const kind = String(message?.approvalKind || "").toLowerCase();
  if (kind === "file" || kind === "patch") return t("approvalQuestionFile");
  if (kind === "command" || kind === "exec" || kind === "shell") return t("approvalQuestionCommand");
  return t("approvalQuestionGeneric");
}

function approvalSandbox(labelKey, value) {
  return `<div class="sandbox-box"><span class="sandbox-label">${escapeHtml(t(labelKey))}</span><span class="sandbox-value">${escapeHtml(value)}</span></div>`;
}

function renderInteractionBody(message) {
  if (!message?.canApprove) return renderMessageMarkdown(message.content);
  const fields = interactionFields(message);
  if (!fields.command && !fields.path && !fields.prompt) return renderMessageMarkdown(message.content);
  const parts = [];
  if (fields.prompt) parts.push(`<p class="approval-prompt">${escapeHtml(fields.prompt)}</p>`);
  if (fields.command) parts.push(approvalSandbox("approvalCommandLabel", fields.command));
  if (fields.path) parts.push(approvalSandbox("approvalPathLabel", fields.path));
  if (fields.workdir) parts.push(`<p class="approval-workdir">${escapeHtml(t("approvalWorkdirLabel"))} <code>${escapeHtml(fields.workdir)}</code></p>`);
  return parts.join("");
}

function isImportantNotice(message) {
  if (message.role !== "notice") return false;
  const kind = String(message.kind || "").toLowerCase();
  const title = String(message.title || "").toLowerCase();
  const content = String(message.content || "").toLowerCase();
  if (kind === "info" || title === "notice") return false;
  if (title.includes("approval dismissed") || content.includes("rejected by user")) return false;
  if (kind === "error") return true;
  const text = [title, content].filter(Boolean).join(" ");
  return (
    text.includes("limit") ||
    text.includes("quota") ||
    text.includes("usage_limit") ||
    text.includes("usage limit") ||
    text.includes("rate_limit") ||
    text.includes("rate limit") ||
    text.includes("plan_limit") ||
    text.includes("plan limit")
  );
}

function noticeCollapseKey(message) {
  return String(message.lineNumber || message.id || `${message.timestamp || ""}:${message.title || ""}:${message.content || ""}`);
}

function renderNoticeTitle(message, collapsed, noticeKey) {
  return `
    <div class="notice-title-row">
      <div class="notice-title">${escapeHtml(message.title || t("roleNotice"))}</div>
      ${
        isImportantNotice(message)
          ? ""
          : `<button class="notice-collapse-button" type="button" data-notice-key="${escapeHtml(noticeKey)}">${escapeHtml(
              collapsed ? t("expandNotice") : t("collapseNotice")
            )}</button>`
      }
    </div>
  `;
}

function formatResetTime(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function formatWindow(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return t("window");
  if (value % 10080 === 0) return t("weekWindow", { count: value / 10080 });
  if (value % 1440 === 0) return t("dayWindow", { count: value / 1440 });
  if (value % 60 === 0) return t("hourWindow", { count: value / 60 });
  return t("minuteWindow", { count: value });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pluginDisplayNameFromUri(uri) {
  const name = String(uri || "")
    .replace(/^plugin:\/\//, "")
    .split("@")[0]
    .trim();
  if (!name) return "Plugin";
  const plugin = state.plugins.find((item) => item.uri === uri || item.name === name);
  return plugin?.displayName || name;
}

function pluginIconHtml(plugin, className = "plugin-chip-icon") {
  if (plugin?.iconDataUrl) {
    return `<img class="${className}" src="${escapeHtml(plugin.iconDataUrl)}" alt="" />`;
  }
  const label = String(plugin?.displayName || plugin?.name || "P").trim().slice(0, 1).toUpperCase() || "P";
  return `<span class="${className} fallback" aria-hidden="true">${escapeHtml(label)}</span>`;
}

function pluginMentionMarkdown(plugin) {
  if (!plugin?.uri) return "";
  return `[@${plugin.displayName || plugin.name}](${plugin.uri})`;
}

function renderMessageMarkdown(text) {
  return renderMarkdown(text, {
    parseMarkdown: (source, options) => globalThis.marked?.parse(source, options),
    sanitizeHtml: (html) => globalThis.DOMPurify?.sanitize(html, { USE_PROFILES: { html: true } }),
    renderPluginReference: (label, uri) => {
      const plugin = state.plugins.find((item) => item.uri === uri);
      const displayName = plugin?.displayName || label || pluginDisplayNameFromUri(uri);
      return `<span class="message-plugin-ref">${pluginIconHtml(plugin || { displayName }, "message-plugin-icon")}${escapeHtml(displayName)}</span>`;
    },
    renderLocalImage: (alt, imagePath) => {
      const tokenParam = state.authToken ? `&token=${encodeURIComponent(state.authToken)}` : "";
      const threadParam = state.selectedId ? `&threadId=${encodeURIComponent(state.selectedId)}` : "";
      const src = `/api/local-image?path=${encodeURIComponent(imagePath)}${threadParam}${tokenParam}`;
      return `<img class="message-image generated-image" src="${src}" alt="${escapeHtml(alt)}" loading="lazy" />`;
    }
  });
}

function imageNameFromPath(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "image";
}

function localAssetUrl(endpoint, filePath, fileName = "") {
  const tokenParam = state.authToken ? `&token=${encodeURIComponent(state.authToken)}` : "";
  const threadParam = state.selectedId ? `&threadId=${encodeURIComponent(state.selectedId)}` : "";
  const nameParam = fileName ? `&name=${encodeURIComponent(fileName)}` : "";
  return `${endpoint}?path=${encodeURIComponent(filePath || "")}${nameParam}${threadParam}${tokenParam}`;
}

function markdownImagePaths(content) {
  return new Set(
    Array.from(String(content || "").matchAll(/!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|webp|gif|bmp|svg))\)/gi), (match) => match[1])
  );
}

function renderMessageImages(message) {
  const inlineImages = Array.isArray(message.images) ? message.images : [];
  const localImages = Array.isArray(message.localImages) ? message.localImages : [];
  const markdownPaths = markdownImagePaths(message.content);
  const fileImages = (Array.isArray(message.files) ? message.files : []).filter((file) => file.inline && !markdownPaths.has(file.path));
  if (!inlineImages.length && !localImages.length && !fileImages.length) return "";
  const inlineHtml = inlineImages
    .map((src) => {
      if (typeof src !== "string" || !src.startsWith("data:image/")) return "";
      return `<img class="message-image" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
    })
    .join("");
  const localHtml = localImages
    .map((imagePath) => {
      const name = imageNameFromPath(imagePath);
      if (!/\.(?:png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) return `<span class="message-image-pill">${escapeHtml(name)}</span>`;
      const src = localAssetUrl("/api/local-image", imagePath);
      return `<img class="message-image generated-image" src="${src}" alt="${escapeHtml(name)}" loading="lazy" />`;
    })
    .join("");
  const fileHtml = fileImages
    .map((file) => {
      const src = localAssetUrl("/api/local-image", file.path);
      const href = localAssetUrl("/api/local-file", file.path, file.name || "image");
      return `<a class="message-image-link" href="${href}" download="${escapeHtml(file.name || "image")}" title="${escapeHtml(file.path || "")}">
        <img class="message-image generated-image" src="${src}" alt="${escapeHtml(file.name || "image")}" loading="lazy" />
        <span>${escapeHtml(file.name || "image")}</span>
      </a>`;
    })
    .join("");
  return `<div class="message-images">${inlineHtml}${localHtml}${fileHtml}</div>`;
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMessageFiles(message) {
  const files = (Array.isArray(message.files) ? message.files : []).filter((file) => !file.inline);
  if (!files.length) return "";
  return `<div class="message-files">${files.map((file) => {
    const href = localAssetUrl("/api/local-file", file.path, file.name || "file");
    return `<a class="message-file" href="${href}" download="${escapeHtml(file.name || "file")}" title="${escapeHtml(file.path || "")}">
      <span class="message-file-icon">${file.mimeType?.startsWith("image/") ? "IMG" : "FILE"}</span>
      <span class="message-file-copy"><strong>${escapeHtml(file.name || "file")}</strong><small>${escapeHtml(file.mimeType || "")}${file.size ? ` · ${formatFileSize(file.size)}` : ""}</small></span>
      <span class="message-file-download" aria-hidden="true">↓</span>
    </a>`;
  }).join("")}</div>`;
}

function renderPromotedToolImages(message) {
  if (!messageImageCount(message) || state.showTools) return "";
  const metaBottom = formatMessageDate(message.completedAtMs || message.timestamp);
  return `
    <article class="message assistant tool-image">
      <div class="role">${roleBadge({ role: "assistant" })}</div>
      <div class="bubble">
        ${renderMessageImages(message)}
        ${metaBottom ? `<div class="message-meta message-meta-bottom">${escapeHtml(metaBottom)}</div>` : ""}
      </div>
    </article>
  `;
}

function mimeTypeForFile(file) {
  if (file.type) return file.type;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  return "";
}

function configureImageInput() {
  if (els.imageInput) els.imageInput.accept = IMAGE_INPUT_ACCEPT;
  if (els.imageFileInput) els.imageFileInput.accept = IMAGE_FILE_INPUT_ACCEPT;
}

function closeImagePickerMenu() {
  if (!els.imagePickerMenu) return;
  els.imagePickerMenu.hidden = true;
  els.attachButton.setAttribute("aria-expanded", "false");
}

function toggleImagePickerMenu() {
  if (!els.imagePickerMenu) return;
  const nextOpen = els.imagePickerMenu.hidden;
  els.imagePickerMenu.hidden = !nextOpen;
  els.attachButton.setAttribute("aria-expanded", String(nextOpen));
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("imageUnsupported")));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Invalid image data"))), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image")));
    reader.readAsDataURL(blob);
  });
}

async function fileToImageAttachment(file) {
  const mimeType = mimeTypeForFile(file);
  if (!mimeType.startsWith("image/")) return null;

  const image = await loadImageFromFile(file);
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  if (
    naturalWidth < MIN_IMAGE_EDGE ||
    naturalHeight < MIN_IMAGE_EDGE ||
    naturalWidth > 12000 ||
    naturalHeight > 12000 ||
    naturalWidth * naturalHeight > 60_000_000
  ) {
    throw new Error(t("imageDimensionsInvalid", { min: MIN_IMAGE_EDGE, max: 12000 }));
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Invalid image data");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, "image/jpeg", IMAGE_JPEG_QUALITY);
  if (blob.size < 512 || blob.size > MAX_IMAGE_BYTES) {
    throw new Error(t("imageTooLarge", { size: Math.round(MAX_IMAGE_BYTES / 1024 / 1024) }));
  }
  const dataUrl = await blobToDataUrl(blob);
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: (file.name || "image").replace(/\.[^.]*$/, "") + ".jpg",
    mimeType: "image/jpeg",
    size: blob.size,
    dataUrl,
    data: match[2]
  };
}

function renderImageAttachments() {
  const hasAttachments = state.imageAttachments.length > 0;
  els.attachmentTray.hidden = !hasAttachments;
  // The keyboard-state CSS used to hide every attachment preview. Keep a class
  // on the composer so an image remains visible while the user types a caption.
  els.composerForm.classList.toggle("has-attachments", hasAttachments);
  els.attachmentTray.setAttribute("aria-label", t("attachedImages", { count: state.imageAttachments.length }));
  els.attachmentTray.innerHTML = state.imageAttachments
    .map(
      (image) => `
        <div class="attachment-item">
          <img src="${escapeHtml(image.dataUrl)}" alt="" />
          <span title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</span>
          <button type="button" data-attachment-id="${escapeHtml(image.id)}" aria-label="${escapeHtml(t("removeImage"))}" title="${escapeHtml(t("removeImage"))}">×</button>
        </div>
      `
    )
    .join("");
}

async function addImageFiles(files) {
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  if (state.imageAttachments.length + incoming.length > MAX_IMAGE_ATTACHMENTS) {
    els.sendStatus.textContent = t("tooManyImages", { count: MAX_IMAGE_ATTACHMENTS });
    return;
  }
  try {
    const attachments = (await Promise.all(incoming.map((file) => fileToImageAttachment(file)))).filter(Boolean);
    state.imageAttachments.push(...attachments);
    els.sendStatus.textContent = "";
    renderImageAttachments();
    renderComposerMode();
  } catch (error) {
    els.sendStatus.textContent = error.message;
  }
}

function visibleThreads() {
  const threads = filterVisibleThreads(state.threads, state.filter);
  if (!state.draftThread) return threads;
  return filterVisibleThreads([state.draftThread], state.filter).length ? [state.draftThread, ...threads] : threads;
}

function reminderEnabled(threadId) {
  return Boolean(threadId && state.reminders?.[threadId]);
}

function setThreadReminder(thread, enabled) {
  if (!thread?.id || thread.id === DRAFT_THREAD_ID) return;
  if (enabled) state.reminders[thread.id] = { title: thread.title || t("untitled") };
  else delete state.reminders[thread.id];
  safeStorageSet(localStorage, "codex-thread-reminders", JSON.stringify(state.reminders));
  try {
    globalThis.CodexPocket?.setThreadReminder?.(thread.id, thread.title || t("untitled"), enabled);
  } catch {
    // The desktop browser has no native bridge.
  }
}

const WELCOME_STORAGE_KEY = "turnloom-welcome-seen-v1";

function openWelcomeDialog() {
  if (!els.welcomeDialog) return;
  els.welcomeDialog.hidden = false;
  document.body.classList.add("welcome-open");
  // Focus the dialog itself, not the primary button. Focusing the button painted a
  // focus ring around it on every touch open, which read as a stray double border;
  // Tab still reaches the button and shows the ring when it is actually keyboard focus.
  els.welcomeDialog.querySelector(".welcome-card")?.focus({ preventScroll: true });
}

function closeWelcomeDialog({ remember = true } = {}) {
  if (!els.welcomeDialog) return;
  els.welcomeDialog.hidden = true;
  document.body.classList.remove("welcome-open");
  if (remember) safeStorageSet(localStorage, WELCOME_STORAGE_KEY, "1");
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("empty text");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard unavailable");
}

async function setThreadPin(thread, pinned) {
  if (!thread?.id || thread.id === DRAFT_THREAD_ID) return;
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(thread.id)}/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned })
    });
    thread.pinned = pinned;
    renderThreads();
    await loadThreads(false);
  } catch (error) {
    els.sendStatus.textContent = t("pinFailed", { message: error.message });
  }
}

function closeThreadContextMenu() {
  state.contextThreadId = null;
  els.threadContextMenu.hidden = true;
}

function openThreadContextMenu(threadId, clientX, clientY) {
  const thread = state.threads.find((entry) => entry.id === threadId);
  if (!thread) return;
  state.contextThreadId = threadId;
  els.threadContextTitle.textContent = thread.title || t("untitled");
  els.threadPinAction.textContent = thread.pinned ? t("unpinThread") : t("pinThread");
  els.threadReminderAction.textContent = reminderEnabled(threadId) ? t("reminderOn") : t("reminderOff");
  els.threadCopyLinkAction.textContent = t("copyThreadLink");
  els.threadContextMenu.hidden = false;

  const menuWidth = els.threadContextMenu.offsetWidth;
  const menuHeight = els.threadContextMenu.offsetHeight;
  const margin = 10;
  const left = Math.min(Math.max(margin, clientX), window.innerWidth - menuWidth - margin);
  const top = Math.min(Math.max(margin, clientY), window.innerHeight - menuHeight - margin);
  els.threadContextMenu.style.left = `${left}px`;
  els.threadContextMenu.style.top = `${top}px`;
  els.threadPinAction.focus({ preventScroll: true });
}

function threadStatusLabel(status) {
  // 状态文案按「用户要采取的行动」分：疑険停滞只在列表顶部的
  // 「需要关注」分组里点名，标题/工具提示统一说运行中，避免每条都提示。
  if (status?.thinking) return t("statusRunning");
  if (status?.interactionRequired) return t("statusWaiting");
  if (status?.state === "ended") return t("statusEnded");
  return t("statusUnknown");
}

function compactElapsed(status, now = Date.now()) {
  const start = Number(status?.startedAtMs || 0);
  if (!status?.thinking || !Number.isFinite(start) || start <= 0) return "";
  return formatDuration(now - start);
}
function threadStatusPill(status) {
  if (!status) return "";
  if (status.interactionRequired) {
    return `<span class="status-pill waiting"><span class="status-pill-dot" aria-hidden="true"></span>${escapeHtml(t("statusWaiting"))}</span>`;
  }
  if (status.thinking) {
    const elapsed = compactElapsed(status);
    // 疑険停滞统一在列表顶部的「需要关注」分组点名，标题栏不再重复。
    return `<span class="status-pill running"><span class="status-pill-dot" aria-hidden="true"></span>${escapeHtml(t("statusThinking"))}${
      elapsed ? ` · <span id="threadMetaTime">${escapeHtml(elapsed)}</span>` : ""
    }</span>`;
  }
  if (status.state === "ended") {
    return `<span class="status-pill online"><span class="status-pill-dot" aria-hidden="true"></span>${escapeHtml(t("statusEnded"))}</span>`;
  }
  return "";
}


// 会话归属的文件夹名：优先用宿主给的项目名，其次退回工作目录末段，
// 两者都没有才归到「其他对话」——和分组用的是同一套口径。
function threadFolderLabel(thread) {
  const name = String(thread?.project?.name || "").trim();
  if (name) return name;
  const cwd = String(thread?.cwd || "").replace(/[\\/]+$/, "");
  const segment = cwd.split(/[\\/]+/).filter(Boolean).pop();
  return segment || t("otherConversations");
}
function renderThreads() {
  const counts = threadStatusCounts(state.threads);
  els.threadCount.textContent = t("conversationsCount", { count: state.threads.length });

  // 抽屉顶部的全局状态总览：一眼看到哪些在跑、哪些要我处理、哪些卡住了。
  const setCount = (id, value) => {
    const el = document.querySelector(id);
    if (el) el.textContent = String(value);
  };
  setCount("#statusCountWaiting", counts.waiting);
  setCount("#statusCountRunning", counts.running);
  setCount("#statusCountStale", counts.stale);
  setCount("#statusCountEnded", counts.ended);
  for (const chip of document.querySelectorAll(".status-overview-chip")) {
    chip.classList.toggle("active", chip.dataset.statusFilter === state.statusFilter);
    const n = counts[chip.dataset.statusFilter] || 0;
    chip.classList.toggle("has-items", n > 0);
  }

  // 主标题栏状态条独立占一行，避免大字模式下压住工具栏/消息列表。
  const headerBtn = document.querySelector("#headerStatusButton");
  const headerText = document.querySelector("#headerStatusText");
  const statusRow = document.querySelector(".conversation-status-row");
  if (headerBtn && headerText) {
    const urgent = counts.waiting + counts.stale;
    if (urgent > 0 || counts.running > 0) {
      headerBtn.hidden = false;
      headerBtn.className = `header-status-button${urgent > 0 ? " urgent" : " running"}`;
      const parts = [];
      if (counts.waiting) parts.push(`${counts.waiting} 待处理`);
      if (counts.stale) parts.push(`${counts.stale} 需关注`);
      if (counts.running) parts.push(`${counts.running} 运行中`);
      headerText.textContent = parts.join(" · ");
    } else {
      headerBtn.hidden = true;
      headerText.textContent = "";
    }
    if (statusRow) statusRow.hidden = headerBtn.hidden;
  }

  const renderThread = (thread) => {
    const active = thread.id === state.selectedId ? " active" : "";
    const title = escapeHtml(thread.title || t("untitled"));
    const status = thread.status || {};
    const reminder = reminderEnabled(thread.id);
    const kind = threadStatusKind(status);
    const elapsed = compactElapsed(status);
    const statusText = {
      waiting: t("statusWaiting"),
      running: t("statusThinking"),
      // 疑似停滞只在「需要关注」置顶分组里点名一次；列表行仍显示运行中，
      // 不再在每条会话上重复「长时间无输出」。
      stale: t("statusThinking"),
      ended: t("statusEnded"),
      unknown: t("statusUnknown") || "状态未知"
    }[kind];
    // 每条都带状态条：已结束/未知也要有明确标识，不能只靠灰字小圆点。
    const statusMark = `<span class="thread-status-mark ${kind}" title="${escapeHtml(statusText)}" aria-hidden="true"></span>`;
    const folderChip =
      state.threadSortMode === "recent" && thread.id !== DRAFT_THREAD_ID
        ? `<span class="thread-folder">${escapeHtml(threadFolderLabel(thread))}</span>`
        : "";
    const moreButton = thread.id === DRAFT_THREAD_ID
      ? ""
      : `<button class="thread-more-button" type="button" data-thread-more="${escapeHtml(thread.id)}" aria-label="会话操作" aria-haspopup="menu">⋯</button>`;
    return `
      <div class="thread-row">
        <button class="thread-item${active} status-${kind}${thread.id === DRAFT_THREAD_ID ? " draft" : ""}" data-id="${thread.id}" ${thread.id === DRAFT_THREAD_ID ? "" : 'aria-haspopup="menu"'}>
          ${statusMark}
          <span class="thread-copy">
            <span class="thread-title">${title}</span>${folderChip}
            <span class="thread-status thread-status-${kind}" title="${escapeHtml(statusText)}">
              <span class="thread-status-dot" aria-hidden="true"></span>${escapeHtml(statusText)}${elapsed ? ` · ${escapeHtml(elapsed)}` : ""}
              ${reminder ? `<span class="thread-reminder-state">🔔 ${escapeHtml(t("reminderEnabledLabel"))}</span>` : ""}
            </span>
          </span>
        </button>
        ${moreButton}
      </div>
    `;
  };
  const draft = state.draftThread && filterVisibleThreads([state.draftThread], state.filter).length && !state.statusFilter
    ? renderThread(state.draftThread)
    : "";
  const groups = groupedVisibleThreads(state.threads, {
    query: state.filter,
    pinnedLabel: t("pinnedGroup"),
    ungroupedLabel: t("otherConversations"),
    sortMode: state.threadSortMode,
    statusFilter: state.statusFilter,
    attentionLabel: t("attentionGroup") || "需要关注"
  });
  const searching = Boolean(String(state.filter || "").trim());
  const filtering = Boolean(state.statusFilter);
  const groupCollapsed = (group) => {
    // 「需要关注」永远展开：用户说看见了会自己处理，不能让他再点一次。
    if (group.attention) return false;
    if (searching || filtering) return false;
    const explicit = state.collapsedThreadGroups[group.key];
    if (typeof explicit === "boolean") return explicit;
    return !group.threads.some((thread) => thread.id === state.selectedId);
  };
  els.threadList.innerHTML = `${draft}${groups.map((group) => {
    const collapsed = groupCollapsed(group);
    return `
    <section class="thread-group${group.attention ? " thread-group-attention" : ""}${group.ungrouped ? " thread-group-ungrouped" : ""}${collapsed ? " is-collapsed" : ""}" data-group-key="${escapeHtml(group.key)}">
      <button type="button" class="thread-group-title" data-thread-group-toggle="${escapeHtml(group.key)}" aria-expanded="${String(!collapsed)}">
        <span class="thread-group-name">${escapeHtml(group.label)}</span><span class="thread-group-count">${group.threads.length}</span><span class="thread-group-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg></span>
      </button>
      <div class="thread-group-items">${group.threads.map(renderThread).join("")}</div>
    </section>
  `;
  }).join("")}`;
  const searchEmpty = document.querySelector("#searchEmpty");
  if (searchEmpty) {
    searchEmpty.hidden = !(searching || filtering) || groups.some((group) => group.threads.length);
    searchEmpty.textContent = filtering ? "这个状态下暂时没有对话" : "没有匹配的对话";
  }
  syncThreadSortSegments();
}
function syncThreadSortSegments() {
  const buttons = els.threadSortSegments?.querySelectorAll("[data-thread-sort]") || [];
  for (const button of buttons) {
    const active = button.dataset.threadSort === state.threadSortMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

els.threadSortSegments?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-thread-sort]");
  if (!button) return;
  const next = button.dataset.threadSort === "recent" ? "recent" : "project";
  if (next === state.threadSortMode) return;
  state.threadSortMode = next;
  safeStorageSet(localStorage, "codex-thread-sort-mode", next);
  syncThreadSortSegments();
  renderThreads();
});

// 状态总览：点哪一类就只看哪一类；再点一次取消筛选。
document.querySelector("#statusOverview")?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-status-filter]");
  if (!chip) return;
  const next = chip.dataset.statusFilter;
  state.statusFilter = state.statusFilter === next ? "" : next;
  renderThreads();
  const list = document.querySelector(".thread-list");
  if (list) list.scrollTop = 0;
});

// 主标题栏徽标：直接打开抽屉并跳到「需要人处理」的那一类。
document.querySelector("#headerStatusButton")?.addEventListener("click", () => {
  const counts = threadStatusCounts(state.threads);
  state.statusFilter = counts.waiting ? "waiting" : counts.stale ? "stale" : "running";
  if (els.shell?.classList.contains("sidebar-collapsed")) els.shell.classList.remove("sidebar-collapsed");
  renderThreads();
});

els.threadList.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-thread-group-toggle]");
  if (!toggle) return;
  const key = toggle.dataset.threadGroupToggle;
  state.collapsedThreadGroups[key] = !state.collapsedThreadGroups[key];
  safeStorageSet(localStorage, "codex-collapsed-thread-groups", JSON.stringify(state.collapsedThreadGroups));
  renderThreads();
});

function renderSidebarState() {
  els.shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
}

function isCompactPortrait() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function closeSidebarOnCompact() {
  if (!isCompactPortrait()) return;
  state.sidebarCollapsed = true;
  renderSidebarState();
}

// On a phone the drawer toggle must live *inside* the conversation header: a
// position:fixed button parked over the header gets its taps swallowed by the
// header's own stacking context, so the thread list became unreachable.
function placeDrawerToggle() {
  const toggle = els.sidebarToggle;
  const header = document.querySelector(".conversation-header");
  if (!toggle || !header) return;
  if (isCompactPortrait()) {
    if (toggle.parentElement !== header) header.insertBefore(toggle, header.firstChild);
  } else if (toggle.parentElement !== document.body) {
    document.body.insertBefore(toggle, document.body.firstChild);
  }
}

function initResponsiveSidebar() {
  // On a phone the thread list must start collapsed, otherwise it eats a third of
  // the width and the conversation body is squeezed (QA D04).
  state.sidebarCollapsed = isCompactPortrait();
  placeDrawerToggle();
  renderSidebarState();
  const query = window.matchMedia("(max-width: 760px)");
  const onChange = (event) => {
    if (event.matches) closeSidebarOnCompact();
    else state.sidebarCollapsed = false;
    placeDrawerToggle();
    renderSidebarState();
  };
  if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
  else if (typeof query.addListener === "function") query.addListener(onChange);
}

function roleLabel(message) {
  if (message.role === "assistant") return "Codex";
  if (message.role === "user") return state.locale === "zh" ? "你" : "You";
  if (message.role === "tool") return t("roleTool");
  if (message.role === "interaction") return t("roleInteraction");
  if (message.role === "notice") return t("roleNotice");
  if (state.locale === "zh") return message.role === "developer" ? "开发者指令" : "系统指令";
  return message.role || "System";
}

function roleIcon(message) {
  if (message.role === "assistant") {
    return `<img class="role-icon-image" src="/assets/companion-mark.svg" alt="" />`;
  }
  if (message.role === "user") {
    return `
      <svg class="role-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="2.75" width="10" height="18.5" rx="2.25"></rect>
        <path d="M10.25 5.25h3.5M11 18.25h2"></path>
      </svg>
    `;
  }
  if (message.role === "tool") {
    return `
      <svg class="role-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 5.5 18.5 9.5M16.5 3.5l4 4-11 11H5.5v-4z"></path>
      </svg>
    `;
  }
  if (message.role === "interaction") {
    return `
      <svg class="role-icon-svg interaction-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      </svg>
    `;
  }
  if (message.role === "notice") {
    return `
      <svg class="role-icon-svg notice-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 8h.01"></path>
        <path d="M11 12h1v4h1"></path>
      </svg>
    `;
  }
  const fallbackLabel = String(message.role || "System").slice(0, 1).toUpperCase();
  return `<span class="role-icon-fallback" aria-hidden="true">${escapeHtml(fallbackLabel)}</span>`;
}

function roleBadge(message, repeated = false) {
  // Grouped messages: only the first message of an uninterrupted run names its author.
  // Repeating 「Codex」 above every answer added a line of noise above each reply.
  if (repeated && (message.role === "assistant" || message.role === "tool")) return "";
  return `
    <div class="role-badge" aria-label="${escapeHtml(roleLabel(message))}">
      ${roleIcon(message)}
      <span class="role-text">${escapeHtml(roleLabel(message))}</span>
    </div>
  `;
}

function messageMetaTop(message, previousUserMessage) {
  if (message.role === "user") return "";
  if (message.role === "assistant") {
    const inferredDuration =
      message.durationMs ||
      (previousUserMessage?.timestamp && message.timestamp
        ? new Date(message.timestamp).getTime() - new Date(previousUserMessage.timestamp).getTime()
        : 0);
    const duration = formatDuration(inferredDuration);
    // Without a measurable duration a bare 「耗时」 is a dangling label; the date alone
    // reads better than "耗时 · 10/25 20:52".
    return duration ? `${t("processed")} ${duration}` : "";
  }
  if (message.role === "tool") return message.kind || t("tool");
  if (message.role === "interaction") return message.requiresDesktopAction ? t("interactionRequired") : message.kind || t("roleInteraction");
  if (message.role === "notice") return message.kind || t("roleNotice");
  return message.kind || "";
}

function messageImageCount(message) {
  return (Array.isArray(message.images) ? message.images.length : 0) + (Array.isArray(message.localImages) ? message.localImages.length : 0);
}

function pendingSignature() {
  return state.pendingMessages.map((message) => `${message.id}:${messageImageCount(message)}`).join(",");
}

function pendingMessagesForThread(threadId) {
  return state.pendingMessages.filter((message) => message.threadId === threadId);
}

function mergePendingMessages(data) {
  const threadId = data.thread?.id || state.selectedId;
  const hostMessages = Array.isArray(data.messages) ? data.messages : [];
  // The host may persist a text-only rollout row before its staged image. Keep
  // the optimistic attachment visible on that real row instead of showing a
  // "sent without image" message.
  const withRestoredImages = hostMessages.map((message) => {
    if (message?.role !== "user" || !Array.isArray(message.images) || message.images.length) return message;
    const pending = state.pendingMessages.find((entry) =>
      entry?.threadId === threadId &&
      entry?.role === "user" &&
      Array.isArray(entry.images) &&
      entry.images.length &&
      String(entry.sentContent || entry.content || "").trim() === String(message.content || "").trim()
    );
    return pending ? { ...message, images: [...pending.images], restoredAttachments: true } : message;
  });
  state.pendingMessages = reconcilePendingMessages(state.pendingMessages, withRestoredImages, threadId);
  const pending = pendingMessagesForThread(threadId).filter((message) => message.deliveryStatus !== "queued");
  if (!pending.length) return withRestoredImages;
  return [...withRestoredImages, ...pending];
}

function mergeRestoredPendingImages(messages, restoredMessages) {
  if (!Array.isArray(messages) || !Array.isArray(restoredMessages)) return messages || [];
  const byIndex = new Map();
  restoredMessages.forEach((message, index) => {
    if (message?.restoredAttachments && Array.isArray(message.images)) byIndex.set(index, message.images);
  });
  if (!byIndex.size) return messages;
  return messages.map((message, index) => {
    const images = byIndex.get(index);
    if (!images || !Array.isArray(message?.images) || message.images.length >= images.length) return message;
    return { ...message, images, restoredAttachments: true };
  });
}

function pendingDeliveryHtml(message) {
  if (message.role !== "user" || !message.deliveryStatus || message.deliveryStatus === "sent") return "";
  if (message.deliveryStatus === "failed") {
    return `<div class="message-delivery failed"><span>${escapeHtml(t("messageFailed"))}</span><button type="button" class="message-retry-button" data-pending-action="retry">${escapeHtml(t("retrySend"))}</button></div>`;
  }
  if (message.deliveryStatus === "queued") {
    return `<div class="message-delivery queued">${escapeHtml(t("messageQueued"))}</div>`;
  }
  return `<div class="message-delivery sending">${escapeHtml(t("messageSending"))}</div>`;
}

// Native Android back first dismisses the active web surface instead of
// destroying the workspace and losing the current draft.
globalThis.codexPocketHandleBack = () => {
  if (els.goalEditDialog && !els.goalEditDialog.hidden) {
    closeGoalEditDialog();
    return true;
  }
  if (state.modelPanelOpen) {
    closeModelPanel();
    return true;
  }
  if (state.pluginMenuOpen) {
    closePluginMentionMenu();
    return true;
  }
  if (state.skillMenuOpen) {
    closeSkillMentionMenu();
    return true;
  }
  if (els.imagePickerMenu && !els.imagePickerMenu.hidden) {
    closeImagePickerMenu();
    return true;
  }
  if (state.sidebarCollapsed === false && isCompactPortrait()) {
    state.sidebarCollapsed = true;
    renderSidebarState();
    return true;
  }
  return false;
};

function renderCurrentMessages(scrollToBottom = true) {
  const data =
    state.lastMessagesData || {
      thread: state.selectedId === DRAFT_THREAD_ID ? state.draftThread : state.threads.find((thread) => thread.id === state.selectedId) || null,
      messages: [],
      status: state.threadStatus || { thinking: false }
    };
  renderMessages(data);
  if (scrollToBottom) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }
  updateScrollToBottomButton();
}

function renderMessageLoading() {
  els.messageList.innerHTML = `<div class="message-loading" role="status" aria-live="polite"><span class="message-loading-spinner" aria-hidden="true"></span><span>${escapeHtml(t("loading"))}</span></div>`;
  updateScrollToBottomButton();
}

function isMessageListNearBottom() {
  return els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight < 120;
}

function updateScrollToBottomButton() {
  const canScroll = els.messageList.scrollHeight > els.messageList.clientHeight + 8;
  els.scrollToBottomButton.hidden = !canScroll || isMessageListNearBottom();
}

function updateComposerHeightVariable() {
  els.composerForm.parentElement?.style.setProperty("--composer-height", `${els.composerForm.offsetHeight}px`);
}

function scrollMessagesToBottom({ smooth = true } = {}) {
  els.messageList.scrollTo({
    top: els.messageList.scrollHeight,
    behavior: smooth ? "smooth" : "auto"
  });
  window.setTimeout(updateScrollToBottomButton, smooth ? 220 : 0);
}

function autoResizeComposerInput() {
  const input = els.composerInput;
  input.style.height = "auto";
  const maxHeight = Number.parseFloat(getComputedStyle(input).maxHeight) || 170;
  const nextHeight = Math.min(input.scrollHeight, maxHeight);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  updateComposerHeightVariable();
  updateScrollToBottomButton();
}

function addPendingUserMessage(threadId, content, images = []) {
  const pending = {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    threadId,
    role: "user",
    kind: "pending",
    deliveryStatus: "sending",
    timestamp: new Date().toISOString(),
    content,
    sentContent: content,
    images: images.map((image) => image.dataUrl),
    attachments: images.map(({ name, mimeType, size, data, dataUrl }) => ({ name, mimeType, size, data, dataUrl }))
  };
  state.pendingMessages.push(pending);
  state.messagesSignature = "";
  renderCurrentMessages(true);
  return pending.id;
}

function updatePendingMessage(id, patch) {
  const pending = state.pendingMessages.find((message) => message.id === id);
  if (!pending) return;
  Object.assign(pending, patch);
  state.messagesSignature = "";
  renderCurrentMessages(false);
}

function retryPendingMessage(message) {
  if (!message || message.deliveryStatus !== "failed" || state.composerBusy) return;
  state.pendingMessages = state.pendingMessages.filter((entry) => entry.id !== message.id);
  els.composerInput.value = message.sentContent || message.content || "";
  state.imageAttachments = (message.attachments || []).map((image, index) => ({
    id: `retry-${Date.now()}-${index}`,
    name: image.name || "image.jpg",
    mimeType: image.mimeType || "image/jpeg",
    size: Number(image.size) || 0,
    data: image.data || String(image.dataUrl || "").split(",")[1] || "",
    dataUrl: image.dataUrl || (image.data ? `data:${image.mimeType || "image/jpeg"};base64,${image.data}` : "")
  }));
  state.messagesSignature = "";
  renderImageAttachments();
  autoResizeComposerInput();
  renderCurrentMessages(false);
  els.composerForm.requestSubmit();
}

function goalStatusLabel(status) {
  const key = String(status || "");
  const labels = {
    active: "goalStatusActive",
    paused: "goalStatusPaused",
    blocked: "goalStatusBlocked",
    usageLimited: "goalStatusUsageLimited",
    budgetLimited: "goalStatusBudgetLimited",
    complete: "goalStatusComplete"
  };
  return labels[key] ? t(labels[key]) : key;
}

function renderGoal(goal) {
  const hidden = !state.selectedId || state.selectedId === DRAFT_THREAD_ID || !goal?.objective;
  els.goalPanel.hidden = hidden;
  els.goalContextMenu.hidden = true;
  els.goalView.hidden = hidden;
  if (hidden) {
    closeGoalEditDialog();
    return;
  }
  els.goalObjective.textContent = goal?.objective || "";
  els.goalObjective.classList.remove("empty");
  els.goalStatus.textContent = goalStatusLabel(goal?.status);
  els.goalDetailObjective.textContent = goal.objective;
  els.goalDetailStatus.textContent = goalStatusLabel(goal.status);
}

function openGoalDetailDialog() {
  if (!state.goal?.objective || !els.goalEditDialog) return;
  state.goalEditing = false;
  renderGoal(state.goal);
  els.goalDialogTitle.textContent = t("goalDetail");
  els.goalDetailView.hidden = false;
  els.goalForm.hidden = true;
  els.goalEditDialog.hidden = false;
  document.body.classList.add("goal-dialog-open");
  els.goalDetailBackButton.focus();
}

function openGoalEditDialog() {
  if (!state.goal?.objective || !els.goalEditDialog) return;
  state.goalEditing = true;
  els.goalDialogTitle.textContent = t("goalEdit");
  els.goalDetailView.hidden = true;
  els.goalForm.hidden = false;
  els.goalObjectiveInput.value = state.goal.objective || "";
  els.goalStatusInput.value = state.goal.status || "active";
  els.goalEditDialog.hidden = false;
  document.body.classList.add("goal-dialog-open");
  requestAnimationFrame(() => {
    els.goalObjectiveInput.focus();
    els.goalObjectiveInput.setSelectionRange(els.goalObjectiveInput.value.length, els.goalObjectiveInput.value.length);
  });
}

function closeGoalEditDialog() {
  const wasOpen = els.goalEditDialog && !els.goalEditDialog.hidden;
  state.goalEditing = false;
  if (els.goalEditDialog) els.goalEditDialog.hidden = true;
  document.body.classList.remove("goal-dialog-open");
  if (wasOpen && !els.goalPanel.hidden) els.goalView.focus();
}

async function requestContextCompaction() {
  if (!state.selectedId || state.selectedId === DRAFT_THREAD_ID || !state.config?.allowWrite) return;
  try {
    await postJson(`/api/threads/${encodeURIComponent(state.selectedId)}/compact`, {});
    els.sendStatus.textContent = t("compactStarted");
    refreshSoon(500);
  } catch (error) {
    els.sendStatus.textContent = error.message;
  }
}

function openGoalContextMenu() {
  if (!state.goal?.objective || !els.goalContextMenu) return;
  els.goalContextMenu.hidden = false;
}

async function updateGoalStatus(status) {
  if (!state.selectedId || !state.goal?.objective) return;
  try {
    const data = await fetchJson(`/api/threads/${encodeURIComponent(state.selectedId)}/goal`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: state.goal.objective, status })
    });
    state.goal = data.goal || null;
    els.goalContextMenu.hidden = true;
    renderGoal(state.goal);
  } catch (error) {
    els.sendStatus.textContent = t("goalSaveFailed", { message: error.message });
  }
}

function renderMessages(data) {
  const selected = state.selectedId === DRAFT_THREAD_ID ? state.draftThread : state.threads.find((thread) => thread.id === state.selectedId);
  els.threadTitle.textContent = selected?.title || data.thread?.title || t("untitled");
  state.goal = data.goal || null;
  renderGoal(state.goal);
  const displayMessages = mergePendingMessages(data);
  const statusPill = threadStatusPill(data.status);
  const attentionNote =
    !data.status?.thinking && !data.status?.interactionRequired && data.status?.possibleDesktopAttention
      ? `<span class="thread-meta-note">${escapeHtml(t("desktopMayNeedAttention"))}</span>`
      : "";
  // An empty conversation already says so in the body; a "0 条内容" pill next to the
  // title just repeats it (QA D05).
  const visibleCount = displayMessages.filter((message) => state.showTools || !["tool", "system", "developer"].includes(message.role)).length;
  const countNote = visibleCount
    ? `<span class="thread-meta-count">${escapeHtml(t("contents", { count: visibleCount }))}</span>`
    : "";
  // 疑似停滞的提示统一放到列表顶部的「需要关注」分组，标题栏不再重复。
  els.threadMeta.innerHTML = `${statusPill}${countNote}${attentionNote}`;

  if (!displayMessages.length && !data.status?.thinking) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(state.selectedId === DRAFT_THREAD_ID ? t("newConversationReady") : t("emptyThread"))}</div>`;
    updateScrollToBottomButton();
    return;
  }

  let previousUserMessage = null;
  let previousRole = null;
  // Messages coming from the PI bridge carry no id, so the copy affordance is keyed by
  // render index instead of id (the branch button silently never appeared for them).
  state.displayMessages = displayMessages;
  const messageHtml = displayMessages
    .map((message, index) => {
      const isTool = message.role === "tool";
      const isInteraction = message.role === "interaction";
      const isNotice = message.role === "notice";
      const noticeKey = isNotice ? noticeCollapseKey(message) : "";
      const noticeCollapsed = isNotice && !isImportantNotice(message) && !state.expandedNotices[noticeKey];
      const isDetail = isTool || message.role === "system" || message.role === "developer";
      const hidden = isDetail && !state.showTools ? " hidden" : "";
      const toolTitle = `<div class="tool-title"><span class="tool-kind-chip">${escapeHtml(message.kind || t("tool"))}</span>${
        message.title ? `<span class="tool-path">${escapeHtml(message.title)}</span>` : ""
      }</div>`;
      const interactionTitle = message.canApprove
        ? `<div class="approval-head"><span class="status-pill waiting"><span class="status-pill-dot" aria-hidden="true"></span>${escapeHtml(
            t("interactionRequired")
          )} · ${escapeHtml(t("interactionDesktopAction"))}</span></div><p class="approval-question">${escapeHtml(
            approvalQuestion(message)
          )}</p>`
        : `<div class="interaction-title">${escapeHtml(t("interactionDesktopAction"))}</div>`;
      const title = isNotice
        ? renderNoticeTitle(message, noticeCollapsed, noticeKey)
        : isTool
          ? toolTitle
          : isInteraction
            ? interactionTitle
            : "";
      const metaTop = messageMetaTop(message, previousUserMessage);
      const metaBottom = formatMessageDate(message.completedAtMs || message.timestamp);
      const metaLine = [metaTop, metaBottom].filter(Boolean).join(" · ");
      // Group consecutive messages from the same author: repeat the name only when the
      // author actually changes, otherwise a run of answers is four times taller than it
      // needs to be. The time/duration caption stays on every message.
      const badge = roleBadge(message, message.role === previousRole);
      const roleRow =
        badge || metaLine
          ? `<div class="role">${badge}${metaLine ? `<span class="role-meta">${escapeHtml(metaLine)}</span>` : ""}</div>`
          : "";
      if (message.role === "user") previousUserMessage = message;
      previousRole = message.role;
      const pendingClass = message.deliveryStatus && message.deliveryStatus !== "sent" ? " pending" : "";
      const pendingId = message.deliveryStatus ? ` data-pending-id="${escapeHtml(message.id || "")}"` : "";
      const messageIndexAttr = ` data-message-index="${index}"`;
      const messageArticle = `
        <article class="message ${escapeHtml(message.role)}${pendingClass}${hidden}"${pendingId}${messageIndexAttr} data-message-id="${escapeHtml(message.id || "")}" data-turn-id="${escapeHtml(message.turnId || "")}">
          ${roleRow}
          <div class="bubble">
            ${title}
            ${
              !noticeCollapsed && message.content
                ? isInteraction
                  ? renderInteractionBody(message)
                  : renderMessageMarkdown(message.content)
                : ""
            }
            ${!noticeCollapsed ? renderMessageImages(message) : ""}
            ${!noticeCollapsed ? renderMessageFiles(message) : ""}
            ${renderApprovalActions(message)}
            ${pendingDeliveryHtml(message)}
          </div>
        </article>
      `;

/**
 * 应用内确认层。WebChromeClient 默认会把 confirm() 画成安卓系统对话框，
 * 一眼看出是网页。所有需要确认的动作都走这里，样式与 App 其余弹层一致。
 */
function appConfirm(message, { title = "请确认", confirmText = "确定", cancelText = "取消", danger = false } = {}) {
  const backdrop = document.querySelector("#appDialogBackdrop");
  const dialog = document.querySelector("#appDialog");
  if (!backdrop || !dialog) return Promise.resolve(window.confirm(message));
  document.querySelector("#appDialogTitle").textContent = title;
  document.querySelector("#appDialogBody").textContent = message;
  const cancel = document.querySelector("#appDialogCancel");
  const ok = document.querySelector("#appDialogConfirm");
  cancel.textContent = cancelText;
  ok.textContent = confirmText;
  dialog.classList.toggle("danger", danger);
  backdrop.hidden = false;
  dialog.hidden = false;
  ok.focus({ preventScroll: true });
  return new Promise((resolve) => {
    const done = (value) => {
      backdrop.hidden = true;
      dialog.hidden = true;
      backdrop.removeEventListener("click", onCancel);
      cancel.removeEventListener("click", onCancel);
      ok.removeEventListener("click", onOk);
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onCancel = () => done(false);
    const onOk = () => done(true);
    const onKey = (event) => {
      if (event.key === "Escape") done(false);
    };
    backdrop.addEventListener("click", onCancel);
    cancel.addEventListener("click", onCancel);
    ok.addEventListener("click", onOk);
    document.addEventListener("keydown", onKey);
  });
}
      return `${messageArticle}${isTool ? renderPromotedToolImages(message) : ""}`;
    })
    .join("");
  const thinkingHtml = data.status?.thinking
    ? `
      <article class="message assistant thinking-message">
        <div class="role">${roleBadge({ role: "assistant" })}<span class="role-meta running-time">${escapeHtml(
          runningTimeLabel(data.status, Date.now(), state.locale) || t("processing")
        )}</span></div>
        <div class="bubble thinking-bubble">
          <p>${escapeHtml(t("thinking").replace("...", ""))}<span class="thinking-dots" aria-hidden="true"></span></p>
        </div>
      </article>
    `
    : "";
  els.messageList.innerHTML = `${messageHtml}${thinkingHtml}`;
  updateScrollToBottomButton();
}

// 每条消息下面常驻的「复制」「从这里创建分支」两个按钮被去掉了：它们把气泡
// 撑得比正文还高，而且分支按钮在 PI 会话里根本出不来（PI 消息没有 id）。
// 现在改成「长按消息」弹出操作单，按 turnId 分支 —— PI 会话每条消息都带 turnId。
function messageActionTarget(node) {
  const article = node?.closest?.("article.message");
  if (!article) return null;
  const role = article.classList.contains("user") ? "user" : article.classList.contains("assistant") ? "assistant" : "";
  if (!role) return null;
  const index = Number(article.dataset.messageIndex);
  const message = Number.isInteger(index) ? state.displayMessages?.[index] : null;
  if (!message || message.deliveryStatus) return null;
  const text = String(message.content || "").trim();
  if (!text && !message.turnId) return null;
  return { article, role, index, text, turnId: String(article.dataset.turnId || message.turnId || "") };
}

const messageActionState = { target: null };
const LONG_PRESS_MS = 450;

function closeMessageActions() {
  if (els.messageActionSheet) els.messageActionSheet.hidden = true;
  if (els.messageActionBackdrop) els.messageActionBackdrop.hidden = true;
  messageActionState.target = null;
}

function openMessageActions(target) {
  if (!target || !els.messageActionSheet) return;
  messageActionState.target = target;
  // 没有 turnId 就没有可分支的基点：直接隐藏这一项，而不是留一个点了没反应的
  // 按钮。PI 会话的每条消息都带 turnId，所以这里基本不会隐藏。
  const canBranch = Boolean(target.turnId);
  if (els.messageBranchItem) {
    els.messageBranchItem.hidden = !canBranch;
    els.messageBranchItem.disabled = !canBranch;
  }
  if (els.messageCopyItem) els.messageCopyItem.disabled = !target.text;
  if (els.messageSelectItem) els.messageSelectItem.disabled = !target.text;
  els.messageActionBackdrop.hidden = false;
  els.messageActionSheet.hidden = false;
}

function selectMessageText(target) {
  if (!target?.article) return;
  const bubble = target.article.querySelector(".bubble") || target.article;
  target.article.classList.add("selecting");
  const range = document.createRange();
  range.selectNodeContents(bubble);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  els.sendStatus.textContent = t("textSelected");
}

function wireMessageActions() {
  if (!els.messageList) return;
  let timer = null;
  let start = null;
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    start = null;
  };

  els.messageList.addEventListener("pointerdown", (event) => {
    if (typeof event.button === "number" && event.button !== 0) return;
    const target = messageActionTarget(event.target);
    if (!target) return;
    start = { x: event.clientX, y: event.clientY };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // A short tick confirms the long press without stealing focus.
      if (navigator.vibrate) navigator.vibrate(12);
      openMessageActions(target);
    }, LONG_PRESS_MS);
  });

  // 滑动必须取消长按，否则想滚动列表就会冒出一个菜单。
  els.messageList.addEventListener("pointermove", (event) => {
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10) cancel();
  });
  els.messageList.addEventListener("pointerup", cancel);
  els.messageList.addEventListener("pointercancel", cancel);
  // 桌面端用右键，不必按住等。
  els.messageList.addEventListener("contextmenu", (event) => {
    const target = messageActionTarget(event.target);
    if (!target) return;
    event.preventDefault();
    cancel();
    openMessageActions(target);
  });

  els.messageActionBackdrop?.addEventListener("click", closeMessageActions);
  els.messageCopyItem?.addEventListener("click", async () => {
    const target = messageActionState.target;
    closeMessageActions();
    if (!target?.text) return;
    const ok = await writeClipboard(target.text);
    flashSendStatus(ok ? t("copiedMessage") : t("copyFailed"));
  });
  els.messageSelectItem?.addEventListener("click", () => {
    const target = messageActionState.target;
    closeMessageActions();
    selectMessageText(target);
  });
  els.messageBranchItem?.addEventListener("click", async () => {
    const target = messageActionState.target;
    closeMessageActions();
    if (!target?.turnId) return;
    await createMessageBranch(target.turnId);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.messageActionSheet && !els.messageActionSheet.hidden) closeMessageActions();
  });
}

async function writeClipboard(text) {
  // Inside the Android shell, the native writer is the only path that does not depend on
  // a secure context or a trusted gesture, so prefer it.
  try {
    if (window.CodexPocket?.copyText) {
      window.CodexPocket.copyText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand path
  }
  // The workspace is served over plain http on a LAN address, so it is not a secure
  // context and navigator.clipboard is unavailable inside the WebView.
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

// 「已复制」这条提示两秒后收掉，免得一直挂在输入框下面。
function flashSendStatus(text) {
  els.sendStatus.textContent = text;
  window.setTimeout(() => {
    if (els.sendStatus.textContent === text) els.sendStatus.textContent = "";
  }, 2000);
}
window.setInterval(() => {
  if (document.hidden) return;
  const label = els.messageList.querySelector(".running-time");
  if (label) {
    const text = runningTimeLabel(state.threadStatus, Date.now(), state.locale) || t("processing");
    if (label.textContent !== text) label.textContent = text;
  }
  const metaTime = document.querySelector("#threadMetaTime");
  if (metaTime) {
    const compact = compactElapsed(state.threadStatus, Date.now());
    if (compact && metaTime.textContent !== compact) metaTime.textContent = compact;
  }
}, 1000);
function isNetworkFailure(error) {
  if (!error || error.status) return false;
  if (error instanceof TypeError) return true;
  return /failed to fetch|load failed|fetch failed|network request failed|networkerror|err_internet|err_connection/i.test(
    error.message || ""
  );
}

// Turn low-level transport/HTTP failures into something a user can act on.
function friendlyErrorMessage(error) {
  // AbortSignal.timeout() rejects with a TimeoutError DOMException; without this the
  // user would read the raw "signal timed out" text.
  if (error?.name === "TimeoutError" || /signal timed out|timeout/i.test(error?.message || "")) {
    return t("requestTimedOut");
  }
  if (error?.friendly) return error.friendly;
  if (isNetworkFailure(error)) return t("networkUnreachable");
  const status = Number(error?.status) || 0;
  if (status === 401) return t("accessCodeWrong");
  if (status >= 500) return t("serverError", { status });
  const raw = (error?.message || "").trim();
  if (!raw) return t("networkUnreachable");
  // A bare HTTP reason phrase ("Not Found") tells the user nothing; anything the
  // server phrased on purpose is already human-readable, so pass it through.
  if (/^[A-Z][A-Za-z ]{3,40}$/.test(raw)) return t("requestFailed", { message: raw });
  return raw;
}

async function appFetch(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (isNetworkFailure(error) && error instanceof Error) error.friendly = t("networkUnreachable");
    throw error;
  }
}

async function readJsonBody(response) {
  try {
    return await response.json();
  } catch (error) {
    const wrapped = new Error("unreadable response");
    wrapped.status = response.status || 502;
    wrapped.friendly = t("serverError", { status: response.status || 502 });
    throw wrapped;
  }
}
async function fetchJson(url, options = {}) {
  const response = await appFetch(url, {
    cache: "no-store",
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const data = await readJsonBody(response);
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  return data;
}

async function fetchThreads(url) {
  const cached = state.threadListCache?.url === url ? state.threadListCache : null;
  const headers = authHeaders(cached?.etag ? { "if-none-match": cached.etag } : {});
  const response = await appFetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(THREADS_REQUEST_TIMEOUT_MS) });
  if (response.status === 304 && cached) return cached.data;
  const data = await readJsonBody(response);
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  state.threadListCache = { url, etag: response.headers.get("etag") || "", data };
  return data;
}

function syncDelay(baseMs, backoffMs = 0) {
  const hiddenMultiplier = document.hidden ? 4 : 1;
  return Math.max(baseMs * hiddenMultiplier, baseMs + backoffMs);
}

function nextBackoff(currentMs, baseMs, maxMs) {
  return Math.min(maxMs, currentMs ? currentMs * 2 : baseMs);
}

function noteSyncSuccess(kind) {
  state[`${kind}SyncBackoffMs`] = 0;
  state.lastSyncActivityAt = Date.now();
}

function noteSyncFailure(kind, baseMs, maxMs) {
  state[`${kind}SyncBackoffMs`] = nextBackoff(state[`${kind}SyncBackoffMs`] || 0, baseMs, maxMs);
}

async function loadPlugins() {
  if (state.pluginsLoaded || state.pluginsLoading) return;
  state.pluginsLoading = true;
  renderPluginMentionMenu();
  try {
    const data = await fetchJson("/api/plugins");
    applyHomeContext(data);
    state.plugins = Array.isArray(data.plugins) ? data.plugins : [];
    state.pluginsLoaded = true;
  } catch (error) {
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    state.plugins = [];
  } finally {
    state.pluginsLoading = false;
    renderPluginMentionMenu();
  }
}

async function loadSkills() {
  if (state.skillsLoaded || state.skillsLoading) return;
  state.skillsLoading = true;
  renderSkillMentionMenu();
  try {
    const data = await fetchJson("/api/skills");
    applyHomeContext(data);
    state.skills = Array.isArray(data.skills) ? data.skills : [];
    state.skillsLoaded = true;
  } catch (error) {
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    state.skills = [];
  } finally {
    state.skillsLoading = false;
    renderSkillMentionMenu();
  }
}

async function postJson(url, body, options = {}) {
  const response = await appFetch(url, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
    ...options
  });
  const data = await readJsonBody(response);
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  return data;
}

async function getJson(url) {
  const response = await appFetch(url, { headers: authHeaders() });
  const data = await readJsonBody(response);
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  return data;
}

/**
 * Projects (= folders) a new conversation can be filed into.
 *
 * Same list the server uses to validate the choice, so the picker can never
 * offer something the host would reject. The remembered project is restored so
 * filing consecutive conversations into the same folder stays one tap.
 */
async function loadProjects() {
  try {
    const data = await getJson("/api/projects");
    state.projects = Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    state.projects = [];
  }
  renderDraftProjectPicker();
}

function renderDraftProjectPicker() {
  const select = els.draftProjectSelect;
  if (!select) return;
  const known = new Set(state.projects.map((project) => project.id));
  if (state.draftProjectId && !known.has(state.draftProjectId)) state.draftProjectId = "";
  const options = ['<option value="">不指定项目</option>'];
  for (const project of state.projects) {
    const label = project.threadCount ? `${project.name} · ${project.threadCount}` : project.name;
    options.push(`<option value="${escapeHtml(project.id)}">${escapeHtml(label)}</option>`);
  }
  select.innerHTML = options.join("");
  select.value = state.draftProjectId || "";
}

function syncDraftProjectRow() {
  const visible = Boolean(state.draftThread) && state.projects.length > 0;
  if (els.draftProjectRow) els.draftProjectRow.hidden = !visible;
}

function pluginMentionMatch() {
  const input = els.composerInput;
  const cursor = input.selectionStart ?? 0;
  const before = input.value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const prefix = before.slice(Math.max(0, at - 1), at);
  if (prefix && !/\s/.test(prefix)) return null;
  const query = before.slice(at + 1);
  if (/[\n\r()[\]{}<>]/.test(query) || query.length > 48) return null;
  return { start: at, end: cursor, query };
}

function skillMentionMatch() {
  const input = els.composerInput;
  const cursor = input.selectionStart ?? 0;
  const before = input.value.slice(0, cursor);
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  const prefix = before.slice(Math.max(0, slash - 1), slash);
  if (prefix && !/\s/.test(prefix)) return null;
  const query = before.slice(slash + 1);
  if (/[\n\r()[\]{}<>/@]/.test(query) || query.length > 48) return null;
  return { start: slash, end: cursor, query };
}

function filteredPlugins() {
  const query = state.pluginQuery.trim().toLowerCase();
  const plugins = state.plugins || [];
  if (!query) return plugins.slice(0, 12);
  return plugins
    .map((plugin) => {
      const displayName = String(plugin.displayName || "").toLowerCase();
      const name = String(plugin.name || "").toLowerCase();
      const marketplace = String(plugin.marketplace || "").toLowerCase();
      const description = String(plugin.description || "").toLowerCase();
      let score = 0;
      if (displayName === query || name === query) score = 100;
      else if (displayName.startsWith(query) || name.startsWith(query)) score = 80;
      else if (displayName.includes(query) || name.includes(query)) score = 60;
      else if (marketplace.includes(query)) score = 30;
      else if (description.includes(query)) score = 10;
      return { plugin, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.plugin.displayName || a.plugin.name).localeCompare(b.plugin.displayName || b.plugin.name, undefined, { sensitivity: "base" }))
    .map((item) => item.plugin)
    .slice(0, 12);
}

function filteredSkills() {
  const query = state.skillQuery.trim().toLowerCase();
  const skills = state.skills || [];
  if (!query) return skills;
  return skills
    .map((skill) => {
      const displayName = String(skill.displayName || skill.name || "").toLowerCase();
      const source = String(skill.source || "").toLowerCase();
      const description = String(skill.description || "").toLowerCase();
      let score = 0;
      if (displayName === query) score = 100;
      else if (displayName.startsWith(query)) score = 80;
      else if (displayName.includes(query)) score = 60;
      else if (source.includes(query)) score = 30;
      else if (description.includes(query)) score = 10;
      return { skill, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.skill.priority ?? 999) - (b.skill.priority ?? 999) || (a.skill.displayName || a.skill.name).localeCompare(b.skill.displayName || b.skill.name, undefined, { sensitivity: "base" }))
    .map((item) => item.skill)
}

function closePluginMentionMenu() {
  state.pluginMenuOpen = false;
  state.pluginQuery = "";
  state.pluginTriggerStart = -1;
  state.pluginActiveIndex = 0;
  els.pluginPickerButton?.setAttribute("aria-expanded", "false");
  els.pluginPickerButton?.classList.remove("active");
  if (els.pluginMentionMenu) {
    els.pluginMentionMenu.hidden = true;
    els.pluginMentionMenu.innerHTML = "";
  }
}

function closeSkillMentionMenu() {
  state.skillMenuOpen = false;
  state.skillQuery = "";
  state.skillTriggerStart = -1;
  state.skillActiveIndex = 0;
  els.skillPickerButton?.setAttribute("aria-expanded", "false");
  els.skillPickerButton?.classList.remove("active");
  if (els.skillMentionMenu) {
    els.skillMentionMenu.hidden = true;
    els.skillMentionMenu.innerHTML = "";
  }
}

function renderSelectedPlugins() {
  if (!els.pluginMentionTray) return;
  els.pluginMentionTray.hidden = state.selectedPlugins.length === 0;
  els.pluginMentionTray.innerHTML = state.selectedPlugins
    .map(
      (plugin) => `
        <button class="plugin-chip" type="button" data-plugin-uri="${escapeHtml(plugin.uri)}" title="${escapeHtml(plugin.displayName || plugin.name)}">
          ${pluginIconHtml(plugin)}
          <span>${escapeHtml(plugin.displayName || plugin.name)}</span>
          <small aria-hidden="true">×</small>
        </button>
      `
    )
    .join("");
}

function renderSelectedSkills() {
  if (!els.skillMentionTray) return;
  els.skillMentionTray.hidden = state.selectedSkills.length === 0;
  els.skillMentionTray.innerHTML = state.selectedSkills
    .map(
      (skill) => `
        <button class="plugin-chip skill-chip" type="button" data-skill-uri="${escapeHtml(skill.uri)}" title="${escapeHtml(skill.displayName || skill.name)}">
          <span class="plugin-chip-icon skill-chip-icon fallback">/</span>
          <span>${escapeHtml(skill.displayName || skill.name)}</span>
          <small aria-hidden="true">×</small>
        </button>
      `
    )
    .join("");
}

function clearSelectedPlugins() {
  state.selectedPlugins = [];
  renderSelectedPlugins();
}

function clearSelectedSkills() {
  state.selectedSkills = [];
  renderSelectedSkills();
}

function selectedPluginMarkdown() {
  return state.selectedPlugins.map((plugin) => pluginMentionMarkdown(plugin)).filter(Boolean).join(" ");
}

function selectedSkillPrompt() {
  const names = state.selectedSkills.filter((skill) => skill.kind !== "builtin").map((skill) => skill.displayName || skill.name).filter(Boolean);
  if (!names.length) return "";
  return `${names.length === 1 ? "Use skill" : "Use skills"}: ${names.join(", ")}.`;
}

function composerSendMessage(message) {
  return [selectedSkillPrompt(), selectedPluginMarkdown(), message.trim()].filter(Boolean).join("\n\n").trim();
}

// Clear every composer surface after Desktop has accepted a send. Keep this
// idempotent because Android WebView can restore a form value during an async
// refresh or while the composer transitions between busy and ready states.
function clearComposerAfterAcceptedSend() {
  els.composerInput.value = "";
  els.composerInput.defaultValue = "";
  try {
    els.composerInput.setSelectionRange(0, 0);
  } catch {
    // Selection APIs are unavailable while some mobile inputs are detached.
  }
  els.composerInput.dispatchEvent(new Event("input", { bubbles: true }));
  clearSelectedPlugins();
  clearSelectedSkills();
  state.imageAttachments = [];
  els.imageInput.value = "";
  els.imageFileInput.value = "";
  renderImageAttachments();
  autoResizeComposerInput();
}

function messageContentText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(messageContentText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return [value.text, value.content, value.message, value.prompt].map(messageContentText).filter(Boolean).join("\n");
}

function hasDisplayedUserMessage(text) {
  const expected = String(text || "").trim();
  if (!expected) return false;
  return (state.lastMessagesData?.messages || []).some((message) => {
    return message?.role === "user" && messageContentText(message.content || message.text || message).includes(expected);
  });
}

function hasComposerPayload() {
  return Boolean(els.composerInput.value.trim() || state.selectedPlugins.length || state.selectedSkills.length || state.imageAttachments.length);
}

function renderPluginMentionMenu() {
  if (!els.pluginMentionMenu || !state.pluginMenuOpen) return;
  if (state.pluginsLoading) {
    els.pluginMentionMenu.hidden = false;
    els.pluginMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("pluginPickerLoading"))}</div>`;
    return;
  }
  const plugins = filteredPlugins();
  state.pluginActiveIndex = Math.max(0, Math.min(state.pluginActiveIndex, Math.max(plugins.length - 1, 0)));
  els.pluginMentionMenu.hidden = false;
  if (!plugins.length) {
    els.pluginMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("pluginPickerEmpty"))}</div>`;
    return;
  }
  els.pluginMentionMenu.innerHTML = `
    <div class="plugin-mention-heading">${escapeHtml(t("pluginPickerTitle"))}</div>
    ${plugins
      .map((plugin, index) => {
        const active = index === state.pluginActiveIndex ? " active" : "";
        const description = plugin.description ? `<span>${escapeHtml(plugin.description)}</span>` : `<span>${escapeHtml(plugin.uri || "")}</span>`;
        return `
          <button
            class="plugin-mention-item${active}"
            type="button"
            role="option"
            aria-selected="${index === state.pluginActiveIndex ? "true" : "false"}"
            data-plugin-index="${index}"
          >
            ${pluginIconHtml(plugin, "plugin-mention-icon")}
            <strong>${escapeHtml(plugin.displayName || plugin.name)}</strong>
            ${description}
          </button>
        `;
      })
      .join("")}
  `;
}

function renderSkillMentionMenu() {
  if (!els.skillMentionMenu || !state.skillMenuOpen) return;
  if (state.skillsLoading) {
    els.skillMentionMenu.hidden = false;
    els.skillMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("skillPickerLoading"))}</div>`;
    return;
  }
  const skills = filteredSkills();
  state.skillActiveIndex = Math.max(0, Math.min(state.skillActiveIndex, Math.max(skills.length - 1, 0)));
  els.skillMentionMenu.hidden = false;
  if (!skills.length) {
    els.skillMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("skillPickerEmpty"))}</div>`;
    return;
  }
  els.skillMentionMenu.innerHTML = `
    <div class="plugin-mention-heading">${escapeHtml(t("skillPickerTitle"))}</div>
    ${skills
      .map((skill, index) => {
        const active = index === state.skillActiveIndex ? " active" : "";
        const description = skill.description ? `<span>${escapeHtml(skill.description)}</span>` : `<span>${escapeHtml(skill.source || "")}</span>`;
        return `
          <button
            class="plugin-mention-item skill-mention-item${active}"
            type="button"
            role="option"
            aria-selected="${index === state.skillActiveIndex ? "true" : "false"}"
            data-skill-index="${index}"
          >
            <span class="plugin-mention-icon skill-mention-icon fallback">${skill.kind === "builtin" ? "↗" : "/"}</span>
            <strong>${escapeHtml(skill.displayName || skill.name)}</strong>
            ${description}
          </button>
        `;
      })
      .join("")}
  `;
}

function updatePluginMentionMenu() {
  if (els.composerInput.disabled) {
    closePluginMentionMenu();
    return;
  }
  const match = pluginMentionMatch();
  if (!match) {
    closePluginMentionMenu();
    return;
  }
  state.pluginMenuOpen = true;
  state.pluginQuery = match.query;
  state.pluginTriggerStart = match.start;
  renderPluginMentionMenu();
  loadPlugins().catch(() => {});
}

function updateSkillMentionMenu() {
  if (els.composerInput.disabled) {
    closeSkillMentionMenu();
    return;
  }
  const match = skillMentionMatch();
  if (!match) {
    closeSkillMentionMenu();
    return;
  }
  state.skillMenuOpen = true;
  state.skillQuery = match.query;
  state.skillTriggerStart = match.start;
  renderSkillMentionMenu();
  loadSkills().catch(() => {});
}

function openPluginPickerMenu() {
  if (els.composerInput.disabled) return;
  closeModelPanel();
  closeSkillMentionMenu();
  state.pluginMenuOpen = true;
  state.pluginQuery = "";
  state.pluginTriggerStart = -1;
  state.pluginActiveIndex = 0;
  els.pluginPickerButton?.setAttribute("aria-expanded", "true");
  els.pluginPickerButton?.classList.add("active");
  renderPluginMentionMenu();
  loadPlugins().catch(() => {});
}

function openSkillPickerMenu() {
  if (els.composerInput.disabled) return;
  closeModelPanel();
  closePluginMentionMenu();
  state.skillMenuOpen = true;
  state.skillQuery = "";
  state.skillTriggerStart = -1;
  state.skillActiveIndex = 0;
  els.skillPickerButton?.setAttribute("aria-expanded", "true");
  els.skillPickerButton?.classList.add("active");
  renderSkillMentionMenu();
  loadSkills().catch(() => {});
}

function insertPluginMention(plugin) {
  if (!plugin?.uri) return;
  const input = els.composerInput;
  if (state.pluginTriggerStart >= 0) {
    const cursor = input.selectionStart ?? input.value.length;
    const separator = input.value.slice(cursor).startsWith(" ") || cursor === input.value.length ? "" : " ";
    const nextValue = `${input.value.slice(0, state.pluginTriggerStart)}${separator}${input.value.slice(cursor)}`;
    const nextCursor = state.pluginTriggerStart + separator.length;
    input.value = nextValue;
    input.setSelectionRange(nextCursor, nextCursor);
  }
  if (!state.selectedPlugins.some((item) => item.uri === plugin.uri)) {
    state.selectedPlugins.push(plugin);
    renderSelectedPlugins();
  }
  closePluginMentionMenu();
  renderComposerMode();
  input.focus();
}

function selectActivePluginMention() {
  if (!state.pluginMenuOpen || state.pluginsLoading) return false;
  const plugin = filteredPlugins()[state.pluginActiveIndex];
  if (!plugin) return false;
  insertPluginMention(plugin);
  return true;
}

function insertSkillMention(skill) {
  if (!skill?.uri) return;
  if (skill.kind === "builtin" && skill.action === "compact") {
    closeSkillMentionMenu();
    if (state.selectedId && state.selectedId !== DRAFT_THREAD_ID) void requestContextCompaction();
    return;
  }
  if (skill.kind === "builtin" && skill.action === "goal") {
    closeSkillMentionMenu();
    openGoalEditDialog();
    return;
  }
  if (skill.kind === "builtin" && skill.action === "plan") {
    closeSkillMentionMenu();
    const input = els.composerInput;
    input.value = `${input.value}${input.value ? "\n\n" : ""}${t("planPrompt")}`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    autoResizeComposerInput();
    return;
  }
  const input = els.composerInput;
  if (state.skillTriggerStart >= 0) {
    const cursor = input.selectionStart ?? input.value.length;
    const separator = input.value.slice(cursor).startsWith(" ") || cursor === input.value.length ? "" : " ";
    const nextValue = `${input.value.slice(0, state.skillTriggerStart)}${separator}${input.value.slice(cursor)}`;
    const nextCursor = state.skillTriggerStart + separator.length;
    input.value = nextValue;
    input.setSelectionRange(nextCursor, nextCursor);
  }
  if (!state.selectedSkills.some((item) => item.uri === skill.uri)) {
    state.selectedSkills.push(skill);
    renderSelectedSkills();
  }
  closeSkillMentionMenu();
  renderComposerMode();
  input.focus();
}

function selectActiveSkillMention() {
  if (!state.skillMenuOpen || state.skillsLoading) return false;
  const skill = filteredSkills()[state.skillActiveIndex];
  if (!skill) return false;
  insertSkillMention(skill);
  return true;
}

function renderComposerMode() {
  const allowWrite = Boolean(state.config?.allowWrite);
  const thinking = Boolean(state.threadStatus?.thinking);
  const hasTarget = Boolean(state.selectedId);
  const canSend = allowWrite && hasTarget && !state.composerBusy && !state.uncertainSend && hasComposerPayload();
  els.composerInput.disabled = !allowWrite || state.composerBusy || !hasTarget;
  // A brand-new conversation cannot carry images yet (the first message has to be
  // text so the thread exists), so do not lead the user into a rejected send.
  const draftThread = state.selectedId === DRAFT_THREAD_ID;
  els.attachButton.disabled = !allowWrite || state.composerBusy || !hasTarget || draftThread;
  els.attachButton.setAttribute("title", t(draftThread ? "attachNeedsText" : "addImage"));
  els.attachButton.setAttribute("aria-label", t(draftThread ? "attachNeedsText" : "addImage"));
  els.pluginPickerButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
  els.skillPickerButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
  if (els.mentionButton) els.mentionButton.disabled = els.pluginPickerButton.disabled;
  els.sendButton.disabled = !canSend;
  els.sendButton.classList.remove("stop-mode");
  els.sendButton.setAttribute("aria-label", t("send"));
  els.sendButton.setAttribute("title", t("send"));
  const showFollowUpControls = allowWrite && thinking && !state.uncertainSend && state.selectedId !== DRAFT_THREAD_ID;
  els.followUpMode.hidden = !showFollowUpControls;
  els.stopButton.hidden = !showFollowUpControls;
  els.stopButton.disabled = state.composerBusy;
  els.composerForm.classList.toggle("follow-up-active", showFollowUpControls);
  for (const button of els.followUpMode.querySelectorAll("[data-follow-up-mode]")) {
    const selected = button.dataset.followUpMode === state.followUpMode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  els.composerInput.placeholder = allowWrite
    ? thinking && state.selectedId !== DRAFT_THREAD_ID
      ? t(state.followUpMode === "steer" ? "steerFollowUp" : "queueFollowUp")
      : t("sendToCodex")
    : t("readonlyPlaceholder");
  renderQueueStatus(state.threadStatus);
  if (!allowWrite) els.sendStatus.textContent = t("readonly");
  else if (els.sendStatus.textContent === t("readonly")) els.sendStatus.textContent = "";
  autoResizeComposerInput();
  if (els.composerInput.disabled) {
    closePluginMentionMenu();
    closeSkillMentionMenu();
  }
}

function renderQueueStatus(status = state.threadStatus) {
  const queuedMessages = Array.isArray(status?.queuedMessages) ? status.queuedMessages : [];
  const count = Number(status?.queueLength) || queuedMessages.length;
  const queueError = String(status?.queueError || "").trim();
  const queueUnavailable = Boolean(status?.queueUnavailable);
  const showError = Boolean(queueError || queueUnavailable);
  const expanded = Boolean(state.queueExpanded);
  els.queueStatusBar.hidden = count <= 0 && !showError;
  els.queueStatusBar.classList.toggle("is-expanded", expanded);
  els.queueStatusHeader.hidden = count <= 0 && !showError;
  els.queueStatusList.hidden = !expanded || count <= 0;
  if (els.queueToggleButton) {
    els.queueToggleButton.hidden = count <= 0;
    els.queueToggleButton.setAttribute("aria-expanded", String(expanded));
  }
  const compactPreview = (value, maxLength = 120) => {
    const text = String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  };
  if (count <= 0) {
    els.queueStatusText.textContent = queueError || (queueUnavailable ? t("queueUnavailableStatus") : "");
    els.queueStatusList.innerHTML = "";
    return;
  }
  els.queueStatusText.textContent = t("queuedCount", { count });
  els.queueStatusList.innerHTML = queuedMessages
    .map(
      (item, index) => `
        <div class="queue-status-item" data-queue-item-id="${escapeHtml(item.id || "")}">
          <div class="queue-status-copy">
            <span class="queue-status-label">#${Number(item.position) || index + 1} · ${escapeHtml(item.priority != null ? t("queuedItemPriority") : item.deliveryState === "failed" ? t("messageFailed") : item.deliveryState === "awaitingConfirmation" || item.deliveryState === "sending" ? t("messageSending") : t("queuedItem"))}</span>
            <span class="queue-status-preview">${escapeHtml(compactPreview(item.preview || item.text))}</span>
            ${Array.isArray(item.images) && item.images.length ? `<div class="queue-status-images">${item.images.map((image) => `<img src="${escapeHtml(withAuthToken(image.url))}" alt="${escapeHtml(image.name || t("addImage"))}" loading="lazy" />`).join("")}</div>` : ""}
          </div>
          <div class="queue-status-actions">
            ${item.deliveryState === "queued" && item.priority == null ? `<button class="queue-steer-button" type="button" data-queue-action="steer">${escapeHtml(t("insertQueued"))}</button>` : ""}
            <button type="button" data-queue-action="edit">${escapeHtml(t("editQueued"))}</button>
            <button type="button" data-queue-action="cancel">${escapeHtml(t("cancelQueued"))}</button>
          </div>
        </div>
      `
    )
    .join("");
}

function applyQueueStatusResult(result) {
  state.threadStatus = {
    ...(state.threadStatus || {}),
    queueLength: Number(result?.queueLength) || 0,
    queuedMessages: Array.isArray(result?.queuedMessages) ? result.queuedMessages : []
  };
  renderComposerMode();
}

async function loadConfig() {
  state.config = await fetchJson("/api/health", { signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
  applyHomeContext(state.config);
  normalizeModelSettings();
  hideAuthGate();
  renderComposerMode();
}

function applyHomeContext(data) {
  if (!data || data.codexHomeVersion == null) return false;
  const version = Number(data.codexHomeVersion);
  const nextHome = data.codexHome || state.codexHome;
  // Only a *different* Codex home invalidates the open conversation. codexHomeVersion
  // also bumps on every write while a turn runs, and resetting on that blanked the
  // visible conversation to 「加载中」 a few seconds into every sync — the periodic
  // thread sync reloads the list but not the messages, so the blank never resolved
  // (this is what left the phone stuck on 加载中). The conversation cache key already
  // carries the version, so a bump still invalidates stale cached messages without
  // disturbing what is on screen.
  const changed = state.codexHomeVersion != null && nextHome != null && nextHome !== state.codexHome;
  state.codexHome = nextHome;
  state.codexHomeVersion = Number.isFinite(version) ? version : state.codexHomeVersion;
  if (!changed) return false;
  if (!hasActiveDraft()) clearDraftThread();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.pendingMessages = [];
  state.approvalSubmissions = {};
  state.expandedNotices = {};
  state.lastMessagesData = null;
  state.plugins = [];
  state.pluginsLoaded = false;
  state.pluginsLoading = false;
  state.skills = [];
  state.skillsLoaded = false;
  state.skillsLoading = false;
  clearSelectedPlugins();
  clearSelectedSkills();
  closePluginMentionMenu();
  closeSkillMentionMenu();
  els.messageList.innerHTML = `<div class="empty-state empty-state-loading">${escapeHtml(t("loading"))}</div>`;
  return true;
}

async function loadThreads() {
  const previousSelectedId = state.selectedId;
  const query = state.selectedId ? `?selectedId=${encodeURIComponent(state.selectedId)}` : "";
  const data = await fetchThreads(`/api/threads${query}`);
  const homeChanged = applyHomeContext(data);
  state.threads = data.threads || [];
  const isDraftSelected = hasActiveDraft();
  if (!isDraftSelected && (homeChanged || !state.threads.some((thread) => thread.id === state.selectedId)) && state.threads[0]) {
    state.selectedId = state.threads[0].id;
  }
  if (!state.threads.length && !isDraftSelected) {
    state.selectedId = null;
  }
  if (state.selectedId !== previousSelectedId) {
    state.messageLimit = MESSAGE_PAGE_SIZE;
    state.messageBeforeCursor = "";
    state.messageHistoryLoading = false;
    closeGoalEditDialog();
    state.goal = null;
  }
  if (state.selectedId !== previousSelectedId || state.modelThreadId == null) adoptSelectedThreadModel();
  renderThreads();
  noteSyncSuccess("thread");
}

function renderTransientSyncError(error) {
  const selected = state.threads.find((thread) => thread.id === state.selectedId);
  const title = selected?.title || els.threadTitle.textContent || t("selectThread");
  els.threadTitle.textContent = title;
  els.threadMeta.textContent = `${t("syncTemporaryFailed")}${t("separator")}${friendlyErrorMessage(error)}`;
}

function renderLoadErrorState(error) {
  const message = friendlyErrorMessage(error);
  els.messageList.innerHTML = `<div class="empty-state empty-state-error" role="status">${escapeHtml(
    message
  )}<button type="button" class="empty-state-retry" data-load-retry>${escapeHtml(t("retryLoad"))}</button></div>`;
  updateScrollToBottomButton();
}

async function loadMessages(force = false, threadId = state.selectedId, { preserveScrollPosition = null } = {}) {
  if (!threadId) return;
  const request = { id: ++state.messageRequestSeq, threadId };
  state.activeMessageRequest = request;
  state.messageLoading = true;
  if (!state.lastMessagesData || state.lastMessagesData.thread?.id !== threadId) renderMessageLoading();
  if (threadId === DRAFT_THREAD_ID) {
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    state.lastMessagesData = {
      thread: state.draftThread,
      messages: [],
      status: { thinking: false }
    };
    state.threadStatus = state.lastMessagesData.status;
    renderComposerMode();
    renderMessages(state.lastMessagesData);
    state.activeMessageRequest = null;
    state.messageLoading = false;
    return;
  }
  const cacheKey = conversationCacheKey({
    codexHomeVersion: state.codexHomeVersion ?? state.config?.codexHomeVersion ?? "unknown",
    threadId,
    messageLimit: state.messageLimit
  });
  const historyParam = state.messageLimit > MESSAGE_PAGE_SIZE ? "&history=full" : "";
  const beforeParam = state.messageBeforeCursor ? `&before=${encodeURIComponent(state.messageBeforeCursor)}` : "";
  const requestedBefore = state.messageBeforeCursor;
  // A messages request with no timeout leaves the list on "加载中" forever when the
  // connection stalls (observed once on the phone). Bound it so a stall surfaces as the
  // retryable error state instead of an endless spinner.
  const networkRequest = fetchJson(
    "/api/threads/" + threadId + "/messages?limit=" + state.messageLimit + beforeParam + historyParam,
    { signal: AbortSignal.timeout(MESSAGE_REQUEST_TIMEOUT_MS) }
  );
  let cachedShown = false;
  const openingThread = !state.lastMessagesData || state.lastMessagesData.thread?.id !== threadId;
  const currentThread = state.threads.find((thread) => thread.id === threadId) || null;
  try {
    const cached = await readConversationCache(cacheKey);
    if (
      cached &&
      isConversationCacheFresh(cached, currentThread) &&
      shouldHydrateConversationCache({ preserveScrollPosition }) &&
      state.selectedId === threadId &&
      state.activeMessageRequest === request
    ) {
      state.lastMessagesData = cached;
      state.threadStatus = cached.status || null;
      state.messagesSignature = "cache:" + (cached.cachedAt || 0);
      state.messageLoading = false;
      renderComposerMode();
      renderMessages(cached);
      if (openingThread) {
        els.messageList.scrollTop = els.messageList.scrollHeight;
        updateScrollToBottomButton();
      }
      cachedShown = true;
    }
  } catch {
    // Cache is an optimization; network loading continues normally.
  }
  try {
    const data = await networkRequest;
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    if (requestedBefore && state.lastMessagesData?.thread?.id === threadId) {
      const byKey = new Map([...(data.messages || []), ...(state.lastMessagesData.messages || [])].map((message) => [
        `${message.id || ""}:${message.lineNumber || ""}:${message.timestamp || ""}:${message.role || ""}`,
        message
      ]));
      data.messages = [...byKey.values()].sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
      data.hasOlderMessages = Boolean(data.hasOlderMessages);
    }
    state.lastMessagesData = data;
    state.messageLoading = false;
    state.threadStatus = data.status || null;
    renderComposerMode();
    const signature = `${data.thread?.updatedAtMs || ""}:${data.size || ""}:${data.mtimeMs || ""}:${data.limit || ""}:${data.omittedMessages || 0}:${state.showTools}:${data.status?.thinking ? "thinking" : "idle"}:${data.status?.interactionRequired ? "interaction" : "clear"}:${data.status?.turnId || ""}:${pendingSignature()}`;
    if (force || signature !== state.messagesSignature) {
      const wasNearBottom = isMessageListNearBottom();
      const scrollMode = messageScrollMode({
        cacheHydration: cachedShown && openingThread,
        force,
        preserveScrollPosition: Boolean(preserveScrollPosition),
        wasNearBottom
      });
      state.messagesSignature = signature;
      renderMessages(data);
      if (scrollMode === "retain") {
        const restoreScrollPosition = () => {
          const target = retainedScrollTop({
          ...preserveScrollPosition,
          nextScrollHeight: els.messageList.scrollHeight
          });
          els.messageList.scrollTop = target;
          updateScrollToBottomButton();
        };
        restoreScrollPosition();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(restoreScrollPosition);
        });
        window.setTimeout(restoreScrollPosition, 300);
        els.messageList.querySelectorAll("img").forEach((image) => {
          image.addEventListener("load", restoreScrollPosition, { once: true });
        });
      } else if (scrollMode === "latest") {
        els.messageList.scrollTop = els.messageList.scrollHeight;
      }
      updateScrollToBottomButton();
      if (!preserveScrollPosition && openingThread && data.hasOlderMessages) {
        window.requestAnimationFrame(() => {
          if (
            state.selectedId === threadId &&
            !state.messageHistoryLoading &&
            els.messageList.scrollHeight <= els.messageList.clientHeight + 8
          ) {
            void loadOlderMessages();
          }
        });
      }
    }
    void writeConversationCache(cacheKey, data);
    noteSyncSuccess("message");
  } catch (error) {
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    if (error.status === 401) throw error;
    noteSyncFailure("message", state.threadStatus?.thinking ? MESSAGE_SYNC_THINKING_MS : MESSAGE_SYNC_IDLE_MS, MESSAGE_SYNC_BACKOFF_MAX_MS);
    if (state.messagesSignature || cachedShown) {
      renderTransientSyncError(error);
    } else {
    renderLoadErrorState(error);
    }
  } finally {
    if (state.activeMessageRequest === request) state.activeMessageRequest = null;
    if (state.activeMessageRequest === null) state.messageLoading = false;
  }
}

function withAuthToken(url) {
  if (!state.authToken || !url) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(state.authToken)}`;
}

async function loadOlderMessages() {
  if (state.messageHistoryLoading || state.selectedId === DRAFT_THREAD_ID) return;
  const nextLimit = nextMessageLimit(state.messageLimit, state.lastMessagesData);
  if (!nextLimit) return;
  state.messageHistoryLoading = true;
  const preserveScrollPosition = {
    scrollTop: els.messageList.scrollTop,
    scrollHeight: els.messageList.scrollHeight
  };
  state.messageLimit = nextLimit;
  state.messageBeforeCursor = state.lastMessagesData?.olderCursor || "";
  try {
    await loadMessages(true, state.selectedId, { preserveScrollPosition });
  } finally {
    state.messageHistoryLoading = false;
  }
}

async function refresh(forceMessages = false, { preserveScrollPosition = false } = {}) {
  try {
    if (!state.config) await loadConfig();
    const previousThreadId = state.selectedId;
    const scrollSnapshot =
      preserveScrollPosition && state.lastMessagesData?.thread?.id === previousThreadId
        ? { scrollTop: els.messageList.scrollTop, scrollHeight: els.messageList.scrollHeight }
        : null;
    await loadThreads();
    await loadMessages(forceMessages, state.selectedId, { preserveScrollPosition: previousThreadId === state.selectedId ? scrollSnapshot : null });
  } catch (error) {
    if (error.status === 401) {
      lockApp(state.authToken ? t("accessCodeWrong") : t("enterAccessCode"));
      return;
    }
    els.threadCount.textContent = t("syncFailed");
    noteSyncFailure("thread", THREAD_SYNC_INTERVAL_MS, THREAD_SYNC_BACKOFF_MAX_MS);
    if (state.threads.length || state.messagesSignature) {
      renderTransientSyncError(error);
    } else {
    renderLoadErrorState(error);
    }
  }
}

function refreshSoon(delayMs = 700) {
  setTimeout(() => {
    if (shouldSync()) refresh(true);
  }, delayMs);
}

function messageChangeCursor(data = state.lastMessagesData) {
  if (!data) return "";
  return JSON.stringify({
    updatedAtMs: data.thread?.updatedAtMs || 0,
    size: data.size || 0,
    mtimeMs: data.mtimeMs || 0,
    turnId: data.status?.turnId || null,
    thinking: Boolean(data.status?.thinking),
    queueLength: data.status?.queueLength || 0
  });
}

function stopMessageStream() {
  state.messageStreamGeneration += 1;
  state.messageStreamController?.abort();
  state.messageStreamController = null;
}

async function startMessageStream(threadId = state.selectedId) {
  stopMessageStream();
  if (!threadId || threadId === DRAFT_THREAD_ID) return;
  const generation = state.messageStreamGeneration;
  const controller = new AbortController();
  state.messageStreamController = controller;
  let cursor = messageChangeCursor();
  while (!controller.signal.aborted && generation === state.messageStreamGeneration && state.selectedId === threadId) {
    try {
      const result = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/changes?timeout=25000&cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal });
      if (result.changed && generation === state.messageStreamGeneration && state.selectedId === threadId) {
        await loadMessages(true, threadId);
        cursor = result.cursor || messageChangeCursor();
      } else {
        cursor = result.cursor || cursor;
      }
      state.messageSyncBackoffMs = 0;
    } catch (error) {
      if (controller.signal.aborted || generation !== state.messageStreamGeneration) break;
      if (error.status === 401) {
        handleUnauthorized(error);
        break;
      }
      state.messageSyncBackoffMs = Math.min(MESSAGE_SYNC_BACKOFF_MAX_MS, Math.max(1000, state.messageSyncBackoffMs * 2 || 1000));
      await new Promise((resolve) => setTimeout(resolve, state.messageSyncBackoffMs));
      cursor = messageChangeCursor();
    }
  }
}

function scheduleThreadSync(delayMs = syncDelay(THREAD_SYNC_INTERVAL_MS, state.threadSyncBackoffMs)) {
  setTimeout(async () => {
    try {
      if (shouldSync()) await loadThreads();
      // Switching to a different Codex home clears the open conversation. The thread
      // sync on its own would leave that blank until the user tapped something, so
      // reload it here.
      if (shouldSync() && state.selectedId && !state.lastMessagesData) await loadMessages(true);
    } catch (error) {
      if (error.status === 401) handleUnauthorized(error);
      else noteSyncFailure("thread", THREAD_SYNC_INTERVAL_MS, THREAD_SYNC_BACKOFF_MAX_MS);
    } finally {
      scheduleThreadSync();
    }
  }, delayMs);
}

function scheduleMessageSync() {
  void startMessageStream();
}

function shouldRefocusComposer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function saveCurrentThreadDraft() {
  const id = String(state.selectedId || "");
  if (!id) return;
  state.threadDrafts = state.threadDrafts || {};
  state.threadDrafts[id] = {
    message: els.composerInput.value,
    images: [...state.imageAttachments],
    selectedPlugins: [...state.selectedPlugins],
    selectedSkills: [...state.selectedSkills],
    model: state.model,
    effort: state.effort,
    modelPreferences: { ...(state.modelPreferences || {}) }
  };
}

function restoreThreadDraft(id) {
  const draft = state.threadDrafts?.[String(id || "")];
  els.composerInput.value = draft?.message || "";
  state.imageAttachments = draft?.images ? [...draft.images] : [];
  state.selectedPlugins = draft?.selectedPlugins ? [...draft.selectedPlugins] : [];
  state.selectedSkills = draft?.selectedSkills ? [...draft.selectedSkills] : [];
  if (draft?.model) state.model = draft.model;
  if (draft?.effort) state.effort = draft.effort;
  renderSelectedPlugins();
  renderSelectedSkills();
  renderImageAttachments();
  autoResizeComposerInput();
}

els.threadList.addEventListener("click", (event) => {
  const more = event.target.closest("[data-thread-more]");
  if (more) {
    event.preventDefault();
    event.stopPropagation();
    const rect = more.getBoundingClientRect();
    openThreadContextMenu(more.dataset.threadMore, rect.left, rect.bottom);
    return;
  }
  const button = event.target.closest(".thread-item");
  if (!button) return;
  if (Date.now() < suppressThreadClickUntil) {
    event.preventDefault();
    return;
  }
  const nextId = button.dataset.id;
  if (!nextId || nextId === state.selectedId) return;
  closeThreadContextMenu();
  closeGoalEditDialog();
  stopMessageStream();
  saveCurrentThreadDraft();
  state.selectedId = nextId;
  state.messageLimit = MESSAGE_PAGE_SIZE;
  state.messageBeforeCursor = "";
  state.messageHistoryLoading = false;
  restoreThreadDraft(nextId);
  adoptSelectedThreadModel();
  if (state.selectedId !== DRAFT_THREAD_ID) clearDraftThread();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.lastMessagesData = null;
  els.sendStatus.textContent = "";
  renderModelSettings();
  renderComposerMode();
  renderThreads();
  loadMessages(true, state.selectedId);
  void startMessageStream(state.selectedId);
  closeSidebarOnCompact();
});

let longPressTimer = null;
let longPressStart = null;
let suppressThreadClickUntil = 0;

function cancelThreadLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressStart = null;
}

els.threadList.addEventListener("pointerdown", (event) => {
  const button = event.target.closest(".thread-item");
  if (!button || button.dataset.id === DRAFT_THREAD_ID || event.button > 0) return;
  cancelThreadLongPress();
  longPressStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  longPressTimer = setTimeout(() => {
    suppressThreadClickUntil = Date.now() + 700;
    openThreadContextMenu(button.dataset.id, event.clientX, event.clientY);
    navigator.vibrate?.(12);
    cancelThreadLongPress();
  }, 520);
});

els.threadList.addEventListener("pointermove", (event) => {
  if (!longPressStart || event.pointerId !== longPressStart.pointerId) return;
  if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) cancelThreadLongPress();
});

for (const eventName of ["pointerup", "pointercancel", "scroll"]) {
  els.threadList.addEventListener(eventName, cancelThreadLongPress, { passive: true });
}

els.threadList.addEventListener("contextmenu", (event) => {
  const button = event.target.closest(".thread-item");
  if (!button || button.dataset.id === DRAFT_THREAD_ID) return;
  event.preventDefault();
  suppressThreadClickUntil = Date.now() + 700;
  openThreadContextMenu(button.dataset.id, event.clientX, event.clientY);
});

els.threadList.addEventListener("keydown", (event) => {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  const button = event.target.closest(".thread-item");
  if (!button || button.dataset.id === DRAFT_THREAD_ID) return;
  event.preventDefault();
  const rect = button.getBoundingClientRect();
  openThreadContextMenu(button.dataset.id, rect.left + 20, rect.top + rect.height / 2);
});

els.threadReminderAction.addEventListener("click", () => {
  const thread = state.threads.find((entry) => entry.id === state.contextThreadId);
  if (!thread) return closeThreadContextMenu();
  setThreadReminder(thread, !reminderEnabled(thread.id));
  closeThreadContextMenu();
  renderThreads();
});

els.threadPinAction.addEventListener("click", () => {
  const thread = state.threads.find((entry) => entry.id === state.contextThreadId);
  if (!thread) return closeThreadContextMenu();
  closeThreadContextMenu();
  void setThreadPin(thread, !thread.pinned);
});

els.newThreadButton.addEventListener("click", () => {
  if (!state.config?.allowWrite || els.newThreadButton.disabled) return;
  els.sendStatus.textContent = "";
  closeGoalEditDialog();
  clearSelectedPlugins();
  state.draftThread = {
    id: DRAFT_THREAD_ID,
    title: t("newConversationDraft"),
    preview: "",
    cwd: ""
  };
  state.draftStartedAt = Date.now();
  state.selectedId = DRAFT_THREAD_ID;
  state.messageLimit = MESSAGE_PAGE_SIZE;
  state.messageBeforeCursor = "";
  state.messageHistoryLoading = false;
  state.modelThreadId = DRAFT_THREAD_ID;
  normalizeModelSettings();
  state.messagesSignature = "";
  state.threadStatus = { thinking: false };
  state.lastMessagesData = {
    thread: state.draftThread,
    messages: [],
    status: state.threadStatus
  };
  renderThreads();
  renderCurrentMessages(true);
  renderComposerMode();
  renderDraftProjectPicker();
  syncDraftProjectRow();
  closeSidebarOnCompact();
  if (shouldRefocusComposer()) els.composerInput.focus();
});

// Filing into a folder is a per-draft decision, remembered for the next one.
els.draftProjectSelect?.addEventListener("change", () => {
  state.draftProjectId = els.draftProjectSelect.value || "";
  safeStorageSet(localStorage, "codex-draft-project", state.draftProjectId);
});

els.refreshButton.addEventListener("click", () => refresh(true, { preserveScrollPosition: true }));

els.goalEditButton?.addEventListener("click", () => {
  openGoalEditDialog();
});

els.goalView?.addEventListener("click", openGoalDetailDialog);
els.goalDetailBackButton?.addEventListener("click", closeGoalEditDialog);

els.goalContextMenu?.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.id;
  if (action === "goalPauseAction") void updateGoalStatus("paused");
  if (action === "goalEditAction") {
    els.goalContextMenu.hidden = true;
    openGoalEditDialog();
  }
  if (action === "goalDeleteAction") {
    els.goalContextMenu.hidden = true;
    els.goalClearButton?.click();
  }
});

els.goalPanel?.addEventListener("contextmenu", (event) => {
  if (!state.goal?.objective) return;
  event.preventDefault();
  openGoalContextMenu();
});

els.goalCancelButton?.addEventListener("click", () => {
  openGoalDetailDialog();
});

els.goalDialogClose?.addEventListener("click", closeGoalEditDialog);
els.goalEditDialog?.addEventListener("click", (event) => {
  if (event.target.matches("[data-goal-dialog-close]")) closeGoalEditDialog();
});

els.goalClearButton?.addEventListener("click", async () => {
  if (!state.selectedId) return;
  if (
    !(await appConfirm("删除当前目标？", {
      title: "删除目标",
      confirmText: "删除",
      danger: true,
    }))
  )
    return;
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(state.selectedId)}/goal`, { method: "DELETE" });
    state.goal = null;
    closeGoalEditDialog();
    renderGoal(null);
    refreshSoon(200);
  } catch (error) {
    els.sendStatus.textContent = t("goalClearFailed", { message: error.message });
  }
});

els.goalForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedId) return;
  try {
    const data = await fetchJson(`/api/threads/${encodeURIComponent(state.selectedId)}/goal`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objective: els.goalObjectiveInput.value,
        status: els.goalStatusInput.value
      })
    });
    state.goal = data.goal || null;
    closeGoalEditDialog();
    renderGoal(state.goal);
  } catch (error) {
    els.sendStatus.textContent = t("goalSaveFailed", { message: error.message });
  }
});

els.sidebarCloseButton?.addEventListener("click", () => {
  state.sidebarCollapsed = true;
  renderSidebarState();
});

els.sidebarToggle.addEventListener("click", () => {
  state.sidebarCollapsed = false;
  renderSidebarState();
});

els.drawerOverlay.addEventListener("click", () => {
  state.sidebarCollapsed = true;
  renderSidebarState();
});

els.messageList.addEventListener("pointerdown", () => {
  closeSidebarOnCompact();
});

els.messageList.addEventListener("scroll", () => {
  updateScrollToBottomButton();
  if (els.messageList.scrollTop <= 80) void loadOlderMessages();
});

els.scrollToBottomButton.addEventListener("click", () => {
  scrollMessagesToBottom();
});

els.messageList.addEventListener("click", async (event) => {
  const loadRetry = event.target.closest("[data-load-retry]");
  if (loadRetry) {
    event.preventDefault();
    event.stopPropagation();
    loadRetry.disabled = true;
    els.messageList.innerHTML = `<div class="empty-state empty-state-loading">${escapeHtml(t("loading"))}</div>`;
    void refresh(true);
    return;
  }
  // 复制与分支现在走长按操作单（wireMessageActions），消息里不再有常驻按钮。
  const retryButton = event.target.closest("[data-pending-action='retry']");
  if (retryButton) {
    event.preventDefault();
    event.stopPropagation();
    const article = retryButton.closest("[data-pending-id]");
    const pending = state.pendingMessages.find((entry) => entry.id === article?.dataset.pendingId);
    retryPendingMessage(pending);
    return;
  }
  const noticeButton = event.target.closest(".notice-collapse-button");
  if (noticeButton) {
    event.preventDefault();
    event.stopPropagation();
    const key = noticeButton.dataset.noticeKey || "";
    if (!key) return;
    state.expandedNotices[key] = !state.expandedNotices[key];
    renderCurrentMessages(false);
    return;
  }

  const button = event.target.closest(".approval-action");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (!state.config?.allowWrite || button.disabled) return;
  const container = button.closest(".approval-actions");
  const requestId = container?.dataset.requestId || "";
  const approvalKind = container?.dataset.approvalKind || "command";
  const decision = button.dataset.decision || "";
  if (!requestId || !decision) return;
  const submissionKey = approvalSubmissionKey(state.selectedId, requestId);
  const buttons = [...container.querySelectorAll(".approval-action")];
  buttons.forEach((item) => {
    item.disabled = true;
  });
  state.approvalSubmissions[submissionKey] = { status: "submitting", decision };
  container.outerHTML = `<div class="approval-result pending">${escapeHtml(t("approvalSending"))}</div>`;
  try {
    await postJson("/api/approval", {
      threadId: state.selectedId,
      requestId,
      approvalKind,
      decision
    });
    state.approvalSubmissions[submissionKey] = { status: "submitted", decision };
    state.messagesSignature = "";
    if (els.sendStatus.textContent === t("approvalSending") || els.sendStatus.textContent === t("approvalDone")) {
      els.sendStatus.textContent = "";
    }
    renderCurrentMessages(false);
    refreshSoon(700);
  } catch (error) {
    delete state.approvalSubmissions[submissionKey];
    buttons.forEach((item) => {
      item.disabled = false;
    });
    els.sendStatus.textContent = t("approvalFailed", { message: error.message });
    state.messagesSignature = "";
    refreshSoon(700);
  }
});

window.addEventListener("resize", () => {
  if (!isCompactPortrait()) {
    state.sidebarCollapsed = false;
    renderSidebarState();
  }
  autoResizeComposerInput();
  updateScrollToBottomButton();
});

/**
 * 键盘遮挡修复（2026-11-05）。
 *
 * Android WebView 在 adjustResize 下不一定同步更新 100dvh（老内核尤其明显），
 * 结果 shell 仍按全屏高布局，composer 被软键盘盖住。这里直接用
 * visualViewport.height 重订 shell 高度，并把「键盘开着」标到 <html> 上，
 * 让 CSS 收紧输入区、保持发送键始终在键盘上方。
 */
function syncVisualViewport() {
  const shell = els.shell || document.querySelector("#shell");
  const vv = window.visualViewport;
  if (!shell) return;
  const layout = window.innerHeight || document.documentElement.clientHeight;
  const visible = vv ? Math.round(vv.height) : layout;
  const keyboardOpen = (Boolean(vv) && layout - visible > 120) || layout < 520;
  // vv.offsetTop 是可视区相对布局视口的偏移；键盘态下把 shell 钉在可视区。
  const offset = vv ? Math.round(vv.offsetTop || 0) : 0;
  shell.style.setProperty("--app-visible-height", `${visible}px`);
  shell.style.setProperty("--app-viewport-offset", `${offset}px`);
  shell.style.height = `${visible}px`;
  document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
  // 系统全局字体放大：WebView 的 textZoom 会把根字号一起放大。
  // 检测到超过基准就切到宽松布局（两列状态条、允许折行、相对高度）。
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  document.documentElement.classList.toggle("large-text", rootFont > 18.5);
  if (keyboardOpen) {
    // 输入焦点在 composer 时，把它滚进可视区（某些内核不会自动 pan）。
    if (document.activeElement === els.composerInput) {
      els.composerInput.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  updateScrollToBottomButton();
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncVisualViewport);
  window.visualViewport.addEventListener("scroll", syncVisualViewport);
}
window.addEventListener("resize", syncVisualViewport);
window.addEventListener("focusin", () => window.setTimeout(syncVisualViewport, 120));
window.addEventListener("focusout", () => window.setTimeout(syncVisualViewport, 180));
syncVisualViewport();

els.searchInput.addEventListener("input", (event) => {
  state.filter = event.target.value;
  renderThreads();
});

// 搜索时给出明确的空结果与清除入口，别让用户对着空白列表猜。
els.searchInput.addEventListener("search", () => {
  state.filter = "";
  renderThreads();
});

els.toolToggle.addEventListener("change", (event) => {
  state.showTools = event.target.checked;
  state.messagesSignature = "";
  loadMessages(true);
});

function selectModel(modelId) {
  if (!modelId) return;
  state.model = modelId;
  state.effort = "";
  rememberModelSettingsForCurrentThread();
  normalizeModelSettings();
  closeModelPanel();
}

function selectEffort(effort) {
  if (!effort) return;
  state.effort = effort;
  rememberModelSettingsForCurrentThread();
  normalizeModelSettings();
}

document.querySelector("#modelList")?.addEventListener("click", (event) => {
  const row = event.target.closest("[data-model-id]");
  if (row) selectModel(row.dataset.modelId);
});

document.querySelector("#effortChips")?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-effort]");
  if (chip) selectEffort(chip.dataset.effort);
});

document.querySelector("#modelScopeButton")?.addEventListener("click", () => {
  state.showAllModels = !state.showAllModels;
  renderModelSettings();
});

els.modelSummary.addEventListener("click", () => {
  state.modelPanelOpen = !state.modelPanelOpen;
  state.modelFilter = "";
  if (els.modelFilter) els.modelFilter.value = "";
  closePluginMentionMenu();
  closeSkillMentionMenu();
  renderModelSettings();
});

els.modelFilter?.addEventListener("input", () => {
  state.modelFilter = els.modelFilter.value;
  renderModelSettings();
});

// 隐藏 select 只作表单值载体；用户实际通过 #modelList / #effortChips 选择。
els.modelSelect.addEventListener("change", () => {
  if (!els.modelSelect.value) return;
  state.model = els.modelSelect.value;
  normalizeModelSettings();
});

els.effortSelect.addEventListener("change", () => {
  if (!els.effortSelect.value) return;
  state.effort = els.effortSelect.value;
  normalizeModelSettings();
});

els.pluginPickerButton.addEventListener("click", () => {
  if (els.pluginPickerButton.disabled) return;
  if (state.pluginMenuOpen && state.pluginTriggerStart < 0) {
    closePluginMentionMenu();
    return;
  }
  openPluginPickerMenu();
});

els.skillPickerButton.addEventListener("click", () => {
  if (els.skillPickerButton.disabled) return;
  if (state.skillMenuOpen && state.skillTriggerStart < 0) {
    closeSkillMentionMenu();
    return;
  }
  openSkillPickerMenu();
});

// 手机输入区只留一个「@」入口：插件与技能在这里二选一（这两个按钮在窄屏被移到
// 屏幕外，程序化点击仍然走原来的打开逻辑），省下的 44px 留给模型名。
function closeMentionMenu() {
  if (!els.mentionMenu) return;
  els.mentionMenu.hidden = true;
  els.mentionButton?.setAttribute("aria-expanded", "false");
}

function toggleMentionMenu() {
  if (!els.mentionMenu) return;
  const nextOpen = els.mentionMenu.hidden;
  if (nextOpen) closeModelPanel();
  els.mentionMenu.hidden = !nextOpen;
  els.mentionButton?.setAttribute("aria-expanded", String(nextOpen));
}

els.mentionButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (els.mentionButton.disabled) return;
  toggleMentionMenu();
});

els.mentionPluginItem?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeMentionMenu();
  els.pluginPickerButton.click();
});

els.mentionSkillItem?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeMentionMenu();
  els.skillPickerButton.click();
});

document.addEventListener("click", (event) => {
  if (!els.threadContextMenu.hidden && !els.threadContextMenu.contains(event.target)) closeThreadContextMenu();
  if (els.goalContextMenu && !els.goalContextMenu.hidden && !els.goalContextMenu.contains(event.target) && !els.goalPanel.contains(event.target)) els.goalContextMenu.hidden = true;
  if (state.modelPanelOpen && !els.modelPanel.contains(event.target) && !els.modelSummary.contains(event.target)) {
    closeModelPanel();
  }
  if (
    state.pluginMenuOpen &&
    !els.pluginMentionMenu?.contains(event.target) &&
    !els.composerInput.contains(event.target) &&
    !els.pluginPickerButton.contains(event.target)
  ) {
    closePluginMentionMenu();
  }
  if (
    state.skillMenuOpen &&
    !els.skillMentionMenu?.contains(event.target) &&
    !els.composerInput.contains(event.target) &&
    !els.skillPickerButton.contains(event.target)
  ) {
    closeSkillMentionMenu();
  }
  if (
    els.mentionMenu &&
    !els.mentionMenu.hidden &&
    !els.mentionMenu.contains(event.target) &&
    !els.mentionButton.contains(event.target)
  ) {
    closeMentionMenu();
  }
  if (
    !els.imagePickerMenu.hidden &&
    !els.imagePickerMenu.contains(event.target) &&
    !els.attachButton.contains(event.target)
  ) {
    closeImagePickerMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.goalEditDialog && !els.goalEditDialog.hidden) closeGoalEditDialog();
});

els.authReveal.addEventListener("click", () => {
  const revealed = els.authInput.type === "text";
  els.authInput.type = revealed ? "password" : "text";
  els.authReveal.setAttribute("aria-pressed", String(!revealed));
  els.authReveal.setAttribute("aria-label", revealed ? t("showAccessCode") : t("hideAccessCode"));
  els.authReveal.setAttribute("title", revealed ? t("showAccessCode") : t("hideAccessCode"));
  els.authInput.focus();
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = els.authInput.value.trim();
  if (!token) {
    showAuthGate(t("enterAccessCode"));
    return;
  }
  state.authToken = token;
  safeStorageRemove(sessionStorage, "codexLanToken");
  if (els.rememberDevice.checked) safeStorageSet(localStorage, rememberedTokenKey(), token);
  else safeStorageRemove(localStorage, rememberedTokenKey());
  els.authError.textContent = "";
  els.authButton.disabled = true;
  els.authButton.textContent = t("verifying");
  try {
    await loadConfig();
    await refresh(true);
    maybeOpenWelcomeGuide();
  } catch (error) {
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    showAuthGate(error.message);
  } finally {
    els.authButton.disabled = false;
    els.authButton.textContent = t("enter");
  }
});

els.composerInput.addEventListener("keydown", (event) => {
  if (state.pluginMenuOpen) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredPlugins().length;
      if (count) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.pluginActiveIndex = (state.pluginActiveIndex + delta + count) % count;
        renderPluginMentionMenu();
      }
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (selectActivePluginMention()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePluginMentionMenu();
      return;
    }
  }
  if (state.skillMenuOpen) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredSkills().length;
      if (count) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.skillActiveIndex = (state.skillActiveIndex + delta + count) % count;
        renderSkillMentionMenu();
      }
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (selectActiveSkillMention()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSkillMentionMenu();
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.composerForm.requestSubmit();
  }
});

els.composerInput.addEventListener("input", () => {
  state.pluginActiveIndex = 0;
  state.skillActiveIndex = 0;
  autoResizeComposerInput();
  updatePluginMentionMenu();
  updateSkillMentionMenu();
  renderComposerMode();
});

els.composerInput.addEventListener("click", () => {
  updatePluginMentionMenu();
  updateSkillMentionMenu();
});

els.composerInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (state.pluginMenuOpen && state.pluginTriggerStart < 0) return;
    if (state.skillMenuOpen && state.skillTriggerStart < 0) return;
    if (!els.pluginMentionMenu?.contains(document.activeElement) && !els.pluginPickerButton.contains(document.activeElement)) {
      closePluginMentionMenu();
    }
    if (!els.skillMentionMenu?.contains(document.activeElement) && !els.skillPickerButton.contains(document.activeElement)) {
      closeSkillMentionMenu();
    }
  }, 120);
});

els.pluginMentionMenu?.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

els.skillMentionMenu?.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

els.pluginMentionMenu?.addEventListener("click", (event) => {
  const button = event.target.closest(".plugin-mention-item");
  if (!button) return;
  const plugin = filteredPlugins()[Number(button.dataset.pluginIndex)];
  insertPluginMention(plugin);
});

els.skillMentionMenu?.addEventListener("click", (event) => {
  const button = event.target.closest(".skill-mention-item");
  if (!button) return;
  const skill = filteredSkills()[Number(button.dataset.skillIndex)];
  insertSkillMention(skill);
});

els.pluginMentionTray?.addEventListener("click", (event) => {
  const button = event.target.closest(".plugin-chip");
  if (!button) return;
  state.selectedPlugins = state.selectedPlugins.filter((plugin) => plugin.uri !== button.dataset.pluginUri);
  renderSelectedPlugins();
  renderComposerMode();
  els.composerInput.focus();
});

els.skillMentionTray?.addEventListener("click", (event) => {
  const button = event.target.closest(".skill-chip");
  if (!button) return;
  state.selectedSkills = state.selectedSkills.filter((skill) => skill.uri !== button.dataset.skillUri);
  renderSelectedSkills();
  renderComposerMode();
  els.composerInput.focus();
});

els.attachButton.addEventListener("click", () => {
  if (els.attachButton.disabled) return;
  closePluginMentionMenu();
  closeSkillMentionMenu();
  toggleImagePickerMenu();
});

els.pickPhotoButton.addEventListener("click", () => {
  closeImagePickerMenu();
  els.imageInput.click();
});

els.pickFileButton.addEventListener("click", () => {
  closeImagePickerMenu();
  els.imageFileInput.click();
});

async function handleImageInputChange(event) {
  await addImageFiles(event.target.files);
  event.target.value = "";
}

els.imageInput.addEventListener("change", handleImageInputChange);
els.imageFileInput.addEventListener("change", handleImageInputChange);

els.attachmentTray.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-attachment-id]");
  if (!button) return;
  state.imageAttachments = state.imageAttachments.filter((image) => image.id !== button.dataset.attachmentId);
  renderImageAttachments();
  renderComposerMode();
});

els.composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  closePluginMentionMenu();
  if (!state.config?.allowWrite) return;
  if (state.uncertainSend) {
    els.sendStatus.textContent = t("sendUncertain");
    await refresh(true);
    if (hasDisplayedUserMessage(state.uncertainSend.message) || state.threadStatus?.thinking) {
      state.uncertainSend = null;
      els.composerInput.value = "";
      autoResizeComposerInput();
      state.imageAttachments = [];
      renderImageAttachments();
      els.sendStatus.textContent = t("sendUncertainAccepted");
      renderComposerMode();
    }
    return;
  }
  const thinking = Boolean(state.threadStatus?.thinking);
  if (state.composerBusy) return;
  const isDraftThread = state.selectedId === DRAFT_THREAD_ID;
  const message = els.composerInput.value.trim();
  const sendMessage = composerSendMessage(message);
  const images = [...state.imageAttachments];
  if (!sendMessage && !images.length) return;
  if (images.length) {
    const selected = availableModels().find((model) => model.id === state.model);
    if (selected && selected.supportsImages === false) {
      els.sendStatus.textContent = t("imageModelUnsupported");
      renderModelSettings();
      return;
    }
  }
  const sendMode = thinking && !isDraftThread ? state.followUpMode : "start";
  const previousThreadStatus = state.threadStatus;
  const draftSnapshot = {
    message: els.composerInput.value,
    images,
    selectedPlugins: [...state.selectedPlugins],
    selectedSkills: [...state.selectedSkills]
  };
  let sendAccepted = false;
  const pendingMessageId = isDraftThread ? null : addPendingUserMessage(state.selectedId, sendMessage, images);
  clearComposerAfterAcceptedSend();
  const clientRequestId = globalThis.crypto?.randomUUID?.() || `send-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.composerBusy = true;
  if (!thinking && !isDraftThread) {
    state.threadStatus = { ...(state.threadStatus || {}), thinking: true, possibleDesktopAttention: false };
    state.messagesSignature = "";
    renderCurrentMessages(true);
  }
  renderComposerMode();
  els.sendStatus.textContent = "";
  try {
    const result = await postJson("/api/send", {
      message: sendMessage,
      threadId: isDraftThread ? null : state.selectedId,
      newThread: isDraftThread,
      mode: sendMode,
      model: state.model,
      effort: state.effort,
      ...(isDraftThread && state.draftProjectId ? { projectId: state.draftProjectId } : {}),
      clientRequestId,
      images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
    });
    if (!result?.uncertain) {
      sendAccepted = true;
      if (pendingMessageId) updatePendingMessage(pendingMessageId, { deliveryStatus: "sent", kind: "message" });
      try {
        globalThis.CodexPocket?.kickReminderCheck?.();
      } catch {
        // The desktop browser has no native bridge.
      }
    }
    if (isDraftThread && result.threadId) {
      if (state.modelPreferences[DRAFT_THREAD_ID]) {
        state.modelPreferences[result.threadId] = state.modelPreferences[DRAFT_THREAD_ID];
        delete state.modelPreferences[DRAFT_THREAD_ID];
        safeStorageSet(localStorage, "codex-model-preferences", JSON.stringify(state.modelPreferences));
      }
      clearDraftThread();
      state.selectedId = result.threadId;
      state.pendingMessages = state.pendingMessages.filter((pending) => pending.id !== pendingMessageId);
      await loadThreads();
    }
    if (result?.uncertain) {
      state.uncertainSend = { threadId: state.selectedId, message: sendMessage, images };
      state.threadStatus = {
        ...(state.threadStatus || {}),
        thinking: Boolean(result.accepted || thinking),
        turnId: result.turnId || state.threadStatus?.turnId || null
      };
      els.sendStatus.textContent = result.accepted ? t("sendUncertainAccepted") : t("sendUncertain");
      await refresh(true);
      // A host turn that started before the confirmation timeout is proof
      // that the prompt reached the desktop; do not mark it as unsent.
      if (hasDisplayedUserMessage(sendMessage) || state.threadStatus?.thinking || result.accepted || result.turnId) {
        sendAccepted = true;
        state.uncertainSend = null;
        if (pendingMessageId) updatePendingMessage(pendingMessageId, { deliveryStatus: "sent", kind: "message" });
        clearComposerAfterAcceptedSend();
      } else {
        // A timeout is not a successful send. Keep the original payload in
        // the optimistic row so the user can explicitly retry it.
        if (pendingMessageId) {
          updatePendingMessage(pendingMessageId, {
            deliveryStatus: "failed",
            kind: "pending",
            error: t("sendUncertainFailed")
          });
        }
        state.uncertainSend = null;
        els.sendStatus.textContent = t("sendUncertainFailed");
      }
    } else if (sendMode === "queue") {
      if (pendingMessageId) updatePendingMessage(pendingMessageId, { deliveryStatus: "queued", queueItemId: result.queueItem?.id || null });
      const queuedMessages = [...(state.threadStatus?.queuedMessages || []), result.queueItem].filter(Boolean);
      state.threadStatus = {
        ...(state.threadStatus || {}),
        queueLength: result.queueLength || queuedMessages.length,
        queuedMessages
      };
      els.sendStatus.textContent = "";
    } else if (sendMode === "steer") {
      state.threadStatus = { ...(state.threadStatus || {}), thinking: true, turnId: result.turnId || state.threadStatus?.turnId || null };
      if (result.mode === "start-after-steer") {
        els.sendStatus.textContent = t("steerBecameNewTurn");
      } else {
        els.sendStatus.textContent = "";
      }
    } else {
      state.threadStatus = { ...(state.threadStatus || {}), thinking: true, turnId: result.turnId || state.threadStatus?.turnId || null };
    }
    renderComposerMode();
    refreshSoon(sendMode === "queue" ? 400 : 1200);
  } catch (error) {
    if (pendingMessageId) updatePendingMessage(pendingMessageId, { deliveryStatus: "failed", kind: "pending", error: error.message || "" });
    if (!thinking) {
      state.threadStatus = previousThreadStatus;
      state.messagesSignature = "";
      renderCurrentMessages(true);
    }
    if (isDraftThread) {
      els.composerInput.value = draftSnapshot.message;
      state.selectedPlugins = draftSnapshot.selectedPlugins;
      state.selectedSkills = draftSnapshot.selectedSkills;
      state.imageAttachments = draftSnapshot.images;
      renderSelectedPlugins();
      renderSelectedSkills();
      renderImageAttachments();
      autoResizeComposerInput();
    }
    if (!thinking && /image/i.test(error.message || "")) {
      state.imageAttachments = [];
      els.imageInput.value = "";
      els.imageFileInput.value = "";
      renderImageAttachments();
    }
    els.sendStatus.textContent = t("sendFailed", { message: error.message });
  } finally {
    if (sendAccepted) clearComposerAfterAcceptedSend();
    state.composerBusy = false;
    renderComposerMode();
    if (!thinking && shouldRefocusComposer()) els.composerInput.focus();
  }
});

els.followUpMode.addEventListener("click", (event) => {
  const button = event.target.closest("[data-follow-up-mode]");
  if (!button) return;
  state.followUpMode = button.dataset.followUpMode === "steer" ? "steer" : "queue";
  safeStorageSet(localStorage, "codex-follow-up-mode", state.followUpMode);
  renderComposerMode();
  if (shouldRefocusComposer()) els.composerInput.focus();
});

els.stopButton.addEventListener("click", async () => {
  if (!state.threadStatus?.thinking || state.composerBusy || !state.selectedId) return;
  const previousStatus = state.threadStatus;
  const threadId = state.selectedId;
  const expectedTurnId = String(state.threadStatus.turnId || "");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  state.composerBusy = true;
  // 保持 thinking=true 直到服务端确认真的停了：否则按钮会在点击瞬间消失，
  // 用户既看不到反馈，也不知道该等还是该再点一次。
  state.threadStatus = { ...(state.threadStatus || {}), stopping: true };
  renderComposerMode();
  els.sendStatus.textContent = t("stoppingTask");
  els.stopButton.classList.add("is-stopping");
  try {
    const result = await postJson(
      "/api/interrupt",
      { threadId, ...(expectedTurnId ? { expectedTurnId } : {}) },
      { signal: controller.signal }
    );
    if (result?.ok === false) throw new Error(result?.error || "宿主未确认停止");
    state.threadStatus = { ...(state.threadStatus || {}), thinking: false, turnId: null, stopping: false };
    state.messagesSignature = "";
    els.sendStatus.textContent = t("taskStopped");
    refreshSoon(250);
  } catch (error) {
    state.threadStatus = previousStatus;
    if (error?.name === "AbortError") error = new Error("停止请求超时，请确认 Codex Desktop 仍在运行");
    els.sendStatus.textContent = t("interruptFailed", { message: error.message });
  } finally {
    window.clearTimeout(timeout);
    state.composerBusy = false;
    els.stopButton.classList.remove("is-stopping");
    renderComposerMode();
  }
});

els.threadCopyLinkAction.addEventListener("click", async () => {
  const thread = state.threads.find((entry) => entry.id === state.contextThreadId);
  if (!thread) return closeThreadContextMenu();
  try {
    await copyText(threadDeepLink(thread.id));
    els.sendStatus.textContent = t("threadLinkCopied");
  } catch (error) {
    els.sendStatus.textContent = t("threadLinkCopyFailed", { message: error.message });
  }
  closeThreadContextMenu();
});

els.queueStatusList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-queue-action]");
  const itemElement = button?.closest("[data-queue-item-id]");
  const itemId = itemElement?.dataset.queueItemId;
  const item = state.threadStatus?.queuedMessages?.find((entry) => entry.id === itemId);
  if (!button || !item || !state.selectedId || state.composerBusy) return;
  const action = button.dataset.queueAction;
  const edit = action === "edit";
  state.composerBusy = true;
  renderComposerMode();
  try {
    if (action === "steer") {
      const result = await postJson("/api/queue/steer", { threadId: state.selectedId, itemId });
      applyQueueStatusResult(result);
      state.pendingMessages = state.pendingMessages.filter((message) => message.queueItemId !== itemId);
      state.threadStatus = { ...(state.threadStatus || {}), thinking: true, turnId: result.turnId || state.threadStatus?.turnId || null };
      state.messagesSignature = "";
      renderCurrentMessages(false);
      refreshSoon(800);
      return;
    }
    const result = await postJson("/api/queue/cancel", { threadId: state.selectedId, itemId, edit });
    applyQueueStatusResult(result);
    state.pendingMessages = state.pendingMessages.filter((message) => message.queueItemId !== itemId);
    state.messagesSignature = "";
    renderCurrentMessages(false);
    if (edit) {
      state.followUpMode = "queue";
      safeStorageSet(localStorage, "codex-follow-up-mode", state.followUpMode);
      const draft = result.draft || { text: item.text || item.preview || "", images: [] };
      els.composerInput.value = draft.text || "";
      state.imageAttachments = (draft.images || []).map((image, index) => ({
        id: `queue-edit-${Date.now()}-${index}`,
        name: image.name || "image.jpg",
        mimeType: image.mimeType || "image/jpeg",
        size: Number(image.size) || 0,
        data: image.data || "",
        dataUrl: image.data ? `data:${image.mimeType || "image/jpeg"};base64,${image.data}` : ""
      }));
      renderImageAttachments();
      autoResizeComposerInput();
      if (shouldRefocusComposer()) els.composerInput.focus();
    }
  } catch (error) {
    els.sendStatus.textContent = t("queueClearFailed", { message: error.message });
  } finally {
    state.composerBusy = false;
    renderComposerMode();
  }
});

els.queueToggleButton?.addEventListener("click", () => {
  state.queueExpanded = !state.queueExpanded;
  safeStorageSet(localStorage, "codex-queue-expanded", state.queueExpanded ? "1" : "0");
  renderQueueStatus(state.threadStatus);
});

els.clearQueueButton.addEventListener("click", async () => {
  if (!state.selectedId || state.composerBusy) return;
  try {
    const result = await postJson("/api/queue/cancel", { threadId: state.selectedId });
    applyQueueStatusResult(result);
    const cancelledIds = new Set(result.cancelledIds || []);
    state.pendingMessages = state.pendingMessages.filter((message) => !cancelledIds.has(message.queueItemId));
    state.messagesSignature = "";
    renderCurrentMessages(false);
    els.sendStatus.textContent = t("queueCleared", { count: result.cancelled || 0 });
  } catch (error) {
    els.sendStatus.textContent = t("queueClearFailed", { message: error.message });
  }
});

applyStaticText();
configureImageInput();
initAuthToken();
initResponsiveSidebar();

els.guideButton?.addEventListener("click", openWelcomeDialog);
els.welcomeClose?.addEventListener("click", () => closeWelcomeDialog());
els.welcomeStart?.addEventListener("click", () => closeWelcomeDialog());
els.welcomeDialog?.querySelector("[data-guide-close]")?.addEventListener("click", () => closeWelcomeDialog());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.welcomeDialog && !els.welcomeDialog.hidden) closeWelcomeDialog();
});
const guideMode = new URLSearchParams(window.location.search).get("guide");

function maybeOpenWelcomeGuide() {
  if (!state.config || state.authLocked || els.authGate.hidden === false) return;
  if (guideMode === "1" || (!safeStorageGet(localStorage, WELCOME_STORAGE_KEY) && guideMode !== "0")) openWelcomeDialog();
}

async function bootstrap() {
  wireMessageActions();
// ── 手机端 · PI 宿主能力（审批 / 会话管理 / 文件 / 用量 / 通知 / 定时 / 技能）──
const hostUi = { approvals: [], filePath: "", sheetTitle: "", busy: false };

function hostSheetEl() {
  return document.querySelector("#hostSheet");
}

function openHostSheet(title, html) {
  const sheet = hostSheetEl();
  if (!sheet) return;
  hostUi.sheetTitle = title;
  const heading = document.querySelector("#hostSheetTitle");
  const body = document.querySelector("#hostSheetBody");
  if (heading) heading.textContent = title;
  if (body) body.innerHTML = html;
  sheet.hidden = false;
}

function closeHostSheet() {
  const sheet = hostSheetEl();
  if (sheet) sheet.hidden = true;
}

function hostNotice(message) {
  if (els.sendStatus) els.sendStatus.textContent = message;
}

async function hostInvoke(operation, args = [], confirm = false) {
  return postJson("/api/host", { operation, args, confirm });
}

function hostRows(rows, emptyLabel) {
  if (!Array.isArray(rows) || !rows.length) {
    return `<p class="host-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  return `<ul class="host-list">${rows.join("")}</ul>`;
}

// ── 审批 ────────────────────────────────────────────────────────────────
async function refreshApprovals() {
  const threadId = state.selectedId;
  if (!threadId || threadId === DRAFT_THREAD_ID) {
    hostUi.approvals = [];
    renderApprovals();
    return;
  }
  try {
    const data = await fetchJson(`/api/host/approvals?threadId=${encodeURIComponent(threadId)}`);
    hostUi.approvals = Array.isArray(data?.approvals) ? data.approvals : [];
  } catch {
    // 桥未重载时不打扰用户：审批区保持上一次已知状态。
  }
  renderApprovals();
}

function renderApprovals() {
  const banner = document.querySelector("#approvalBanner");
  if (!banner) return;
  const pending = hostUi.approvals.filter((item) => item.status === "pending");
  if (!pending.length) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  banner.hidden = false;
  banner.innerHTML = pending
    .map(
      (item) => `
      <article class="approval-card" data-approval-id="${escapeHtml(item.requestId)}">
        <div class="approval-card-head">
          <strong>${escapeHtml(item.title || (item.kind === "goal" ? "目标待批准" : "计划待批准"))}</strong>
          <span class="approval-kind">${escapeHtml(item.kind)}</span>
        </div>
        <p class="approval-card-question">${escapeHtml(item.question || "")}</p>
        <label class="approval-mode">批准后权限
          <select data-approval-mode>
            <option value="ask">逐次询问</option>
            <option value="accept-edits">允许改文件</option>
            <option value="auto">自动执行</option>
          </select>
        </label>
        <div class="approval-card-actions">
          <button type="button" class="approval-approve" data-approval-action="approve">批准</button>
          <button type="button" class="approval-reject" data-approval-action="reject">拒绝</button>
        </div>
      </article>`
    )
    .join("");
}

async function resolveApprovalCard(card, action) {
  const requestId = card?.dataset?.approvalId || "";
  const item = hostUi.approvals.find((entry) => entry.requestId === requestId);
  if (!item) return;
  const mode = card.querySelector("[data-approval-mode]")?.value || "ask";
  const approved = await appConfirm(
    action === "approve"
      ? `确认批准这一步？批准后将以「${mode === "auto" ? "自动执行" : mode === "accept-edits" ? "允许改文件" : "逐次询问"}」继续执行。`
      : "确认拒绝这一步？",
    { title: action === "approve" ? "批准" : "拒绝", confirmText: "确认", cancelText: "取消", danger: action !== "approve" }
  );
  if (!approved) return;
  try {
    await postJson("/api/host/approvals/resolve", {
      kind: item.kind,
      requestId: item.requestId,
      sessionId: item.sessionId,
      turnId: item.turnId,
      toolCallId: item.toolCallId,
      version: item.version,
      action,
      targetPermissionMode: mode,
      confirm: true
    });
    hostNotice(action === "approve" ? "已批准。" : "已拒绝。");
    await refreshApprovals();
  } catch (error) {
    hostNotice(`${action === "approve" ? "批准" : "拒绝"}失败：${error.message}`);
  }
}

// ── 会话管理 ────────────────────────────────────────────────────────────
async function renameCurrentThread() {
  const threadId = state.contextThreadId;
  const thread = (state.threads || []).find((entry) => entry.id === threadId);
  if (!threadId || !thread) return;
  openHostSheet("重命名会话", `
    <form class="host-form" id="hostRenameForm">
      <label>标题<input id="hostRenameInput" value="${escapeHtml(thread.title || "")}" autocomplete="off" /></label>
      <div class="host-form-actions">
        <button type="submit">保存</button>
        <button type="button" data-host-sheet-close>取消</button>
      </div>
    </form>`);
  const form = document.querySelector("#hostRenameForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = String(document.querySelector("#hostRenameInput")?.value || "").trim();
    if (!title) return;
    try {
      await hostInvoke("session/rename", [threadId, title]);
      closeHostSheet();
      await loadThreads(false);
      hostNotice("已重命名。");
    } catch (error) {
      hostNotice(`重命名失败：${error.message}`);
    }
  });
}

async function compactCurrentThread() {
  const threadId = state.contextThreadId;
  if (!threadId) return;
  const ok = await appConfirm("压缩这个会话的上下文？压缩后历史仍在，但模型上下文会变短。", {
    title: "压缩上下文",
    confirmText: "压缩",
    cancelText: "取消"
  });
  if (!ok) return;
  try {
    await hostInvoke("agent/compact", [{ sessionId: threadId }]);
    hostNotice("已请求压缩上下文。");
  } catch (error) {
    hostNotice(`压缩失败：${error.message}`);
  }
}

async function openThreadOnDesktop() {
  const threadId = state.contextThreadId;
  if (!threadId) return;
  try {
    await hostInvoke("session/open", [threadId]);
    hostNotice("已在桌面端打开。");
  } catch (error) {
    hostNotice(`打开失败：${error.message}`);
  }
}

async function deleteCurrentThread() {
  const threadId = state.contextThreadId;
  const thread = (state.threads || []).find((entry) => entry.id === threadId);
  if (!threadId || !thread) return;
  const ok = await appConfirm(`删除「${thread.title || "这条会话"}」？删除后手机端与桌面端都不再显示。`, {
    title: "删除会话",
    confirmText: "删除",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;
  try {
    await hostInvoke("session/delete", [threadId], true);
    closeThreadContextMenu();
    if (state.selectedId === threadId) state.selectedId = null;
    await loadThreads(false);
    hostNotice("会话已删除。");
  } catch (error) {
    hostNotice(`删除失败：${error.message}`);
  }
}

/**
 * 从列表移除（软删除）。
 *
 * 宿主的 session/delete 是 dangerous，会在桌面弹原生确认框 —— 人不在电脑前就
 * 删不掉。这里只写 sessions.deleted_at（PI 自己的删除语义），数据保留、可恢复，
 * 不触发桌面弹窗，符合「手机端能独立整理会话」的设计。
 */
async function hideCurrentThread() {
  const threadId = state.contextThreadId;
  const thread = (state.threads || []).find((entry) => entry.id === threadId);
  if (!threadId || !thread) return;
  const ok = await appConfirm(`把「${thread.title || "这条会话"}」从列表移除？数据会保留，可在「更多能力 → 已移除的会话」里恢复。`, {
    title: "从列表移除",
    confirmText: "移除",
    cancelText: "取消"
  });
  if (!ok) return;
  try {
    await postJson("/api/host/session/hide", { threadId });
    closeThreadContextMenu();
    state.threads = (state.threads || []).filter((entry) => entry.id !== threadId);
    if (state.selectedId === threadId) {
      state.selectedId = null;
      state.messagesSignature = "";
      state.threadStatus = null;
    }
    renderThreads();
    await loadThreads(false);
    hostNotice("已从列表移除，可在「更多能力 → 已移除的会话」恢复。");
  } catch (error) {
    hostNotice(`移除失败：${error.message}`);
  }
}

async function showHiddenSessions() {
  openHostSheet("已移除的会话", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await fetchJson("/api/host/hidden");
    const items = Array.isArray(data?.sessions) ? data.sessions : [];
    const rows = items.map((item) => {
      const time = Number(item.deletedAt) || 0;
      return `<li><span>${escapeHtml(item.title || item.id)}</span><span class="host-muted">${time ? escapeHtml(new Date(time).toLocaleString()) : ""}</span><button type="button" class="host-secondary" data-host-restore="${escapeHtml(item.id)}">恢复</button></li>`;
    });
    openHostSheet("已移除的会话", hostRows(rows, "没有已移除的会话。"));
  } catch (error) {
    openHostSheet("已移除的会话", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}


// ── 用量 ────────────────────────────────────────────────────────────────
async function showUsage(threadId = state.contextThreadId) {
  if (!threadId) return;
  openHostSheet("会话用量", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await fetchJson(`/api/host/usage?threadId=${encodeURIComponent(threadId)}`);
    const totals = data?.totals || {};
    const turns = Array.isArray(data?.turns) ? data.turns : [];
    const rows = turns.map(
      (turn) => `<li><span>${escapeHtml(turn.modelId || "-")}</span><span>${Number(turn.inputTokens) || 0} in / ${Number(turn.outputTokens) || 0} out</span><span class="host-muted">${escapeHtml(turn.status)}</span></li>`
    );
    openHostSheet("会话用量", `
      <p class="host-summary">完成 ${Number(totals.turns) || 0} 轮 · 输入 ${Number(totals.inputTokens) || 0} · 输出 ${Number(totals.outputTokens) || 0}</p>
      ${hostRows(rows, "还没有完成的轮次。")}`);
  } catch (error) {
    openHostSheet("会话用量", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

// ── 历史版本 ────────────────────────────────────────────────────────────
async function showRevisions(threadId = state.contextThreadId) {
  if (!threadId) return;
  openHostSheet("历史版本", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await hostInvoke("session/listRevisions", [{ sessionId: threadId }]);
    const payload = data?.result ?? data;
    const list = Array.isArray(payload?.revisions) ? payload.revisions : [];
    const rows = list.map((rev) => {
      const id = String(rev.id || rev.revisionId || "");
      const label = String(rev.title || rev.label || id);
      const time = Number(rev.createdAt || rev.created_at) || 0;
      return `<li><span>${escapeHtml(label)}</span><span class="host-muted">${time ? escapeHtml(new Date(time).toLocaleString()) : ""}</span></li>`;
    });
    openHostSheet("历史版本", hostRows(rows, "这个会话没有历史版本记录。"));
  } catch (error) {
    openHostSheet("历史版本", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

// ── 文件与改动 ──────────────────────────────────────────────────────────
async function showFiles(threadId = state.contextThreadId, dirPath = "") {
  if (!threadId) return;
  openHostSheet("文件与改动", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await fetchJson(
      `/api/host/files?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(dirPath)}`
    );
    const payload = data?.result ?? data;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const parent = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
    const rows = entries.map((entry) => {
      const name = String(entry.name || entry.path || "");
      const isDir = entry.type === "directory" || entry.kind === "dir" || entry.isDirectory === true;
      const target = String(entry.path || (dirPath ? `${dirPath}/${name}` : name));
      return `<li><button type="button" class="host-file" data-host-file="${escapeHtml(target)}" data-host-dir="${isDir ? "1" : "0"}">${isDir ? "📁" : "📄"} ${escapeHtml(name)}</button></li>`;
    });
    openHostSheet(
      "文件与改动",
      `${dirPath ? `<button type="button" class="host-crumb" data-host-file="${escapeHtml(parent)}" data-host-dir="1">← 上级</button>` : ""}
       <p class="host-muted">${escapeHtml(dirPath || "项目根目录")}</p>
       ${hostRows(rows, "这个目录是空的。")}
       <button type="button" class="host-secondary" data-host-diff="1">查看工作区改动</button>`
    );
  } catch (error) {
    openHostSheet("文件与改动", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

async function showFilePreview(threadId, filePath) {
  try {
    const data = await fetchJson(
      `/api/host/file?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(filePath)}`
    );
    const payload = data?.result ?? data;
    const content = String(payload?.content ?? "").slice(0, 12 * 1024);
    openHostSheet(filePath.split("/").pop() || "文件预览", `
      ${payload?.truncated ? `<p class="host-muted">文件较大，仅显示前 200 KB。</p>` : ""}
      <pre class="host-code">${escapeHtml(content || "(空文件或二进制内容)")}</pre>
      <button type="button" class="host-secondary" data-host-file="${escapeHtml(filePath.split("/").slice(0, -1).join("/"))}" data-host-dir="1">← 返回目录</button>`);
  } catch (error) {
    openHostSheet("文件预览", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

async function showWorkspaceDiff(threadId) {
  try {
    const data = await fetchJson(`/api/host/diff?threadId=${encodeURIComponent(threadId)}`);
    const payload = data?.result ?? data;
    // 宿主返回的是结构化结果：{ repo, clean, files:[{path,status,additions,deletions,binary}] }
    const files = Array.isArray(payload?.files) ? payload.files : null;
    if (files) {
      if (!files.length || payload.clean) {
        openHostSheet("工作区改动", `<p class="host-empty">当前工作区没有未提交改动。</p>`);
        return;
      }
      const rows = files.map((file) => {
        const status = String(file.status || "");
        const badge = status === "untracked" ? "新增" : status === "deleted" ? "删除" : "修改";
        const stat = file.binary ? "二进制" : `+${Number(file.additions) || 0} −${Number(file.deletions) || 0}`;
        return `<li><span>${escapeHtml(file.path || "")}</span><span class="host-muted">${badge} · ${stat}</span></li>`;
      });
      openHostSheet(`工作区改动（${files.length} 个文件）`, hostRows(rows, "没有改动。"));
      return;
    }
    const text = typeof payload === "string" ? payload : String(payload?.diff ?? payload?.patch ?? "");
    openHostSheet("工作区改动", text
      ? `<pre class="host-code">${escapeHtml(text)}</pre>`
      : `<p class="host-empty">当前工作区没有未提交改动。</p>`);
  } catch (error) {
    openHostSheet("工作区改动", `<p class="host-empty">${escapeHtml(error.message)}</p>`);
  }
}
// ── 更多能力（文件 / 用量 / 通知 / 定时 / 技能命令 / 供应商 / 浏览器） ──
async function showHostTools() {
  openHostSheet("更多能力", `
    <div class="host-tools">
      <button type="button" data-host-tool="files">文件与改动</button>
      <button type="button" data-host-tool="usage">本会话用量</button>
      <button type="button" data-host-tool="notifications">通知</button>
      <button type="button" data-host-tool="scheduled">定时任务</button>
      <button type="button" data-host-tool="commands">技能与命令</button>
      <button type="button" data-host-tool="providers">供应商与模型</button>
      <button type="button" data-host-tool="browser">浏览器状态</button>
      <button type="button" data-host-tool="hidden">已移除的会话</button>
    </div>`);
}

async function showNotifications() {
  openHostSheet("通知", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await fetchJson("/api/host/notifications?limit=30");
    const items = Array.isArray(data?.notifications) ? data.notifications : [];
    const rows = items.map((item) => {
      const time = Number(item.createdAt) || 0;
      return `<li><span>${escapeHtml(item.sessionTitle || item.kind)}</span><span class="host-muted">${escapeHtml(item.kind)}${time ? " · " + escapeHtml(new Date(time).toLocaleString()) : ""}</span></li>`;
    });
    openHostSheet(
      `通知${Number(data?.unread) ? `（${data.unread} 条未读）` : ""}`,
      `${hostRows(rows, "没有通知。")}
       ${items.length ? `<button type="button" class="host-secondary" data-host-notif-read="1">全部标为已读</button>` : ""}`
    );
  } catch (error) {
    openHostSheet("通知", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

async function showScheduled() {
  openHostSheet("定时任务", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await fetchJson("/api/host/scheduled");
    const items = Array.isArray(data?.tasks) ? data.tasks : [];
    const rows = items.map((task) => {
      const time = Number(task.lastRunAt) || 0;
      return `<li><span>${escapeHtml(task.title || task.prompt.slice(0, 40))}</span><span class="host-muted">${escapeHtml(task.cadence)}${task.enabled ? "" : " · 已停用"}${time ? " · 上次 " + escapeHtml(new Date(time).toLocaleString()) : ""}</span></li>`;
    });
    openHostSheet("定时任务", hostRows(rows, "没有定时任务。"));
  } catch (error) {
    openHostSheet("定时任务", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

async function showCommands() {
  openHostSheet("技能与命令", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await hostInvoke("composer/commands", [{}]);
    const payload = data?.result ?? data;
    const list = Array.isArray(payload?.commands) ? payload.commands : Array.isArray(payload) ? payload : [];
    const rows = list.slice(0, 80).map((cmd) => {
      const name = String(cmd.name || cmd.id || cmd.title || "");
      const desc = String(cmd.description || "");
      const insert = name.startsWith("/") ? name : `/${name}`;
      return `<li><button type="button" class="host-command" data-host-command="${escapeHtml(insert)}"><strong>${escapeHtml(insert)}</strong><span class="host-muted">${escapeHtml(desc)}</span></button></li>`;
    });
    openHostSheet("技能与命令", `${hostRows(rows, "没有可用的斜杠命令。")}<p class="host-muted">点一条会插入到输入框，再补充内容发送。</p>`);
  } catch (error) {
    openHostSheet("技能与命令", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

async function showProviders() {
  openHostSheet("供应商与模型", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await hostInvoke("providers/list", [{ includeDisabled: true }]);
    const payload = data?.result ?? data;
    const list = Array.isArray(payload?.providers) ? payload.providers : [];
    const rows = list.map((provider) => {
      const models = Array.isArray(provider.models) ? provider.models.length : 0;
      return `<li><span>${escapeHtml(provider.name || provider.id)}</span><span class="host-muted">${models} 个模型${provider.enabled === false ? " · 已停用" : ""}</span></li>`;
    });
    openHostSheet("供应商与模型", hostRows(rows, "没有配置供应商。"));
  } catch (error) {
    openHostSheet("供应商与模型", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

async function showBrowserState() {
  openHostSheet("浏览器状态", `<p class="host-empty">加载中…</p>`);
  try {
    const data = await hostInvoke("browser/getState", []);
    const payload = data?.result ?? data;
    const tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
    const rows = tabs.map((tab) => `<li><span>${escapeHtml(tab.title || tab.url || "")}</span><span class="host-muted">${escapeHtml(tab.url || "")}</span></li>`);
    openHostSheet("浏览器状态", rows.length ? hostRows(rows, "") : `<p class="host-empty">桌面端浏览器没有打开的标签页。</p>`);
  } catch (error) {
    openHostSheet("浏览器状态", `<p class="host-empty">读取失败：${escapeHtml(error.message)}</p>`);
  }
}

// ── 事件绑定 ────────────────────────────────────────────────────────────
function initHostTools() {
  document.querySelectorAll("[data-host-sheet-close]").forEach((button) => {
    button.addEventListener("click", closeHostSheet);
  });
  document.querySelector("#hostToolsButton")?.addEventListener("click", showHostTools);

  document.querySelector("#approvalBanner")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-approval-action]");
    if (!button) return;
    const card = button.closest("[data-approval-id]");
    resolveApprovalCard(card, button.dataset.approvalAction);
  });

  const actions = {
    threadRenameAction: renameCurrentThread,
    threadCompactAction: compactCurrentThread,
    threadUsageAction: () => showUsage(state.contextThreadId),
    threadFilesAction: () => showFiles(state.contextThreadId, ""),
    threadRevisionsAction: () => showRevisions(state.contextThreadId),
    threadOpenAction: openThreadOnDesktop,
    threadHideAction: hideCurrentThread,
    threadDeleteAction: deleteCurrentThread
  };
  for (const [id, handler] of Object.entries(actions)) {
    document.querySelector(`#${id}`)?.addEventListener("click", () => {
      closeThreadContextMenu();
      handler();
    });
  }

  document.querySelector("#hostSheetBody")?.addEventListener("click", (event) => {
    const fileButton = event.target.closest("[data-host-file]");
    if (fileButton) {
      const target = fileButton.dataset.hostFile || "";
      if (fileButton.dataset.hostDir === "1") showFiles(state.selectedId, target);
      else showFilePreview(state.selectedId, target);
      return;
    }
    if (event.target.closest("[data-host-diff]")) {
      showWorkspaceDiff(state.selectedId);
      return;
    }
    const restoreButton = event.target.closest("[data-host-restore]");
    if (restoreButton) {
      const threadId = restoreButton.dataset.hostRestore || "";
      postJson("/api/host/session/restore", { threadId })
        .then(async () => {
          await loadThreads(false);
          await showHiddenSessions();
          hostNotice("已恢复。");
        })
        .catch((error) => hostNotice(`恢复失败：${error.message}`));
      return;
    }
    if (event.target.closest("[data-host-notif-read]")) {
      postJson("/api/host/notifications/read", {})
        .then(() => showNotifications())
        .catch((error) => hostNotice(`标记失败：${error.message}`));
      return;
    }
    const command = event.target.closest("[data-host-command]");
    if (command) {
      const text = command.dataset.hostCommand || "";
      if (els.composerInput) {
        els.composerInput.value = `${text} `;
        els.composerInput.focus();
      }
      closeHostSheet();
      return;
    }
    const tool = event.target.closest("[data-host-tool]");
    if (tool) {
      const name = tool.dataset.hostTool;
      if (name === "notifications") showNotifications();
      if (name === "scheduled") showScheduled();
      if (name === "commands") showCommands();
      if (name === "providers") showProviders();
      if (name === "browser") showBrowserState();
      if (name === "hidden") showHiddenSessions();
      if (name === "files") showFiles(state.selectedId, "");
      if (name === "usage") showUsage(state.selectedId);
    }
  });

  setInterval(() => {
    if (!document.hidden) refreshApprovals();
  }, 15000);
  refreshApprovals();
}

initHostTools();
  await refresh(true);
  // The project list only matters once the user starts a new conversation, but
  // loading it here keeps the picker instant when they do.
  void loadProjects();
  maybeOpenWelcomeGuide();
  scheduleThreadSync();
  scheduleMessageSync();
}

async function createMessageBranch(turnId = "") {
  const threadId = state.selectedId;
  if (!threadId) return;
  try {
    const result = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/branch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(turnId ? { lastTurnId: turnId } : {})
    });
    els.sendStatus.textContent = result.branchFallback ? t("branchCreatedAtEnd") : t("branchCreated");
    // 新分叉要等门面同步一轮才进列表（桥每 3 秒重算一次）。不轮询的话，
    // 界面会先提示「分支已创建」然后停在原地——看着像没成功。
    if (result.threadId) {
      const wanted = String(result.threadId);
      for (let attempt = 0; attempt < 8; attempt++) {
        await loadThreads(false);
        if ((state.threads || []).some((thread) => String(thread.id) === wanted)) break;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      state.selectedId = wanted;
      state.messagesSignature = "";
      state.threadStatus = null;
      renderThreads();
      await loadMessages(true, wanted);
    } else {
      await loadThreads(false);
    }
  } catch (error) {
    // 宿主会直接抛英文原因（"Cannot fork a running session"）。这条是用户最容易撞上的
    // 一种，翻成人话；其余原样带上，至少能看出是宿主拒绝的。
    const needsIdle = /running session/i.test(error.message || "");
    els.sendStatus.textContent = needsIdle ? t("branchNeedsIdle") : t("branchFailed", { message: error.message });
  }
}

bootstrap();
