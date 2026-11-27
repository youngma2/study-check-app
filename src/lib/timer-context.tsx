import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useOverlayBack } from './back-guard';
import { playTimerAlarm } from './chime';
import { vibrateTimerEnd, vibrateTimerToggle } from './haptics';
import { useStudy, type ActionResult } from './study-context';
import { formatClock, loadTimer, remainingSeconds, saveTimer, type TimerSession } from './timer';
import type { Member } from './types';

/**
 * ⏱ 뽑기 보너스 시간 타이머 (부모 전용 조작)
 *
 * · 부모가 '사용 시작' 을 누르면 그만큼 뽑기 시간에서 차감되고 카운트다운이 시작됩니다.
 * · 일시 멈춤·재개·끝내기도 부모만 할 수 있습니다(isParent 확인).
 * · 시간이 다 되면 화면 모달 + 진동 + 효과음 + 브라우저 알림으로 알려 줍니다.
 * · 새로고침해도 ends_at / remaining_sec 이 localStorage 에 남아 이어집니다.
 */

export interface TimerAlert {
  memberName: string;
  minutes: number;
}

export interface TimerContextValue {
  session: TimerSession | null;
  /** 지금 남은 초(실시간) */
  remainingSec: number;
  /** '12:34' */
  clock: string;
  /** '시간이 끝났습니다!' 모달에 쓸 값 */
  alert: TimerAlert | null;
  start: (member: Member, minutes: number) => Promise<ActionResult>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  dismissAlert: () => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

function notifyTimerEnd(memberName: string, minutes: number): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission !== 'granted') return;
    const title = '⏰ 시간이 끝났습니다!';
    const body = `${memberName} · ${minutes}분 타이머가 끝났어요.`;
    const options: NotificationOptions = {
      body,
      tag: 'study-timer-end',
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png?v=4`,
      badge: `${import.meta.env.BASE_URL}badge-96.png?v=4`,
      vibrate: [300, 120, 300, 120, 500],
    } as NotificationOptions;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, options))
        .catch(() => {
          try {
            new Notification(title, options);
          } catch {
            /* 알림이 안 떠도 화면 모달로 알려 줍니다. */
          }
        });
      return;
    }
    new Notification(title, options);
  } catch {
    /* 브라우저가 막아도 화면 모달·진동으로 알려 줍니다. */
  }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const study = useStudy();
  const [session, setSession] = useState<TimerSession | null>(() => loadTimer());
  const sessionRef = useRef<TimerSession | null>(session);
  sessionRef.current = session;
  const [remainingSec, setRemainingSec] = useState<number>(() => remainingSeconds(loadTimer()));
  const [alert, setAlert] = useState<TimerAlert | null>(null);
  const finishingRef = useRef<string | null>(null);

  const persist = useCallback((next: TimerSession | null) => {
    sessionRef.current = next;
    setSession(next);
    saveTimer(next);
    setRemainingSec(remainingSeconds(next));
  }, []);

  /** 시간이 다 됨 — 상태를 done 으로 바꾸고 알림은 아래 효과가 한 번만 띄웁니다. */
  const finish = useCallback(
    (current: TimerSession) => {
      if (finishingRef.current === current.id) return;
      finishingRef.current = current.id;
      persist({ ...current, status: 'done', remaining_sec: 0, alerted: false });
    },
    [persist],
  );

  // 1초마다 남은 시간을 다시 셉니다(새로고침·다른 창에서 돌아와도 ends_at 기준).
  useEffect(() => {
    if (!session) {
      setRemainingSec(0);
      return;
    }
    if (session.status !== 'running') {
      setRemainingSec(remainingSeconds(session));
      return;
    }
    const tick = () => {
      const current = sessionRef.current;
      if (!current || current.status !== 'running') return;
      const left = remainingSeconds(current);
      setRemainingSec(left);
      if (left <= 0) finish(current);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [session, finish]);

  // '시간이 끝났습니다!' — 화면 모달 + 진동 + 효과음 + 브라우저 알림 (한 번만)
  useEffect(() => {
    if (!session || session.status !== 'done' || session.alerted) return;
    const current = session;
    setAlert({ memberName: current.member_name || '아이', minutes: current.minutes });
    vibrateTimerEnd();
    playTimerAlarm();
    notifyTimerEnd(current.member_name || '아이', current.minutes);
    const next = { ...current, alerted: true };
    sessionRef.current = next;
    setSession(next);
    saveTimer(next);
  }, [session]);

  const start = useCallback(
    async (member: Member, minutes: number): Promise<ActionResult> => {
      if (!study.isParent || !study.parentUnlocked) {
        return { ok: false, error: '시간 타이머는 부모님만 시작할 수 있어요.' };
      }
      if (sessionRef.current && sessionRef.current.status !== 'done') {
        return { ok: false, error: '이미 타이머가 돌고 있어요. 끝내고 다시 시작해 주세요.' };
      }
      const result = await study.consumeBonusTime(member.id, minutes);
      if (!result.ok) return result;

      const now = new Date();
      const next: TimerSession = {
        id: `tm_${now.getTime().toString(36)}`,
        member_id: member.id,
        member_name: member.name,
        minutes: Math.max(1, Math.round(minutes)),
        started_at: now.toISOString(),
        ends_at: new Date(now.getTime() + Math.max(1, Math.round(minutes)) * 60_000).toISOString(),
        status: 'running',
        remaining_sec: Math.max(1, Math.round(minutes)) * 60,
        alerted: false,
      };
      finishingRef.current = null;
      persist(next);
      vibrateTimerToggle();
      return { ok: true };
    },
    [persist, study],
  );

  const pause = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.status !== 'running') return;
    if (!study.isParent || !study.parentUnlocked) return;
    vibrateTimerToggle();
    persist({ ...current, status: 'paused', remaining_sec: remainingSeconds(current) });
  }, [persist, study.isParent, study.parentUnlocked]);

  const resume = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.status !== 'paused') return;
    if (!study.isParent || !study.parentUnlocked) return;
    vibrateTimerToggle();
    const left = Math.max(1, current.remaining_sec);
    persist({
      ...current,
      status: 'running',
      ends_at: new Date(Date.now() + left * 1000).toISOString(),
    });
  }, [persist, study.isParent, study.parentUnlocked]);

  const stop = useCallback(() => {
    if (!study.isParent || !study.parentUnlocked) return;
    finishingRef.current = null;
    persist(null);
  }, [persist, study.isParent, study.parentUnlocked]);

  const dismissAlert = useCallback(() => setAlert(null), []);

  useOverlayBack(alert !== null, dismissAlert);

  const value = useMemo<TimerContextValue>(
    () => ({
      session,
      remainingSec,
      clock: formatClock(remainingSec),
      alert,
      start,
      pause,
      resume,
      stop,
      dismissAlert,
    }),
    [session, remainingSec, alert, start, pause, resume, stop, dismissAlert],
  );

  return (
    <TimerContext.Provider value={value}>
      {children}
      {alert ? (
        <div
          data-testid="timer-ended"
          role="dialog"
          aria-modal="true"
          aria-label="시간이 끝났습니다"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 px-5 backdrop-blur-sm"
        >
          <div className="animate-gift-pop w-full max-w-[320px] rounded-[26px] bg-white px-5 py-6 text-center shadow-2xl">
            <p className="animate-box-idle text-[38px] leading-none" aria-hidden>
              ⏰
            </p>
            <h2 className="mt-2 text-[18px] font-extrabold tracking-tight text-slate-900">시간이 끝났습니다!</h2>
            <p className="mt-1 text-[12px] font-bold text-slate-500">
              {alert.memberName} · {alert.minutes}분 타이머가 끝났어요
            </p>
            <button
              type="button"
              data-testid="timer-ended-ok"
              onClick={dismissAlert}
              className="mt-4 w-full rounded-2xl bg-indigo-600 py-3 text-[13px] font-extrabold text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.98]"
            >
              확인
            </button>
          </div>
        </div>
      ) : null}
    </TimerContext.Provider>
  );
}

export function useTimer(): TimerContextValue {
  const value = useContext(TimerContext);
  if (!value) throw new Error('useTimer 는 TimerProvider 안에서만 쓸 수 있어요.');
  return value;
}
