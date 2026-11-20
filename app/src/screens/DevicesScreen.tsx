/**
 * 设备页（2.2.6）：电脑 → 平台 → harness，一次只露一层。
 *
 * 三条定稿的交互（报告第 3 节）：
 * - 当前电脑恒展开：点当前卡什么都不发生，没有 collapsed / manualOpen 状态，
 *   `openMachine` 直接等于 `activeId`。
 * - 切换是非乐观的：点别的卡 = `switchMachine(id)`，成功才换当前卡并展开，
 *   失败保持原状、顶部给一条报错。报错读 `sessionStore.getState().error`，
 *   不能读渲染闭包里的 `session`（await 之后还是切换前的值）。
 * - `data-machine` 只挂在 `.tl-platblock`：非当前电脑不渲染平台，全页才只有一个值。
 *
 * 数据事实（Atlas 的契约）：只有当前电脑的 harness 列表可读；非活动电脑不探活，
 * 只写「上次使用」。平台不是实体，是 `harness.kind` + 显示名映射（lib/platforms）。
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, RefreshCw, WifiOff } from 'lucide-react';
import type { Harness } from '../lib/machinePairing';
import { platformsOf, serviceLabel } from '../lib/platforms';
import {
  useSessionState, switchMachine, switchHarness, retryPersistedSession,
  forgetMachine, sessionStore, type MachineSummary,
} from '../state/sessionStore';
import { useDataState } from '../state/dataStore';
import { openAddMachine } from '../state/tabStore';
import { haptic } from '../lib/nativeBridge';
import { COLORS } from '../theme/optionATokens';
import VaulSheet from '../components/VaulSheet';
import { ActionButton } from '../components/ui';

function syncLabel(lastSyncAt: number | null, now = Date.now()): string {
  if (!lastSyncAt) return '尚未同步';
  const minutes = Math.floor(Math.max(0, now - lastSyncAt) / 60000);
  if (minutes < 1) return '刚同步';
  if (minutes < 60) return `${minutes} 分钟前同步`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前同步`;
  return `${Math.floor(hours / 24)} 天前同步`;
}

function lastUsedLabel(at: number | null, now = Date.now()): string {
  if (!at) return '尚未使用过';
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return '刚刚用过';
  if (minutes < 60) return `上次使用 ${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `上次使用 ${hours} 小时前`;
  return `上次使用 ${Math.floor(hours / 24)} 天前`;
}

/** 拟物只用在电脑这一层：一台小笔记本，说明「这是一台机器」。 */
function LaptopMark() {
  return (
    <span className="tl-devmark" aria-hidden="true">
      <span className="tl-devmark-screen" />
      <span className="tl-devmark-base" />
    </span>
  );
}

export default function DevicesScreen() {
  const session = useSessionState();
  const data = useDataState();
  const [openPlatform, setOpenPlatform] = useState<string>('');
  const [revealedMachine, setRevealedMachine] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [menuMachine, setMenuMachine] = useState<MachineSummary | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);

  const machines = session.machines;
  const activeId = machines.find((machine) => machine.active)?.id || '';
  // 定稿：当前电脑恒展开，没有收起动作。点当前卡是空操作。
  const openMachine = activeId;
  const platforms = useMemo(
    () => platformsOf(session.harnesses, session.machineName),
    [session.harnesses, session.machineName],
  );
  const expandedPlatform = platforms.some((platform) => platform.key === openPlatform) ? openPlatform : '';

  // 分支在挂载后的下一帧展开：先以 0fr 画出来，再过渡到 1fr，脊柱和平台卡才有
  // 「线先画、卡后到」的错位。直接以 data-open=true 挂载不会有动画。
  useEffect(() => {
    if (!activeId) { setRevealedMachine(''); return; }
    setRevealedMachine('');
    const frame = requestAnimationFrame(() => setRevealedMachine(activeId));
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  // 默认展开第一个平台：原型里 Codex 就是「on」的。晚一帧打开，harness 行才有淡入。
  useEffect(() => {
    if (!platforms.length) { setOpenPlatform(''); return; }
    setOpenPlatform((current) => (platforms.some((platform) => platform.key === current) ? current : platforms[0].key));
  }, [platforms]);

  const chooseMachine = async (machine: MachineSummary) => {
    // 当前电脑：定稿要求「点了不动」，连展开/收起都不做。
    if (machine.active || busy) return;
    haptic('selection');
    setBusy(machine.id);
    setError('');
    const ok = await switchMachine(machine.id);
    setBusy('');
    if (ok) { haptic('success'); setOpenPlatform(''); return; }
    haptic('error');
    // await 之后闭包里的 session 还是切换前的 error，必须读 store 的当前值。
    setError(`切换电脑未完成：${sessionStore.getState().error || '请重试'}`);
  };

  const chooseHarness = async (harness: Harness) => {
    haptic('selection');
    if (harness.id === session.harnessId && session.status === 'ready') return;
    setError('');
    const ok = await switchHarness(harness.id);
    if (ok) return;
    haptic('error');
    setError(`切换入口未完成：${sessionStore.getState().error || '请重试'}`);
  };

  const openMachineMenu = (machine: MachineSummary) => {
    haptic('selection');
    setConfirmForget(false);
    setMenuMachine(machine);
  };

  const confirmForgetMachine = () => {
    if (!menuMachine) return;
    haptic('warning');
    forgetMachine(menuMachine.id);
    setMenuMachine(null);
    setConfirmForget(false);
  };

  return (
    <div className="tl-screen tl-device-screen">
      <div className="tl-safe-top">
        <div className="tl-thread-nav">
          <h1>设备</h1>
          <button
            type="button"
            className="tl-press tl-nav-action"
            aria-label="重新校验连接"
            disabled={session.status === 'reconnecting'}
            onClick={() => { haptic('selection'); setError(''); retryPersistedSession(); }}
          >
            <RefreshCw size={20} className={session.status === 'reconnecting' ? 'tl-spin' : undefined} />
          </button>
        </div>
        <p className="tl-device-lede">{machines.length} 台已配对</p>
        {/* 顶部错误条放在固定区：两台以上就要滚动，错误若留在滚动流里，
            用户停在列表任意位置时就看不见（NB3 09:17 口径）。 */}
        {error && <p role="alert" className="tl-page-note tl-page-note--error tl-device-error">{error}</p>}
      </div>

      <div className="tl-device-scroll">
        <div className="tl-devstack">
          {machines.map((machine) => {
            const active = machine.active;
            return (
              <div key={machine.id} className="tl-devgrid">
                <div
                  className={`tl-devcard${active ? ' is-active' : ''}`}
                  data-active={active ? 'true' : 'false'}
                  data-expanded={active ? 'true' : 'false'}
                  onClick={(event) => {
                    // The button below is the semantic control; this only makes
                    // the card's breathing space part of the same target.
                    if (event.target === event.currentTarget) void chooseMachine(machine);
                  }}
                >
                  <button
                    type="button"
                    className="tl-devcard-select tl-press"
                    aria-expanded={active ? true : undefined}
                    aria-label={active ? `${machine.name}，当前电脑` : `切换到 ${machine.name}`}
                    disabled={Boolean(busy) && busy !== machine.id}
                    onClick={() => { void chooseMachine(machine); }}
                  >
                    <LaptopMark />
                    <span className="tl-devcard-main">
                      <span className="tl-devcard-name">
                        {machine.name}
                        {active && <span className="tl-devcard-badge">当前</span>}
                      </span>
                      <span className="tl-devcard-sub">
                        {active
                          ? `${machine.host} · ${session.online ? '在线' : '离线'} · ${syncLabel(data.lastSyncAt)}`
                          : `${machine.harnessCount} 个平台 · ${lastUsedLabel(machine.lastUsedAt)}`}
                      </span>
                    </span>
                    {busy === machine.id
                      ? <RefreshCw size={16} className="tl-spin" color={COLORS.labelSecondary} />
                      : !active ? <span className="tl-devcard-switch">切换</span> : null}
                  </button>
                  <button
                    type="button"
                    className="tl-devcard-more tl-press"
                    aria-label={`管理 ${machine.name}`}
                    disabled={Boolean(busy)}
                    onClick={() => openMachineMenu(machine)}
                  >
                    <MoreHorizontal size={18} color={COLORS.labelSecondary} />
                  </button>
                </div>

                {/* 只给当前电脑渲染平台：非当前电脑不探活，所以也没有平台可画。
                    这也是 `data-machine` 全页只有一个值的前提。 */}
                <div
                  className="tl-branch"
                  data-open={openMachine === machine.id && revealedMachine === machine.id ? 'true' : 'false'}
                  aria-hidden={openMachine !== machine.id}
                >
                  <div className="tl-branch-inner">
                    <div className="tl-branch-pad">
                      {active && (
                        <>
                          <span className="tl-branch-spine" />
                          {platforms.map((platform, index) => {
                            const open = platform.key === expandedPlatform;
                            const current = platform.harnesses.find((harness) => harness.id === session.harnessId);
                            const online = platform.harnesses.some((harness) => harness.online === true);
                            return (
                              <div key={platform.key} className="tl-platblock" data-machine={machine.id}>
                                <button
                                  type="button"
                                  className={`tl-platcard tl-press${open ? ' is-open' : ''}`}
                                  style={{ '--k': index } as CSSProperties}
                                  data-plat={platform.key}
                                  aria-expanded={open}
                                  onClick={() => { haptic('selection'); setOpenPlatform(platform.key); }}
                                >
                                  <span className="tl-platmark" aria-hidden="true">{platform.mark}</span>
                                  <span className="tl-plat-main">
                                    <span className="tl-plat-kind">{platform.label}</span>
                                    <span className="tl-plat-meta">
                                      {platform.harnesses.length} 个入口 · {online ? '发现时在线' : '发现时离线'}
                                      {current ? ` · 当前 ${serviceLabel(current.name, current.kind, session.machineName)}` : ''}
                                    </span>
                                  </span>
                                  <ChevronDown size={15} color={COLORS.labelSecondary} className={`tl-plat-caret${open ? ' is-open' : ''}`} />
                                </button>
                                <div className="tl-harness" data-open={open}>
                                  <div className="tl-harness-inner">
                                    {platform.harnesses.map((harness, row) => {
                                      const selected = harness.id === session.harnessId;
                                      // 真实模板里 PI 的 name 就是「PI-Desktop」，照抄会让行
                                      // 读起来像第二张平台卡；同名时退回 id（pidesk）。
                                      const rowName = harness.name === platform.label ? (harness.id || harness.name) : harness.name;
                                      return (
                                        <button
                                          key={harness.id}
                                          type="button"
                                          className={`tl-hrow tl-press${selected ? ' is-current' : ''}`}
                                          style={{ '--r': row } as CSSProperties}
                                          data-harness={harness.id}
                                          disabled={session.status === 'reconnecting'}
                                          onClick={() => { void chooseHarness(harness); }}
                                        >
                                          <span className="tl-hrow-main">
                                            <span className="tl-hrow-name">{rowName}</span>
                                            <span className="tl-hrow-meta">
                                              {harness.defaultHarness ? '默认入口' : '本机服务'} · {harness.online === false ? '发现时离线' : '发现时在线'}
                                            </span>
                                          </span>
                                          <span className={`tl-hrow-pill${selected ? ' is-current' : ''}`}>
                                            {selected ? '当前' : '切换'}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {platforms.length === 0 && (
                            <p className="tl-branch-note">这台电脑没有发现可用的平台入口，请检查桌面端配置后重新校验。</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <button type="button" className="tl-addmachine tl-press" onClick={() => { haptic('selection'); openAddMachine(); }}>
            <span className="tl-addmachine-mark" aria-hidden="true"><Plus size={18} /></span>
            <span className="tl-addmachine-main">
              <span className="tl-addmachine-title">添加一台电脑</span>
              <span className="tl-addmachine-sub">扫码或输入地址 · 原来的电脑会保留</span>
            </span>
            <ChevronRight size={16} className="tl-addmachine-go" aria-hidden="true" />
          </button>
        </div>

        {!session.online && (
          <div className="tl-device-offline">
            <WifiOff size={15} />
            <span>离线：卡片显示上次同步的结果，切换入口会失败。</span>
          </div>
        )}
      </div>

      <VaulSheet
        open={Boolean(menuMachine)}
        onOpenChange={(open) => { if (!open) { setMenuMachine(null); setConfirmForget(false); } }}
        title={confirmForget ? '忘记这台电脑？' : menuMachine?.name || ''}
        subtitle={confirmForget
          ? '只移除这台手机上的配对与会话缓存；电脑上的会话不会被删除。'
          : menuMachine?.active ? '当前电脑' : menuMachine ? lastUsedLabel(menuMachine.lastUsedAt) : ''}
      >
        {confirmForget ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <ActionButton variant="red" onClick={confirmForgetMachine}>确认忘记</ActionButton>
            <ActionButton variant="neutral" onClick={() => setConfirmForget(false)}>保留</ActionButton>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <ActionButton variant="red" onClick={() => { haptic('warning'); setConfirmForget(true); }}>忘记这台电脑</ActionButton>
            <ActionButton variant="neutral" onClick={() => setMenuMachine(null)}>关闭</ActionButton>
          </div>
        )}
      </VaulSheet>
    </div>
  );
}
