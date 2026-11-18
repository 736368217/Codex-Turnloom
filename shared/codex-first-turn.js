import { createInterface } from 'node:readline';

/** Start exactly one turn through the documented stdio app-server protocol.
 * Keep the child alive until that turn completes, then close its stdin.
 * Caller owns spawning so credentials/config remain process-local.
 */
export function startAppServerFirstTurn({ command, home, cwd, text, model, effort,
  spawnProcess, startupTimeoutMs = 45_000, executionTimeoutMs = 6 * 60 * 60 * 1000,
  onBackgroundError = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, ['app-server', '--listen', 'stdio://'], {
      cwd, env: { ...process.env, CODEX_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let sequence = 0, threadId = '', turnId = '', settled = false, closed = false;
    let turnFinished = false;
    let executionTimer = null, shutdownTimer = null;
    const pending = new Map();
    const lines = createInterface({ input: child.stdout });
    const stop = () => {
      if (closed) return;
      closed = true;
      clearTimeout(startupTimer); clearTimeout(executionTimer);
      child.stdin.end();
      shutdownTimer = setTimeout(() => { if (child.exitCode == null) child.kill('SIGTERM'); }, 3000);
      shutdownTimer.unref?.();
    };
    const fail = error => {
      if (closed) return;
      for (const p of pending.values()) p.reject(error);
      pending.clear();
      if (!settled) { settled = true; reject(error); }
      else { try { onBackgroundError(threadId, error); } catch {} }
      stop();
    };
    const write = message => child.stdin.write(JSON.stringify(message) + '\n');
    const request = (method, params) => new Promise((yes, no) => {
      const id = ++sequence; pending.set(id, { resolve: yes, reject: no });
      try { write({ id, method, params }); } catch (error) { pending.delete(id); no(error); }
    });
    const startupTimer = setTimeout(() => {
      const error = new Error('Timed out starting a new Codex conversation.'); error.status = 504; fail(error);
    }, startupTimeoutMs);
    lines.on('line', line => {
      if (closed) return;
      if (line.length > 4_000_000) { fail(new Error('Codex app-server protocol record exceeded the limit.')); return; }
      let message; try { message = JSON.parse(line); } catch { fail(new Error('Invalid Codex app-server response.')); return; }
      if (message.method && message.id != null) {
        // This connection cannot display interactive host prompts. Never grant one.
        write({ id: message.id, error: { code: -32601, message: 'Interactive requests require the Desktop conversation owner.' } });
        return;
      }
      if (message.id != null && pending.has(message.id)) {
        const p = pending.get(message.id); pending.delete(message.id);
        if (message.error) { const error = new Error(String(message.error.message || 'Codex app-server rejected the request.')); error.status = 502; p.reject(error); }
        else p.resolve(message.result);
      }
      if (message.method === 'turn/completed' && message.params?.threadId === threadId
          && (!turnId || message.params.turn?.id === turnId)) {
        turnFinished = true;
        if (message.params.turn?.status === 'failed') {
          try { onBackgroundError(threadId, new Error('Codex first turn failed.')); } catch {}
        }
        stop();
      }
    });
    // Consume diagnostics without logging credentials or unbounded provider output.
    child.stderr.on('data', () => {});
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('close', () => {
      clearTimeout(startupTimer); clearTimeout(executionTimer); clearTimeout(shutdownTimer); lines.close();
      if (!closed && !turnFinished) {
        const error = new Error('Codex app-server exited before the first turn completed.');
        for (const p of pending.values()) p.reject(error);
        pending.clear();
        if (!settled) { settled = true; reject(error); }
        else { try { onBackgroundError(threadId, error); } catch {} }
      }
      closed = true;
    });
    (async () => {
      await request('initialize', { clientInfo: { name: 'turnloom', title: 'Codex-Turnloom', version: '2.1' } });
      write({ method: 'initialized' });
      const created = await request('thread/start', { model, cwd });
      threadId = String(created?.thread?.id || '');
      if (!threadId) throw new Error('Codex app-server did not return a conversation id.');
      const started = await request('turn/start', {
        threadId, model, ...(effort ? { effort } : {}), input: [{ type: 'text', text, text_elements: [] }],
      });
      turnId = String(started?.turn?.id || '');
      if (!turnId) throw new Error('Codex app-server did not return a turn id.');
      clearTimeout(startupTimer);
      if (!closed) {
        executionTimer = setTimeout(() => fail(new Error('Codex first-turn worker exceeded its lifetime.')), executionTimeoutMs);
        executionTimer.unref?.();
      }
      if (!settled) { settled = true; resolve({ threadId, turnId }); }
    })().catch(fail);
  });
}
