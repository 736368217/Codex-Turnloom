/**
 * 发送前的模型解析：手机端选的模型必须原样生效，或者被明确拒绝。
 *
 * 真机事故：手机上选的是 DS（wb反代/deepseek-v4.1-flash），电脑端跑的是另一个
 * 模型。旧实现 models.find(id) || 默认模型，任何一次没对上都会被静默换成默认模型，
 * 用户只能看到「选择无效」。这里钉住三件事：
 *   1. 目录里没有的模型不会被替换成别的模型；
 *   2. 只是大小写 / 供应商前缀差异时能认出来并回报 remap；
 *   3. 请求的模型与最终模型一起回传，客户端可以如实显示。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTurnSettings, catalogModelMatch, piSendModelSettings } from '../server.js';

const catalog = {
  models: [
    { id: 'wb反代/deepseek-v4.1-flash', label: 'deepseek-v4.1-flash · wb反代', efforts: ['max'], defaultEffort: 'max' },
    { id: 'krisphyn（m1/cn:hy4', label: 'cn:hy4', efforts: ['off', 'high'], defaultEffort: 'high' },
  ],
  defaultModel: 'wb反代/deepseek-v4.1-flash',
  defaultEffort: 'max',
};

test('已选模型在目录里时原样生效', () => {
  const settings = resolveTurnSettings({ model: 'krisphyn（m1/cn:hy4', effort: 'off' }, catalog);
  assert.equal(settings.model, 'krisphyn（m1/cn:hy4');
  assert.equal(settings.effort, 'off');
  assert.equal(settings.modelKnown, true);
  assert.equal(settings.modelRemapped, false);
  assert.equal(settings.requestedModel, 'krisphyn（m1/cn:hy4');
});

test('目录里没有的模型不会被静默替换成默认模型', () => {
  const settings = resolveTurnSettings({ model: 'someone/removed-model', effort: 'high' }, catalog);
  assert.equal(settings.modelKnown, false, '调用方据此拒绝发送，而不是用默认模型代替');
  assert.equal(settings.requestedModel, 'someone/removed-model');
});

test('大小写差异与唯一模型名后缀都能认出来，并回报 remap', () => {
  const ci = resolveTurnSettings({ model: 'WB反代/DEEPSEEK-V4.1-FLASH' }, catalog);
  assert.equal(ci.model, 'wb反代/deepseek-v4.1-flash');
  assert.equal(ci.modelKnown, true);
  assert.equal(ci.modelRemapped, true);

  const tailOnly = {
    models: [
      { id: 'p1/only-model', efforts: [] },
      { id: 'p2/other-model', efforts: [] },
    ],
    defaultModel: 'p1/only-model',
  };
  assert.equal(catalogModelMatch(tailOnly.models, 'ghost/only-model').id, 'p1/only-model');
  // 多个供应商都有同名模型时不能猜。
  const ambiguous = {
    models: [
      { id: 'p1/dup', efforts: [] },
      { id: 'p2/dup', efforts: [] },
    ],
    defaultModel: 'p1/dup',
  };
  assert.equal(catalogModelMatch(ambiguous.models, 'ghost/dup'), null);
  assert.equal(resolveTurnSettings({ model: 'ghost/dup' }, ambiguous).modelKnown, false);
});

test('没传模型时用目录默认模型，且不算回退', () => {
  const settings = resolveTurnSettings({}, catalog);
  assert.equal(settings.model, 'wb反代/deepseek-v4.1-flash');
  assert.equal(settings.effort, 'max');
  assert.equal(settings.modelKnown, true);
  assert.equal(settings.requestedModel, '');
});

test('模型不支持所选强度时退回该模型自己的默认档，不跨模型借用', () => {
  const settings = resolveTurnSettings({ model: 'krisphyn（m1/cn:hy4', effort: 'max' }, catalog);
  assert.equal(settings.model, 'krisphyn（m1/cn:hy4');
  assert.equal(settings.effort, 'high');
});

/**
 * 2026-11-18 真机事故：会话实际在 `wbfd/deepseek-v4.1-flash`，手机端目录 id 相同但
 * 本地解析失败回落目录默认，于是每轮都带一个「要切模型」的请求；桥按显式模型调用宿主
 * 的 dangerous `session/configure`，桌面弹原生确认框，无人可点 → 发送全线挂住。
 *
 * 服务端这一层的契约是：**手机端没选模型就不下发模型切换**，直接沿用会话当前的
 * `供应商名/模型 id`（同值不会触发切换）。下面的用例钉住这条，避免以后有人「优化」
 * 成每次都带目录默认值，把弹框又带回来。
 */
const LIVE_PI_SESSION = {
  providerId: '7369f2c9-c112-4ebe-8d46-d5022b9e0a4e',
  providerName: 'wbfd',
  modelId: 'deepseek-v4.1-flash',
  thinkingLevel: 'high',
};

test('客户端没选模型时，PI 发送沿用会话当前的 供应商/模型，而不是目录默认值', () => {
  const settings = piSendModelSettings({
    requestedModel: '',
    fallback: { model: 'wbfd/hy4flash-free', effort: 'max' },
    live: LIVE_PI_SESSION,
  });
  assert.deepEqual(settings, { model: 'wbfd/deepseek-v4.1-flash', effort: 'high' });
  assert.notEqual(settings.model, 'wbfd/hy4flash-free', '不能把目录默认值当成这一轮的模型');
});

test('客户端显式选了模型时，按所选模型下发，不被会话现值覆盖', () => {
  const settings = piSendModelSettings({
    requestedModel: 'wbfd/hy4flash-free',
    fallback: { model: 'wbfd/hy4flash-free', effort: 'max' },
    live: LIVE_PI_SESSION,
  });
  assert.deepEqual(settings, { model: 'wbfd/hy4flash-free', effort: 'max' });
});

test('读不到会话现值时退回目录解析结果，不编造供应商前缀', () => {
  const fallback = { model: 'p1/only-model', effort: 'max' };
  assert.deepEqual(piSendModelSettings({ requestedModel: '', fallback, live: null }), fallback);
  assert.deepEqual(piSendModelSettings({ requestedModel: '', fallback, live: { modelId: 'x' } }), fallback);
  assert.deepEqual(piSendModelSettings({ requestedModel: '', fallback, live: { providerName: 'p1' } }), fallback);
});

test('会话给出裸模型 id 而目录是 供应商/id 时，裸 id 请求也能唯一归一', () => {
  // 手机端若把会话的裸 id 原样发上来，服务端能认出它就是目录里的那一项。
  const resolved = resolveTurnSettings({ model: 'deepseek-v4.1-flash' }, {
    models: [{ id: 'wbfd/deepseek-v4.1-flash', efforts: ['high'], defaultEffort: 'high' }],
    defaultModel: 'wbfd/deepseek-v4.1-flash',
    defaultEffort: 'high',
  });
  assert.equal(resolved.model, 'wbfd/deepseek-v4.1-flash');
  assert.equal(resolved.modelKnown, true);
  assert.equal(resolved.modelRemapped, true);
  assert.equal(resolved.requestedModel, 'deepseek-v4.1-flash');
});
