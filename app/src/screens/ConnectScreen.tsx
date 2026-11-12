import { useEffect, useRef, useState, type FormEvent } from 'react';
import { App } from 'konsta/react';
import { QrCode, Link2, ScanLine, RefreshCw, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { COLORS } from '../theme/optionATokens';
import { ActionButton } from '../components/ui';
import { haptic, requestQrScan } from '../lib/nativeBridge';
import { parseMachinePairingPayload, manualPairing, type MachinePairing } from '../lib/machinePairing';
import { connectWithPairing, useSessionState, setConnectionError, switchHarness, unpair } from '../state/sessionStore';

export default function ConnectScreen({ onRevalidate }: { onRevalidate?: () => void }) {
  const session = useSessionState();
  const [serverUrl, setServerUrl] = useState(session.serverUrl);
  const [accessCode, setAccessCode] = useState(session.machineToken);
  const [showManual, setShowManual] = useState(!session.cameraAvailable);
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const lastPairing = useRef<MachinePairing | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const working = busy || ['checking', 'connecting', 'reconnecting'].includes(session.status);
  const saved = session.harnesses.length > 0;

  useEffect(() => {
    if (session.status === 'checking') {
      setServerUrl(session.serverUrl);
      setAccessCode(session.machineToken);
    }
  }, [session.status, session.serverUrl, session.machineToken]);
  useEffect(() => {
    if (session.status === 'error' && session.error.includes('访问码')) {
      setShowManual(true); setAccessCode(''); lastPairing.current = null;
    }
  }, [session.status, session.error]);

  async function connect(pairing: MachinePairing) {
    lastPairing.current = pairing;
    setBusy(true);
    setNotice('');
    try {
      if (!await connectWithPairing(pairing)) haptic('error');
    } catch {
      setConnectionError('连接未完成，请重试。');
    } finally { setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (working) return;
    const parsed = manualPairing(serverUrl, accessCode);
    if (!parsed.ok) { setConnectionError(parsed.error); return; }
    void connect(parsed.value);
  }
  async function scan() {
    if (working) return;
    setBusy(true);
    setConnectionError('', session.status);
    setNotice('');
    const result = await requestQrScan();
    setBusy(false);
    if (result.status === 'cancelled') { setNotice('已取消扫码'); return; }
    if (result.status === 'error') {
      setShowManual(true);
      setConnectionError(result.message || '无法打开相机，请手动连接。');
      return;
    }
    const parsed = parseMachinePairingPayload(result.value || '');
    if (!parsed.ok) { setConnectionError(parsed.error); return; }
    await connect(parsed.value);
  }
  function retry() {
    if (working) return;
    if (showManual && serverUrl.trim() && accessCode.trim()) submit();
    else if (lastPairing.current) void connect(lastPairing.current);
    else if (saved) onRevalidate?.();
    else setShowManual(true);
  }
  function revealManual() {
    setShowManual(v => !v);
    setTimeout(() => form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }
  return <App theme="ios" dark={false} safeAreas>
    <main className="tl-app tl-connect" style={{ background: COLORS.canvas }}>
      <div className="tl-connect-scroll">
        <header className="tl-connect-header">
          <div className="tl-brand" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="42" height="42">
              <path d="M18 34a16 16 0 0 1 27-11M46 30a16 16 0 0 1-27 11" fill="none" stroke="white" strokeLinecap="round" strokeWidth="6" />
              <circle cx="45" cy="23" r="5" fill="#56D9B5" /><circle cx="19" cy="41" r="5" fill="#FF6B4A" />
            </svg>
          </div>
          <h1 className="tl-large-title">连接电脑</h1>
          <p>{saved ? `正在连接 ${session.machineName}` : '打开电脑端的配对二维码，扫码即可连接。'}</p>
        </header>
        <section className="tl-card tl-connect-card">
          <ActionButton icon={<ScanLine size={18} />} onClick={() => void scan()} disabled={working || !session.cameraAvailable}>
            {working ? '正在连接…' : '扫码连接'}
          </ActionButton>
          {!session.cameraAvailable && <p className="tl-connect-hint">此设备没有可用相机，请手动连接。</p>}
          <button type="button" className="tl-connect-manual tl-press" aria-expanded={showManual} aria-controls="manual-connection" onClick={revealManual} disabled={working}>
            <Link2 size={17} /> 输入地址和访问码 <ChevronDown size={16} style={{ marginLeft: 'auto', transform: showManual ? 'rotate(180deg)' : undefined }} />
          </button>
          {showManual && <form id="manual-connection" ref={form} onSubmit={submit} className="tl-connect-form">
            <label htmlFor="connection-url">电脑服务地址</label>
            <input id="connection-url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="http://192.168.1.10:8787" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={working} />
            <label htmlFor="connection-code">机器访问码</label>
            <div className="tl-code-field">
              <input id="connection-code" type={showCode ? 'text' : 'password'} value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="电脑配对页上显示的访问码" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={working} />
              <button type="button" aria-label={showCode ? '隐藏访问码' : '显示访问码'} aria-pressed={showCode} onClick={() => setShowCode(v => !v)}>{showCode ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            <button type="submit" className="tl-connect-submit tl-press" disabled={working || !serverUrl.trim() || !accessCode.trim()}>{working ? '正在验证…' : '验证并连接'}</button>
          </form>}
          {session.error && <div role="alert" className="tl-connect-error">{session.error}</div>}
          {notice && <p role="status" className="tl-connect-hint">{notice}</p>}
          {session.status === 'error' && <button type="button" className="tl-connect-manual tl-press" onClick={retry} disabled={working}><RefreshCw size={16} /> 重试连接</button>}
        </section>
        {saved && session.status === 'error' && <section className="tl-card tl-connect-card" aria-label="连接恢复">
          <p className="tl-connect-hint">也可以连接电脑上的其他服务</p>
          <div className="tl-recovery-services">{session.harnesses.map(h => <button key={h.id} type="button" disabled={working} onClick={() => void switchHarness(h.id)}>{h.name}</button>)}</div>
          <button type="button" className="tl-connect-manual" onClick={() => { unpair(); setAccessCode(''); lastPairing.current = null; setShowManual(true); }}>忘记这台电脑</button>
        </section>}
        <footer className="tl-connect-footer"><QrCode size={15} /> 地址和访问码在电脑端配对页查看。<br />Codex-Turnloom · {session.appVersion}</footer>
      </div>
    </main>
  </App>;
}
