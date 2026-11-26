// QA-only stand-in for `codex app-server --listen stdio://`.
//
// Why this exists: the phone uploads diagnostics only after a *confirmed* send
// (`app/src/state/dataStore.ts` calls uploadDiagnostics once the send succeeds).
// This host has no `codex` CLI and no Codex Desktop IPC, so a real send can never
// succeed here and the upload branch stays unexercised. This stub speaks just
// enough of the documented stdio app-server protocol for one first turn to
// complete, so the server reports success and the phone's upload path runs.
//
// It is NOT a Codex substitute for any behavioural claim: it returns a canned
// turn with no model output. Verified with shared/codex-first-turn.js:
//   initialize -> {result:{}}   initialized (notification)
//   thread/start -> {result:{thread:{id}}}
//   turn/start -> {result:{turn:{id}}}  then {method:'turn/completed'}
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const LOG = process.env.STUB_CODEX_LOG || '';
const say = (m) => { if (LOG) try { appendFileSync(LOG, JSON.stringify(m) + '\n'); } catch {} };
const write = (m) => { process.stdout.write(JSON.stringify(m) + '\n'); };

const THREAD_ID = `stub-thread-${process.pid}`;
const TURN_ID = `stub-turn-${process.pid}`;
let turnSignal = '';

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  say(message);
  const id = message.id;
  const method = message.method;
  if (method && id == null) {
    // Notification from the client ("initialized", "turn/interrupt", ...).
    if (method === 'turn/interrupt') {
      write({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'completed' } } });
    }
    return;
  }
  if (method && id != null) {
    switch (method) {
      case 'initialize':
        write({ id, result: { userAgent: 'stub-codex/0.0.0' } });
        break;
      case 'thread/start':
        write({ id, result: { thread: { id: THREAD_ID, cwd: message?.params?.cwd || '' } } });
        break;
      case 'turn/start':
        write({ id, result: { turn: { id: TURN_ID, status: 'in_progress' } } });
        // Complete on the next tick so the response reaches the client first.
        turnSignal = setTimeout(() => {
          write({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'completed' } } });
        }, 120);
        turnSignal.unref?.();
        break;
      default:
        write({ id, error: { code: -32601, message: `stub-codex: unsupported method ${method}` } });
        break;
    }
    return;
  }
  say({ note: 'unhandled line', raw: line.slice(0, 400) });
});

lines.on('close', () => { say({ note: 'stdin closed' }); process.exit(0); });
