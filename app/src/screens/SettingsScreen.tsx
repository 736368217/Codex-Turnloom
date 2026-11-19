import { useEffect, useRef, useState } from 'react';
import { Toggle } from 'konsta/react';
import { Wifi, Database, Activity, Trash2, RefreshCw, Download, X, ShieldCheck, CircleCheck, AlertTriangle, Info, FileUp } from 'lucide-react';
import { InsetGroup } from '../components/Segmented';
import { StatusPill } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useSessionState, setOfflineCacheEnabled, currentRequestContext } from '../state/sessionStore';
import { useDataState, clearOfflineCache, refreshAll } from '../state/dataStore';
import { openSheet } from '../state/sheetStore';
import { haptic, hasNativeUpdater, startUpdateDownload, cancelUpdate, installUpdate, isPublicUpdateUrl } from '../lib/nativeBridge';
import type { RequestContext } from '../lib/turnloomApi';
import { absoluteApkUrl } from '../lib/appUpdate';
import { runUpdateCheck } from '../lib/updateChannel';
import { uploadDiagnostics } from '../lib/diagnostics';
import { useUpdate, updateStore, setState, setMessage, setRelease, setRequestId, setChannel } from '../state/updateStore';

const PUBLIC_HOST_FALLBACK = 'dl.736.de5.net';

export function UpdatePanel() {
  const session = useSessionState();
  const { state, message, release, progress, source, host, publicError } = useUpdate();
  const lastCheckRef = useRef(0);

  const check = async (force = false): Promise<void> => {
    if (['checking', 'downloading', 'ready'].includes(updateStore.getState().state)) return;
    if (!force && updateStore.getState().state === 'cancelled') return;
    const now = Date.now();
    if (!force && now - lastCheckRef.current < 60_000) return;
    lastCheckRef.current = now;
    const prev = updateStore.getState();
    setState('checking');
    setMessage('正在检查新版本…');
    setRelease(null);
    const outcome = await runUpdateCheck({
      installed: { versionCode: session.appVersionCode, packageName: session.packageName },
      serverContext: currentRequestContext(),
    });
    setChannel({ source: outcome.source, host: outcome.host, publicError: outcome.publicError });
    if (outcome.state === 'error') {
      // A background check that fails must stay quiet: no red line, no "检查失败"
      // for a request nobody asked for. Only a manual check reports the failure.
      if (!force) {
        const keep = ['available', 'ready', 'downloading', 'cancelled'].includes(prev.state);
        updateStore.setState({ state: keep ? prev.state : 'idle', message: keep ? prev.message : '', release: keep ? prev.release : null });
        return;
      }
      setState('error');
      setMessage(outcome.message);
      return;
    }
    setState(outcome.state === 'checking' ? 'error' : outcome.state);
    setMessage(outcome.message);
    setRelease(outcome.release);
  };

  // Cold foreground check: no modal, no automatic download.
  useEffect(() => {
    void check(false);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(false); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [session.scope, session.appVersionCode]);

  // App-level updateStore handles callbacks even while this tab is unmounted.

  const download = () => {
    if (!release || !hasNativeUpdater()) {
      setState('error');
      setMessage('此设备暂不支持在应用内下载安装包');
      return;
    }
    const context: RequestContext | null = currentRequestContext();
    const isPublic = isPublicUpdateUrl(release.apkUrl);
    // A public CDN download needs no paired machine; a computer-hosted one does.
    // Returning early on a missing context used to kill the button silently.
    if (!isPublic && !context) {
      setState('error');
      setMessage('这份安装包由电脑端提供，请先连接电脑再下载');
      return;
    }
    const url = absoluteApkUrl(context ? context.target.origin : '', release.apkUrl);
    if (!url) { setState('error'); setMessage('安装包地址无效，请重新检查更新'); return; }
    const id = startUpdateDownload({
      // The machine token never travels to R2: a public download carries none.
      url, token: isPublic ? '' : (context ? context.target.token : ''), sha256: release.sha256,
      versionCode: release.versionCode, packageName: release.packageName,
    });
    if (!id) { setState('error'); setMessage('无法开始下载，请稍后重试'); return; }
    setRequestId(id);
    setState('downloading');
    setMessage('正在下载安装包…');
  };

  const percent = progress.total > 0 ? Math.min(100, Math.round(progress.received / progress.total * 100)) : 0;

  // The source line is the acceptance surface for the fallback chain: it prints who
  // actually answered, so "无需更新" can never be read as a public-channel answer.
  const sourceLine = (() => {
    if (source === 'public') return `来源 · 公网 ${host || PUBLIC_HOST_FALLBACK}`;
    if (source === 'server') {
      const reason = publicError === 'public-http' ? '公网无清单' : publicError === 'public-schema' ? '公网清单异常' : '公网不可达';
      return publicError ? `来源 · ${reason} → 电脑端 ${host || '电脑'}` : `来源 · 电脑端 ${host || '电脑'}`;
    }
    return '来源 · —';
  })();
  // No valid manifest this round => never claim 无需更新 (the bug this panel exists for).
  const pillState = state === 'current' && !source ? 'idle' : state;

  return (
    <InsetGroup title="应用更新">
      <div className="tl-update-body" style={{ padding: '10px 16px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>当前版本 {session.appVersion}</span>
          <StatusPill tone={pillState === 'error' ? 'red' : pillState === 'available' || pillState === 'ready' ? 'blue' : 'neutral'}>
            {pillState === 'checking' ? '检查中' : pillState === 'available' || pillState === 'downloading' || pillState === 'ready' ? '有更新' : pillState === 'error' ? '检查失败' : pillState === 'current' ? '无需更新' : pillState === 'cancelled' ? '已暂停' : pillState === 'unavailable' ? '暂无安装包' : '尚未检查'}
          </StatusPill>
        </div>
        <div
          data-qa="update-source"
          style={{ fontSize: 12, lineHeight: '17px', color: COLORS.labelSecondary, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {sourceLine}
        </div>
        {message && <div style={{ fontSize: 13, lineHeight: '19px', color: state === 'error' ? COLORS.red : COLORS.labelSecondary, marginTop: 6 }}>{message}</div>}
        {state === 'downloading' && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 7, borderRadius: 999, background: COLORS.fillSecondary, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent || 8}%`, background: COLORS.blue, transition: 'width .2s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: COLORS.labelSecondary, marginTop: 6 }}>{progress.total > 0 ? `${percent}% · ${Math.round(progress.received / 1024)} / ${Math.round(progress.total / 1024)} KB` : '正在连接下载源…'}</div>
          </div>
        )}
      </div>
      <div className="tl-settings-separator" />
      <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('selection'); void check(true); }} disabled={state === 'checking'}>
        <span className="tl-settings-icon"><RefreshCw size={16} /></span>
        <span>手动检查更新</span>
        <span className="tl-settings-value">{state === 'checking' ? '检查中…' : '›'}</span>
      </button>
      {(state === 'available' || state === 'cancelled') && (
        <>
          <div className="tl-settings-separator" />
          <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('success'); download(); }}>
            <span className="tl-settings-icon"><Download size={16} /></span>
            <span>下载新版本</span>
            <span className="tl-settings-value">›</span>
          </button>
        </>
      )}
      {state === 'downloading' && (
        <>
          <div className="tl-settings-separator" />
          <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('warning'); cancelUpdate(); }}>
            <span className="tl-settings-icon"><X size={16} /></span>
            <span>暂停下载</span>
          </button>
        </>
      )}
      {state === 'ready' && (
        <>
          <div className="tl-settings-separator" />
          <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('success'); if (!installUpdate()) setMessage('无法打开系统安装界面，请稍后重试'); }}>
            <span className="tl-settings-icon"><ShieldCheck size={16} /></span>
            <span>打开系统安装界面</span>
            <span className="tl-settings-value">›</span>
          </button>
        </>
      )}
    </InsetGroup>
  );
}

export default function SettingsScreen() {
  const session = useSessionState();
  const data = useDataState();
  const context = currentRequestContext();
  const online = session.status === 'ready' && session.online && !data.offline;
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagNotice, setDiagNotice] = useState('');

  const uploadPhoneDiagnostics = async (): Promise<void> => {
    if (diagBusy || !context) return;
    setDiagBusy(true);
    setDiagNotice('');
    haptic('selection');
    const stored = await uploadDiagnostics(context);
    setDiagBusy(false);
    setDiagNotice(stored > 0 ? `已上传 ${stored} 条` : '暂无可上传记录');
  };

  return (
    <div className="tl-thread-screen">
      <div className="tl-safe-top" style={{ flex: '0 0 auto' }}>
        <div className="tl-thread-nav"><h1>设置</h1></div>
      </div>

      <div className="tl-settings-scroll">
        <section className="tl-settings-group">
          <div className="tl-settings-label">我的电脑</div>
          <div className="tl-settings-card">
            <div className="tl-settings-row">
              <span className="tl-settings-icon"><Wifi size={16} color={online ? COLORS.green : COLORS.red} /></span>
              <span className="tl-settings-main">
                <span className="tl-settings-title">
                  {session.machineName}{session.harnessName && session.harnessName !== session.machineName ? ` · ${session.harnessName}` : ''}
                </span>
                <span className="tl-settings-sub">{session.serverUrl}</span>
              </span>
              <span className="tl-settings-value"><StatusPill tone={online ? 'green' : 'red'} active>{online ? '已连接' : '离线'}</StatusPill></span>
            </div>
            <button type="button" className="tl-press tl-settings-row" onClick={() => { if (context) { haptic('selection'); void refreshAll(context); } }}>
              <span className="tl-settings-icon"><Activity size={16} /></span>
              <span>测试连接</span>
            </button>
            <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('selection'); openSheet('harness'); }}>
              <span className="tl-settings-icon"><CircleCheck size={16} /></span>
              <span>切换电脑上的服务</span>
              <span className="tl-settings-value">›</span>
            </button>
            <button type="button" className="tl-press tl-settings-row" onClick={() => { void uploadPhoneDiagnostics(); }}>
              <span className="tl-settings-icon"><FileUp size={16} /></span>
              <span>上传诊断</span>
              <span className="tl-settings-value">{diagBusy ? '上传中…' : diagNotice || '最近 200 条'}</span>
            </button>
          </div>
        </section>

        <section className="tl-settings-group">
          <div className="tl-settings-label">会话</div>
          <div className="tl-settings-card">
            <div className="tl-settings-row">
              <span className="tl-settings-icon"><Database size={16} /></span>
              <span style={{ flex: 1 }}>保留上次同步的会话</span>
              <Toggle checked={session.offlineCacheEnabled} onChange={() => { haptic('selection'); setOfflineCacheEnabled(!session.offlineCacheEnabled); }} />
            </div>
            <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('warning'); clearOfflineCache(context); }}>
              <span className="tl-settings-icon"><Trash2 size={16} /></span>
              <span>清除缓存会话</span>
              <span className="tl-settings-value">{data.cachedAt ? new Date(data.cachedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无缓存'}</span>
            </button>
          </div>
        </section>

        <section className="tl-settings-group">
          <div className="tl-settings-label">关于</div>
          <div className="tl-settings-card">
            <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('selection'); openSheet('update'); }}>
              <span className="tl-settings-icon"><Download size={16} /></span>
              <span>检查更新</span>
              <span className="tl-settings-value">›</span>
            </button>
            <button type="button" className="tl-press tl-settings-row" onClick={() => { haptic('selection'); openSheet('diagnostics'); }}>
              <span className="tl-settings-icon"><Info size={16} /></span>
              <span>运行信息</span>
              <span className="tl-settings-value">›</span>
            </button>
            <div className="tl-settings-row">
              <span className="tl-settings-icon"><AlertTriangle size={16} /></span>
              <span>版本</span>
              <span className="tl-settings-value">{session.appVersion} ({session.appVersionCode})</span>
            </div>
          </div>
        </section>

        <section className="tl-settings-group">
          <div className="tl-settings-label">危险操作</div>
          <div className="tl-settings-card">
            <button type="button" className="tl-press tl-settings-row tl-settings-row--danger" onClick={() => { haptic('warning'); openSheet('disconnect'); }}>
              <span className="tl-settings-icon"><X size={16} /></span>
              <span>忘记这台电脑</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
