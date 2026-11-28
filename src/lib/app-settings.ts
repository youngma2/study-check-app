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
  { key: 'semester', label: '학기중(평일)', emoji: '📚' },
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

/** '0'(일) ~ '6'(토) → 그 요일의 기본 공부 목록 (예전 저장 모양 — 읽을 때만 씁니다) */
export type WeekdayRoutine = Record<string, TaskPreset[]>;
/** memberId → 요일별 목록 (예전 저장 모양) */
export type MemberRoutines = Record<string, WeekdayRoutine>;

/**
 * 📚 프리셋의 기본 공부 항목 한 줄.
 * · days — 이 항목을 하는 요일(0=일 … 6=토). 화면에서 체크박스로 켜고 끕니다.
 * · order — 목록 순서(작을수록 위). 위·아래 버튼으로 바꿉니다.
 * · needParent — 부모(관리자) 확인이 필요한 항목(예: 독서록 아빠 검사).
 */
export interface RoutineItem {
  id: string;
  title: string;
  subject: string;
  days: number[];
  order: number;
  needParent?: boolean;
}

export interface RoutineSet {
  label: string;
  /** memberId → 그 아이의 기본 항목 목록 */
  items: Record<string, RoutineItem[]>;
}

/** 📅 월말 결산 기록 한 줄 — 그 달 마지막 최종 티어와 XP */
export interface Settlement {
  season: string;
  xp: number;
  title: string;
  tier: string;
  division: number;
  level: number;
  frozen_at: string;
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
  /** 🎁 선물 상자 개수 (1 ~ 5) — 상자를 열 때 이만큼 보여 줍니다. */
  boxCount: number;
  /** 🏆 티어 난이도(%) — 0 이 기본 기준, 값이 클수록 승급이 어려워집니다. */
  tierDifficulty: number;
  /** 🔥 자동 버스트 타임을 켠 날('YYYY-MM-DD') — 이 날 이전에는 소급 적용하지 않습니다. */
  burstAutoFrom: string | null;
  /** 🖼 아이 프로필 아이콘 바꾸기 (memberId → 이모지) */
  profileEmoji: Record<string, string>;
  /** 📅 월말 결산에 남긴 지난달 기록 (memberId → season → 결산) */
  settlements: Record<string, Record<string, Settlement>>;
}

export const DEFAULT_STREAK_BONUSES: StreakBonus[] = [
  { day: 3, xp: 30 },
  { day: 7, xp: 70 },
  { day: 14, xp: 140 },
  { day: 30, xp: 300 },
];

export const LOCAL_APP_SETTINGS_KEY = 'study-check.app-settings.v1';

/** 티어 난이도 버튼 — 기본(0%)이 기준이고 처음에는 +5% 로 시작합니다. */
export const TIER_DIFFICULTY_OPTIONS = [-10, -5, 0, 5, 10, 15, 20] as const;

function emptyRoutines(): Record<RoutineKey, RoutineSet> {
  return {
    semester: { label: '학기중(평일)', items: {} },
    vacation: { label: '방학', items: {} },
    exam: { label: '시험기간', items: {} },
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
    boxCount: 3,
    tierDifficulty: 5,
    burstAutoFrom: null,
    profileEmoji: {},
    settlements: {},
  };
}

/* ------------------------------------------------------------------ */
/* 값 다듬기                                                           */
/* ------------------------------------------------------------------ */

function isIsoLike(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && !Number.isNaN(Date.parse(value));
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function routineKey(item: { title: string; subject: string }): string {
  return `${item.title.trim()}::${item.subject}`;
}

/** 여러 목록을 합칩니다 — 같은 공부면 적용 요일을 합치고, 부모 확인 표시는 켜진 쪽을 따릅니다. */
export function mergeRoutineItems(base: RoutineItem[], extra: RoutineItem[]): RoutineItem[] {
  const out = base.map((item) => ({ ...item, days: [...item.days] }));
  const index = new Map(out.map((item) => [routineKey(item), item] as const));
  for (const item of extra) {
    const found = index.get(routineKey(item));
    if (found) {
      found.days = Array.from(new Set([...found.days, ...item.days])).sort((a, b) => a - b);
      if (item.needParent) found.needParent = true;
      continue;
    }
    const copy: RoutineItem = { ...item, days: [...item.days], order: out.length };
    index.set(routineKey(copy), copy);
    out.push(copy);
  }
  return out.map((item, order) => ({ ...item, order }));
}

function newRoutineId(): string {
  return `ri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 저장된 목록(새 모양 items 또는 예전 요일별 routines)을 항목 목록으로 읽습니다. */
function toRoutineItems(value: unknown): RoutineItem[] {
  const out: RoutineItem[] = [];
  const seen = new Map<string, RoutineItem>();

  const push = (raw: Partial<RoutineItem> & { title?: unknown; subject?: unknown }, days: number[]) => {
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 60) : '';
    if (!title) return;
    const subject = typeof raw.subject === 'string' && raw.subject ? raw.subject : 'etc';
    const key = `${title}::${subject}`;
    const found = seen.get(key);
    const safeDays = days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (found) {
      found.days = Array.from(new Set([...found.days, ...safeDays])).sort((a, b) => a - b);
      if (raw.needParent === true) found.needParent = true;
      return;
    }
    const item: RoutineItem = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newRoutineId(),
      title,
      subject,
      days: Array.from(new Set(safeDays)).sort((a, b) => a - b),
      order: out.length,
    };
    if (raw.needParent === true) item.needParent = true;
    seen.set(key, item);
    out.push(item);
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const raw = entry as Partial<RoutineItem>;
      const days = Array.isArray(raw.days)
        ? raw.days.filter((day): day is number => typeof day === 'number' && day >= 0 && day <= 6)
        : [];
      push(raw, days.length > 0 ? days : ALL_DAYS);
    }
    return out
      .map((item) => item)
      .sort((a, b) => a.order - b.order)
      .map((item, order) => ({ ...item, order }));
  }

  // 예전 모양: { '0': [...], '1': [...], ... } — 나온 요일을 적용 요일로 삼킵니다.
  if (value && typeof value === 'object') {
    const raw: RoutineItem[] = [];
    for (const day of [1, 2, 3, 4, 5, 6, 0]) {
      const list = (value as Record<string, unknown>)[String(day)];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Partial<TaskPreset>;
        if (typeof item.title !== 'string') continue;
        raw.push({
          id: newRoutineId(),
          title: item.title,
          subject: typeof item.subject === 'string' ? item.subject : 'etc',
          days: [day],
          order: raw.length,
        });
      }
    }
    for (const item of raw) push(item, item.days);
  }

  return out.map((item, order) => ({ ...item, order }));
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
      const value = entry as { items?: unknown; routines?: unknown };
      const items: Record<string, RoutineItem[]> = {};
      // 새 모양(items)을 먼저 읽고, 예전 모양(routines)이 있으면 합칩니다.
      if (value.items && typeof value.items === 'object') {
        for (const [memberId, list] of Object.entries(value.items as Record<string, unknown>)) {
          const parsed = toRoutineItems(list);
          if (parsed.length > 0) items[memberId] = parsed;
        }
      }
      if (value.routines && typeof value.routines === 'object') {
        for (const [memberId, weekdays] of Object.entries(value.routines as Record<string, unknown>)) {
          const parsed = toRoutineItems(weekdays);
          if (parsed.length === 0) continue;
          items[memberId] = mergeRoutineItems(items[memberId] ?? [], parsed);
        }
      }
      presets[preset.key] = { label: preset.label, items };
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

  const boxCount = typeof raw.boxCount === 'number' && Number.isFinite(raw.boxCount)
    ? Math.max(1, Math.min(5, Math.round(raw.boxCount)))
    : 3;

  const difficulty = typeof raw.tierDifficulty === 'number' && Number.isFinite(raw.tierDifficulty)
    ? Math.max(-10, Math.min(20, Math.round(raw.tierDifficulty)))
    : 5;

  const profileEmoji: Record<string, string> = {};
  if (raw.profileEmoji && typeof raw.profileEmoji === 'object') {
    for (const [memberId, emoji] of Object.entries(raw.profileEmoji as Record<string, unknown>)) {
      if (typeof emoji === 'string' && emoji.trim() && emoji.length <= 8) profileEmoji[memberId] = emoji;
    }
  }

  const settlements: Record<string, Record<string, Settlement>> = {};
  if (raw.settlements && typeof raw.settlements === 'object') {
    for (const [memberId, months] of Object.entries(raw.settlements as Record<string, unknown>)) {
      if (!months || typeof months !== 'object') continue;
      const kept: Record<string, Settlement> = {};
      for (const [season, entry] of Object.entries(months as Record<string, unknown>)) {
        if (!/^\d{4}-\d{2}$/.test(season) || !entry || typeof entry !== 'object') continue;
        const value = entry as Partial<Settlement>;
        if (typeof value.xp !== 'number' || !Number.isFinite(value.xp)) continue;
        if (typeof value.title !== 'string' || typeof value.tier !== 'string') continue;
        kept[season] = {
          season,
          xp: Math.max(0, Math.round(value.xp * 10) / 10),
          title: value.title,
          tier: value.tier,
          division: typeof value.division === 'number' ? value.division : 0,
          level: typeof value.level === 'number' ? value.level : 0,
          frozen_at: isIsoLike(value.frozen_at) ? value.frozen_at : new Date().toISOString(),
        };
      }
      if (Object.keys(kept).length > 0) settlements[memberId] = kept;
    }
  }

  const rawAutoFrom = typeof raw.burstAutoFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.burstAutoFrom)
    ? raw.burstAutoFrom
    : null;
  const burstAutoFrom = rawAutoFrom ?? (raw.burstAuto === true ? koreaISODateOf(new Date().toISOString()) : null);

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
    boxCount,
    tierDifficulty: difficulty,
    // 자동 버스트 타임은 켠 날부터만 적용합니다 — 날짜가 없던 예전 값은 오늘부터로 잡습니다.
    burstAutoFrom,
    profileEmoji,
    settlements,
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

/** 그 프리셋의 한 아이 기본 항목 목록 (저장된 순서대로) */
export function itemsForMember(
  settings: AppSettings,
  memberId: string,
  presetKey: RoutineKey = settings.activePreset,
): RoutineItem[] {
  const list = settings.presets[presetKey]?.items[memberId] ?? [];
  return [...list].sort((a, b) => a.order - b.order);
}

/** 한 아이·한 요일에 실제로 넣을 기본 목록 — 적용 요일이 맞는 항목만 순서대로 */
export function itemsForDay(
  settings: AppSettings,
  memberId: string,
  weekday: number,
  presetKey: RoutineKey = settings.activePreset,
): RoutineItem[] {
  return itemsForMember(settings, memberId, presetKey).filter((item) => item.days.includes(weekday));
}

/** 프리셋의 한 아이 목록을 통째로 바꾼 새 설정을 돌려줍니다(저장은 호출하는 쪽에서). */
export function withRoutineItems(
  settings: AppSettings,
  memberId: string,
  items: RoutineItem[],
  presetKey: RoutineKey = settings.activePreset,
): AppSettings {
  const preset = settings.presets[presetKey] ?? { label: presetKey, items: {} };
  const cleaned = items
    .map((item, order) => ({
      ...item,
      title: item.title.trim().slice(0, 60),
      days: Array.from(new Set(item.days.filter((day) => day >= 0 && day <= 6))).sort((a, b) => a - b),
      order,
    }))
    .filter((item) => item.title.length > 0);

  const nextItems = { ...preset.items };
  if (cleaned.length > 0) nextItems[memberId] = cleaned;
  else delete nextItems[memberId];

  return {
    ...settings,
    presets: { ...settings.presets, [presetKey]: { label: preset.label, items: nextItems } },
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
  settings: Pick<AppSettings, 'burstWindows' | 'burstAuto' | 'burstAutoDays'> & { burstAutoFrom?: string | null },
): boolean {
  if (settings.burstAuto && autoBurstOn(iso, settings.burstAutoDays, settings.burstAutoFrom ?? null)) return true;
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

/** 🔥 자동 버스트 타임 — 켠 날(from)부터, 월말까지 남은 일수가 days 보다 작으면 그 날은 켜집니다. */
export function autoBurstOn(iso: string, days: number, from: string | null = null): boolean {
  // 켜기 전 날짜에는 소급 적용하지 않습니다.
  if (from && iso < from) return false;
  return daysUntilMonthEnd(iso) < Math.max(1, Math.round(days));
}

/**
 * 완료한 시각의 버스트 배율 — 1 · 2 · 4.
 * · 수동(켜 둔 시간대)과 자동(월말)이 겹치면 overlap 이 켜져 있을 때만 4배, 아니면 2배 한 번입니다.
 */
export function burstMultiplierAt(
  iso: string | null | undefined,
  windows: BurstWindow[],
  options: { autoDays?: number; overlap?: boolean; autoFrom?: string | null } = {},
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
  const auto =
    autoDays > 0 && isoDate !== null && autoBurstOn(isoDate, autoDays, options.autoFrom ?? null);

  if (manual && auto) return options.overlap ? 4 : 2;
  return manual || auto ? 2 : 1;
}

/** 지금(오늘) 버스트 타임이 켜져 있는지 — 화면 배너에 씁니다. */
export function burstActiveToday(
  settings: Pick<AppSettings, 'burstWindows' | 'burstAuto' | 'burstAutoDays'> & { burstAutoFrom?: string | null },
  todayIso: string,
): boolean {
  // 자동은 날짜로 정해지고, 수동은 '지금 켜져 있는지(burst)' 로 봅니다.
  if (settings.burstAuto && autoBurstOn(todayIso, settings.burstAutoDays, settings.burstAutoFrom ?? null)) {
    return true;
  }
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
