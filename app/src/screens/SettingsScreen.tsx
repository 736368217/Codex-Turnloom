import { useEffect, useRef } from 'react';
import { Toggle } from 'konsta/react';
import { Wifi, Database, Activity, Trash2, Sun, RefreshCw, Download, X, ShieldCheck, CircleCheck, AlertTriangle } from 'lucide-react';
import { InsetGroup } from '../components/Segmented';
import { ActionButton, TapRow, StatusPill } from '../components/ui';
import { COLORS, APP_IDENTITY } from '../theme/optionATokens';
import { useSessionState, setOfflineCacheEnabled, currentRequestContext } from '../state/sessionStore';
import { useDataState, clearOfflineCache, refreshAll } from '../state/dataStore';
import { openSheet } from '../state/sheetStore';
import { haptic, hasNativeUpdater, startUpdateDownload, cancelUpdate, installUpdate } from '../lib/nativeBridge';
import { getAppUpdate, type RequestContext } from '../lib/turnloomApi';
import { assessUpdate, absoluteApkUrl } from '../lib/appUpdate';
import { useUpdate, updateStore, setState, setMessage, setRelease, setRequestId } from '../state/updateStore';

function UpdatePanel() {
  const session = useSessionState();
  const { state, message, release, progress } = useUpdate();
  const lastCheckRef = useRef(0);

  const check = async (force = false): Promise<void> => {
    if (['checking', 'downloading', 'ready'].includes(updateStore.getState().state)) return;
    if (!force && updateStore.getState().state === 'cancelled') return;
    const context = currentRequestContext();
    if (!context) return;
    const now = Date.now();
    if (!force && now - lastCheckRef.current < 60_000) return;
    lastCheckRef.current = now;
    setState('checking');
    setMessage('正在检查新版本…');
    setRelease(null);
    const result = await getAppUpdate(context);
    if (!result.ok) {
      setState('error');
      setMessage(result.offline || result.status === 0 ? '暂时无法连接电脑，请稍后重试' : '无法获取更新信息，请稍后重试');
      return;
    }
    const assessment = assessUpdate(result.data, {
      versionCode: session.appVersionCode,
      packageName: session.packageName,
    });
    setState(assessment.state === 'checking' ? 'error' : assessment.state);
    setMessage(assessment.message);
    setRelease(assessment.release);
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
    if (!context) return;
    const url = absoluteApkUrl(context.target.origin, release.apkUrl);
    if (!url) { setState('error'); setMessage('安装包地址无效，请重新检查更新'); return; }
    const id = startUpdateDownload({
      url, token: context.target.token, sha256: release.sha256,
      versionCode: release.versionCode, packageName: release.packageName,
    });
    if (!id) { setState('error'); setMessage('无法开始下载，请稍后重试'); return; }
    setRequestId(id);
    setState('downloading');
    setMessage('正在下载安装包…');
  };

  const percent = progress.total > 0 ? Math.min(100, Math.round(progress.received / progress.total * 100)) : 0;

  return (
    <InsetGroup title="应用更新">
      <div style={{ padding: '12px 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>当前版本 {session.appVersion}</span>
          <StatusPill tone={state === 'error' ? 'red' : state === 'available' || state === 'ready' ? 'blue' : 'neutral'}>
            {state === 'checking' ? '检查中' : state === 'available' || state === 'downloading' || state === 'ready' ? '有更新' : state === 'error' ? '检查失败' : state === 'current' ? '无需更新' : state === 'cancelled' ? '已暂停' : state === 'unavailable' ? '暂无安装包' : '尚未检查'}
          </StatusPill>
        </div>
        {message && <div style={{ fontSize: 12, lineHeight: 18, color: state === 'error' ? COLORS.red : COLORS.labelSecondary, marginTop: 8 }}>{message}</div>}
        {state === 'downloading' && (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 7, borderRadius: 999, background: COLORS.fillSecondary, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent || 8}%`, background: COLORS.blue, transition: 'width .2s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: COLORS.labelSecondary, marginTop: 6 }}>{progress.total > 0 ? `${percent}% · ${Math.round(progress.received / 1024)} / ${Math.round(progress.total / 1024)} KB` : '正在连接电脑…'}</div>
          </div>
        )}
      </div>
      <div className="tl-separator" style={{ marginLeft: 16 }} />
      <TapRow leading={<RefreshCw size={17} color={COLORS.blue} />} onClick={() => { haptic('selection'); void check(true); }} disabled={state === 'checking'}>
        <span style={{ fontSize: 15 }}>手动检查更新</span>
      </TapRow>
      {(state === 'available' || state === 'cancelled') && (
        <>
          <div className="tl-separator" style={{ marginLeft: 16 }} />
          <TapRow leading={<Download size={17} color={COLORS.green} />} onClick={() => { haptic('success'); download(); }}>
            <span style={{ fontSize: 15 }}>下载新版本</span>
          </TapRow>
        </>
      )}
      {state === 'downloading' && (
        <>
          <div className="tl-separator" style={{ marginLeft: 16 }} />
          <TapRow leading={<X size={17} color={COLORS.red} />} onClick={() => { haptic('warning'); cancelUpdate(); }}>
            <span style={{ fontSize: 15 }}>暂停下载</span>
          </TapRow>
        </>
      )}
      {state === 'ready' && (
        <>
          <div className="tl-separator" style={{ marginLeft: 16 }} />
          <TapRow leading={<ShieldCheck size={17} color={COLORS.green} />} onClick={() => { haptic('success'); if (!installUpdate()) setMessage('无法打开系统安装界面，请稍后重试'); }}>
            <span style={{ fontSize: 15 }}>打开系统安装界面</span>
          </TapRow>
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

  return (
    <div className="tl-screen tl-no-scrollbar">
      <div className="tl-safe-top" style={{ padding: '12px 20px 0' }}>
        <div className="tl-large-title">设置</div>
        <div style={{ fontSize: 13, color: COLORS.labelSecondary, marginTop: 4 }}>{APP_IDENTITY.label} · {session.appVersion}</div>
      </div>

      <InsetGroup title="连接">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', minHeight: 52 }}>
          <Wifi size={17} color={online ? COLORS.green : COLORS.red} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{session.machineName} · {session.harnessName}</span>
            <span style={{ display: 'block', fontSize: 12, color: COLORS.labelSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.serverUrl}</span>
          </span>
          <StatusPill tone={online ? 'green' : 'red'} active>{online ? '已连接' : '离线'}</StatusPill>
        </div>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <TapRow leading={<Activity size={17} color={COLORS.blue} />} onClick={() => { if (context) { haptic('selection'); void refreshAll(context); } }}>
          <span style={{ fontSize: 15 }}>测试连接</span>
        </TapRow>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <TapRow leading={<CircleCheck size={17} color={COLORS.blue} />} onClick={() => { haptic('selection'); openSheet('harness'); }}>
          <span style={{ fontSize: 15 }}>切换电脑上的服务</span>
        </TapRow>
      </InsetGroup>

      <UpdatePanel />

      <InsetGroup title="本机缓存">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', minHeight: 52 }}>
          <Database size={17} color={COLORS.blue} />
          <span style={{ flex: 1, fontSize: 15 }}>保留上次同步的会话</span>
          <Toggle checked={session.offlineCacheEnabled} onChange={() => { haptic('selection'); setOfflineCacheEnabled(!session.offlineCacheEnabled); }} />
        </div>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <TapRow leading={<Trash2 size={17} color={COLORS.red} />} trailing={<span style={{ fontSize: 12, color: COLORS.labelSecondary }}>{data.cachedAt ? new Date(data.cachedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无缓存'}</span>} onClick={() => { haptic('warning'); clearOfflineCache(context); }}>
          <span style={{ fontSize: 15 }}>清除缓存会话</span>
        </TapRow>
        <div style={{ padding: '0 16px 12px', fontSize: 12, color: COLORS.labelSecondary }}>缓存按机器与服务分别保存，切换服务不会混入其他服务的会话。</div>
      </InsetGroup>

      <InsetGroup title="关于">
        <TapRow leading={<AlertTriangle size={17} color={COLORS.blue} />} onClick={() => { haptic('selection'); openSheet('diagnostics'); }}>
          <span style={{ fontSize: 15 }}>运行信息</span>
        </TapRow>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', minHeight: 52 }}>
          <Sun size={17} color={COLORS.labelSecondary} />
          <span style={{ flex: 1, fontSize: 14 }}>外观</span><StatusPill>浅色</StatusPill>
        </div>
      </InsetGroup>

      <div style={{ margin: '0 16px 12px' }}>
        <ActionButton variant="neutral" icon={<X size={16} />} onClick={() => { haptic('warning'); openSheet('disconnect'); }} style={{ color: COLORS.red }}>
          忘记这台电脑
        </ActionButton>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: COLORS.labelSecondary, padding: '4px 24px 8px' }}>
        {APP_IDENTITY.label} · {session.appVersion} ({session.appVersionCode})
      </div>
    </div>
  );
}
