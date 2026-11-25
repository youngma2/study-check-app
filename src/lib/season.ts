import { addDays, fromISODate, holidayName, koreaTodayISO, toISODate } from './date';
import type { Task } from './types';

/**
 * 🏆 월간 시즌 티어 · 경험치(XP) · 연속 100% 달성
 *
 * · 시즌은 달력 한 달입니다(KST 기준). 매달 1일 0시에 새 시즌이 시작됩니다.
 * · XP 는 그 달에 부모가 확인 완료(verified)한 공부 1건당 +10.
 *   그 날 할 일을 100% 채우면 +20, 3일 이상 연속 100%면 그 뒤로 매일 +10.
 * · 티어는 6단계(브론즈·실버·골드·플래티넘·다이아·마스터)이고,
 *   마스터를 뺀 5단계는 다시 III → II → I 세 단계로 나뉩니다(총 16칸).
 * · 연속 100%는 **평일(월~금, 공휴일 제외)** 만 셉니다. 토·일·공휴일은
 *   일수에 넣지도, 못 했다고 연속을 끊지도 않습니다. (§영민님 요청 2026-11-25)
 */

export const XP_PER_TASK = 10;
export const XP_ALL_CLEAR = 20;
export const XP_STREAK = 10;
/** 며칠째부터 연속 보너스가 붙는지 (3일 이상 연속) */
export const STREAK_BONUS_FROM = 3;

/** 아이 화면에서 숨기는 부모 전화 항목 — XP 에도 넣지 않습니다(App.tsx 의 isCallTask 와 같은 규칙). */
function isHiddenTask(task: Task): boolean {
  return task.title.includes('📞 통화') || task.id.includes('_call1') || task.id.includes('_call2');
}

export type TierKey = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master';

export interface TierDef {
  key: TierKey;
  label: string;
  emoji: string;
  min: number;
  /** 마스터는 위 끝이 없습니다(null). */
  max: number | null;
  /** 1(브론즈) ~ 6(마스터) */
  rank: number;
}

export const TIERS: TierDef[] = [
  { key: 'bronze', label: '브론즈', emoji: '🥉', min: 0, max: 99, rank: 1 },
  { key: 'silver', label: '실버', emoji: '🥈', min: 100, max: 249, rank: 2 },
  { key: 'gold', label: '골드', emoji: '🥇', min: 250, max: 449, rank: 3 },
  { key: 'platinum', label: '플래티넘', emoji: '💠', min: 450, max: 699, rank: 4 },
  { key: 'diamond', label: '다이아', emoji: '💎', min: 700, max: 999, rank: 5 },
  { key: 'master', label: '마스터', emoji: '👑', min: 1000, max: null, rank: 6 },
];

/** 세부 단계 이름 — III(막 승급) → II → I(그 티어의 끝) */
export const DIVISIONS = ['', 'I', 'II', 'III'] as const;

export function tierByRank(rank: number): TierDef {
  return TIERS[Math.min(Math.max(Math.round(rank), 1), TIERS.length) - 1];
}

export function tierByKey(key: string): TierDef | undefined {
  return TIERS.find((tier) => tier.key === key);
}

export interface TierLevel {
  key: TierKey;
  label: string;
  rank: number;
  /** 3 = III, 2 = II, 1 = I, 0 = 마스터(세부 단계 없음) */
  division: number;
  /** 0(브론즈 III) ~ 15(마스터) — 승급 여부를 비교하는 값 */
  index: number;
  /** '실버 II' 처럼 보여 줄 이름 */
  title: string;
  /** 이 칸이 시작하는 XP */
  minXp: number;
  /** 다음 칸이 시작하는 XP (마스터는 null) */
  nextXp: number | null;
}

const MASTER_LEVEL = TIERS.length * 3 - 2; // 16칸 중 마지막 = 15

/** 칸 번호(0~15) → 티어·세부 단계 */
export function levelOfIndex(index: number): TierLevel {
  const clamped = Math.max(0, Math.min(MASTER_LEVEL, Math.floor(index)));
  const rank = Math.floor(clamped / 3) + 1;
  const tier = tierByRank(rank);

  if (tier.max === null) {
    return {
      key: tier.key,
      label: tier.label,
      rank: tier.rank,
      division: 0,
      index: MASTER_LEVEL,
      title: tier.label,
      minXp: tier.min,
      nextXp: null,
    };
  }

  const division = 3 - (clamped % 3);
  const span = tier.max - tier.min + 1;
  const step = Math.ceil(span / 3);
  const pos = 3 - division;
  return {
    key: tier.key,
    label: tier.label,
    rank: tier.rank,
    division,
    index: clamped,
    title: `${tier.label} ${DIVISIONS[division]}`,
    minXp: tier.min + pos * step,
    nextXp: pos < 2 ? tier.min + (pos + 1) * step : tier.max + 1,
  };
}

/** XP → 지금 칸 */
export function levelForXp(xp: number): TierLevel {
  const value = Math.max(0, Math.floor(xp || 0));
  for (const tier of TIERS) {
    if (tier.max === null) return levelOfIndex(MASTER_LEVEL);
    if (value <= tier.max) {
      const span = tier.max - tier.min + 1;
      const step = Math.ceil(span / 3);
      const pos = Math.min(2, Math.max(0, Math.floor((value - tier.min) / step)));
      return levelOfIndex((tier.rank - 1) * 3 + pos);
    }
  }
  return levelOfIndex(MASTER_LEVEL);
}

/* ------------------------------------------------------------------ */
/* 시즌(달)                                                             */
/* ------------------------------------------------------------------ */

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function seasonOf(iso: string): string {
  return iso.slice(0, 7);
}

export function seasonEnd(season: string): string {
  const [year, month] = season.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${season}-${String(last).padStart(2, '0')}`;
}

export function previousSeason(season: string): string {
  const [year, month] = season.split('-').map(Number);
  const date = new Date(year, month - 1 - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function seasonLength(season: string): number {
  const [year, month] = season.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

/** 연속 100% 에 세는 날인지 — 평일이면서 공휴일이 아닌 날. */
export function isStreakDay(iso: string): boolean {
  const weekday = fromISODate(iso).getDay();
  if (weekday === 0 || weekday === 6) return false;
  return holidayName(iso) === null;
}

/* ------------------------------------------------------------------ */
/* 계산                                                                 */
/* ------------------------------------------------------------------ */

export interface DayStat {
  date: string;
  total: number;
  verified: number;
  allClear: boolean;
  /** 연속 100% 에 세는 평일인지(주말·공휴일은 false) */
  streakDay: boolean;
  xp: number;
  /** 이 날까지의 연속 100% 일수 (0 이면 연속 끊김) */
  streakAt: number;
}

export interface SeasonStats {
  season: string;
  xp: number;
  verified: number;
  allClearDays: number;
  level: TierLevel;
  /** 지금 이어지고 있는 평일 연속 100% 일수 (0 이면 없음) */
  streak: number;
  todayAllClear: boolean;
  days: DayStat[];
}

interface MonthWindow {
  season: string;
  /** 마지막으로 셀 날짜 */
  lastDate: string;
  /** 오늘(진행 중)인 날짜 — 이 날은 아직 못 채웠어도 연속을 끊지 않습니다. */
  inProgressDate: string | null;
}

function monthStats(tasks: Task[], memberId: string, window: MonthWindow): SeasonStats {
  const byDate = new Map<string, { total: number; verified: number }>();

  for (const task of tasks) {
    if (task.member_id !== memberId) continue;
    if (isHiddenTask(task)) continue;
    if (seasonOf(task.due_date) !== window.season) continue;
    if (task.due_date > window.lastDate) continue;
    const slot = byDate.get(task.due_date) ?? { total: 0, verified: 0 };
    slot.total += 1;
    if (task.status === 'verified') slot.verified += 1;
    byDate.set(task.due_date, slot);
  }

  const days: DayStat[] = [];
  let xp = 0;
  let verifiedTotal = 0;
  let allClearDays = 0;
  let streak = 0;
  let todayAllClear = false;

  const start = fromISODate(`${window.season}-01`);
  const end = fromISODate(window.lastDate);

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = toISODate(cursor);
    const slot = byDate.get(date) ?? { total: 0, verified: 0 };
    const allClear = slot.total > 0 && slot.verified === slot.total;
    const streakDay = isStreakDay(date);

    verifiedTotal += slot.verified;
    if (allClear) allClearDays += 1;

    let dayXp = slot.verified * XP_PER_TASK;
    if (allClear) dayXp += XP_ALL_CLEAR;

    if (streakDay) {
      if (allClear) {
        streak += 1;
        if (streak >= STREAK_BONUS_FROM) dayXp += XP_STREAK;
      } else if (slot.total === 0) {
        // 할 일이 없던 평일 — 세지도, 끊지도 않습니다.
      } else if (date === window.inProgressDate) {
        // 오늘은 아직 남은 항목이 있을 수 있어요. 내일 지나면 그때 끊깁니다.
      } else {
        streak = 0;
      }
    }

    if (date === window.inProgressDate) todayAllClear = allClear;

    xp += dayXp;
    days.push({ date, total: slot.total, verified: slot.verified, allClear, streakDay, xp: dayXp, streakAt: streak });
  }

  return {
    season: window.season,
    xp,
    verified: verifiedTotal,
    allClearDays,
    level: levelForXp(xp),
    streak,
    todayAllClear,
    days,
  };
}

/** 이번 달(오늘까지) 시즌 기록. */
export function computeSeasonStats(
  tasks: Task[],
  memberId: string,
  todayIso: string = koreaTodayISO(),
): SeasonStats {
  const season = seasonOf(todayIso);
  return monthStats(tasks, memberId, { season, lastDate: todayIso, inProgressDate: todayIso });
}

/** 이미 끝난 달의 기록(지난달 최고 티어 등). */
export function computePastSeason(
  tasks: Task[],
  memberId: string,
  season: string,
): SeasonStats {
  return monthStats(tasks, memberId, { season, lastDate: seasonEnd(season), inProgressDate: null });
}

/* ------------------------------------------------------------------ */
/* 보상 뽑기 상자                                                        */
/* ------------------------------------------------------------------ */

export const DEFAULT_REWARD_POOL = [5, 10, 15, 20];

/**
 * 상자를 열었을 때 나올 게임 시간(분).
 * 상위 티어일수록 큰 보상이 잘 나오도록 가중치를 줍니다(플래티넘부터).
 * (서버가 정하는 클라우드 모드와 같은 규칙 — 앱을 거치지 않는 데모 모드에서도 같게)
 */
export function pickRewardMinutes(pool: number[], rank: number, random: () => number = Math.random): number {
  const values = (pool.length > 0 ? pool : DEFAULT_REWARD_POOL).filter(
    (value) => Number.isFinite(value) && value >= 1 && value <= 120,
  );
  if (values.length === 0) return 10;
  const weights = values.map((_, index) => (rank >= 4 ? (index + 1) ** 2 : index + 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < values.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return values[index];
  }
  return values[values.length - 1];
}
