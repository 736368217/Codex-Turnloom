'use strict';
/**
 * Queue contract (2.3.0).
 *
 * Pins the phone-side rules that are easy to regress: a running turn queues
 * instead of refusing, the bar/pane always agree on the count, the paused bar
 * offers "恢复" itself, a sending item disables every action (delete included),
 * "插入本轮" and "移到队首" stay two separate rows, and an image is never
 * rendered with a guessed MIME type.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');

function load(file) {
  const full = path.resolve(root, file);
  const mod = { exports: {} };
  let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
  const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
    .replace(/import\s+[^;]+;?/g, '')
    .replace(/export default [^;]+;/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
  new Function('require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
    (source) => {
      const resolved = path.resolve(path.dirname(full), source);
      const withExt = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
      if (fs.existsSync(withExt)) return load(path.relative(root, withExt));
      throw new Error(`cannot resolve ${source} from ${file}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const contract = load('lib/chatContract.ts');
const queue = load('lib/queueLogic.ts');
const mime = load('lib/imageMime.ts');
const submit = load('lib/composerSubmit.ts');

function item(overrides = {}) {
  return {
    id: 'q1', position: 1, text: '看看这个', preview: '看看这个', imageCount: 0, fileCount: 0,
    images: [], files: [], enqueuedAt: '', deliveryState: 'queued', lastError: '', model: '', effort: '',
    ...overrides,
  };
}

test('Q1: queue fields come from the authoritative status and survive a payload without them', () => {
  const parsed = contract.normalizeThreadStatus({
    thinking: true,
    queueLength: 2,
    queuePaused: true,
    queuedMessages: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two', deliveryState: 'sending', imageCount: 1 }],
  });
  assert.equal(parsed.state, 'running');
  assert.equal(parsed.queueLength, 2);
  assert.equal(parsed.queuePaused, true);
  assert.deepEqual(parsed.queuedMessages.map((row) => row.id), ['a', 'b']);
  assert.equal(parsed.queuedMessages[1].deliveryState, 'sending');

  // A local stop sends `{}`: running ends, the queue snapshot must not vanish.
  const stopped = contract.normalizeThreadStatus({}, parsed);
  assert.equal(stopped.state, 'ended');
  assert.equal(stopped.queueLength, 2);
  assert.equal(stopped.queuePaused, true);
  assert.equal(stopped.queuedMessages.length, 2);
});

test('Q2: a length without rows drops the stale list so bar and panel cannot disagree', () => {
  const withRows = contract.normalizeThreadStatus({ queueLength: 2, queuedMessages: [{ id: 'a' }, { id: 'b' }] });
  const countOnly = contract.normalizeThreadStatus({ queueLength: 3 }, withRows);
  assert.equal(countOnly.queueLength, 3);
  assert.equal(countOnly.queuedMessages.length, 0);

  const sameLength = contract.normalizeThreadStatus({ queueLength: 2 }, withRows);
  assert.equal(sameLength.queuedMessages.length, 2);

  const rowsOnly = contract.normalizeThreadStatus({ queuedMessages: [{ id: 'z' }] }, withRows);
  assert.equal(rowsOnly.queueLength, 1, 'the array is the truth when it is present');
});

test('Q3: one queued item normalizes ids, counts, states and a bounded error', () => {
  const row = contract.normalizeQueueMessage({
    text: 'hi', images: [{ name: 'a.jpg', url: '/api/queue/image?x=1', mimeType: 'image/jpeg' }],
    files: [{ name: 'log.txt', size: 1234, mimeType: 'text/plain' }],
    deliveryState: 'awaitingconfirmation', lastError: 'x'.repeat(600),
  }, 0);
  assert.equal(row.id, 'queued-1');
  assert.equal(row.position, 1);
  assert.equal(row.imageCount, 1);
  assert.equal(row.fileCount, 1);
  assert.equal(row.images[0].mimeType, 'image/jpeg');
  assert.equal(row.deliveryState, 'awaitingConfirmation');
  assert.equal(row.lastError.length, 500);
  const dupes = contract.normalizeQueueList([{ id: 'same' }, { id: 'same' }]);
  assert.equal(dupes.length, 1, 'a duplicated id is never rendered twice');
});

test('Q4: the bar says one true thing per state; failure wins, pause offers 恢复', () => {
  const base = { queueLength: 2 };
  assert.equal(queue.queueBarSummary({ ...base, queuePaused: false, queue: [item(), item({ id: 'q2' })] }).text, '下一条将在本轮结束后发送');
  assert.equal(queue.queueBarSummary({ ...base, queuePaused: true, queue: [item()] }).showResume, true);
  assert.equal(queue.queueBarSummary({ ...base, queuePaused: true, queue: [item()] }).text, '已暂停');
  const sending = queue.queueBarSummary({ ...base, queuePaused: false, queue: [item({ deliveryState: 'sending' })] });
  assert.equal(sending.text, '正在发送…');
  const failed = queue.queueBarSummary({ ...base, queuePaused: true, queue: [item({ deliveryState: 'failed', id: 'bad' })] });
  assert.equal(failed.text, '队首发送失败');
  assert.equal(failed.failedId, 'bad');
  assert.equal(failed.tone, 'red');
  assert.equal(failed.showResume, false, 'a paused failed head shows the failure, not a resume pill');
});

test('Q5: a sending item disables every action — delete included', () => {
  const sending = item({ deliveryState: 'sending' });
  const rows = queue.queueActionRows(sending, 0, 3, true);
  assert.equal(rows.every((row) => row.disabled), true);
  assert.equal(rows.find((row) => row.id === 'remove').disabled, true);
  assert.match(rows[0].reason, /正在发送/);
});

test('Q6: 插入本轮 exists only where the backend declares steer; 移到队首 stays its own row', () => {
  const caps = { turnSteer: true, queueFiles: true };
  const queued = item();
  const idle = queue.queueActionRows(queued, 0, 3, false, caps);
  assert.deepEqual(idle.map((row) => row.id), ['edit', 'steer', 'top', 'up', 'down', 'remove']);
  assert.equal(idle.find((row) => row.id === 'steer').disabled, true);
  assert.equal(idle.find((row) => row.id === 'steer').reason, '本轮已结束');
  assert.equal(idle.find((row) => row.id === 'top').disabled, true, 'first row is already the head');
  assert.equal(idle.find((row) => row.id === 'down').disabled, false);

  const running = queue.queueActionRows(queued, 1, 3, true, caps);
  assert.equal(running.find((row) => row.id === 'steer').disabled, false);
  assert.equal(running.find((row) => row.id === 'top').disabled, false);
  assert.equal(running.find((row) => row.id === 'up').disabled, false);

  const single = queue.queueActionRows(item(), 0, 1, true, caps);
  assert.equal(single.some((row) => row.id === 'up' || row.id === 'down'), false, 'one row has no order actions');
  assert.equal(single.some((row) => row.id === 'retry'), false);

  // PI-native: the bridge's steer only raises priority and there is no reorder,
  // so the panel offers one row labelled 优先下一条 and no ordering group.
  const piCaps = { turnSteer: false, queueFiles: false };
  const pi = queue.queueActionRows(queued, 1, 3, true, piCaps);
  assert.deepEqual(pi.map((row) => row.id), ['edit', 'steer', 'remove']);
  assert.equal(pi.find((row) => row.id === 'steer').label, '优先下一条');
  assert.equal(pi.find((row) => row.id === 'steer').disabled, false);
  const piHead = queue.queueActionRows(queued, 0, 3, true, piCaps);
  assert.equal(piHead.find((row) => row.id === 'steer').disabled, true);
  assert.equal(piHead.find((row) => row.id === 'steer').reason, '已是下一条');
  const piFailed = queue.queueActionRows(item({ deliveryState: 'failed' }), 0, 3, true, piCaps, { failedIndex: 0 });
  assert.equal(piFailed.some((row) => row.id === 'steer'), false, 'a failed item cannot be prioritised');
});

test('Q6b: a failed item hides the order group instead of greying three rows', () => {
  const caps = { turnSteer: true, queueFiles: true };
  const rows = queue.queueActionRows(item({ deliveryState: 'failed' }), 0, 3, true, caps, { failedIndex: 0 });
  assert.deepEqual(rows.map((row) => row.id), ['edit', 'steer', 'retry', 'remove']);
  assert.equal(rows.find((row) => row.id === 'remove').danger, true);
  assert.equal(rows.find((row) => row.id === 'retry').disabled, false);
});

test('Q6c: only the row touching a failed head loses 上移; everyone behind loses 移到队首', () => {
  const caps = { turnSteer: true, queueFiles: true };
  const touching = queue.queueActionRows(item(), 1, 4, true, caps, { failedIndex: 0 });
  assert.equal(touching.find((row) => row.id === 'top').disabled, true);
  assert.equal(touching.find((row) => row.id === 'up').disabled, true);
  assert.equal(touching.find((row) => row.id === 'down').disabled, false);
  assert.equal(touching.find((row) => row.id === 'up').reason, '', 'the panel states it once');

  const behind = queue.queueActionRows(item(), 2, 4, true, caps, { failedIndex: 0 });
  assert.equal(behind.find((row) => row.id === 'top').disabled, true);
  assert.equal(behind.find((row) => row.id === 'up').disabled, false, 'one step lands on index 1, never past the failure');
  assert.equal(behind.find((row) => row.id === 'down').disabled, false);
});

test('Q6d: capabilities come from the server, and an undeclared flag never becomes a promise', () => {
  const codex = contract.normalizeThreadStatus({ queueCapabilities: { turnSteer: true, queueFiles: true } });
  assert.deepEqual(codex.queueCapabilities, { turnSteer: true, queueFiles: true });
  const pi = contract.normalizeThreadStatus({ queueCapabilities: { turnSteer: false, queueFiles: false } });
  assert.deepEqual(pi.queueCapabilities, { turnSteer: false, queueFiles: false });
  // Unknown is not "yes" for steer; files keep the existing friendly default.
  assert.deepEqual(contract.normalizeThreadStatus({ thinking: true }).queueCapabilities, { turnSteer: false, queueFiles: true });
  // A later payload without the field keeps the last declared capabilities.
  const kept = contract.normalizeThreadStatus({ queueLength: 1 }, pi);
  assert.deepEqual(kept.queueCapabilities, { turnSteer: false, queueFiles: false });
});

test('Q7: subtitles, badge, limit note and failure text follow the state', () => {
  assert.equal(queue.queueItemSubtitle(item()), '等待本轮结束');
  assert.equal(queue.queueItemSubtitle(item({ deliveryState: 'failed' })), '发送失败');
  assert.match(queue.queueItemSubtitle(item({ deliveryState: 'sending' })), /不能修改/);
  assert.equal(queue.queueStateBadge('failed').label, '失败');
  assert.equal(queue.queueStateBadge('queued').label, '排队中');
  assert.equal(queue.queueLimitNote(16), '');
  assert.equal(queue.queueLimitNote(17), '最多 20 条。');
  assert.equal(queue.queueFailureText(item({ deliveryState: 'failed', lastError: 'y'.repeat(260) })).length, 201);
  assert.match(queue.queueFailureText(item({ lastError: '' })), /没有给出原因/);
  assert.equal(
    queue.queueSheetSubtitle({ queueLength: 2, queuePaused: false, queue: [item({ deliveryState: 'failed' })] }),
    '队首消息发送失败。重试、编辑或删除后继续。',
  );
  assert.equal(
    queue.queueSheetSubtitle({ queueLength: 2, queuePaused: true, queue: [item()] }),
    '已暂停，点「恢复」后按顺序继续发送。',
  );
  assert.match(
    queue.queueSheetSubtitle({ queueLength: 2, queuePaused: false, queue: [item()] }),
    /排序/,
    'the default subtitle must mention sorting',
  );
});

test('Q8: retrieving a draft rebuilds the exact tray and text', () => {
  const attachments = queue.draftAttachments({
    text: '继续',
    images: [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'aGVsbG8=' }],
    files: [{ name: 'log.txt', mimeType: 'text/plain', data: 'aGk=' }],
  });
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].kind, 'image');
  assert.equal(attachments[0].dataUrl, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal(attachments[1].kind, 'file');
  assert.equal(attachments[1].name, 'log.txt');
  assert.deepEqual(queue.draftAttachments(null), []);
});

test('Q9: the composer hint is one line and never invents a queue', () => {
  assert.equal(queue.queueHintText({ running: true, waiting: false, hasInput: true, queueLength: 0, notice: '' }), '本轮运行中，发送会排队，结束后自动发出');
  assert.equal(queue.queueHintText({ running: true, waiting: false, hasInput: true, queueLength: 2, notice: '' }), '');
  assert.equal(queue.queueHintText({ running: false, waiting: false, hasInput: true, queueLength: 0, notice: '' }), '');
  assert.equal(queue.queueHintText({ running: false, waiting: false, hasInput: true, queueLength: 0, notice: '已排队 · 第 2 条' }), '已排队 · 第 2 条');
});

test('Q9b: a turn parked on an approval says so, and that line wins over the running one', () => {
  // waiting implies thinking:true (the same fact that made 2.4.0's waiting group
  // empty when the order was wrong), so the waiting branch must come first.
  assert.equal(queue.queueHintText({ running: true, waiting: true, hasInput: true, queueLength: 0, notice: '' }), '先处理审批，或排队下一条');
  assert.equal(queue.queueHintText({ running: true, waiting: true, hasInput: true, queueLength: 2, notice: '' }), '先处理审批，或排队下一条');
  assert.equal(queue.queueHintText({ running: true, waiting: true, hasInput: false, queueLength: 0, notice: '' }), '');
  assert.equal(queue.queueHintText({ running: true, waiting: true, hasInput: true, queueLength: 0, notice: '队列已暂停。恢复后按顺序继续。' }), '队列已暂停。恢复后按顺序继续。');
  const screen = read('screens/ChatDetailScreen.tsx');
  assert.match(screen, /const waiting = Boolean\(status\?\.interactionRequired\)/);
  assert.match(screen, /queueHintText\(\{ running, waiting, hasInput: composerHasContent, queueLength, notice: queueNotice \}\)/);
});

test('Q10: an image MIME is taken from bytes, then the server field, then the name — never guessed', () => {
  assert.equal(mime.imageMimeFromBytes('iVBORw0KGgoAAAANSUhEUg'), 'image/png');
  assert.equal(mime.imageMimeFromBytes('/9j/4AAQSkZJRg'), 'image/jpeg');
  assert.equal(mime.imageMimeFromBytes('UklGRiQAAABXRUJQ'), 'image/webp');
  assert.equal(mime.imageMimeFromBytes('R0lGODlhAQABAAAAACw='), 'image/gif');
  assert.equal(mime.imageMimeFromBytes('AAAA'), '');
  assert.equal(mime.imageMimeFromName('photo.JPG'), 'image/jpeg');
  assert.equal(mime.imageMimeFromName('scan.heic'), '');
  assert.equal(mime.resolveImageMime({ bodyBase64: 'AAAA', mimeType: 'image/png' }), 'image/png');
  assert.equal(mime.resolveImageMime({ bodyBase64: 'iVBORw0KGgo', mimeType: 'image/jpeg' }), 'image/png', 'bytes beat a wrong declaration');
  assert.equal(mime.resolveImageMime({ bodyBase64: 'AAAA', name: 'a.webp' }), 'image/webp');
  assert.equal(mime.resolveImageMime({ bodyBase64: 'AAAA' }), '', 'no evidence means no data URL at all');
  assert.equal(mime.resolveImageMime({ bodyBase64: 'AAAA', mimeType: 'text/html' }), '', 'only image/* declarations count');
});

test('Q11: the running composer keeps two real 44px actions, Stop rightmost', () => {
  const composer = read('components/ChatComposer.tsx');
  const primary = composer.slice(composer.indexOf('export function ChatPrimaryButton'), composer.indexOf('export function requestIdForIdentity'));
  const sendAt = primary.indexOf('aria-label="排队发送"');
  const stopAt = primary.indexOf('aria-label="停止"');
  assert.ok(sendAt > 0 && stopAt > sendAt, 'queue-send is rendered before Stop');
  assert.match(primary, /style=\{primaryStyle\(\)\}/);
  assert.match(composer, /function primaryStyle\(\)[\s\S]*?width: 44, minWidth: 44, height: 44, minHeight: 44/);
  assert.match(primary, /tl-composer-primary-row/);
  // Empty input keeps only Stop, so Stop must not be wrapped in a condition.
  assert.match(primary, /hasInput && \(/);
});

test('Q12: the screen wires the bar, the sheet, a queue submit and a paused stop', () => {
  const screen = read('screens/ChatDetailScreen.tsx');
  assert.match(screen, /<QueueBar/);
  assert.match(screen, /<QueueSheet/);
  assert.match(screen, /sendQueuedMessage/);
  assert.match(screen, /resumeThreadQueue/);
  assert.match(screen, /enterKeyHint="send"/);
  assert.match(screen, /queueHintText\(\{ running, waiting, hasInput: composerHasContent, queueLength, notice: queueNotice \}\)/);
  assert.match(screen, /hintVisible=\{Boolean\(composerHint\)\}/, 'no empty 21px line for the whole run');
  assert.match(screen, /onQueueFilesBlocked=/);
  assert.match(screen, /onRetrieved=\{applyQueueDraft\}/);
  // Failed head opens its own detail straight from the bar.
  assert.match(screen, /setQueueInitialItem\(failedId/);
});

test('Q13: the panel never renders a remote <img> directly and keeps the two-level drawer', () => {
  const panels = read('components/QueuePanels.tsx');
  assert.doesNotMatch(panels, /<img\s+src=\{/, 'remote images only through AuthedImage');
  assert.match(panels, /<AuthedImage/);
  assert.match(panels, /返回队列/);
  assert.match(panels, /aria-label=\{row\.reason \?/);
  assert.match(panels, /aria-label="恢复队列"/);
  assert.match(panels, /pushNativeBackLayer/);
  assert.match(panels, /className="tl-queue-detail-body tl-no-scrollbar"/);
  const bodyAt = panels.indexOf('className="tl-queue-detail-body');
  const noteAt = panels.indexOf('className="tl-queue-order-note">{QUEUE_FAILED_ORDER_NOTE}');
  const actionsAt = panels.indexOf('className="tl-queue-actions"');
  assert.ok(bodyAt > 0 && noteAt > bodyAt && actionsAt > noteAt, 'the failure note sits above the actions, outside the 30vh scroll box');
});

test('Q13b: a backend without queued files explains on tap instead of a dead button', () => {
  const composer = read('components/ChatComposer.tsx');
  assert.match(composer, /onQueueFilesBlocked\?\.\(\)/);
  const fileButton = composer.slice(composer.indexOf("aria-label={filesBlocked ? '附件"), composer.indexOf('</button>', composer.indexOf("aria-label={filesBlocked ? '附件")));
  assert.doesNotMatch(fileButton, /disabled=\{fields\.picking \|\| filesBlocked\}/, 'the tap must stay alive');
  assert.match(fileButton, /aria-disabled=\{filesBlocked \? true : undefined\}/);
  assert.match(fileButton, /haptic\('warning'\)/);
  const screen = read('screens/ChatDetailScreen.tsx');
  assert.match(screen, /当前后端不支持把文件排进队列，本轮结束后再发。/);
});

test('Q14: queue CSS uses the warning triple, real 44px targets and a reduced-motion opt-out', () => {
  const css = read('theme/globals.css');
  assert.match(css, /--tl-warning: #FF9500;/);
  assert.match(css, /--tl-warning-surface: #FFF4E5;/);
  assert.match(css, /--tl-warning-label: #8A5300;/);
  const bar = css.slice(css.indexOf('.tl-queuebar-main {'), css.indexOf('.tl-queuebar-count {'));
  assert.match(bar, /min-height: 44px/);
  const resume = css.slice(css.indexOf('.tl-queuebar-resume {'), css.indexOf('.tl-queuebar-resume:disabled'));
  assert.match(resume, /min-height: 44px/);
  const action = css.slice(css.indexOf('.tl-queue-action {'), css.indexOf('.tl-queue-action:disabled'));
  assert.match(action, /min-height: 52px/);
  const detail = css.slice(css.indexOf('.tl-queue-detail-body {'), css.indexOf('.tl-queue-detail-text {'));
  assert.match(detail, /max-height: 30vh/, 'the detail body scrolls inside the drawer');
  assert.match(detail, /overflow-y: auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tl-queuebar \{ animation: none; \}/);
});

test('Q15: queue sends never claim the turn ended and never append an optimistic bubble', () => {
  const store = read('state/dataStore.ts');
  const fn = store.slice(store.indexOf('export async function sendQueuedMessage'), store.indexOf('export interface QueueActionResult'));
  assert.match(fn, /mode: 'queue'/);
  assert.doesNotMatch(fn, /markThreadSubmitted/, 'the turn is still running after a queue send');
  assert.doesNotMatch(fn, /messagesByThread/, 'no optimistic bubble for a queued message');
  assert.match(fn, /applyQueueSnapshot/);
  const interrupt = store.slice(store.indexOf('export async function interruptThread'), store.indexOf('export async function resolveApproval'));
  assert.match(interrupt, /applyQueueSnapshot\(context\.scope, threadId, result\.data\)/, 'stopping pauses the queue');
});

test('Q16: the native envelope carries image bytes and the bridge keeps bodyBase64', () => {
  const bridge = read('lib/nativeBridge.ts');
  assert.match(bridge, /bodyBase64\?: string/);
  assert.match(bridge, /typeof parsed\.bodyBase64 === 'string'/);
  const image = read('lib/authImage.ts');
  assert.match(image, /bodyBase64/);
  assert.match(image, /resolveImageMime/);
  assert.doesNotMatch(image, /sniffMime/, 'one MIME resolver, in imageMime.ts');
});
