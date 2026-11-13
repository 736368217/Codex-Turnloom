/** Home: verified machine status + real active tasks. */
import { Plus, ChevronRight, Zap } from 'lucide-react';
import MachineHubHeader from '../components/MachineHubHeader';
import StatusCard from '../components/StatusCard';
import TaskStream from '../components/TaskStream';
import { SectionTitle, TapRow } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState } from '../state/dataStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';

export default function HomeScreen() {
  const data = useDataState();
  return (
    <div className="tl-screen tl-no-scrollbar">
      <MachineHubHeader />
      <SectionTitle>机器状态</SectionTitle>
      <StatusCard />

      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px 8px' }}>
        <span className="tl-section-title" style={{ flex: 1, padding: 0 }}>活跃任务</span>
        <button type="button" className="tl-press" onClick={() => { haptic('selection'); openSheet('newTask'); }} aria-label="新建任务" style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, padding: '0 10px', border: 0, background: 'transparent', color: COLORS.blue, fontSize: 13, fontWeight: 600 }}>
          <Plus size={16} /> 新建
        </button>
      </div>
      <TaskStream threads={data.threads} limit={5} />

      <SectionTitle>快捷操作</SectionTitle>
      <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', margin: '0 16px', overflow: 'hidden' }}>
        <TapRow leading={<Zap size={17} color={COLORS.blue} />} trailing={<ChevronRight size={16} color={COLORS.labelSecondary} />} onClick={() => { haptic('selection'); openSheet('harness'); }}>
          <span style={{ fontSize: 15 }}>切换电脑上的服务</span>
        </TapRow>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <TapRow leading={<Plus size={17} color={COLORS.green} />} trailing={<ChevronRight size={16} color={COLORS.labelSecondary} />} onClick={() => { haptic('selection'); openSheet('newTask'); }}>
          <span style={{ fontSize: 15 }}>新建任务</span>
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
