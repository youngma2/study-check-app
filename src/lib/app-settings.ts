import { koreaISODateOf } from './date';
import type { TaskPreset } from './types';

/**
 * ⚙️ 앱 설정 — 부모 관리(PIN)에서 바꾸는 것들
 *
 * ① 프리셋별 기본 공부 목록(학기중·방학·시험기간)
 * ② 🔥 버스트 타임(경험치 2배) ON/OFF 와 켜져 있던 시간대
 * ③ ⑤ 연속 달성(스트릭) 보너스 XP
 * ④ 뽑기 보너스 시간을 나눠 쓴 기록(타이머)
 *
 * 가족 폰끼리 함께 쓰는 값이라 Supabase `family_app_settings` 표(한 줄)에 둡니다.
 * 그 표가 아직 없는 DB(SQL 을 실행하기 전)에서는 이 기기의 localStorage 만 씁니다 —
 * 그래도 앱은 에러 없이 그대로 동작하고, 화면에 '이 폰에만 적용' 이라고 알려 줍니다.
 */

export type RoutineKey = 'semester' | 'vacation' | 'exam';

export const ROUTINE_PRESETS: Array<{ key: RoutineKey; label: string; emoji: string }> = [
  { key: 'semester', label: '학기중', emoji: '📚' },
  { key: 'vacation', label: '방학', emoji: '🏖️' },
  { key: 'exam', label: '시험기간', emoji: '📝' },
];

/** 🔥 경험치 2배가 적용되는 시간대 — 부모가 켠 때부터 끌 때까지 */
export interface BurstWindow {
  /** ISO 시각 */
  from: string;
  /** ISO 시각. null 이면 아직 진행 중(켜져 있음) */
  to: string | null;
}

/** 연속 달성 보너스 — day 일 연속 100% 를 채운 날에 xp 를 더 줍니다. */
export interface StreakBonus {
  day: number;
  xp: number;
}

/**
 * 뽑기 보너스 시간을 쓴 한 줄.
 * · mode 'timer'  — ⏱ 타이머를 돌려서 쓴 시간
 * · mode 'direct' — 타이머 없이 시간만 바로 뺀 것(사유를 함께 남깁니다)
 */
export interface TimeUsage {
  id: string;
  member_id: string;
  minutes: number;
  at: string;
  mode: 'timer' | 'direct';
  /** 직접 차감일 때 적어 둔 사유 */
  reason?: string;
}

/** 🎁 뽑기 상자에서 나올 수 있는 보상 — 게임 시간(분) 또는 화폐 포인트(P) */
export type BoxRewardKind = 'minutes' | 'points';

export interface BoxReward {
  id: string;
  kind: BoxRewardKind;
  /** 분 또는 P */
  value: number;
}

export const DEFAULT_BOX_REWARDS: BoxReward[] = [
  { id: 'bx_min_5', kind: 'minutes', value: 5 },
  { id: 'bx_min_10', kind: 'minutes', value: 10 },
  { id: 'bx_min_15', kind: 'minutes', value: 15 },
  { id: 'bx_min_20', kind: 'minutes', value: 20 },
];

/** '0'(일) ~ '6'(토) → 그 요일의 기본 공부 목록 */
export type WeekdayRoutine = Record<string, TaskPreset[]>;
/** memberId → 요일별 목록 */
export type MemberRoutines = Record<string, WeekdayRoutine>;

export interface RoutineSet {
  label: string;
  routines: MemberRoutines;
}

export interface AppSettings {
  version: 1;
  /** 🔥 버스트 타임 **수동** 설정이 켜져 있는지 */
  burst: boolean;
  /** 🔥 버스트 타임 **자동** 설정 — 월말 며칠 전부터 켤지 */
  burstAuto: boolean;
  /** 자동 설정이 시작되는 날 — 월말까지 남은 일수가 이 값보다 작으면 켜집니다(기본 7일) */
  burstAutoDays: number;
  /** 수동·자동이 겹칠 때 2배를 또 곱할지(4배) — 끄면 최대 2배까지만 */
  burstOverlap: boolean;
  /** 🎁 뽑기 상자 보상 목록 (분·포인트) */
  boxRewards: BoxReward[];
  /** 켜 둔 시간대들 — 완료 시각이 이 안에 있으면 XP 2배(끈 뒤에도 그대로 유지) */
  burstWindows: BurstWindow[];
  /** ⑤ 연속 달성 보너스 XP (3·7·14·30일) */
  streakBonuses: StreakBonus[];
  /** ④ 지금 쓰는 프리셋 */
  activePreset: RoutineKey;
  /** ④ 프리셋별 기본 공부 목록 */
  presets: Record<RoutineKey, RoutineSet>;
  /** ② 뽑기 시간을 나눠 쓴 기록 */
  timeUsage: TimeUsage[];
}

export const DEFAULT_STREAK_BONUSES: StreakBonus[] = [
  { day: 3, xp: 30 },
  { day: 7, xp: 70 },
  { day: 14, xp: 140 },
  { day: 30, xp: 300 },
];

export const LOCAL_APP_SETTINGS_KEY = 'study-check.app-settings.v1';

function emptyRoutines(): Record<RoutineKey, RoutineSet> {
  return {
    semester: { label: '학기중', routines: {} },
    vacation: { label: '방학', routines: {} },
    exam: { label: '시험기간', routines: {} },
  };
}

export function defaultAppSettings(): AppSettings {
  return {
    version: 1,
    burst: false,
    burstAuto: false,
    burstAutoDays: 7,
    burstOverlap: false,
    boxRewards: DEFAULT_BOX_REWARDS.map((reward) => ({ ...reward })),
    burstWindows: [],
    streakBonuses: [...DEFAULT_STREAK_BONUSES],
    activePreset: 'semester',
    presets: emptyRoutines(),
    timeUsage: [],
  };
}

/* ------------------------------------------------------------------ */
/* 값 다듬기                                                           */
/* ------------------------------------------------------------------ */

function isIsoLike(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && !Number.isNaN(Date.parse(value));
}

function toPresetItems(value: unknown): TaskPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const preset = item as Partial<TaskPreset>;
    if (typeof preset.title !== 'string' || !preset.title.trim()) return [];
    return [{ title: preset.title.trim().slice(0, 60), subject: typeof preset.subject === 'string' ? preset.subject : 'etc' }];
  });
}

function toRoutines(value: unknown): MemberRoutines {
  if (!value || typeof value !== 'object') return {};
  const result: MemberRoutines = {};
  for (const [memberId, weekdays] of Object.entries(value as Record<string, unknown>)) {
    if (!weekdays || typeof weekdays !== 'object') continue;
    const byDay: WeekdayRoutine = {};
    for (const [weekday, items] of Object.entries(weekdays as Record<string, unknown>)) {
      if (!/^[0-6]$/.test(weekday)) continue;
      const list = toPresetItems(items);
      if (list.length > 0) byDay[weekday] = list;
    }
    if (Object.keys(byDay).length > 0) result[memberId] = byDay;
  }
  return result;
}

/** 어떤 값이 와도 화면이 쓸 수 있는 설정으로 맞춥니다(예전 값·깨진 값도 안전). */
export function normalizeAppSettings(value: unknown): AppSettings {
  const base = defaultAppSettings();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Partial<AppSettings>;

  const windows: BurstWindow[] = Array.isArray(raw.burstWindows)
    ? raw.burstWindows.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const window = item as Partial<BurstWindow>;
        if (!isIsoLike(window.from)) return [];
        return [{ from: window.from, to: isIsoLike(window.to) ? window.to : null }];
      })
    : [];
  const cappedWindows = windows.slice(-30);
  // 켜져 있는데 열린 시간대가 없으면(예전 값) 지금부터로 하나 열어 둡니다.
  const burst = raw.burst === true;
  if (burst && !cappedWindows.some((item) => item.to === null)) {
    cappedWindows.push({ from: new Date().toISOString(), to: null });
  }
  if (!burst) {
    for (const window of cappedWindows) {
      if (window.to === null) window.to = new Date().toISOString();
    }
  }

  const bonuses: StreakBonus[] = Array.isArray(raw.streakBonuses)
    ? raw.streakBonuses.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const bonus = item as Partial<StreakBonus>;
        if (typeof bonus.day !== 'number' || !Number.isFinite(bonus.day)) return [];
        if (typeof bonus.xp !== 'number' || !Number.isFinite(bonus.xp)) return [];
        const day = Math.max(1, Math.min(365, Math.round(bonus.day)));
        const xp = Math.max(0, Math.min(10000, Math.round(bonus.xp)));
        return [{ day, xp }];
      })
    : [];

  const presets = emptyRoutines();
  if (raw.presets && typeof raw.presets === 'object') {
    for (const preset of ROUTINE_PRESETS) {
      const entry = (raw.presets as Record<string, unknown>)[preset.key];
      if (!entry || typeof entry !== 'object') continue;
      presets[preset.key] = {
        label: preset.label,
        routines: toRoutines((entry as { routines?: unknown }).routines),
      };
    }
  }

  const activePreset = ROUTINE_PRESETS.some((preset) => preset.key === raw.activePreset)
    ? (raw.activePreset as RoutineKey)
    : 'semester';

  const timeUsage: TimeUsage[] = Array.isArray(raw.timeUsage)
    ? raw.timeUsage.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const usage = item as Partial<TimeUsage>;
        if (typeof usage.id !== 'string' || typeof usage.member_id !== 'string') return [];
        if (typeof usage.minutes !== 'number' || !Number.isFinite(usage.minutes)) return [];
        if (!isIsoLike(usage.at)) return [];
        return [
          {
            id: usage.id,
            member_id: usage.member_id,
            minutes: Math.max(1, Math.min(600, Math.round(usage.minutes))),
            at: usage.at,
            // 예전 기록은 타이머로 쓴 것으로 봅니다.
            mode: usage.mode === 'direct' ? 'direct' : 'timer',
            reason: typeof usage.reason === 'string' && usage.reason.trim() ? usage.reason.trim().slice(0, 40) : undefined,
          },
        ];
      })
    : [];

  const boxRewards: BoxReward[] = Array.isArray(raw.boxRewards)
    ? raw.boxRewards.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return [];
        const reward = item as Partial<BoxReward>;
        if (typeof reward.value !== 'number' || !Number.isFinite(reward.value)) return [];
        const value = Math.round(reward.value);
        if (value < 1 || value > 500) return [];
        return [
          {
            id: typeof reward.id === 'string' && reward.id ? reward.id : `bx_${index}_${Date.now().toString(36)}`,
            kind: reward.kind === 'points' ? 'points' : 'minutes',
            value,
          },
        ];
      })
    : [];

  const autoDays = typeof raw.burstAutoDays === 'number' && Number.isFinite(raw.burstAutoDays)
    ? Math.max(1, Math.min(28, Math.round(raw.burstAutoDays)))
    : 7;

  return {
    version: 1,
    burst,
    burstAuto: raw.burstAuto === true,
    burstAutoDays: autoDays,
    burstOverlap: raw.burstOverlap === true,
    // 목록을 다 지운 경우에는 상자가 아무것도 주지 않게 되므로 기본 보상으로 돌아갑니다.
    boxRewards:
      Array.isArray(raw.boxRewards) && boxRewards.length > 0
        ? boxRewards.slice(0, 8)
        : DEFAULT_BOX_REWARDS.map((reward) => ({ ...reward })),
    burstWindows: cappedWindows,
    // 값을 일부러 비운 배열(보너스 없음)은 그대로 두고, 값이 아예 없을 때만 기본값을 씁니다.
    streakBonuses: Array.isArray(raw.streakBonuses)
      ? bonuses.sort((a, b) => a.day - b.day).slice(0, 8)
      : [...DEFAULT_STREAK_BONUSES],
    activePreset,
    presets,
    timeUsage: timeUsage.slice(-200),
  };
}

/* ------------------------------------------------------------------ */
/* 이 기기 저장                                                        */
/* ------------------------------------------------------------------ */

export function loadLocalAppSettings(): AppSettings {
  if (typeof window === 'undefined') return defaultAppSettings();
  try {
    const raw = window.localStorage.getItem(LOCAL_APP_SETTINGS_KEY);
    if (!raw) return defaultAppSettings();
    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return defaultAppSettings();
  }
}

export function saveLocalAppSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_APP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 저장 공간이 없어도 화면은 그대로 쓸 수 있게 둡니다. */
  }
}

/* ------------------------------------------------------------------ */
/* 조회 도우미                                                         */
/* ------------------------------------------------------------------ */

/** 지금 쓰는 프리셋의 한 아이 요일별 목록 */
export function routinesForMember(settings: AppSettings, memberId: string): WeekdayRoutine {
  return settings.presets[settings.activePreset]?.routines[memberId] ?? {};
}

/** 한 아이·한 요일의 기본 목록 */
export function routineForDay(settings: AppSettings, memberId: string, weekday: number): TaskPreset[] {
  return routinesForMember(settings, memberId)[String(weekday)] ?? [];
}

/** 목록을 바꾼 새 설정을 돌려줍니다(저장은 호출하는 쪽에서). */
export function withRoutine(
  settings: AppSettings,
  memberId: string,
  weekday: number,
  items: TaskPreset[],
): AppSettings {
  const presetKey = settings.activePreset;
  const preset = settings.presets[presetKey] ?? { label: presetKey, routines: {} };
  const byDay = { ...(preset.routines[memberId] ?? {}) };
  const cleaned = toPresetItems(items);
  if (cleaned.length > 0) byDay[String(weekday)] = cleaned;
  else delete byDay[String(weekday)];

  const routines = { ...preset.routines };
  if (Object.keys(byDay).length > 0) routines[memberId] = byDay;
  else delete routines[memberId];

  return {
    ...settings,
    presets: { ...settings.presets, [presetKey]: { label: preset.label, routines } },
  };
}

/** 🔥 버스트 타임을 켜고 끕니다 — 시간대를 함께 남겨, 끈 뒤에도 그때 완료한 XP 는 2배로 남습니다. */
export function toggleBurst(settings: AppSettings, on: boolean, now: Date = new Date()): AppSettings {
  const iso = now.toISOString();
  if (on === settings.burst) return settings;
  if (on) {
    return {
      ...settings,
      burst: true,
      burstWindows: [...settings.burstWindows, { from: iso, to: null }].slice(-30),
    };
  }
  const windows = settings.burstWindows.map((window) =>
    window.to === null ? { ...window, to: iso } : window,
  );
  return { ...settings, burst: false, burstWindows: windows };
}

/** 그 날(한국 날짜)이 버스트 타임 안인지 — 수동(켜 둔 시간대) 또는 자동(월말) 중 하나면 켜집니다. */
export function burstOnDate(
  iso: string,
  settings: Pick<AppSettings, 'burstWindows' | 'burstAuto' | 'burstAutoDays'>,
): boolean {
  if (settings.burstAuto && autoBurstOn(iso, settings.burstAutoDays)) return true;
  return settings.burstWindows.some((window) => {
    const from = koreaDateOf(window.from);
    if (!from || from > iso) return false;
    const to = window.to === null ? null : koreaDateOf(window.to);
    return to === null || to >= iso;
  });
}

/** 'YYYY-MM-DD' 의 한국 날짜 계산 도우미 (기기 시간대와 상관없이) */
function koreaDateOf(timestamp: string): string | null {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return null;
  return koreaISODateOf(new Date(time).toISOString());
}

/** 월말까지 남은 일수 (그 달 마지막 날이면 0) */
export function daysUntilMonthEnd(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  return Math.max(0, last - day);
}

/** 🔥 자동 버스트 타임 — 월말까지 남은 일수가 days 보다 작으면 그 날은 켜집니다(7 → 마지막 7일). */
export function autoBurstOn(iso: string, days: number): boolean {
  return daysUntilMonthEnd(iso) < Math.max(1, Math.round(days));
}

/**
 * 완료한 시각의 버스트 배율 — 1 · 2 · 4.
 * · 수동(켜 둔 시간대)과 자동(월말)이 겹치면 overlap 이 켜져 있을 때만 4배, 아니면 2배 한 번입니다.
 */
export function burstMultiplierAt(
  iso: string | null | undefined,
  windows: BurstWindow[],
  options: { autoDays?: number; overlap?: boolean } = {},
): number {
  if (!iso) return 1;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 1;

  let manual = false;
  for (const window of windows) {
    const from = Date.parse(window.from);
    if (Number.isNaN(from)) continue;
    const to = window.to === null ? Infinity : Date.parse(window.to);
    if (Number.isNaN(to)) continue;
    if (time >= from && time <= to) {
      manual = true;
      break;
    }
  }

  const autoDays = options.autoDays ?? 0;
  const isoDate = koreaISODateOf(new Date(time).toISOString());
  const auto = autoDays > 0 && isoDate !== null && autoBurstOn(isoDate, autoDays);

  if (manual && auto) return options.overlap ? 4 : 2;
  return manual || auto ? 2 : 1;
}

/** 지금(오늘) 버스트 타임이 켜져 있는지 — 화면 배너에 씁니다. */
export function burstActiveToday(
  settings: Pick<AppSettings, 'burstWindows' | 'burstAuto' | 'burstAutoDays'>,
  todayIso: string,
): boolean {
  // 자동은 날짜로 정해지고, 수동은 '지금 켜져 있는지(burst)' 로 봅니다.
  if (settings.burstAuto && autoBurstOn(todayIso, settings.burstAutoDays)) return true;
  return settings.burstWindows.some((window) => window.to === null);
}

/** 분 보상만 모은 목록 — 뽑기 상자(서버·기기)가 시간을 뽑을 때 쓰는 후보입니다. */
export function boxMinutePool(rewards: BoxReward[]): number[] {
  const values = rewards
    .filter((reward) => reward.kind === 'minutes')
    .map((reward) => Math.max(1, Math.min(120, Math.round(reward.value))));
  return values.length > 0 ? Array.from(new Set(values)) : [5, 10, 15, 20];
}

/**
 * 상자 하나(event.id)가 어떤 보상을 줄지 — 어느 폰에서 열어도 같은 값이 나오도록 id 로 정합니다.
 * (연출은 3택1이지만 실제 보상은 정해져 있다는 기존 규칙 그대로)
 */
export function boxRewardFor(
  rewards: BoxReward[],
  eventId: string,
  boxMinutes: number | null,
): { kind: BoxRewardKind; value: number } {
  const list = rewards.length > 0 ? rewards : DEFAULT_BOX_REWARDS;
  let hash = 0;
  for (let index = 0; index < eventId.length; index += 1) {
    hash = (hash * 31 + eventId.charCodeAt(index)) >>> 0;
  }
  const pick = list[hash % list.length];
  if (pick.kind === 'points') return { kind: 'points', value: Math.max(1, Math.round(pick.value)) };
  // 분 보상은 상자에 이미 정해진 값(서버·기기 기록)을 씁니다 — 타이머와 숫자가 어긋나지 않게.
  return { kind: 'minutes', value: boxMinutes && boxMinutes > 0 ? boxMinutes : Math.max(1, Math.round(pick.value)) };
}

/** 그 상자가 포인트 보상인지 (분 보너스 계산에서 빼야 하는지) */
export function boxIsPointsPrize(rewards: BoxReward[], eventId: string): boolean {
  return boxRewardFor(rewards, eventId, null).kind === 'points';
}

/** 연속 달성 보너스가 붙는 날인지 — 정확히 그 날수일 때만(그 날 하루분). */
export function streakBonusXp(day: number, bonuses: StreakBonus[]): number {
  const found = bonuses.find((bonus) => bonus.day === day);
  return found ? found.xp : 0;
}

/** 지금 연속 일수에서 이미 달성한 가장 큰 보너스 (없으면 null) */
export function reachedStreakBonus(streak: number, bonuses: StreakBonus[]): StreakBonus | null {
  const passed = bonuses.filter((bonus) => bonus.day <= streak).sort((a, b) => b.day - a.day);
  return passed[0] ?? null;
}

/** 다음에 달성할 보너스 (없으면 null) */
export function nextStreakBonus(streak: number, bonuses: StreakBonus[]): StreakBonus | null {
  const upcoming = bonuses.filter((bonus) => bonus.day > streak).sort((a, b) => a.day - b.day);
  return upcoming[0] ?? null;
}

/** 그 아이가 타이머로 나눠 쓴 시간 합계(분) */
export function usedBonusMinutes(settings: AppSettings, memberId: string): number {
  return settings.timeUsage
    .filter((usage) => usage.member_id === memberId)
    .reduce((sum, usage) => sum + usage.minutes, 0);
}

/** 뽑기로 받은 시간에서 나눠 쓴 만큼을 뺀, 지금 쓸 수 있는 시간(분) */
export function remainingBonusMinutes(
  settings: AppSettings,
  memberId: string,
  unusedBonus: number,
): number {
  return Math.max(0, Math.round(unusedBonus) - usedBonusMinutes(settings, memberId));
}

/** 시간을 쓴 한 줄을 더한 새 설정 (타이머·직접 차감 모두) */
export function addTimeUsage(
  settings: AppSettings,
  memberId: string,
  minutes: number,
  mode: 'timer' | 'direct' = 'timer',
  reason?: string,
  now: Date = new Date(),
): AppSettings {
  const used = Math.max(1, Math.round(minutes));
  const record: TimeUsage = {
    id: `tu_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    member_id: memberId,
    minutes: used,
    at: now.toISOString(),
    mode,
    reason: reason?.trim() ? reason.trim().slice(0, 40) : undefined,
  };
  return { ...settings, timeUsage: [...settings.timeUsage, record].slice(-200) };
}
