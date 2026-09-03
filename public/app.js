import { MESSAGE_PAGE_SIZE, nextMessageLimit, reconcilePendingMessages, retainedScrollTop } from "./history.js";
import { renderMarkdown } from "./markdown.js";
import { filterVisibleThreads, groupedVisibleThreads, threadDeepLink } from "./threads.js";
import { resolveAuthToken } from "./auth.js";
import { clearConversationCache, conversationCacheKey, readConversationCache, writeConversationCache } from "./conversation-cache.js";

const state = {
  threads: [],
  selectedId: null,
  draftThread: null,
  messagesSignature: "",
  filter: "",
  showTools: false,
  expandedNotices: {},
  sidebarCollapsed: false,
  messageRequestSeq: 0,
  activeMessageRequest: null,
  messageLoading: false,
  messageLimit: MESSAGE_PAGE_SIZE,
  messageHistoryLoading: false,
  account: null,
  accountExpanded: false,
  config: null,
  codexHome: "",
  codexHomeVersion: null,
  draftStartedAt: 0,
  authToken: "",
  authLocked: false,
  threadStatus: null,
  goal: null,
  goalEditing: false,
  goalPressTimer: null,
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
  lastInsertedByThread: {},
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
  accountSyncBackoffMs: 0,
  lastSyncActivityAt: Date.now()
};

const THREAD_SYNC_INTERVAL_MS = 12000;
const MESSAGE_SYNC_THINKING_MS = 2000;
const MESSAGE_SYNC_IDLE_MS = 6000;
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
  queueStatusHeader: document.querySelector("#queueStatusHeader"),
  queueStatusText: document.querySelector("#queueStatusText"),
  queueStatusList: document.querySelector("#queueStatusList"),
  clearQueueButton: document.querySelector("#clearQueueButton"),
  insertStatusItem: document.querySelector("#insertStatusItem"),
  insertStatusText: document.querySelector("#insertStatusText"),
  sendStatus: document.querySelector("#sendStatus"),
  modelSummary: document.querySelector("#modelSummary"),
  modelName: document.querySelector("#modelName"),
  modelEffort: document.querySelector("#modelEffort"),
  modelPanel: document.querySelector("#modelPanel"),
  modelSelect: document.querySelector("#modelSelect"),
  effortSelect: document.querySelector("#effortSelect"),
  modelSelectLabel: document.querySelector("#modelSelectLabel"),
  effortSelectLabel: document.querySelector("#effortSelectLabel"),
  pluginPickerButton: document.querySelector("#pluginPickerButton"),
  skillPickerButton: document.querySelector("#skillPickerButton"),
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
    approvalYes: "是",
    approvalNo: "否",
    approvalAlways: "一直是",
    approvalSending: "正在提交审批...",
    approvalDone: "审批已提交",
    approvalFailed: "审批提交失败：{message}",
    desktopMayNeedAttention: "可能需要桌面处理",
    showUsage: "显示套餐用量",
    send: "发送",
    stop: "停止",
    stopCurrentTask: "停止当前任务",
    queue: "排队",
    steer: "插入",
    followUpMode: "运行中发送方式",
    queueFollowUp: "当前任务完成后发送",
    steerFollowUp: "立即插入当前任务",
    queuedCount: "已排队 {count} 条",
    queuedWithPreview: "已排队 {count} 条 · {preview}",
    queueAccepted: "已加入队列，当前任务完成后发送。",
    steerAccepted: "已插入当前任务。",
    clearQueue: "取消全部排队消息",
    queueCleared: "已取消 {count} 条排队消息。",
    queueClearFailed: "取消队列失败：{message}",
    queuedItem: "排队消息",
    editQueued: "编辑",
    cancelQueued: "取消",
    insertedItem: "已插入 · {preview}",
    stopInserted: "停止",
    editInserted: "停止后编辑",
    insertActionFailed: "处理插入消息失败：{message}",
    steerBecameNewTurn: "原任务刚好完成，这条消息已作为下一步发送。",
    modelSettings: "选择模型和思考强度",
    modelLabel: "模型",
    effortLabel: "思考强度",
    effortLow: "低",
    effortMedium: "中",
    effortHigh: "高",
    effortXhigh: "超高",
    effortMax: "最大",
    effortUltra: "极致",
    addImage: "添加图片",
    pickPhoto: "相册",
    pickFile: "文件浏览",
    removeImage: "移除图片",
    imageTooLarge: "图片过大，单张不能超过 {size} MB。",
    imageUnsupported: "不支持此图片格式，请换 JPEG、PNG、WebP、GIF、HEIC 或 BMP。",
    imageDimensionsInvalid: "图片尺寸不支持，宽高需在 {min}-{max}px 之间。",
    tooManyImages: "最多只能添加 {count} 张图片。",
    sendToCodex: "发送到当前 Codex 窗口",
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
    processed: "已处理",
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
    statusWaiting: "等待处理",
    statusEnded: "已结束",
    statusUnknown: "状态未知",
    reminderOn: "关闭完成提醒",
    reminderOff: "开启完成提醒",
    reminderEnabledLabel: "提醒已开",
    copyThreadLink: "复制深度链接",
    threadLinkCopied: "已复制对话深度链接",
    threadLinkCopyFailed: "复制深度链接失败：{message}",
    branchFromHere: "从这里创建分支",
    branchCreated: "分支已创建",
    branchFailed: "创建分支失败：{message}",
    messageQueued: "排队中",
    pinThread: "置顶",
    unpinThread: "取消置顶",
    pinnedGroup: "置顶",
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
    sendUncertainAccepted: "桌面端已接收这条消息，正在刷新状态。",
    interruptFailed: "停止失败：{message}",
    busyCannotSend: "Codex 正在处理。请先停止当前任务，再发送这条消息。",
    pluginPickerTitle: "引用插件",
    pluginPickerLoading: "正在加载插件...",
    pluginPickerEmpty: "没有找到匹配插件",
    skillPickerTitle: "引用技能",
    skillPickerLoading: "正在加载技能...",
    skillPickerEmpty: "没有找到匹配技能",
    goalLabel: "目标",
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
    approvalYes: "Yes",
    approvalNo: "No",
    approvalAlways: "Always",
    approvalSending: "Submitting approval...",
    approvalDone: "Approval submitted",
    approvalFailed: "Approval failed: {message}",
    desktopMayNeedAttention: "Desktop may need attention",
    showUsage: "Show plan usage",
    send: "Send",
    stop: "Stop",
    stopCurrentTask: "Stop current task",
    queue: "Queue",
    steer: "Insert",
    followUpMode: "Send while running",
    queueFollowUp: "Send after the current task",
    steerFollowUp: "Insert into the current task",
    queuedCount: "{count} queued",
    queuedWithPreview: "{count} queued · {preview}",
    queueAccepted: "Queued for after the current task.",
    steerAccepted: "Inserted into the current task.",
    clearQueue: "Cancel all queued messages",
    queueCleared: "Cancelled {count} queued messages.",
    queueClearFailed: "Could not cancel queue: {message}",
    queuedItem: "Queued message",
    editQueued: "Edit",
    cancelQueued: "Cancel",
    insertedItem: "Inserted · {preview}",
    stopInserted: "Stop",
    editInserted: "Stop and edit",
    insertActionFailed: "Could not update inserted message: {message}",
    steerBecameNewTurn: "The previous task finished, so this message was sent as the next step.",
    modelSettings: "Choose model and reasoning effort",
    modelLabel: "Model",
    effortLabel: "Reasoning effort",
    effortLow: "Low",
    effortMedium: "Medium",
    effortHigh: "High",
    effortXhigh: "Extra high",
    effortMax: "Maximum",
    effortUltra: "Ultra",
    addImage: "Add image",
    pickPhoto: "Photos",
    pickFile: "Files",
    removeImage: "Remove image",
    imageTooLarge: "Image is too large. Each image must be under {size} MB.",
    imageUnsupported: "Unsupported image format. Use JPEG, PNG, WebP, GIF, HEIC, or BMP.",
    imageDimensionsInvalid: "Unsupported image dimensions. Width and height must be {min}-{max}px.",
    tooManyImages: "You can attach up to {count} images.",
    sendToCodex: "Send to current Codex window",
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
    processed: "Processed",
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
    statusWaiting: "Waiting",
    statusEnded: "Ended",
    statusUnknown: "Unknown",
    reminderOn: "Disable completion reminder",
    reminderOff: "Enable completion reminder",
    reminderEnabledLabel: "Reminder on",
    copyThreadLink: "Copy deep link",
    threadLinkCopied: "Conversation deep link copied",
    threadLinkCopyFailed: "Could not copy deep link: {message}",
    branchFromHere: "Create branch from here",
    branchCreated: "Branch created",
    branchFailed: "Could not create branch: {message}",
    messageQueued: "Queued",
    pinThread: "Pin",
    unpinThread: "Unpin",
    pinnedGroup: "Pinned",
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
    sendUncertainAccepted: "Desktop accepted the message. Refreshing the conversation state.",
    interruptFailed: "Stop failed: {message}",
    busyCannotSend: "Codex is still processing. Stop the current task before sending this message.",
    pluginPickerTitle: "Mention plugin",
    pluginPickerLoading: "Loading plugins...",
    pluginPickerEmpty: "No matching plugins",
    skillPickerTitle: "Mention skill",
    skillPickerLoading: "Loading skills...",
    skillPickerEmpty: "No matching skills",
    goalLabel: "Goal",
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
  document.querySelector("#toolToggleLabel").textContent = "🔧";
  document.querySelector(".toggle").setAttribute("title", t("tool"));
  document.querySelector(".toggle").setAttribute("aria-label", t("tool"));
  els.toolToggle.checked = state.showTools;
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("pickThread"))}</div>`;
  els.modelSummary.setAttribute("title", t("modelSettings"));
  els.modelSummary.setAttribute("aria-label", t("modelSettings"));
  els.modelSelectLabel.textContent = t("modelLabel");
  els.effortSelectLabel.textContent = t("effortLabel");
  els.pluginPickerButton.setAttribute("title", t("pluginPickerTitle"));
  els.pluginPickerButton.setAttribute("aria-label", t("pluginPickerTitle"));
  els.skillPickerButton.setAttribute("title", t("skillPickerTitle"));
  els.skillPickerButton.setAttribute("aria-label", t("skillPickerTitle"));
  els.attachButton.setAttribute("title", t("addImage"));
  els.attachButton.setAttribute("aria-label", t("addImage"));
  els.pickPhotoButton.textContent = t("pickPhoto");
  els.pickFileButton.textContent = t("pickFile");
  els.sendButton.setAttribute("title", t("send"));
  els.sendButton.setAttribute("aria-label", t("send"));
  els.stopButton.setAttribute("title", t("stopCurrentTask"));
  els.stopButton.setAttribute("aria-label", t("stopCurrentTask"));
  els.followUpMode.setAttribute("aria-label", t("followUpMode"));
  els.followUpMode.querySelector('[data-follow-up-mode="queue"]').textContent = t("queue");
  els.followUpMode.querySelector('[data-follow-up-mode="queue"]').setAttribute("title", t("queueFollowUp"));
  els.followUpMode.querySelector('[data-follow-up-mode="steer"]').textContent = t("steer");
  els.followUpMode.querySelector('[data-follow-up-mode="steer"]').setAttribute("title", t("steerFollowUp"));
  els.clearQueueButton.setAttribute("title", t("clearQueue"));
  els.clearQueueButton.setAttribute("aria-label", t("clearQueue"));
  els.insertStatusItem.querySelector('[data-insert-action="edit"]').textContent = t("editInserted");
  els.insertStatusItem.querySelector('[data-insert-action="cancel"]').textContent = t("stopInserted");
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
  els.modelSelect.replaceChildren(...models.map((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label || model.id;
    return option;
  }));
  els.modelSelect.value = selectedModel.id;
  const efforts = Array.isArray(selectedModel.efforts) ? selectedModel.efforts : [];
  els.effortSelect.replaceChildren(...efforts.map((effort) => {
    const option = document.createElement("option");
    option.value = effort;
    option.textContent = effortLabel(effort);
    return option;
  }));
  els.effortSelect.value = state.effort;
  els.modelName.textContent = selectedModel.label || selectedModel.id;
  els.modelEffort.textContent = effortLabel(state.effort);
  els.modelSummary.setAttribute("aria-expanded", String(state.modelPanelOpen));
  els.modelSummary.classList.toggle("expanded", state.modelPanelOpen);
  els.modelPanel.hidden = !state.modelPanelOpen;
}

function closeModelPanel() {
  if (!state.modelPanelOpen) return;
  state.modelPanelOpen = false;
  renderModelSettings();
}

function adoptSelectedThreadModel() {
  const thread = state.threads.find((entry) => entry.id === state.selectedId);
  const preference = state.modelPreferences[state.selectedId];
  state.modelThreadId = state.selectedId;
  if (preference?.effort) state.effort = preference.effort;
  normalizeModelSettings(preference?.model || thread?.model || state.model);
}

function initAuthToken() {
  const url = new URL(window.location.href);
  const urlToken = url.searchParams.get("login") || url.searchParams.get("token") || "";
  if (urlToken) {
    url.searchParams.delete("login");
    url.searchParams.delete("token");
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
    rememberedToken: safeStorageGet(localStorage, "codexLanToken"),
    nativeToken
  });
  els.rememberDevice.checked = Boolean(safeStorageGet(localStorage, "codexLanToken"));
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
  safeStorageRemove(localStorage, "codexLanToken");
  state.authToken = "";
  state.authLocked = true;
  state.config = null;
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

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m${seconds}s`;
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
    ["accept", "approvalYes", "primary"],
    ["decline", "approvalNo", "secondary"],
    ["acceptForSession", "approvalAlways", "primary"]
  ];
  return `
    <div class="approval-actions" data-request-id="${requestId}" data-approval-kind="${approvalKind}">
      ${buttons
        .map(
          ([decision, labelKey, tone]) =>
            `<button class="approval-action ${tone}" type="button" data-decision="${escapeHtml(decision)}">${escapeHtml(t(labelKey))}</button>`
        )
        .join("")}
    </div>
  `;
}

function approvalSubmissionKey(threadId, requestId) {
  return `${threadId || ""}:${requestId || ""}`;
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
  els.attachmentTray.hidden = state.imageAttachments.length === 0;
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
  els.welcomeStart?.focus({ preventScroll: true });
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
  if (status?.thinking) return t("statusRunning");
  if (status?.interactionRequired) return t("statusWaiting");
  if (status?.state === "ended") return t("statusEnded");
  return t("statusUnknown");
}

function renderThreads() {
  els.threadCount.textContent = t("conversationsCount", { count: state.threads.length });
  const renderThread = (thread) => {
      const active = thread.id === state.selectedId ? " active" : "";
      const title = escapeHtml(thread.title || t("untitled"));
      const status = thread.status || {};
      const reminder = reminderEnabled(thread.id);
      return `
        <button class="thread-item${active}${thread.id === DRAFT_THREAD_ID ? " draft" : ""}" data-id="${thread.id}" ${thread.id === DRAFT_THREAD_ID ? "" : 'aria-haspopup="menu"'}>
          <span class="thread-copy">
            <span class="thread-title">${title}</span>
            <span class="thread-status thread-status-${escapeHtml(status.state || "unknown")}" title="${escapeHtml(threadStatusLabel(status))}">
              <span class="thread-status-dot" aria-hidden="true"></span>${escapeHtml(threadStatusLabel(status))}
              ${reminder ? `<span class="thread-reminder-state">${escapeHtml(t("reminderEnabledLabel"))}</span>` : ""}
            </span>
          </span>
        </button>
      `;
  };
  const draft = state.draftThread && filterVisibleThreads([state.draftThread], state.filter).length
    ? renderThread(state.draftThread)
    : "";
  const groups = groupedVisibleThreads(state.threads, {
    query: state.filter,
    pinnedLabel: t("pinnedGroup"),
    ungroupedLabel: t("otherConversations")
  });
  els.threadList.innerHTML = `${draft}${groups.map((group) => `
    <section class="thread-group${group.ungrouped ? " thread-group-ungrouped" : ""}" data-group-key="${escapeHtml(group.key)}">
      <h2 class="thread-group-title">${escapeHtml(group.label)}</h2>
      ${group.threads.map(renderThread).join("")}
    </section>
  `).join("")}`;
}

function renderSidebarState() {
  els.shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
}

function isCompactPortrait() {
  return window.matchMedia("(max-width: 760px) and (orientation: portrait)").matches;
}

function closeSidebarOnCompact() {
  if (!isCompactPortrait()) return;
  state.sidebarCollapsed = true;
  renderSidebarState();
}

function initResponsiveSidebar() {
  state.sidebarCollapsed = false;
  renderSidebarState();
}

function roleLabel(message) {
  if (message.role === "assistant") return "Codex";
  if (message.role === "user") return "User";
  if (message.role === "tool") return t("roleTool");
  if (message.role === "interaction") return t("roleInteraction");
  if (message.role === "notice") return t("roleNotice");
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

function roleBadge(message) {
  return `
    <div class="role-badge" aria-label="${escapeHtml(roleLabel(message))}">
      ${roleIcon(message)}
      <span class="role-text">${escapeHtml(roleLabel(message))}</span>
    </div>
  `;
}

function messageMetaTop(message, previousUserMessage) {
  if (message.role === "user") return t("sent");
  if (message.role === "assistant") {
    const inferredDuration =
      message.durationMs ||
      (previousUserMessage?.timestamp && message.timestamp
        ? new Date(message.timestamp).getTime() - new Date(previousUserMessage.timestamp).getTime()
        : 0);
    const duration = formatDuration(inferredDuration);
    return duration ? `${t("processed")} ${duration}` : t("processed");
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
  state.pendingMessages = reconcilePendingMessages(state.pendingMessages, data.messages, threadId);
  const pending = pendingMessagesForThread(threadId);
  if (!pending.length) return data.messages;
  return [...data.messages, ...pending];
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
}

function openGoalEditDialog() {
  if (!state.goal?.objective || !els.goalEditDialog) return;
  state.goalEditing = true;
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
  state.goalEditing = false;
  if (els.goalEditDialog) els.goalEditDialog.hidden = true;
  document.body.classList.remove("goal-dialog-open");
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
  const statusText = data.status?.interactionRequired
    ? `${t("separator")}${t("interactionRequired")}`
    : data.status?.thinking
        ? `${t("separator")}${t("thinking")}`
        : data.status?.possibleDesktopAttention
          ? `${t("separator")}${t("desktopMayNeedAttention")}`
          : "";
  els.threadMeta.textContent = `${t("contents", { count: displayMessages.length })}${statusText}`;

  if (!displayMessages.length && !data.status?.thinking) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(state.selectedId === DRAFT_THREAD_ID ? t("newConversationReady") : t("emptyThread"))}</div>`;
    updateScrollToBottomButton();
    return;
  }

  let previousUserMessage = null;
  const messageHtml = displayMessages
    .map((message) => {
      const isTool = message.role === "tool";
      const isInteraction = message.role === "interaction";
      const isNotice = message.role === "notice";
      const noticeKey = isNotice ? noticeCollapseKey(message) : "";
      const noticeCollapsed = isNotice && !isImportantNotice(message) && !state.expandedNotices[noticeKey];
      const hidden = isTool && !state.showTools ? " hidden" : "";
      const title =
        isNotice
          ? renderNoticeTitle(message, noticeCollapsed, noticeKey)
          : isTool || isInteraction
            ? `<div class="${isInteraction ? "interaction-title" : "tool-title"}">${escapeHtml(
                isInteraction ? t("interactionDesktopAction") : message.kind
              )}${isTool ? `${t("separator")}${escapeHtml(message.title || "")}` : ""}</div>`
          : "";
      const metaTop = messageMetaTop(message, previousUserMessage);
      const metaBottom = formatMessageDate(message.completedAtMs || message.timestamp);
      if (message.role === "user") previousUserMessage = message;
      const pendingClass = message.deliveryStatus && message.deliveryStatus !== "sent" ? " pending" : "";
      const pendingId = message.deliveryStatus ? ` data-pending-id="${escapeHtml(message.id || "")}"` : "";
      const branchAction = renderBranchAction(message);
      const messageArticle = `
        <article class="message ${escapeHtml(message.role)}${pendingClass}${hidden}"${pendingId} data-message-id="${escapeHtml(message.id || "")}" data-turn-id="${escapeHtml(message.turnId || "")}">
          <div class="role">${roleBadge(message)}</div>
          <div class="bubble">
            ${metaTop ? `<div class="message-meta message-meta-top">${escapeHtml(metaTop)}</div>` : ""}
            ${title}
            ${message.content && !noticeCollapsed ? renderMessageMarkdown(message.content) : ""}
            ${!noticeCollapsed ? renderMessageImages(message) : ""}
            ${!noticeCollapsed ? renderMessageFiles(message) : ""}
            ${renderApprovalActions(message)}
            ${branchAction}
            ${pendingDeliveryHtml(message)}
            ${metaBottom ? `<div class="message-meta message-meta-bottom">${escapeHtml(metaBottom)}</div>` : ""}
          </div>
        </article>
      `;
      return `${messageArticle}${isTool ? renderPromotedToolImages(message) : ""}`;
    })
    .join("");
  const thinkingHtml = data.status?.thinking
    ? `
      <article class="message assistant thinking-message">
        <div class="role">${roleBadge({ role: "assistant" })}</div>
        <div class="bubble thinking-bubble">
          <div class="message-meta message-meta-top">${escapeHtml(t("processing"))}</div>
          <p>${escapeHtml(t("thinking").replace("...", ""))}<span class="thinking-dots" aria-hidden="true"></span></p>
        </div>
      </article>
    `
    : "";
  els.messageList.innerHTML = `${messageHtml}${thinkingHtml}`;
  updateScrollToBottomButton();
}

function renderBranchAction(message) {
  if (!message?.id || message.deliveryStatus || !["user", "assistant"].includes(message.role)) return "";
  return `<button type="button" class="message-branch-button" data-branch-message-id="${escapeHtml(message.id)}" data-branch-turn-id="${escapeHtml(message.turnId || "")}">${escapeHtml(t("branchFromHere"))}</button>`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
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
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  return data;
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
  els.attachButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
  els.pluginPickerButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
  els.skillPickerButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
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
    ? state.selectedId === DRAFT_THREAD_ID
      ? t("newConversationReady")
      : thinking
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
  let inserted = state.lastInsertedByThread[state.selectedId] || null;
  if (inserted && status?.thinking === false) {
    delete state.lastInsertedByThread[state.selectedId];
    inserted = null;
  }
  els.queueStatusBar.hidden = count <= 0 && !inserted;
  els.queueStatusHeader.hidden = count <= 0;
  els.queueStatusList.hidden = count <= 0;
  els.insertStatusItem.hidden = !inserted;
  const compactPreview = (value, maxLength = 120) => {
    const text = String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  };
  if (inserted) els.insertStatusText.textContent = t("insertedItem", { preview: compactPreview(inserted.preview) });
  else els.insertStatusText.textContent = "";
  if (count <= 0) {
    els.queueStatusText.textContent = "";
    els.queueStatusList.innerHTML = "";
    return;
  }
  const preview = compactPreview(queuedMessages.at(-1)?.preview);
  els.queueStatusText.textContent = preview ? t("queuedWithPreview", { count, preview }) : t("queuedCount", { count });
  els.queueStatusList.innerHTML = queuedMessages
    .map(
      (item, index) => `
        <div class="queue-status-item" data-queue-item-id="${escapeHtml(item.id || "")}">
          <div class="queue-status-copy">
            <span class="queue-status-label">${escapeHtml(item.deliveryState === "failed" ? t("messageFailed") : item.deliveryState === "awaitingConfirmation" || item.deliveryState === "sending" ? t("messageSending") : t("queuedItem"))} ${index + 1}</span>
            <span class="queue-status-preview">${escapeHtml(compactPreview(item.preview || item.text))}</span>
          </div>
          <div class="queue-status-actions">
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
  state.config = await fetchJson("/api/health");
  applyHomeContext(state.config);
  normalizeModelSettings();
  hideAuthGate();
  renderComposerMode();
}

function applyHomeContext(data) {
  if (!data || data.codexHomeVersion == null) return false;
  const version = Number(data.codexHomeVersion);
  const changed = state.codexHomeVersion != null && Number.isFinite(version) && version !== state.codexHomeVersion;
  state.codexHome = data.codexHome || state.codexHome;
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
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("loading"))}</div>`;
  return true;
}

async function loadThreads() {
  const previousSelectedId = state.selectedId;
  const query = state.selectedId ? `?selectedId=${encodeURIComponent(state.selectedId)}` : "";
  const data = await fetchJson(`/api/threads${query}`);
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
  els.threadMeta.textContent = `${t("syncTemporaryFailed")}${t("separator")}${error.message}`;
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
  const networkRequest = fetchJson("/api/threads/" + threadId + "/messages?limit=" + state.messageLimit + historyParam);
  let cachedShown = false;
  try {
    const cached = await readConversationCache(cacheKey);
    if (cached && state.selectedId === threadId && state.activeMessageRequest === request) {
      state.lastMessagesData = cached;
      state.threadStatus = cached.status || null;
      state.messagesSignature = "cache:" + (cached.cachedAt || 0);
      state.messageLoading = false;
      renderComposerMode();
      renderMessages(cached);
      cachedShown = true;
    }
  } catch {
    // Cache is an optimization; network loading continues normally.
  }
  try {
    const data = await networkRequest;
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    state.lastMessagesData = data;
    state.messageLoading = false;
    state.threadStatus = data.status || null;
    renderComposerMode();
    const signature = `${data.thread?.updatedAtMs || ""}:${data.size || ""}:${data.mtimeMs || ""}:${data.limit || ""}:${data.omittedMessages || 0}:${state.showTools}:${data.status?.thinking ? "thinking" : "idle"}:${data.status?.interactionRequired ? "interaction" : "clear"}:${data.status?.turnId || ""}:${pendingSignature()}`;
    if (force || signature !== state.messagesSignature) {
      const wasNearBottom = isMessageListNearBottom();
      state.messagesSignature = signature;
      renderMessages(data);
      if (preserveScrollPosition) {
        els.messageList.scrollTop = retainedScrollTop({
          ...preserveScrollPosition,
          nextScrollHeight: els.messageList.scrollHeight
        });
      } else if (wasNearBottom || force) {
        els.messageList.scrollTop = els.messageList.scrollHeight;
      }
      updateScrollToBottomButton();
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
      els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  } finally {
    if (state.activeMessageRequest === request) state.activeMessageRequest = null;
    if (state.activeMessageRequest === null) state.messageLoading = false;
  }
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
  try {
    await loadMessages(true, state.selectedId, { preserveScrollPosition });
  } finally {
    state.messageHistoryLoading = false;
  }
}

async function refresh(forceMessages = false) {
  try {
    if (!state.config) await loadConfig();
    await loadThreads();
    await loadMessages(forceMessages);
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
      els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

function refreshSoon(delayMs = 700) {
  setTimeout(() => {
    if (shouldSync()) refresh(true);
  }, delayMs);
}

function scheduleThreadSync(delayMs = syncDelay(THREAD_SYNC_INTERVAL_MS, state.threadSyncBackoffMs)) {
  setTimeout(async () => {
    try {
      if (shouldSync()) await loadThreads();
    } catch (error) {
      if (error.status === 401) handleUnauthorized(error);
      else noteSyncFailure("thread", THREAD_SYNC_INTERVAL_MS, THREAD_SYNC_BACKOFF_MAX_MS);
    } finally {
      scheduleThreadSync();
    }
  }, delayMs);
}

function scheduleMessageSync(delayMs = syncDelay(state.threadStatus?.thinking ? MESSAGE_SYNC_THINKING_MS : MESSAGE_SYNC_IDLE_MS, state.messageSyncBackoffMs)) {
  setTimeout(async () => {
    try {
      if (shouldSync()) await loadMessages(false);
    } catch (error) {
      if (error.status === 401) handleUnauthorized(error);
      else noteSyncFailure("message", state.threadStatus?.thinking ? MESSAGE_SYNC_THINKING_MS : MESSAGE_SYNC_IDLE_MS, MESSAGE_SYNC_BACKOFF_MAX_MS);
    } finally {
      scheduleMessageSync();
    }
  }, delayMs);
}

function shouldRefocusComposer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

els.threadList.addEventListener("click", (event) => {
  const button = event.target.closest(".thread-item");
  if (!button) return;
  if (Date.now() < suppressThreadClickUntil) {
    event.preventDefault();
    return;
  }
  closeThreadContextMenu();
  closeGoalEditDialog();
  state.selectedId = button.dataset.id;
  state.messageLimit = MESSAGE_PAGE_SIZE;
  state.messageHistoryLoading = false;
  adoptSelectedThreadModel();
  if (state.selectedId !== DRAFT_THREAD_ID) clearDraftThread();
  clearSelectedPlugins();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.lastMessagesData = null;
  els.sendStatus.textContent = "";
  renderComposerMode();
  renderThreads();
  loadMessages(true, state.selectedId);
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
  closeSidebarOnCompact();
  if (shouldRefocusComposer()) els.composerInput.focus();
});

els.refreshButton.addEventListener("click", () => refresh(true));

els.goalEditButton?.addEventListener("click", () => {
  openGoalEditDialog();
});

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

els.goalPanel?.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, textarea, select")) return;
  clearTimeout(state.goalPressTimer);
  state.goalPressTimer = window.setTimeout(() => openGoalContextMenu(), 520);
});
els.goalPanel?.addEventListener("pointerup", () => clearTimeout(state.goalPressTimer));
els.goalPanel?.addEventListener("pointercancel", () => clearTimeout(state.goalPressTimer));
els.goalPanel?.addEventListener("pointerleave", () => clearTimeout(state.goalPressTimer));
els.goalPanel?.addEventListener("contextmenu", (event) => {
  if (!state.goal?.objective) return;
  event.preventDefault();
  openGoalContextMenu();
});

els.goalCancelButton?.addEventListener("click", () => {
  closeGoalEditDialog();
});

els.goalDialogClose?.addEventListener("click", closeGoalEditDialog);
els.goalEditDialog?.addEventListener("click", (event) => {
  if (event.target.matches("[data-goal-dialog-close]")) closeGoalEditDialog();
});

els.goalClearButton?.addEventListener("click", async () => {
  if (!state.selectedId || !confirm("删除当前目标？")) return;
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
  const branchButton = event.target.closest("[data-branch-message-id]");
  if (branchButton) {
    event.preventDefault();
    event.stopPropagation();
    await createMessageBranch(branchButton.dataset.branchTurnId || "");
    return;
  }
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

els.searchInput.addEventListener("input", (event) => {
  state.filter = event.target.value;
  renderThreads();
});

els.toolToggle.addEventListener("change", (event) => {
  state.showTools = event.target.checked;
  state.messagesSignature = "";
  loadMessages(true);
});

els.modelSummary.addEventListener("click", () => {
  state.modelPanelOpen = !state.modelPanelOpen;
  closePluginMentionMenu();
  closeSkillMentionMenu();
  renderModelSettings();
});

els.modelSelect.addEventListener("change", () => {
  state.model = els.modelSelect.value;
  state.effort = "";
  rememberModelSettingsForCurrentThread();
  normalizeModelSettings();
});

els.effortSelect.addEventListener("change", () => {
  state.effort = els.effortSelect.value;
  rememberModelSettingsForCurrentThread();
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
  if (els.rememberDevice.checked) safeStorageSet(localStorage, "codexLanToken", token);
  else safeStorageRemove(localStorage, "codexLanToken");
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
  if (event.key === "Enter" && !event.shiftKey) {
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
  const sendMode = thinking && !isDraftThread ? state.followUpMode : "start";
  const previousThreadStatus = state.threadStatus;
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
      if (hasDisplayedUserMessage(sendMessage) || state.threadStatus?.thinking) {
        sendAccepted = true;
        state.uncertainSend = null;
        clearComposerAfterAcceptedSend();
      }
    } else if (sendMode === "queue") {
      if (pendingMessageId) updatePendingMessage(pendingMessageId, { deliveryStatus: "queued" });
      const queuedMessages = [...(state.threadStatus?.queuedMessages || []), result.queueItem].filter(Boolean);
      state.threadStatus = {
        ...(state.threadStatus || {}),
        queueLength: result.queueLength || queuedMessages.length,
        queuedMessages
      };
      els.sendStatus.textContent = t("queueAccepted");
    } else if (sendMode === "steer") {
      state.threadStatus = { ...(state.threadStatus || {}), thinking: true, turnId: result.turnId || state.threadStatus?.turnId || null };
      if (result.mode === "start-after-steer") {
        delete state.lastInsertedByThread[state.selectedId];
        els.sendStatus.textContent = t("steerBecameNewTurn");
      } else {
        const editableContent = message || sendMessage;
        state.lastInsertedByThread[state.selectedId] = {
          content: editableContent,
          preview: editableContent.slice(0, 160) || t("addImage"),
          sentAt: result.sentAt || new Date().toISOString()
        };
        els.sendStatus.textContent = t("steerAccepted");
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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  state.composerBusy = true;
  state.threadStatus = { ...(state.threadStatus || {}), thinking: false, turnId: null, stopping: true };
  renderComposerMode();
  els.sendStatus.textContent = "";
  try {
    await postJson("/api/interrupt", { threadId: state.selectedId }, { signal: controller.signal });
    state.threadStatus = { ...(state.threadStatus || {}), thinking: false, turnId: null, stopping: false };
    state.messagesSignature = "";
    refreshSoon(250);
  } catch (error) {
    state.threadStatus = previousStatus;
    if (error?.name === "AbortError") error = new Error("停止请求超时，请确认 Codex Desktop 仍在运行");
    els.sendStatus.textContent = t("interruptFailed", { message: error.message });
  } finally {
    window.clearTimeout(timeout);
    state.composerBusy = false;
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
  const edit = button.dataset.queueAction === "edit";
  state.composerBusy = true;
  renderComposerMode();
  try {
    const result = await postJson("/api/queue/cancel", { threadId: state.selectedId, itemId });
    applyQueueStatusResult(result);
    if (edit) {
      state.followUpMode = "queue";
      safeStorageSet(localStorage, "codex-follow-up-mode", state.followUpMode);
      els.composerInput.value = item.text || item.preview || "";
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

els.insertStatusItem.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-insert-action]");
  const inserted = state.lastInsertedByThread[state.selectedId];
  if (!button || !inserted || !state.selectedId || state.composerBusy) return;
  const edit = button.dataset.insertAction === "edit";
  state.composerBusy = true;
  renderComposerMode();
  try {
    await postJson("/api/interrupt", { threadId: state.selectedId });
    delete state.lastInsertedByThread[state.selectedId];
    state.threadStatus = { ...(state.threadStatus || {}), thinking: false, turnId: null };
    if (edit) {
      els.composerInput.value = inserted.content || "";
      autoResizeComposerInput();
      if (shouldRefocusComposer()) els.composerInput.focus();
    }
    state.messagesSignature = "";
    refreshSoon();
  } catch (error) {
    els.sendStatus.textContent = t("insertActionFailed", { message: error.message });
  } finally {
    state.composerBusy = false;
    renderComposerMode();
  }
});

els.clearQueueButton.addEventListener("click", async () => {
  if (!state.selectedId || state.composerBusy) return;
  try {
    const result = await postJson("/api/queue/cancel", { threadId: state.selectedId });
    applyQueueStatusResult(result);
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
  await refresh(true);
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
    els.sendStatus.textContent = t("branchCreated");
    await loadThreads(false);
    if (result.threadId) {
      state.selectedId = result.threadId;
      state.messagesSignature = "";
      state.threadStatus = null;
      renderThreads();
      await loadMessages(true, result.threadId);
    }
  } catch (error) {
    els.sendStatus.textContent = t("branchFailed", { message: error.message });
  }
}

bootstrap();
