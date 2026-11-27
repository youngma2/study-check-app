/**
 * ⏱ 뽑기 보너스 시간 타이머
 *
 * 부모가 뽑기로 받은 시간에서 원하는 만큼을 '사용 시작' 하면 그만큼 차감하고 카운트다운합니다.
 * 새로고침·앱을 닫았다 열어도 이어지도록 **끝나는 시각(ends_at)** 과 **남은 초(remaining_sec)** 를
 * 이 기기의 localStorage 에 남깁니다.
 * (타이머는 그 자리에서 도는 것이라 기기마다 따로입니다 — 차감 기록은 가족 설정에 남습니다)
 */

export interface TimerSession {
  id: string;
  member_id: string;
  member_name: string;
  minutes: number;
  started_at: string;
  /** 이 시각에 끝납니다 (running 일 때) */
  ends_at: string;
  status: 'running' | 'paused' | 'done';
  /** 일시 멈춤일 때 남은 초 */
  remaining_sec: number;
  /** '시간이 끝났습니다!' 알림을 이미 보여 줬는지 */
  alerted: boolean;
}

export const LOCAL_TIMER_KEY = 'study-check.timer.v1';

function isIsoLike(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeTimer(value: unknown): TimerSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TimerSession>;
  if (typeof raw.id !== 'string' || typeof raw.member_id !== 'string') return null;
  if (typeof raw.minutes !== 'number' || !Number.isFinite(raw.minutes)) return null;
  if (!isIsoLike(raw.started_at) || !isIsoLike(raw.ends_at)) return null;
  const status = raw.status === 'paused' || raw.status === 'done' ? raw.status : 'running';
  return {
    id: raw.id,
    member_id: raw.member_id,
    member_name: typeof raw.member_name === 'string' ? raw.member_name : '',
    minutes: Math.max(1, Math.round(raw.minutes)),
    started_at: raw.started_at,
    ends_at: raw.ends_at,
    status,
    remaining_sec:
      typeof raw.remaining_sec === 'number' && Number.isFinite(raw.remaining_sec)
        ? Math.max(0, Math.round(raw.remaining_sec))
        : 0,
    alerted: raw.alerted === true,
  };
}

export function loadTimer(): TimerSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_TIMER_KEY);
    if (!raw) return null;
    return normalizeTimer(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveTimer(session: TimerSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (session === null) window.localStorage.removeItem(LOCAL_TIMER_KEY);
    else window.localStorage.setItem(LOCAL_TIMER_KEY, JSON.stringify(session));
  } catch {
    /* 저장 공간이 없어도 이번 화면의 타이머는 돌아갑니다. */
  }
}

/** 지금 남은 초 — running 은 끝나는 시각에서, paused 는 멈춘 값에서. */
export function remainingSeconds(session: TimerSession | null, nowMs: number = Date.now()): number {
  if (!session) return 0;
  if (session.status === 'done') return 0;
  if (session.status === 'paused') return Math.max(0, session.remaining_sec);
  const ends = Date.parse(session.ends_at);
  if (Number.isNaN(ends)) return Math.max(0, session.remaining_sec);
  return Math.max(0, Math.ceil((ends - nowMs) / 1000));
}

/** 12:34 처럼 */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
