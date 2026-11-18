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
import { resolveTurnSettings, catalogModelMatch } from '../server.js';

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
