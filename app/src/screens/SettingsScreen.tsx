/**
 * 设置（2.4.0）：九行，每一行都能说出「用户什么时候会点它」。
 *
 * 结构来自 docs/team/UX_AUDIT_2.4.0.md §5：
 * 当前电脑 / 连接与诊断 / 体验 / 关于 + 危险操作。
 * 删掉的是重复入口（测试连接、切换服务、独立检查更新/运行信息/上传诊断），
 * 留下的每一行都有唯一动作；版本行本身就是检查更新入口。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Toggle } from 'konsta/react';
import {
  Database, Laptop, Type, List, Vibrate, FileText, BookOpen, MessageCircle,
  ChevronRight, Download, Activity, LogOut,
} from 'lucide-react';
import { ActionButton, StatusPill } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useSessionState, setOfflineCacheEnabled } from '../state/sessionStore';
import { useDataState } from '../state/dataStore';
import { openSheet, openLinkSheet, closeSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';
import { setActiveTab, setThreadsView } from '../state/tabStore';
import {
  usePrefs, setTextSize, setDefaultView, setHaptics,
  TEXT_SIZE_LABEL, DEFAULT_VIEW_LABEL, type TextSize, type DefaultView,
} from '../state/prefsStore';
import {
  useUpdate, updateStore, checkForUpdates, startUpdate, cancelDownload, continueInstall, dismissUpdatePrompt,
} from '../state/updateStore';

const PUBLIC_HOST_FALLBACK = 'dl.736.de5.net';
const GITHUB_URL = 'https://github.com/736368217/Codex-Turnloom';
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
const RELEASES_URL = `${GITHUB_URL}/releases`;
const ISSUES_URL = `${GITHUB_URL}/issues`;

export function UpdatePanel() {
  const session = useSessionState();
  const { state, message, release, progress, source, host, lastCheckedAt, needsInstallConfirm } = useUpdate();
  const mounted = useRef(false);

  // Opening the sheet without a prior answer (connect screen, or the very first
  // settings tap) must not show an empty panel. Guarded to `idle`: this is not
  // the boot check any more — AppRoot owns that one.
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (updateStore.getState().state === 'idle') void checkForUpdates({ manual: false });
  }, []);

  const percent = progress.total > 0 ? Math.min(100, Math.round(progress.received / progress.total * 100)) : 0;
  const versionName = release?.versionName || '';
  const checkedAt = lastCheckedAt ? new Date(lastCheckedAt).toTimeString().slice(0, 5) : '';

  const headline = state === 'available' ? `发现新版本 ${versionName}`
    : state === 'downloading' ? `正在下载 ${versionName}`
      : state === 'ready' ? `新版本 ${versionName}`
        : state === 'current' ? `已是最新版本 ${session.appVersion}`
          : state === 'checking' ? '正在检查新版本…'
            : state === 'error' ? '更新检查失败'
              : state === 'cancelled' ? '下载已取消'
                : state === 'unavailable' ? '暂无可用安装包'
                  : `当前版本 ${session.appVersion}`;

  // The source line is the acceptance surface for the fallback chain: it prints who
  // actually answered, so "已是最新" can never be read as a public-channel answer.
  // The port is dropped — it says nothing at a glance and pushes the line past 320px.
  const shortHost = (value?: string | null) => (value ? value.replace(/:\d+$/, '') : '电脑');
  const sourceLine = source === 'public'
    ? `来源 · 公网 ${host ? shortHost(host) : PUBLIC_HOST_FALLBACK}`
    : source === 'server' ? `来源 · 电脑端 ${shortHost(host)}` : '';

  const closeLater = () => { haptic('selection'); dismissUpdatePrompt(); closeSheet(); };
  const actions = () => {
    if (state === 'available') return <>
      <ActionButton data-qa="update-primary" onClick={() => { haptic('success'); startUpdate(); }}>立即更新</ActionButton>
      <ActionButton variant="neutral" data-qa="update-later" onClick={closeLater}>稍后</ActionButton>
    </>;
    if (state === 'downloading') return (
      <ActionButton variant="neutral" data-qa="update-cancel" onClick={() => { haptic('warning'); cancelDownload(); }}>取消下载</ActionButton>
    );
    if (state === 'ready' && needsInstallConfirm) return <>
      <ActionButton data-qa="update-primary" onClick={() => { haptic('success'); continueInstall(); }}>继续安装</ActionButton>
      <ActionButton variant="neutral" onClick={closeLater}>稍后</ActionButton>
    </>;
    if (state === 'ready') return <ActionButton variant="neutral" onClick={closeSheet}>关闭</ActionButton>;
    if (state === 'cancelled') return <>
      <ActionButton data-qa="update-primary" onClick={() => { haptic('success'); startUpdate(); }}>重新下载</ActionButton>
      <ActionButton variant="neutral" onClick={closeLater}>稍后</ActionButton>
    </>;
    if (state === 'error') return <>
      <ActionButton data-qa="update-primary" onClick={() => { haptic('selection'); if (release) startUpdate(); else void checkForUpdates({ manual: true }); }}>{release ? '重新下载' : '重新检查'}</ActionButton>
      <ActionButton variant="neutral" onClick={closeLater}>稍后</ActionButton>
    </>;
    if (state === 'checking') return null;
    return <ActionButton variant="neutral" onClick={closeSheet}>关闭</ActionButton>;
  };

  return (
    <div data-qa="update-sheet" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div data-qa="update-state" style={{ fontSize: 17, fontWeight: 600, lineHeight: '23px', color: COLORS.labelPrimary }}>
          {headline}
        </div>
        {state === 'available'
          ? (release?.notes ? <div style={{ fontSize: 13, lineHeight: '19px', color: COLORS.labelSecondary }}>{release.notes}</div> : null)
          : message ? <div style={{ fontSize: 13, lineHeight: '19px', color: state === 'error' ? COLORS.red : COLORS.labelSecondary }}>{message}</div> : null}
        <div style={{ fontSize: 12, lineHeight: '17px', color: COLORS.labelSecondary }}>
          当前版本 {session.appVersion} ({session.appVersionCode})
        </div>
      </div>

      {state === 'downloading' && (
        <div data-qa="update-progress">
          <div style={{ height: 7, borderRadius: 999, background: COLORS.fillSecondary, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percent || 8}%`, background: COLORS.blue, transition: 'width .2s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: COLORS.labelSecondary, marginTop: 6 }}>{progress.total > 0 ? `${percent}% · ${Math.round(progress.received / 1024)} / ${Math.round(progress.total / 1024)} KB` : '正在连接下载源…'}</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>{actions()}</div>

      <div data-qa="update-source" style={{ fontSize: 11, lineHeight: '16px', color: COLORS.labelSecondary, overflowWrap: 'anywhere' }}>
        {sourceLine}{sourceLine && checkedAt ? ` · ${checkedAt} 检查` : ''}
      </div>
    </div>
  );
}

/** 设置行左侧图标 + 标题 + 可选副标题，右侧统一放值/箭头。 */
function SettingRow({
  icon, title, subtitle, value, onClick, danger = false, leading,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  leading?: ReactNode;
}) {
  const body = (
    <>
      <span className="tl-settings-icon">{icon}</span>
      {leading}
      <span className="tl-settings-main">
        <span className="tl-settings-title">{title}</span>
        {subtitle && <span className="tl-settings-sub">{subtitle}</span>}
      </span>
      <span className="tl-settings-value">{value}{onClick ? <ChevronRight size={14} /> : null}</span>
    </>
  );
  if (!onClick) return <div className="tl-settings-row">{body}</div>;
  return (
    <button type="button" className={`tl-press tl-settings-row${danger ? ' tl-settings-row--danger' : ''}`} onClick={onClick}>
      {body}
    </button>
  );
}

/** 行内三/二选一：每个选项自己是一个 44px 命中区，绝不缩放。 */
function ChoiceRow<T extends string>({
  icon, label, value, options, onChange,
}: {
  icon: ReactNode;
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
}) {
  return (
    <div className="tl-settings-row tl-choice-row">
      <span className="tl-settings-icon">{icon}</span>
      <span className="tl-choice-label">{label}</span>
      <span className="tl-choice" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className="tl-choice-option tl-press"
            aria-pressed={value === option.key}
            onClick={() => { haptic('selection'); onChange(option.key); }}
          >
            {option.label}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * The single version row. Three answers accepted by the 2.4.2 card:
 * `已是最新 · HH:mm` / `有更新 X` / `检查失败`.
 * A `current` without an answered manifest is NOT 已是最新 — that was the 2.4.0 bug.
 */
function updateValue(state: string, versionName: string | undefined, lastCheckedAt: number, source: string | null): string {
  if (state === 'checking') return '检查中';
  if (state === 'available' || state === 'downloading' || state === 'ready' || state === 'cancelled') {
    return versionName ? `有更新 ${versionName}` : '有更新';
  }
  if (state === 'current') {
    if (!source) return '检查失败';
    const time = lastCheckedAt ? new Date(lastCheckedAt).toTimeString().slice(0, 5) : '';
    return time ? `已是最新 · ${time}` : '已是最新';
  }
  if (state === 'error') return '检查失败';
  if (state === 'unavailable') return '暂无安装包';
  return '尚未检查';
}

export default function SettingsScreen() {
  const session = useSessionState();
  const data = useDataState();
  const prefs = usePrefs();
  const update = useUpdate();
  const online = session.status === 'ready' && session.online && !data.offline;

  return (
    <div className="tl-thread-screen">
      <div className="tl-safe-top" style={{ flex: '0 0 auto' }}>
        <div className="tl-thread-nav"><h1>设置</h1></div>
      </div>

      <div className="tl-settings-scroll">
        <section className="tl-settings-group" data-group="current">
          <div className="tl-settings-label">当前电脑</div>
          <div className="tl-settings-card">
            <button
              type="button"
              className="tl-press tl-settings-row tl-settings-device"
              onClick={() => { haptic('selection'); setActiveTab('devices'); }}
            >
              <span className="tl-settings-icon"><Laptop size={16} /></span>
              <span className="tl-settings-main">
                <span className="tl-settings-title">{session.machineName}</span>
                <span className="tl-settings-sub tl-settings-address">
                  {session.serverUrl || '尚未连接'}
                </span>
              </span>
              <span className="tl-settings-value">
                <StatusPill tone={online ? 'green' : 'red'} active>{online ? '已连接' : '离线'}</StatusPill>
                <ChevronRight size={14} />
              </span>
            </button>
          </div>
        </section>

        <section className="tl-settings-group" data-group="diagnostics">
          <div className="tl-settings-label">连接与诊断</div>
          <div className="tl-settings-card">
            <SettingRow
              icon={<Activity size={16} />}
              title="诊断"
              subtitle="运行信息 · 上传日志 · 清缓存"
              onClick={() => { haptic('selection'); openSheet('diagnostics'); }}
              value={<span className="tl-settings-hint">查看</span>}
            />
            <div className="tl-settings-row">
              <span className="tl-settings-icon"><Database size={16} /></span>
              <span style={{ flex: 1 }}>保留离线会话</span>
              <Toggle
                checked={session.offlineCacheEnabled}
                onChange={() => { haptic('selection'); setOfflineCacheEnabled(!session.offlineCacheEnabled); }}
              />
            </div>
          </div>
        </section>

        <section className="tl-settings-group" data-group="experience">
          <div className="tl-settings-label">体验</div>
          <div className="tl-settings-card">
            <ChoiceRow<TextSize>
              icon={<Type size={16} />}
              label="字号"
              value={prefs.textSize}
              options={[{ key: 's', label: TEXT_SIZE_LABEL.s }, { key: 'm', label: TEXT_SIZE_LABEL.m }, { key: 'l', label: TEXT_SIZE_LABEL.l }]}
              onChange={setTextSize}
            />
            <ChoiceRow<DefaultView>
              icon={<List size={16} />}
              label="默认视图"
              value={prefs.defaultView}
              options={[{ key: 'time', label: DEFAULT_VIEW_LABEL.time }, { key: 'project', label: DEFAULT_VIEW_LABEL.project }]}
              onChange={(view) => { setDefaultView(view); setThreadsView(view); }}
            />
            <div className="tl-settings-row">
              <span className="tl-settings-icon"><Vibrate size={16} /></span>
              <span style={{ flex: 1 }}>触感反馈</span>
              <Toggle checked={prefs.haptics} onChange={() => setHaptics(!prefs.haptics)} />
            </div>
          </div>
        </section>

        <section className="tl-settings-group" data-group="about">
          <div className="tl-settings-label">关于</div>
          <div className="tl-settings-card">
            <SettingRow
              icon={<Download size={16} />}
              title={`版本 ${session.appVersion} (${session.appVersionCode})`}
              onClick={() => {
                haptic('selection');
                openSheet('update');
                const phase = updateStore.getState().state;
                if (phase === 'idle' || phase === 'error' || phase === 'current' || phase === 'unavailable') {
                  void checkForUpdates({ manual: true });
                }
              }}
              value={<span className="tl-settings-hint">{updateValue(update.state, update.release?.versionName, update.lastCheckedAt, update.source)}</span>}
            />
            <SettingRow
              icon={<FileText size={16} />}
              title="更新日志"
              onClick={() => { haptic('selection'); openLinkSheet(RELEASES_URL); }}
              value={<span className="tl-settings-hint">GitHub</span>}
            />
            <SettingRow
              icon={<BookOpen size={16} />}
              title="开源许可"
              onClick={() => { haptic('selection'); openLinkSheet(LICENSE_URL); }}
            />
            <SettingRow
              icon={<MessageCircle size={16} />}
              title="GitHub · 反馈"
              onClick={() => { haptic('selection'); openLinkSheet(ISSUES_URL); }}
            />
          </div>
        </section>

        <section className="tl-settings-group" data-group="danger">
          <div className="tl-settings-label">危险操作</div>
          <div className="tl-settings-card">
            <button type="button" className="tl-press tl-settings-row tl-settings-row--danger" onClick={() => { haptic('warning'); openSheet('disconnect'); }}>
              <span className="tl-settings-icon"><LogOut size={16} /></span>
              <span>忘记这台电脑</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
