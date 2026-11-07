import { useEffect, useState } from 'react';
import { Navbar } from 'konsta/react';
import { Wifi, WifiOff, LockKeyhole } from 'lucide-react';
import { api, ApiError, type HealthResponse } from './lib/turnloomApi';
import { PRESS, cx } from './lib/ui';

type Phase1State = 'loading' | 'online' | 'offline' | 'auth' | 'readonly';

/**
 * Phase 1 shell: the Option A daylight-glass outer frame plus a live
 * health/auth/read-only probe against the REAL /api/health endpoint.
 * Phase 2 replaces the placeholder body with the four UI primitives.
 */
export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [phase, setPhase] = useState<Phase1State>('loading');
  const [error, setError] = useState('');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const result = await api.getHealth();
        if (cancelled) return;
        setHealth(result);
        setPhase(result.allowWrite === false ? 'readonly' : 'online');
        setError('');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.isAuth) {
          setPhase('auth');
          setError('需要访问码才能连接这台电脑。');
        } else {
          setPhase('offline');
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      vaul-drawer-wrapper=""
      className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#F2F2F7] text-[#1C1C1E] shadow-2xl select-none"
    >
      {/* iOS large title → compact glass bar on scroll */}
      <div
        className={cx(
          'z-20 shrink-0 border-b transition-all duration-300',
          scrolled
            ? 'border-[#E5E5EA] bg-white/80 backdrop-blur-xl'
            : 'border-transparent bg-[#F2F2F7]',
        )}
      >
        <Navbar
          large
          transparent
          title="Project Overview"
          subtitle="Codex-Turnloom"
          className="!bg-transparent"
        />
        {!scrolled && (
          <div className="px-4 pb-4">
            <h1 className="text-3xl font-bold tracking-tight text-[#1C1C1E]">Project Overview</h1>
            <p className="mt-1 text-[13px] text-[#8E8E93]">Option A · Cupertino Daylight Glass</p>
          </div>
        )}
      </div>

      <main
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 24)}
      >
        <section className="rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#34C759]/12 px-3 py-1 text-xs font-medium text-[#248A3D]">
              <span className="h-2 w-2 rounded-full bg-[#34C759]" />
              DESKTOP-PC {phase === 'online' || phase === 'readonly' ? 'CONNECTED' : 'OFFLINE'}
            </span>
            {phase === 'online' ? (
              <Wifi size={18} className="text-[#34C759]" />
            ) : phase === 'auth' ? (
              <LockKeyhole size={18} className="text-[#FF9F0A]" />
            ) : (
              <WifiOff size={18} className="text-[#8E8E93]" />
            )}
          </div>

          <div className="mt-4 space-y-2 text-[13px] text-[#8E8E93]">
            <div className="flex justify-between gap-3">
              <span>Backend</span>
              <span className="font-medium text-[#1C1C1E]">
                {health?.backend?.kind ? String(health.backend.kind) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Write access</span>
              <span
                className={cx(
                  'font-medium',
                  health?.allowWrite === false ? 'text-[#D70015]' : 'text-[#248A3D]',
                )}
              >
                {health ? (health.allowWrite ? 'Enabled' : 'Read-only') : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Auth required</span>
              <span className="font-medium text-[#1C1C1E]">
                {health ? (health.authRequired ? 'Yes' : 'No') : '—'}
              </span>
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-xl bg-[#EFEFF4] px-3 py-2 text-[12px] leading-relaxed text-[#8E8E93]">
              {error}
            </p>
          )}
        </section>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className={cx(
            'mt-4 w-full rounded-2xl bg-[#007AFF] px-4 py-3 text-[15px] font-semibold text-white',
            PRESS,
          )}
        >
          Retry connection
        </button>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-[#8E8E93]">
          Phase 1 · engineering + daylight shell + real API layer.
          <br />
          Phase 2 adds the four Cupertino interaction primitives.
        </p>
      </main>
    </div>
  );
}
