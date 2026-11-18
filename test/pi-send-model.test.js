import assert from "node:assert/strict";
import test from "node:test";
import { piSendModelSettings } from "../server.js";

/**
 * 回归：PI 会话"没选模型"时不能把模型目录的默认值写进发送请求。
 *
 * 2026-11-18 实测：会话被切到 `wbfd/deepseek-v4.1-flash` 之后，手机端每条不带模型的
 * 普通消息都变成 `start-uncertain`（POST /api/send 挂 60 秒）。原因是服务端把目录默认
 * 模型 `wbfd/hy4flash-free` 塞进请求，桥认为"用户要换模型"，去调宿主的 dangerous
 * `session/configure` —— 那一步要桌面点原生确认框，手机端没人能点。
 */
test("未选模型时沿用会话当前模型，不用目录默认值", () => {
  const settings = piSendModelSettings({
    requestedModel: "",
    fallback: { model: "wbfd/hy4flash-free", effort: "high" },
    live: { providerName: "wbfd", modelId: "deepseek-v4.1-flash", thinkingLevel: "max" }
  });
  assert.deepEqual(settings, { model: "wbfd/deepseek-v4.1-flash", effort: "max" });
});

test("会话当前模型与目录默认值相同时结果不变", () => {
  const settings = piSendModelSettings({
    requestedModel: "",
    fallback: { model: "wbfd/hy4flash-free", effort: "high" },
    live: { providerName: "wbfd", modelId: "hy4flash-free", thinkingLevel: "high" }
  });
  assert.deepEqual(settings, { model: "wbfd/hy4flash-free", effort: "high" });
});

test("手机端显式选了模型就原样下发（不覆盖用户选择）", () => {
  const settings = piSendModelSettings({
    requestedModel: "wbfd/hy4flash-free",
    fallback: { model: "wbfd/hy4flash-free", effort: "high" },
    live: { providerName: "wbfd", modelId: "deepseek-v4.1-flash", thinkingLevel: "max" }
  });
  assert.deepEqual(settings, { model: "wbfd/hy4flash-free", effort: "high" });
});

test("会话信息缺失时退回目录默认值（不编造模型）", () => {
  for (const live of [null, {}, { providerName: "wbfd" }, { modelId: "deepseek-v4.1-flash" }]) {
    const settings = piSendModelSettings({
      requestedModel: "",
      fallback: { model: "wbfd/hy4flash-free", effort: "high" },
      live
    });
    assert.deepEqual(settings, { model: "wbfd/hy4flash-free", effort: "high" });
  }
});

test("会话没有思考强度时保留目录档位", () => {
  const settings = piSendModelSettings({
    requestedModel: "",
    fallback: { model: "wbfd/hy4flash-free", effort: "high" },
    live: { providerName: "wbfd", modelId: "deepseek-v4.1-flash", thinkingLevel: "" }
  });
  assert.deepEqual(settings, { model: "wbfd/deepseek-v4.1-flash", effort: "high" });
});
