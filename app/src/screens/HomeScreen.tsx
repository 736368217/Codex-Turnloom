/** Home: verified machine status + real active tasks + update availability. */
import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronRight, Zap, Download, RefreshCw, Sparkles } from 'lucide-react';
import MachineHubHeader from '../components/MachineHubHeader';
import StatusCard from '../components/StatusCard';
import TaskStream, { toneOfThread } from '../components/TaskStream';
import { SectionTitle, TapRow, StatusPill } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState } from '../state/dataStore';
import { openSheet } from '../state/sheetStore';
import { useSessionState, currentRequestContext } from '../state/sessionStore';
import { haptic } from '../lib/nativeBridge';
import { assessUpdate, type UpdateAssessment } from '../lib/appUpdate';
import { getPublicAppUpdate, getAppUpdate } from '../lib/turnloomApi';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 每 6 小时自动查一次
const LAST_CHECK_KEY = 'turnloom.update.lastCheck.v1';

function readLastCheck(): number {
  try { return Number(localStorage.getItem(LAST_CHECK_KEY) || 0) || 0; } catch { return 0; }
}
function writeLastCheck(at: number): void {
  try { localStorage.setItem(LAST_CHECK_KEY, String(at)); } catch { /* private mode */ }
}

/**
 * 首页更新检测：即使没配对/连不上电脑也能查。
 * 已配对走鉴权接口；未配对走公开入口，只要记得上次的服务端地址就够。
 */
export default function HomeScreen() {
  const data = useDataState();
  // 首页只展示正在运行的任务；历史会话统一放到「会话」页。
  const runningThreads = data.threads.filter((thread) => toneOfThread(thread, data.statusByThread) === 'running');
  const session = useSessionState();
  const [update, setUpdate] = useState<UpdateAssessment | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  const installed = { versionCode: session.appVersionCode, packageName: session.packageName };

  async function check(force = false) {
    if (busy.current) return;
    const last = readLastCheck();
    if (!force && Date.now() - last < CHECK_INTERVAL_MS) return;
    busy.current = true;
    setChecking(true);
    try {
      const context = currentRequestContext();
      const result = context ? await getAppUpdate(context) : { ok: false as const, status: 0, error: 'unpaired', offline: true };
      const fallback = result.ok ? result : (session.serverUrl ? await getPublicAppUpdate(session.serverUrl) : result);
      if (fallback.ok) {
        setUpdate(assessUpdate(fallback.data, installed));
        writeLastCheck(Date.now());
      }
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  useEffect(() => {
    void check(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // 只在挂载与前后台切换时检查，版本变化由 check 内部节流。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showUpdate = update && (update.state === 'available' || update.state === 'error');

  return (
    <div className="tl-screen tl-no-scrollbar">
      <MachineHubHeader />
      <SectionTitle>机器状态</SectionTitle>
      <StatusCard />

      {showUpdate && (
        <>
          <SectionTitle>应用更新</SectionTitle>
          <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', margin: '0 16px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
              <span style={{ display: 'flex', color: update.state === 'available' ? COLORS.blue : COLORS.labelSecondary }}>
                <Sparkles size={17} />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: COLORS.labelPrimary }}>
                {update.state === 'available'
                  ? `发现新版本 ${update.release?.versionName || ''}`
                  : '暂时无法检查更新'}
              </span>
              {update.state === 'available' && <StatusPill tone="blue">可更新</StatusPill>}
            </div>
            <div style={{ padding: '0 16px 12px', fontSize: 12, lineHeight: 18, color: COLORS.labelSecondary }}>
              {update.state === 'available'
                ? (update.release?.notes || `当前 ${session.appVersion}，可升级到 ${update.release?.versionName}。`)
                : '连不上电脑时也会通过上次的服务端地址检查；稍后可重试。'}
            </div>
            <div className="tl-separator" style={{ marginLeft: 16 }} />
            <TapRow
              leading={<Download size={17} color={COLORS.green} />}
              trailing={<ChevronRight size={16} color={COLORS.labelSecondary} />}
              onClick={() => { haptic('selection'); openSheet('update'); }}
            >
              <span style={{ fontSize: 15 }}>查看并安装</span>
            </TapRow>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px 8px' }}>
        <span className="tl-section-title" style={{ flex: 1, padding: 0 }}>运行中的任务</span>
        <button type="button" className="tl-press" onClick={() => { haptic('selection'); openSheet('newTask'); }} aria-label="新建任务" style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, padding: '0 10px', border: 0, background: 'transparent', color: COLORS.blue, fontSize: 13, fontWeight: 600 }}>
          <Plus size={16} /> 新建
        </button>
      </div>
      <TaskStream
        threads={runningThreads}
        statusByThread={data.statusByThread}
        limit={5}
        emptyTitle="当前没有运行中的任务"
        emptyDescription="任务开始运行后会出现在这里；历史会话在「会话」页。"
      />
      <p className="tl-page-note">仅显示正在运行的任务；全部会话见「会话」页。</p>

      <SectionTitle>快捷操作</SectionTitle>
      <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', margin: '0 16px', overflow: 'hidden' }}>
        <TapRow leading={<Zap size={17} color={COLORS.blue} />} trailing={<ChevronRight size={16} color={COLORS.labelSecondary} />} onClick={() => { haptic('selection'); openSheet('harness'); }}>
          <span style={{ fontSize: 15 }}>切换电脑上的服务</span>
        </TapRow>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <TapRow leading={<Plus size={17} color={COLORS.green} />} trailing={<ChevronRight size={16} color={COLORS.labelSecondary} />} onClick={() => { haptic('selection'); openSheet('newTask'); }}>
          <span style={{ fontSize: 15 }}>新建任务</span>
        </TapRow>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <TapRow
          leading={<RefreshCw size={17} color={checking ? COLORS.labelSecondary : COLORS.blue} />}
          trailing={<ChevronRight size={16} color={COLORS.labelSecondary} />}
          onClick={() => { haptic('selection'); void check(true); }}
        >
          <span style={{ fontSize: 15 }}>{checking ? '正在检查更新…' : '检查应用更新'}</span>
        </TapRow>
      </div>
      {data.offline && data.threads.length > 0 && (
        <div style={{ margin: '14px 20px 0', fontSize: 12, color: COLORS.labelSecondary }}>
          当前显示上次同步的会话，请检查电脑端连接。
        </div>
      )}
    </div>
  );
}
