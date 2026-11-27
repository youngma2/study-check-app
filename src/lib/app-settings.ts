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

/** 뽑기 보너스 시간을 나눠 쓴 한 줄 (타이머 시작) */
export interface TimeUsage {
  id: string;
  member_id: string;
  minutes: number;
  at: string;
}

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
  /** 🔥 버스트 타임이 지금 켜져 있는지 */
  burst: boolean;
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
          },
        ];
      })
    : [];

  return {
    version: 1,
    burst,
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

/** 완료한 시각이 버스트 타임 안인지 → 1 또는 2 */
export function burstMultiplierAt(iso: string | null | undefined, windows: BurstWindow[]): number {
  if (!iso || windows.length === 0) return 1;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 1;
  for (const window of windows) {
    const from = Date.parse(window.from);
    if (Number.isNaN(from)) continue;
    const to = window.to === null ? Infinity : Date.parse(window.to);
    if (Number.isNaN(to)) continue;
    if (time >= from && time <= to) return 2;
  }
  return 1;
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

/** 타이머 시작 한 줄을 더한 새 설정 */
export function addTimeUsage(
  settings: AppSettings,
  memberId: string,
  minutes: number,
  now: Date = new Date(),
): AppSettings {
  const used = Math.max(1, Math.round(minutes));
  const record: TimeUsage = {
    id: `tu_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    member_id: memberId,
    minutes: used,
    at: now.toISOString(),
  };
  return { ...settings, timeUsage: [...settings.timeUsage, record].slice(-200) };
}
