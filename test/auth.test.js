import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthToken } from "../public/auth.js";

test("native Android access code restores a tokenless WebView history page", () => {
  assert.equal(resolveAuthToken({ nativeToken: "native-secret" }), "native-secret");
});

test("explicit URL token wins, then remembered browser token, then native token", () => {
  assert.equal(resolveAuthToken({ urlToken: "url", rememberedToken: "browser", nativeToken: "native" }), "url");
  assert.equal(resolveAuthToken({ rememberedToken: "browser", nativeToken: "native" }), "browser");
  assert.equal(resolveAuthToken({ nativeToken: "native" }), "native");
});
