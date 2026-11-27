import { useEffect, useMemo, useState } from 'react';
import { remainingBonusMinutes } from '../lib/app-settings';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { unusedBonusMinutes } from '../lib/report';
import { useStudy } from '../lib/study-context';
import { useTimer } from '../lib/timer-context';
import { ArrowLeftIcon } from './icons';

/**
 * ⏱ 뽑기 시간 나눠 쓰기 · 카운트다운 타이머 (부모 관리 PIN 안에서만)
 *
 * 뽑기로 받은 남은 시간에서 원하는 분을 입력해 [사용 시작] 하면
 * 그만큼 차감되고 바로 타이머가 돌아갑니다. 일시 멈춤/재개, 끝내기까지 여기서 합니다.
 */

interface TimerPanelProps {
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function TimerPanel({ onClose, onNotify }: TimerPanelProps) {
  const study = useStudy();
  const timer = useTimer();
  useOverlayBack(true, onClose);

  const [memberId, setMemberId] = useState<string>(study.children[0]?.id ?? '');
  const [minutes, setMinutes] = useState<string>('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const member = study.children.find((item) => item.id === memberId) ?? study.children[0];

  /** 아이별 남은 뽑기 시간(분) — 뽑았지만 아직 안 쓴 시간에서 나눠 쓴 만큼을 뺍니다. */
  const remainingByMember = useMemo(() => {
    const map: Record<string, number> = {};
    for (const child of study.children) {
      map[child.id] = remainingBonusMinutes(
        study.appSettings,
        child.id,
        unusedBonusMinutes(study.tierEvents, child.id),
      );
    }
    return map;
  }, [study.appSettings, study.tierEvents, study.children]);

  const remaining = member ? remainingByMember[member.id] ?? 0 : 0;
  const wanted = Number(minutes);

  // 남은 시간이 줄면 입력값도 그 안으로 맞춥니다.
  useEffect(() => {
    if (!Number.isFinite(wanted) || wanted > remaining) {
      setMinutes(String(Math.max(0, Math.min(remaining, 10)) || 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, memberId]);

  const start = async () => {
    if (!member) return;
    setError(null);
    if (!Number.isFinite(wanted) || wanted < 1) {
      setError('1분 이상 입력해 주세요.');
      return;
    }
    setBusy(true);
    const result = await timer.start(member, wanted);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? '시작하지 못했어요');
      return;
    }
    onNotify(`${member.name} · ${Math.round(wanted)}분 타이머를 시작했어요`);
  };

  const running = timer.session && timer.session.status !== 'done' ? timer.session : null;

  return (
    <div data-testid="timer-panel" className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f6fa]">
      <div className="sticky top-0 z-10 bg-[#f5f6fa]/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-4 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="timer-close"
              onClick={onClose}
              aria-label="타이머 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">⏱ 시간 타이머</h1>
              <p className="text-[9.5px] font-bold text-slate-400">뽑기로 받은 시간을 나눠 써요 · 부모만</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2.5 px-4 pb-28 pt-1">
        {running ? (
          <section
            data-testid="timer-running"
            className="rounded-[24px] bg-gradient-to-b from-indigo-600 to-violet-600 p-4 text-center text-white shadow-xl shadow-indigo-500/25"
          >
            <p className="text-[11px] font-extrabold text-white/70">
              {running.member_name} · {running.minutes}분
            </p>
            <p
              data-testid="timer-clock"
              className="mt-1 text-[44px] font-extrabold leading-none tabular-nums tracking-tight"
            >
              {timer.clock}
            </p>
            <p data-testid="timer-status" className="mt-1 text-[10.5px] font-bold text-white/70">
              {running.status === 'paused' ? '⏸ 일시 멈춤' : '⏱ 줄고 있어요'}
            </p>
            <div className="mt-3 flex gap-2">
              {running.status === 'running' ? (
                <button
                  type="button"
                  data-testid="timer-pause"
                  onClick={timer.pause}
                  className="flex-1 rounded-2xl bg-white/15 py-2.5 text-[11.5px] font-extrabold text-white backdrop-blur transition active:scale-[0.98]"
                >
                  ⏸ 일시 멈춤
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="timer-resume"
                  onClick={timer.resume}
                  className="flex-1 rounded-2xl bg-white py-2.5 text-[11.5px] font-extrabold text-indigo-700 transition active:scale-[0.98]"
                >
                  ▶ 재개
                </button>
              )}
              <button
                type="button"
                data-testid="timer-stop"
                onClick={() => {
                  timer.stop();
                  onNotify('타이머를 끝냈어요');
                }}
                className="rounded-2xl bg-white/15 px-3 py-2.5 text-[11.5px] font-extrabold text-white backdrop-blur transition active:scale-[0.98]"
              >
                끝내기
              </button>
            </div>
          </section>
        ) : null}

        <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
          <p className="text-[10px] font-extrabold tracking-wide text-slate-400">누구 시간인가요</p>
          <div className="mt-1.5 flex gap-1.5">
            {study.children.map((child) => (
              <button
                key={child.id}
                type="button"
                data-testid={`timer-child-${child.id}`}
                onClick={() => setMemberId(child.id)}
                className={cx(
                  'flex-1 rounded-2xl px-1 py-2 text-[10.5px] font-extrabold ring-1 transition active:scale-95',
                  child.id === member?.id
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-slate-50 text-slate-600 ring-slate-200',
                )}
              >
                <span className="block text-[14px] leading-none">{child.emoji}</span>
                <span className="mt-1 block">{child.name}</span>
                <span
                  className={cx(
                    'mt-0.5 block text-[9px] font-bold',
                    child.id === member?.id ? 'text-white/70' : 'text-slate-400',
                  )}
                >
                  {remainingByMember[child.id] ?? 0}분 남음
                </span>
              </button>
            ))}
          </div>

          <p
            data-testid="timer-remaining"
            className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[11px] font-extrabold text-amber-800 ring-1 ring-amber-200/70"
          >
            🎁 {member?.name ?? '아이'} 뽑기 시간 <b className="text-[13px]">{remaining}분</b> 남았어요
          </p>

          {remaining <= 0 ? (
            <p data-testid="timer-empty" className="mt-2 text-[10px] font-semibold leading-relaxed text-slate-400">
              아직 뽑기로 받은 시간이 없어요. 큰 티어(실버·골드…)로 올라가 상자를 열면 시간이 생겨요.
            </p>
          ) : (
            <>
              <div className="mt-2 flex gap-1.5">
                {[5, 10, 15, 20].map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`timer-quick-${value}`}
                    disabled={value > remaining}
                    onClick={() => setMinutes(String(value))}
                    className={cx(
                      'flex-1 rounded-xl py-1.5 text-[10.5px] font-extrabold ring-1 transition active:scale-95 disabled:opacity-40',
                      Number(minutes) === value
                        ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                        : 'bg-white text-slate-500 ring-slate-200',
                    )}
                  >
                    {value}분
                  </button>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-1.5">
                <input
                  data-testid="timer-minutes"
                  type="number"
                  min={1}
                  max={Math.max(1, remaining)}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  className="w-20 shrink-0 rounded-xl bg-slate-50 px-2 py-2 text-right text-[13px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 focus:ring-indigo-300"
                />
                <span className="shrink-0 text-[11px] font-extrabold text-slate-400">분</span>
                <button
                  type="button"
                  data-testid="timer-start"
                  disabled={busy || Boolean(running)}
                  onClick={() => void start()}
                  className="ml-auto flex-1 rounded-2xl bg-indigo-600 py-2.5 text-[12px] font-extrabold text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.98] disabled:opacity-50"
                >
                  {busy ? '시작하는 중…' : running ? '이미 돌고 있어요' : '사용 시작'}
                </button>
              </div>
            </>
          )}

          {error ? (
            <p data-testid="timer-error" className="mt-1.5 text-[10px] font-bold text-rose-500">
              {error}
            </p>
          ) : null}
        </section>

        <p className="px-1 pt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · [사용 시작] 을 누르면 뽑기 시간에서 그만큼 빠지고 바로 카운트다운이 시작돼요.
          <br />· 시간이 다 되면 화면 알림·진동·효과음으로 알려 줘요(폰 알림을 켜 두면 알림도 와요).
          <br />· 일시 멈춤·재개·끝내기는 부모만 할 수 있고, 새로고침해도 이어집니다.
        </p>
      </div>
    </div>
  );
}
