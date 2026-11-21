/**
 * Global singleton bottom drawer. No fake approval or permanent interrupt action.
 *
 * 2.4.0: the old `harness` sheet is gone — the device page owns that path.
 * `diagnostics` is now the only diagnostic entry: runtime facts, log upload,
 * cache clear and re-sync in one sheet (never a nested sheet).
 */
import { useState } from 'react';
import { RefreshCw, CircleCheck, FileUp, Trash2 } from 'lucide-react';
import VaulSheet from './VaulSheet';
import { ActionButton } from './ui';
import { COLORS } from '../theme/optionATokens';
import { useSheetState, closeSheet, setSheetNotice, type SheetKey } from '../state/sheetStore';
import { useSessionState, currentRequestContext, unpair } from '../state/sessionStore';
import { useDataState, clearOfflineCache, refreshAll } from '../state/dataStore';
import { usePrefs, TEXT_SIZE_LABEL, DEFAULT_VIEW_LABEL } from '../state/prefsStore';
import { haptic, openExternalUrl } from '../lib/nativeBridge';
import { copyText } from '../lib/clipboard';
import { uploadDiagnostics } from '../lib/diagnostics';
import { UpdatePanel } from '../screens/SettingsScreen';

const TITLES: Record<Exclude<SheetKey, null>, string> = {
  diagnostics: '诊断', disconnect: '忘记这台电脑',
  link: '打开链接', update: '应用更新',
};
const SUBTITLES: Record<Exclude<SheetKey, null>, string> = {
  diagnostics: '当前连接、版本与本地缓存',
  disconnect: '移除配对及这台电脑的本机会话缓存。电脑上的会话不会被删除。',
  link: '即将离开 App，请核对完整地址', update: '检查并安装新版本',
};

/** Global singleton bottom drawer. No fake approval or permanent interrupt action. */
export default function CupertinoSheetHost() {
  const { sheet, linkUrl, notice } = useSheetState();
  const session = useSessionState();
  const data = useDataState();
  const prefs = usePrefs();
  const context = currentRequestContext();
  const [busy, setBusy] = useState('');
  const [diagNotice, setDiagNotice] = useState('');
  const open = sheet !== null;

  const upload = async (): Promise<void> => {
    if (busy || !context) return;
    setBusy('upload');
    setDiagNotice('');
    haptic('selection');
    const stored = await uploadDiagnostics(context);
    setBusy('');
    setDiagNotice(stored > 0 ? `已上传 ${stored} 条日志` : '暂无可上传记录');
    haptic(stored > 0 ? 'success' : 'warning');
  };

  const copyAddress = async (): Promise<void> => {
    const ok = await copyText(session.serverUrl);
    setDiagNotice(ok ? '已复制服务地址' : '复制失败，请重试');
    haptic(ok ? 'success' : 'error');
  };

  const content = () => {
    switch (sheet) {
      case 'link': return <div>
        <p className="tl-link-address">{linkUrl}</p>
        {notice && <p role="alert" className="tl-page-note tl-page-note--error">{notice}</p>}
        <ActionButton onClick={() => { if (openExternalUrl(linkUrl)) closeSheet(); else setSheetNotice('无法打开浏览器，请长按上方地址复制。'); }}>在浏览器打开</ActionButton>
        <ActionButton variant="neutral" onClick={closeSheet}>返回会话</ActionButton>
      </div>;
      case 'disconnect': return <div style={{ display: 'grid', gap: 10 }}><ActionButton variant="red" onClick={() => { clearOfflineCache(context); unpair(); closeSheet(); }}>确认忘记这台电脑</ActionButton><ActionButton variant="neutral" onClick={closeSheet}>保留连接</ActionButton></div>;
      case 'update': return <UpdatePanel />;
      case 'diagnostics': {
        const rows: [string, string][] = [
          ['应用版本', `${session.appVersion} (${session.appVersionCode})`],
          ['电脑', session.machineName],
          ['当前服务', session.harnessName],
          ['服务地址', session.serverUrl],
          ['连接状态', session.online ? '在线' : '离线'],
          ['会话数量', String(data.threads.length)],
          ['最近同步', data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('zh-CN') : '尚未同步'],
          ['字号', TEXT_SIZE_LABEL[prefs.textSize]],
          ['默认视图', DEFAULT_VIEW_LABEL[prefs.defaultView]],
          ['触感反馈', prefs.haptics ? '开' : '关'],
          ['外观', '浅色'],
        ];
        return (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', overflow: 'hidden' }}>
              {rows.map(([label, value], index) => (
                <div key={label}>
                  {index > 0 && <div className="tl-separator" style={{ marginLeft: 16 }} />}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 16px', minHeight: 44 }}>
                    <span style={{ width: 76, flex: '0 0 auto', fontSize: 12, color: COLORS.labelSecondary }}>{label}</span>
                    <span className="tl-selectable" style={{ flex: 1, fontSize: 12, color: COLORS.labelPrimary, wordBreak: 'break-all' }}>{value}</span>
                    {label === '服务地址' && session.serverUrl && (
                      <button type="button" className="tl-diag-copy tl-press" onClick={() => { void copyAddress(); }}>复制</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <ActionButton variant="neutral" icon={<RefreshCw size={16} />} onClick={() => { if (context) { haptic('selection'); void refreshAll(context); setDiagNotice('已重新同步会话'); } }}>重新同步</ActionButton>
              <ActionButton variant="neutral" icon={<FileUp size={16} />} disabled={busy === 'upload'} onClick={() => { void upload(); }}>{busy === 'upload' ? '上传中…' : '上传日志'}</ActionButton>
            </div>
            <ActionButton
              variant="neutral"
              icon={<Trash2 size={16} color={COLORS.actionRed} />}
              onClick={() => { haptic('warning'); clearOfflineCache(context); setDiagNotice('本机会话缓存已清除'); }}
            >
              清除本机会话缓存
            </ActionButton>
            {diagNotice && <p role="status" style={{ margin: 0, fontSize: 12, lineHeight: 18, color: COLORS.labelSecondary }}>{diagNotice}</p>}
            <p style={{ margin: 0, fontSize: 11, lineHeight: 16, color: COLORS.labelSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CircleCheck size={14} color={COLORS.green} />
              日志只包含最近 200 条本机记录，不含会话正文。
            </p>
          </div>
        );
      }
      default: return null;
    }
  };

  return (
    <VaulSheet open={open} onOpenChange={(next) => { if (!next) { closeSheet(); setDiagNotice(''); } }} title={sheet ? TITLES[sheet] : undefined} subtitle={sheet ? SUBTITLES[sheet] : undefined}>
      {content()}
    </VaulSheet>
  );
}
