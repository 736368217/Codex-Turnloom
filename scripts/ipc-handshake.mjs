// Sends one `initialize` frame to the PI-Desktop IPC facade and prints the response.
// Exists so the post-restart self-check can prove the bridge still answers the
// app-server handshake (without it, new conversations fall back to the codex CLI).
import net from "node:net";

const pipe = process.env.TURNLOOM_IPC_PIPE || "\\\\.\\pipe\\pidesktop-codex-ipc";

function encodeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

const socket = net.connect(pipe);
let buffer = Buffer.alloc(0);
const timer = setTimeout(() => {
  console.log(JSON.stringify({ ok: false, error: "timeout" }));
  process.exit(2);
}, 8000);

socket.on("connect", () => {
  socket.write(
    encodeFrame({
      type: "request",
      requestId: "selfcheck-initialize",
      method: "initialize",
      version: 1,
      params: { clientInfo: { name: "turnloom-selfcheck", version: "1.17.2" } },
    }),
  );
});

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) return;
    const text = buffer.subarray(4, 4 + length).toString("utf8");
    clearTimeout(timer);
    let frame = null;
    try {
      frame = JSON.parse(text);
    } catch {
      /* fall through */
    }
    const ok = frame?.resultType === "success";
    console.log(JSON.stringify({ ok, frame }));
    socket.destroy();
    process.exit(ok ? 0 : 1);
  }
});

socket.on("error", (error) => {
  clearTimeout(timer);
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
