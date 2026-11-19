/**
 * `POST /api/admin/logs/upload` 的三个出口，收在一个纯函数里：
 * 缺凭据（200）、R2 拒收（502）、成功（200）。
 *
 * 这样拆是为了能在 CI 里钉住失败的**语义**——缺令牌时绝不发请求、R2 非 2xx
 * 时 HTTP 必须是 502 且带可读原因。整段留在 `server.js` 里就只能靠起服务
 * 实测，而实测覆盖不到回归。
 */

const { randomBytes } = require("node:crypto");

const DEFAULT_ENDPOINT = "https://dl.736.de5.net";
const HINT = "set TURNLOOM_LOG_UPLOAD_TOKEN or place Desktop\\认证\\r2-upload-token.txt";

/** R2 objects are readable without a token, so the key carries 32 random bits to
 * stay unguessable; the bundle itself is allowlisted, so a leaked link still
 * cannot show message text or codes. */
function logUploadKey({ machine, name, suffix }) {
  const safeMachine = String(machine || "machine").replace(/[^A-Za-z0-9._-]+/g, "-");
  const tail = String(suffix || randomBytes(4).toString("hex"));
  return `turnloom/logs/${safeMachine}/${String(name || "logs").replace(/\.zip$/, "")}-${tail}.zip`;
}

/**
 * @returns {Promise<{status: number, body: object}>} `status` is the HTTP status
 *   the route must answer with; `body` is the JSON payload.
 */
async function uploadLogBundle({
  token,
  bundle,
  machine,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
  suffix,
} = {}) {
  if (!token) return { status: 200, body: { ok: false, error: "upload-token-missing", hint: HINT } };
  const key = logUploadKey({ machine, name: bundle?.name, suffix });
  try {
    const response = await fetchImpl(`${endpoint}/${key}`, {
      method: "PUT",
      headers: { "X-Upload-Token": token, "content-type": "application/zip" },
      body: bundle.buffer,
    });
    if (!response.ok) throw new Error(`R2 returned ${response.status}`);
    return {
      status: 200,
      body: {
        ok: true,
        key,
        bytes: bundle.buffer.length,
        files: bundle.files.length,
        omitted: bundle.omitted.length,
        droppedLines: bundle.droppedLines,
      },
    };
  } catch (error) {
    return { status: 502, body: { ok: false, error: "upload-failed", reason: String(error?.message || error) } };
  }
}

module.exports = { uploadLogBundle, logUploadKey, HINT };
