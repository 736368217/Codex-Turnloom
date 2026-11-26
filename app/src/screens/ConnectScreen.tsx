import { useEffect, useRef, useState, type FormEvent } from 'react';
import { App } from 'konsta/react';
import { QrCode, Link2, ScanLine, RefreshCw, ChevronDown, ChevronLeft, Eye, EyeOff, Square, Download } from 'lucide-react';
import { COLORS } from '../theme/optionATokens';
import { ActionButton } from '../components/ui';
import { haptic, pushNativeBackLayer, requestQrScan } from '../lib/nativeBridge';
import { parseMachinePairingPayload, manualPairing, type MachinePairing } from '../lib/machinePairing';
import { connectWithPairing, clearConnectionError, useSessionState, setConnectionError, switchHarness, unpair, stopConnecting } from '../state/sessionStore';
import { openSheet } from '../state/sheetStore';
import CupertinoSheetHost from '../components/CupertinoSheetHost';
import { runUpdateCheck } from '../lib/updateChannel';
import connectHero from '../assets/art/connect-hero.png';

/** 访问码被拒、码框清空之后的唯一一句话。 */
const CODE_RETRY = '访问码不正确，请重新输入。';

export default function ConnectScreen({ onRevalidate, onBack, onPaired, mode = 'connect' }: {
  onRevalidate?: () => void;
  onBack?: () => void;
  onPaired?: () => void;
  /** `add` = 设备页的「添加一台电脑」，已有电脑保持不变。 */
  mode?: 'connect' | 'add';
}) {
  const session = useSessionState();
  const adding = mode === 'add';
  // 添加电脑时不能预填当前那台的地址与访问码：用户会把同一台又配一遍，
  // 或者以为要改的是旧机器。
  const [serverUrl, setServerUrl] = useState(adding ? '' : session.serverUrl);
  const [accessCode, setAccessCode] = useState(adding ? '' : session.machineToken);
  const [showManual, setShowManual] = useState(!session.cameraAvailable);
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const lastPairing = useRef<MachinePairing | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const working = busy || ['checking', 'connecting', 'reconnecting'].includes(session.status);
  const saved = session.harnesses.length > 0;
  const [updateCheck, setUpdateCheck] = useState<'idle' | 'checking' | 'available' | 'current' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');

  /**
   * 连接页的更新检查：只走公网 R2 那一段（配对后的两段链在设置页）。
   * 未配对时**不在挂载期间产生任何外联**；只有用户显式点「检查应用更新」才联网。
   */
  async function checkUpdate(manual = false) {
    if (updateCheck === 'checking') return;
    if (!manual && !session.serverUrl) return;
    setUpdateCheck('checking');
    try {
      const outcome = await runUpdateCheck({
        installed: { versionCode: session.appVersionCode, packageName: session.packageName },
        serverContext: null,
      });
      if (outcome.state === 'available') {
        setUpdateVersion(outcome.release?.versionName || '');
        setUpdateCheck('available');
      } else if (outcome.state === 'current') {
        setUpdateCheck('current');
      } else {
        setUpdateCheck(manual ? 'error' : 'idle');
      }
    } catch {
      setUpdateCheck('error');
    }
  }

  useEffect(() => {
    if (session.status === 'checking' && !adding) {
      setServerUrl(session.serverUrl);
      setAccessCode(session.machineToken);
    }
  }, [session.status, session.serverUrl, session.machineToken, adding]);
  useEffect(() => {
    if (session.status === 'error' && session.error.includes('访问码')) {
      setShowManual(true); setAccessCode(''); lastPairing.current = null;
      // 码框已经被清空、按钮已经置灰，文案也必须走到「请重新输入」这一步：
      // 空码框下面还挂着上一条「访问码不正确」，用户不知道下一步做什么。
      if (session.error !== CODE_RETRY) setConnectionError(CODE_RETRY);
    }
  }, [session.status, session.error]);
  // 添加电脑是一块干净的画布：进来时错误区必须为空，上一条失败讲的是别的电脑。
  useEffect(() => {
    if (adding) clearConnectionError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding]);

  // 添加电脑是全屏路由，没有 AppShell 的返回栈：自己挂一层给系统返回键。
  // 连接过程中不退出，用户要停就点屏上的「停止连接」。
  useEffect(() => {
    if (!onBack) return;
    return pushNativeBackLayer(() => { if (!working) onBack(); });
  }, [onBack, working]);

  // 只有已记住服务地址时才在挂载时自检；否则第一次打开 App 一个请求都不发。
  // 添加另一台电脑时不代旧电脑检查更新——这一步只做配对。
  useEffect(() => {
    if (!session.serverUrl) return;
    // 添加另一台电脑时不代旧电脑检查更新——这一步只做配对。
    if (adding) return;
    void checkUpdate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.serverUrl, adding]);

  async function connect(pairing: MachinePairing) {
    lastPairing.current = pairing;
    setBusy(true);
    setNotice('');
    try {
      if (!await connectWithPairing(pairing)) haptic('error');
      else onPaired?.();
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
  function stop() {
    if (!working) return;
    stopConnecting();
    lastPairing.current = null;
    setNotice('已停止连接，可重新扫码或改用其它地址。');
    haptic('warning');
  }

  function retry() {
    if (working) return;
    if (showManual && serverUrl.trim() && accessCode.trim()) submit();
    else if (lastPairing.current) void connect(lastPairing.current);
    // 添加电脑时 `saved` 指向旧那台：重试它等于替另一台机器做校验，不是用户的意图。
    else if (saved && !adding) onRevalidate?.();
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
          {/* 2.2.6: 设备页「添加一台电脑」复用这个屏；未配对时没有返回键。 */}
          {onBack && (
            <button type="button" className="tl-connect-back tl-press" onClick={onBack} aria-label="返回设备" disabled={working}>
              <ChevronLeft size={20} /> 返回
            </button>
          )}
          <div className="tl-connect-hero">
            <img src={connectHero} alt="" aria-hidden="true" width={669} height={240} decoding="async" />
          </div>
          <h1 className="tl-large-title">{adding ? '添加一台电脑' : '连接电脑'}</h1>
          <p>{adding
            ? '扫码或输入地址；连上后会加入设备列表，原来的电脑保留。'
            : saved ? `正在连接 ${session.machineName}` : '打开电脑端的配对二维码，扫码即可连接。'}</p>
        </header>
        <section className="tl-card tl-connect-card">
          <ActionButton icon={<ScanLine size={20} />} onClick={() => void scan()} disabled={working || !session.cameraAvailable}>
            {working ? '正在连接…' : '扫码连接'}
          </ActionButton>
          {working && <button type="button" className="tl-connect-manual tl-press" onClick={stop} aria-label="停止连接">
            <Square size={16} /> 停止连接
          </button>}
          {!session.cameraAvailable && <p className="tl-connect-hint">此设备没有可用相机，请手动连接。</p>}
          <button type="button" className="tl-connect-manual tl-press" aria-expanded={showManual} aria-controls="manual-connection" onClick={revealManual} disabled={working}>
            <Link2 size={20} /> 输入地址和访问码 <ChevronDown size={16} style={{ marginLeft: 'auto', transform: showManual ? 'rotate(180deg)' : undefined }} />
          </button>
          {showManual && <form id="manual-connection" ref={form} onSubmit={submit} className="tl-connect-form">
            <label htmlFor="connection-url">电脑服务地址</label>
            <input id="connection-url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="http://192.168.1.10:8787" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={working} />
            <label htmlFor="connection-code">机器访问码</label>
            <div className="tl-code-field">
              <input id="connection-code" type={showCode ? 'text' : 'password'} value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="电脑配对页上显示的访问码" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={working} />
              <button type="button" aria-label={showCode ? '隐藏访问码' : '显示访问码'} aria-pressed={showCode} onClick={() => setShowCode(v => !v)}>{showCode ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </div>
            <button type="submit" className="tl-connect-submit tl-press" disabled={working || !serverUrl.trim() || !accessCode.trim()}>{working ? '正在验证…' : '验证并连接'}</button>
          </form>}
          {session.error && <div role="alert" className="tl-connect-error">{session.error}</div>}
          {notice && <p role="status" className="tl-connect-hint">{notice}</p>}
          {session.status === 'error' && <button type="button" className="tl-connect-manual tl-press" onClick={retry} disabled={working}><RefreshCw size={16} /> 重试连接</button>}
        </section>
        {!adding && saved && session.status === 'error' && <section className="tl-card tl-connect-card" aria-label="连接恢复">
          <p className="tl-connect-hint">也可以连接电脑上的其他服务</p>
          <div className="tl-recovery-services">{session.harnesses.map(h => <button key={h.id} type="button" disabled={working} onClick={() => void switchHarness(h.id)}>{h.name}</button>)}</div>
          <button type="button" className="tl-connect-manual" onClick={() => { unpair(); setAccessCode(''); lastPairing.current = null; setShowManual(true); }}>忘记这台电脑</button>
        </section>}
        <footer className="tl-connect-footer"><span className="tl-connect-footer-line"><QrCode size={16} /> 地址和访问码在电脑端配对页查看。</span><br />Codex-Turnloom · {session.appVersion}</footer>
        {/* 未配对也必须能升级：扫码/访问码出问题时，这里是他唯一的自救入口。
            添加另一台电脑时不显示——这一步只做配对。 */}
        {!adding && (
          <section className="tl-card tl-connect-card" aria-label="应用更新">
            <p className="tl-connect-hint">
              {updateCheck === 'checking' && '正在检查新版本…'}
              {updateCheck === 'available' && `发现新版本 ${updateVersion}，可先升级再连接。`}
              {updateCheck === 'current' && `当前已是最新版本 ${session.appVersion}。`}
              {updateCheck === 'error' && '暂时无法检查更新（连不上服务器时也可稍后重试）。'}
              {updateCheck === 'idle' && '连不上电脑时，也可以主动检查公开更新通道（不会自动联网）。'}
            </p>
            <button type="button" className="tl-connect-manual tl-press" onClick={() => { void checkUpdate(true); }} disabled={updateCheck === 'checking'}>
              <RefreshCw size={16} /> {updateCheck === 'checking' ? '检查中…' : '检查应用更新（公开通道）'}
            </button>
            {updateCheck === 'available' && (
              <button type="button" className="tl-connect-submit tl-press" onClick={() => { haptic('selection'); openSheet('update'); }}>
                <Download size={16} /> 查看并安装
              </button>
            )}
          </section>
        )}
      </div>
    </main>
    {/* This screen renders its own Konsta <App>, outside AppShell. Without a host
        here, 「查看并安装」 opened the update sheet into nothing. */}
    <CupertinoSheetHost />
  </App>;
}
