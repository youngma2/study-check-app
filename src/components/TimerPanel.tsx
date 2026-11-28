import { useEffect, useMemo, useState } from 'react';
import { remainingBonusMinutes, type TimeUsage } from '../lib/app-settings';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { formatNoteTime } from '../lib/notes';
import { unusedBonusMinutes } from '../lib/report';
import { memberNameOf, pointPrizeEventIds } from '../lib/shop';
import { useStudy } from '../lib/study-context';
import { useTimer } from '../lib/timer-context';
import { ArrowLeftIcon } from './icons';

/**
 * ⏱ 뽑기 시간 사용 — 부모 관리 PIN 안에서만
 *
 * ① ⏱ 시간 타이머   — 뽑기로 받은 시간에서 원하는 분을 빼고 바로 카운트다운을 돌립니다.
 * ② ⏳ 시간만 차감  — 타이머 없이 시간만 바로 뺍니다(사유를 함께 남깁니다).
 * ③ 📜 시간 사용 로그 — 언제·누가·몇 분을·어떻게(타이머/직접 차감, 사유) 썼는지 전부 보여 줍니다.
 */

interface TimerPanelProps {
  onClose: () => void;
  onNotify: (message: string) => void;
}

const DIRECT_REASONS = ['직접 차감', '영상 시청', '게임 시간', '외출', '기타'];

export function TimerPanel({ onClose, onNotify }: TimerPanelProps) {
  const study = useStudy();
  const timer = useTimer();
  useOverlayBack(true, onClose);

  const [memberId, setMemberId] = useState<string>(study.children[0]?.id ?? '');
  const [minutes, setMinutes] = useState<string>('10');
  const [directMinutes, setDirectMinutes] = useState<string>('5');
  const [reason, setReason] = useState<string>(DIRECT_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [directBusy, setDirectBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directError, setDirectError] = useState<string | null>(null);

  const member = study.children.find((item) => item.id === memberId) ?? study.children[0];

  /** 아이별 남은 뽑기 시간(분) — 뽑았지만 아직 안 쓴 시간에서 나눠 쓴 만큼을 뺍니다. */
  const remainingByMember = useMemo(() => {
    const map: Record<string, number> = {};
    for (const child of study.children) {
      map[child.id] = remainingBonusMinutes(
        study.appSettings,
        child.id,
        unusedBonusMinutes(study.tierEvents, child.id, pointPrizeEventIds(study.db.tasks)),
      );
    }
    return map;
  }, [study.appSettings, study.tierEvents, study.children, study.db.tasks]);

  /** 시간 사용 로그 — 최근 것이 위로 (이 폰에 저장된 기록) */
  const usageLog = useMemo<TimeUsage[]>(
    () => [...study.appSettings.timeUsage].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30),
    [study.appSettings.timeUsage],
  );

  const remaining = member ? remainingByMember[member.id] ?? 0 : 0;
  const wanted = Number(minutes);
  const wantedDirect = Number(directMinutes);

  // 남은 시간이 줄면 입력값도 그 안으로 맞춥니다.
  useEffect(() => {
    if (!Number.isFinite(wanted) || wanted > remaining) {
      setMinutes(String(Math.max(0, Math.min(remaining, 10)) || 0));
    }
    if (!Number.isFinite(wantedDirect) || wantedDirect > remaining) {
      setDirectMinutes(String(Math.max(0, Math.min(remaining, 5)) || 0));
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

  const deductOnly = async () => {
    if (!member) return;
    setDirectError(null);
    if (!Number.isFinite(wantedDirect) || wantedDirect < 1) {
      setDirectError('1분 이상 입력해 주세요.');
      return;
    }
    setDirectBusy(true);
    const result = await study.consumeBonusTime(member.id, wantedDirect, 'direct', reason);
    setDirectBusy(false);
    if (!result.ok) {
      setDirectError(result.error ?? '차감하지 못했어요');
      return;
    }
    onNotify(`${member.name} · ${Math.round(wantedDirect)}분을 시간에서 차감했어요`);
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
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">⏱ 뽑기 시간 쓰기</h1>
              <p className="text-[9.5px] font-bold text-slate-400">타이머로 쓰거나 바로 차감 · 부모만</p>
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
          ) : null}
        </section>

        {/* ① ⏱ 타이머로 쓰기 */}
        <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-slate-900">⏱ 시간 타이머</p>
            <span className="text-[9px] font-bold text-slate-400">카운트다운으로 쓰기</span>
          </div>
          <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
            [사용 시작] 을 누르면 그만큼 시간이 빠지고 바로 타이머가 돌아요.
          </p>

          {remaining > 0 ? (
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
          ) : null}

          {error ? (
            <p data-testid="timer-error" className="mt-1.5 text-[10px] font-bold text-rose-500">
              {error}
            </p>
          ) : null}
        </section>

        {/* ② ⏳ 시간만 바로 차감 (타이머 없이) */}
        <section
          data-testid="direct-deduct"
          className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-amber-200/70"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-slate-900">⏳ 시간만 차감</p>
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-700 ring-1 ring-amber-200/70">
              타이머 없이 바로
            </span>
          </div>
          <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
            타이머를 돌리지 않고 시간만 바로 뺍니다. 누가·몇 분·무슨 사유로 뺐는지 아래 로그에 남아요.
          </p>

          <div className="mt-2 flex gap-1.5">
            <input
              data-testid="direct-minutes"
              type="number"
              min={1}
              max={Math.max(1, remaining)}
              value={directMinutes}
              onChange={(event) => setDirectMinutes(event.target.value)}
              className="w-20 shrink-0 rounded-xl bg-slate-50 px-2 py-2 text-right text-[13px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 focus:ring-amber-300"
            />
            <span className="shrink-0 text-[11px] font-extrabold text-slate-400">분</span>
            <select
              data-testid="direct-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2 py-2 text-[10.5px] font-extrabold text-slate-600 outline-none ring-1 ring-slate-200"
            >
              {DIRECT_REASONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            data-testid="direct-deduct-button"
            disabled={directBusy || remaining <= 0}
            onClick={() => void deductOnly()}
            className="mt-2 w-full rounded-2xl bg-amber-500 py-2.5 text-[12px] font-extrabold text-white shadow-lg shadow-amber-500/25 transition active:scale-[0.98] disabled:opacity-50"
          >
            {directBusy ? '차감하는 중…' : directError ? '다시 차감' : '시간만 차감하기'}
          </button>

          {directError ? (
            <p data-testid="direct-error" className="mt-1.5 text-[10px] font-bold text-rose-500">
              {directError}
            </p>
          ) : null}
        </section>

        {/* ③ 📜 시간 사용 로그 */}
        <section data-testid="time-usage-log" className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-slate-900">📜 시간 사용 로그</p>
            <span className="text-[9px] font-bold text-slate-400">최근 {usageLog.length}건</span>
          </div>
          {usageLog.length === 0 ? (
            <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-center text-[10.5px] font-semibold text-slate-400">
              아직 시간을 쓴 기록이 없어요.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {usageLog.map((usage) => (
                <li
                  key={usage.id}
                  data-testid={`time-usage-${usage.id}`}
                  className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cx(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px]',
                      usage.mode === 'direct' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700',
                    )}
                  >
                    {usage.mode === 'direct' ? '⏳' : '⏱'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-extrabold text-slate-700">
                      {memberNameOf(study.members, usage.member_id)} · {usage.minutes}분
                      <span className="ml-1 text-[9.5px] font-bold text-slate-400">
                        {usage.mode === 'direct' ? '직접 차감' : '타이머'}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[9.5px] font-semibold text-slate-400">
                      {formatNoteTime(usage.at)}
                      {usage.reason ? ` · ${usage.reason}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-1 pt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · [사용 시작] 은 타이머를 돌리고, [시간만 차감하기] 는 타이머 없이 바로 뺍니다.
          <br />· 시간이 다 되면 화면 알림·진동·효과음으로 알려 줘요(폰 알림을 켜 두면 알림도 와요).
          <br />· 일시 멈춤·재개·끝내기는 부모만 할 수 있고, 새로고침해도 이어집니다.
        </p>
      </div>
    </div>
  );
}
