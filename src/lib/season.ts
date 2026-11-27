import { burstMultiplierAt, streakBonusXp, type BurstWindow, type StreakBonus } from './app-settings';
import { addDays, daysBetweenISO, fromISODate, holidayName, koreaISODateOf, koreaTodayISO, toISODate } from './date';
import type { Task, TaskStatus } from './types';

/**
 * 🏆 월간 시즌 티어 · 경험치(XP) · 연속 100% 달성
 *
 * · 시즌은 달력 한 달입니다(KST 기준). 매달 1일 0시에 새 시즌이 시작됩니다.
 * · XP 는 그 달에 부모가 확인 완료(verified)한 공부 1건당 기본 +10 이고,
 *   **그 항목 날짜(due_date)에 완료했는지**에 따라 비율이 달라집니다(아래 XP_DELAY_STEPS).
 *   그 날 할 일을 100% 채우면 +20, 3일 이상 연속 100%면 그 뒤로 매일 +10.
 * · 티어는 6단계(브론즈·실버·골드·플래티넘·다이아·마스터)이고,
 *   마스터를 뺀 5단계는 다시 III → II → I 세 단계로 나뉩니다(총 16칸).
 * · 연속 100%는 **평일(월~금, 공휴일 제외)** 만 셉니다. 토·일·공휴일은
 *   일수에 넣지도, 못 했다고 연속을 끊지도 않습니다. (§영민님 요청 2026-11-25)
 *
 * ⚖️ 완료 시점별 XP 차등 · 취소 시 회수 (§영민님 요청 2026-11-26)
 * · 완료 체크한 **시각(verified_at, 한국 날짜)** 과 항목 날짜(due_date)의 날짜 차이로 비율을 정합니다.
 *     당일 100% · 하루 지남 50% · 이틀 이상 지남 25%
 * · XP 는 어디에도 저장하지 않고 **항목 목록에서 매번 다시 셈**합니다. 그래서 완료를 되돌리면
 *   그 항목 XP 와, 그 날의 100% 보너스·연속 100% 가 함께 사라져 **정확히 회수**됩니다.
 *   (이미 받은 🎁 뽑기 상자 기록은 회수하지 않습니다 — 승급 기록은 family_tier_events 에 남습니다.)
 * · 그 날 100% 보너스(+20)·연속 보너스(+10)는 **그 날 항목을 모두 채웠는지**로 그대로 주고,
 *   지연 감점은 항목 XP 에만 답니다. (완성에 주는 보상과 제때 하기에 주는 보상을 나눕니다)
 */

export const XP_PER_TASK = 10;
export const XP_ALL_CLEAR = 20;
export const XP_STREAK = 10;
/** 며칠째부터 연속 보너스가 붙는지 (3일 이상 연속) */
export const STREAK_BONUS_FROM = 3;

/**
 * ⚙️ 부모 옵션에서 오는 XP 규칙
 * · burstWindows — 🔥 버스트 타임(경험치 2배)이 켜져 있던 시간대. 그때 완료한 항목은 2배로 남습니다.
 * · streakBonuses — ⑤ 연속 달성(3·7·14·30일) 보너스 XP.
 * 값을 주지 않으면 예전과 똑같이 셈합니다(규칙 없음 = 2배 없음·연속 보너스 없음).
 */
export interface XpRules {
  burstWindows?: BurstWindow[];
  streakBonuses?: StreakBonus[];
}

/**
 * ⚖️ 완료가 늦어진 날수 → XP 비율.
 * 0일(당일) 100% · 1일 50% · 2일 이상 25%. 표에 없는 값은 마지막 칸(25%)으로 봅니다.
 */
export const XP_DELAY_STEPS = [
  { maxDelayDays: 0, percent: 100, factor: 1 },
  { maxDelayDays: 1, percent: 50, factor: 0.5 },
  { maxDelayDays: Infinity, percent: 25, factor: 0.25 },
] as const;

/** '오늘 100%' · '하루 지남 50%' · '이틀 이상 25%' */
export function delayLabel(delayDays: number): string {
  if (delayDays <= 0) return '당일 100%';
  if (delayDays === 1) return '하루 지남 50%';
  return '이틀 이상 25%';
}

/** 비율을 빼? 이름만: '당일' · '하루 지남' · '이틀 이상 지남' */
export function delayName(delayDays: number): string {
  if (delayDays <= 0) return '당일';
  if (delayDays === 1) return '하루 지남';
  return '이틀 이상 지남';
}

export function xpPercentForDelay(delayDays: number): number {
  const days = Math.max(0, Math.floor(delayDays));
  return XP_DELAY_STEPS.find((step) => days <= step.maxDelayDays)?.percent ?? 25;
}

/** 항목 1건의 XP — 기본 10 × 비율. (10·5·2.5 처럼 0.5 단위까지만 나옵니다) */
export function xpAmountForDelay(delayDays: number): number {
  const percent = xpPercentForDelay(delayDays);
  // 0.1 XP 단위로 반올림 — 지금 기본값(10 XP)에서는 10 · 5 · 2.5 로만 나옵니다.
  return Math.round((XP_PER_TASK * percent) / 10) / 10;
}

/** 397.5 처럼 소수 XP 도 읽기 좋게 (정수면 소수점 없이) */
export function formatXp(value: number): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export interface TaskXp {
  /** 항목 날짜 → 완료 날짜의 날짜 차이(일). 0 이면 당일 */
  delayDays: number;
  percent: number;
  factor: number;
  /** 이 항목으로 받는(아직 안 했으면 받을) XP */
  xp: number;
  /** '당일 100%' · '하루 지남 50%' · '이틀 이상 25%' */
  label: string;
  /** 완료 시각 기록이 없어 due_date 로 대신한 예전 행인지 */
  legacy: boolean;
  /** 🔥 버스트 타임(경험치 2배)이 적용됐는지 */
  burst: boolean;
}

/**
 * 완료로 친 날짜. verified_at(없으면 updated_at, 그것도 없으면 due_date)을 한국 날짜로 봅니다.
 * 예전에 저장된 행(completed_at 은 없고 updated_at 만 있는 경우 포함)도 그대로 호환됩니다.
 */
export function completionDateOf(task: Task): { date: string; legacy: boolean } {
  const verified = koreaISODateOf(task.verified_at);
  if (verified) return { date: verified, legacy: false };
  const updated = koreaISODateOf(task.updated_at);
  if (updated) return { date: updated, legacy: true };
  return { date: task.due_date, legacy: true };
}

/**
 * 항목 1건의 XP. 완료 전이면 '지금(today) 완료하면 받을 XP' 를 돌려줍니다.
 * (지난 날짜 항목을 오늘 완료하면 그만큼 깎여서 들어옵니다)
 */
export function xpForTask(
  task: Task,
  todayIso: string = koreaTodayISO(),
  rules?: XpRules,
): TaskXp {
  const completion = task.status === 'verified' ? completionDateOf(task) : { date: todayIso, legacy: false };
  const delayDays = Math.max(0, daysBetweenISO(task.due_date, completion.date));
  const percent = xpPercentForDelay(delayDays);
  // 완료한 항목은 그 시각으로, 아직 안 한 항목은 '지금 하면' 으로 버스트 타임을 봅니다.
  const completedIso =
    task.status === 'verified'
      ? task.verified_at ?? task.updated_at ?? `${task.due_date}T23:59:59`
      : new Date().toISOString();
  const multiplier = burstMultiplierAt(completedIso, rules?.burstWindows ?? []);
  return {
    delayDays,
    percent,
    factor: percent / 100,
    xp: Math.round(xpAmountForDelay(delayDays) * multiplier * 10) / 10,
    label: delayLabel(delayDays),
    legacy: completion.legacy,
    burst: multiplier > 1,
  };
}


/** 아이 화면에서 숨기는 부모 전화 항목 — XP 에도 넣지 않습니다(App.tsx 의 isCallTask 와 같은 규칙). */
export function isXpHiddenTask(task: Task): boolean {
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
  /** 그 날 완료한 항목들의 XP 합(지연 감점 반영, 100%·연속 보너스 제외) */
  itemXp: number;
  /** 그 날 완료한 항목 중 당일이 아닌 날에 완료한 수 */
  lateVerified: number;
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
  /** 이번 시즌에 늦게 완료한 항목 수 (XP 가 깎인 항목) */
  lateVerified: number;
  allClearDays: number;
  level: TierLevel;
  /** 지금 이어지고 있는 평일 연속 100% 일수 (0 이면 없음) */
  streak: number;
  todayAllClear: boolean;
  /** 이번 시즌에 ⑤ 연속 달성 보너스로 받은 XP 합 */
  streakBonusXp: number;
  days: DayStat[];
}

interface MonthWindow {
  season: string;
  /** 마지막으로 셀 날짜 */
  lastDate: string;
  /** 오늘(진행 중)인 날짜 — 이 날은 아직 못 채웠어도 연속을 끊지 않습니다. */
  inProgressDate: string | null;
}

function monthStats(tasks: Task[], memberId: string, window: MonthWindow, rules?: XpRules): SeasonStats {
  const byDate = new Map<string, { total: number; verified: number; itemXp: number; lateVerified: number }>();
  /** 항목 XP 는 완료 시각으로 정해지므로 today 는 계산에 쓰이지 않습니다(지연일수 계산 참고). */
  const todayIso = window.inProgressDate ?? window.lastDate;

  for (const task of tasks) {
    if (task.member_id !== memberId) continue;
    if (isXpHiddenTask(task)) continue;
    if (seasonOf(task.due_date) !== window.season) continue;
    if (task.due_date > window.lastDate) continue;
    const slot = byDate.get(task.due_date) ?? { total: 0, verified: 0, itemXp: 0, lateVerified: 0 };
    slot.total += 1;
    if (task.status === 'verified') {
      const detail = xpForTask(task, todayIso, rules);
      slot.verified += 1;
      slot.itemXp += detail.xp;
      if (detail.delayDays > 0) slot.lateVerified += 1;
    }
    byDate.set(task.due_date, slot);
  }

  const days: DayStat[] = [];
  let xp = 0;
  let verifiedTotal = 0;
  let lateTotal = 0;
  let allClearDays = 0;
  let streak = 0;
  let todayAllClear = false;
  let streakBonusTotal = 0;

  const start = fromISODate(`${window.season}-01`);
  const end = fromISODate(window.lastDate);

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = toISODate(cursor);
    const slot = byDate.get(date) ?? { total: 0, verified: 0, itemXp: 0, lateVerified: 0 };
    const allClear = slot.total > 0 && slot.verified === slot.total;
    const streakDay = isStreakDay(date);

    verifiedTotal += slot.verified;
    lateTotal += slot.lateVerified;
    if (allClear) allClearDays += 1;

    // 항목 XP 는 완료한 날의 비율대로 더하고(지연 감점), 100%·연속 보너스는 그대로 붙습니다.
    let dayXp = slot.itemXp;
    if (allClear) dayXp += XP_ALL_CLEAR;

    if (streakDay) {
      if (allClear) {
        streak += 1;
        if (streak >= STREAK_BONUS_FROM) dayXp += XP_STREAK;
        // ⑤ 연속 달성 보너스 — 정확히 그 날수(3·7·14·30일…)를 채운 날에 한 번 붙습니다.
        const milestone = streakBonusXp(streak, rules?.streakBonuses ?? []);
        if (milestone > 0) {
          dayXp += milestone;
          streakBonusTotal += milestone;
        }
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
    days.push({
      date,
      total: slot.total,
      verified: slot.verified,
      itemXp: slot.itemXp,
      lateVerified: slot.lateVerified,
      allClear,
      streakDay,
      xp: dayXp,
      streakAt: streak,
    });
  }

  return {
    season: window.season,
    xp,
    verified: verifiedTotal,
    lateVerified: lateTotal,
    allClearDays,
    level: levelForXp(xp),
    streak,
    todayAllClear,
    streakBonusXp: streakBonusTotal,
    days,
  };
}

/** 이번 달(오늘까지) 시즌 기록. */
export function computeSeasonStats(
  tasks: Task[],
  memberId: string,
  todayIso: string = koreaTodayISO(),
  rules?: XpRules,
): SeasonStats {
  const season = seasonOf(todayIso);
  return monthStats(tasks, memberId, { season, lastDate: todayIso, inProgressDate: todayIso }, rules);
}

/** 이미 끝난 달의 기록(지난달 최고 티어 등). */
export function computePastSeason(
  tasks: Task[],
  memberId: string,
  season: string,
  rules?: XpRules,
): SeasonStats {
  return monthStats(tasks, memberId, { season, lastDate: seasonEnd(season), inProgressDate: null }, rules);
}

/** 그 시즌(달력 한 달)의 XP — 이번 달이면 오늘까지, 지난 달이면 그 달 끝까지. */
export function seasonXpFor(
  tasks: Task[],
  memberId: string,
  season: string,
  todayIso: string = koreaTodayISO(),
  rules?: XpRules,
): number {
  if (season === seasonOf(todayIso)) return computeSeasonStats(tasks, memberId, todayIso, rules).xp;
  return computePastSeason(tasks, memberId, season, rules).xp;
}

/** 완료 체크·되돌리기로 이번 시즌 XP 가 얼마나 달라지는지. */
export interface XpChange {
  /** 항목이 속한 시즌 'YYYY-MM' */
  season: string;
  /** 이번 달 시즌인지 (아니면 지난달 기록에서 빠집니다) */
  currentSeason: boolean;
  before: number;
  after: number;
  /** after - before — 되돌리면 음수(회수량) */
  delta: number;
  /** 항목 자체의 XP 변화 */
  itemDelta: number;
  /** 100% 보너스·연속 100% 보너스 변화 */
  bonusDelta: number;
  /** 바뀐 뒤 그 항목의 XP(완료했을 때 받는 값) */
  item: TaskXp;
}

/**
 * 완료(verified) 또는 되돌리기(todo)로 XP 가 얼마나 달라지는지 정확히 계산합니다.
 * XP 는 저장값이 아니라 항목 목록에서 다시 세는 값이라, 이 차이가 곷 회수량입니다.
 */
export function xpChangeForStatus(
  tasks: Task[],
  task: Task,
  nextStatus: TaskStatus,
  options: { completedAt?: string; todayIso?: string; rules?: XpRules } = {},
): XpChange {
  const todayIso = options.todayIso ?? koreaTodayISO();
  const rules = options.rules;
  const season = seasonOf(task.due_date);
  const before = seasonXpFor(tasks, task.member_id, season, todayIso, rules);

  const nextTask: Task = {
    ...task,
    status: nextStatus,
    verified_at: nextStatus === 'verified' ? (options.completedAt ?? new Date().toISOString()) : null,
    verified_by: nextStatus === 'verified' ? task.verified_by ?? null : null,
  };
  const known = tasks.some((item) => item.id === task.id);
  const afterTasks = known
    ? tasks.map((item) => (item.id === task.id ? nextTask : item))
    : [...tasks, nextTask];
  const after = seasonXpFor(afterTasks, task.member_id, season, todayIso, rules);

  const xpOf = (item: Task): number =>
    item.status === 'verified' && !isXpHiddenTask(item) ? xpForTask(item, todayIso, rules).xp : 0;
  const itemDelta = xpOf(nextTask) - xpOf(task);
  const item = isXpHiddenTask(nextTask)
    ? { ...xpForTask(nextTask, todayIso, rules), xp: 0 }
    : xpForTask(nextTask, todayIso, rules);

  return {
    season,
    currentSeason: season === seasonOf(todayIso),
    before,
    after,
    delta: Math.round((after - before) * 10) / 10,
    itemDelta: Math.round(itemDelta * 10) / 10,
    bonusDelta: Math.round((after - before - itemDelta) * 10) / 10,
    item,
  };
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
