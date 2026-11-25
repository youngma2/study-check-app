import { DEFAULT_REWARD_POOL, pickRewardMinutes, tierByRank, type TierKey } from './season';

/**
 * 🎁 티어 승급 기록 · 보상 뽑기 상자
 *
 * 승급 한 번 = 한 줄(family_tier_events). 큰 티어로 올라간 줄에는 상자(box_minutes)가 붙습니다.
 * 이 줄이 '이미 알린 승급'의 기억이라, 폰이 여러 대여도 같은 승급을 두 번 알리지 않습니다.
 * (클라우드에서는 Supabase 표가 원본, 데모 모드에서는 이 기기의 localStorage 가 원본)
 */

export interface TierEvent {
  id: string;
  family_id: string;
  member_id: string;
  /** 'YYYY-MM' */
  season: string;
  tier: TierKey;
  /** 1(브론즈) ~ 6(마스터) */
  tier_rank: number;
  /** 0 ~ 15 */
  level: number;
  /** 3 = III, 2 = II, 1 = I, 0 = 마스터 */
  division: number;
  /** 큰 티어 승급일 때 뽑힌 게임 시간(분). 세부 단계 승급은 null */
  box_minutes: number | null;
  created_at: string;
  opened_at: string | null;
  used_at: string | null;
  used_by: string | null;
}

export interface RewardSettings {
  /** 상자에서 나올 수 있는 게임 시간(분) 후보 */
  pool: number[];
  /** 큰 티어 승급(상자) 알림 */
  notify_box: boolean;
  /** 세부 단계 승급 알림 */
  notify_step: boolean;
}

export const DEFAULT_REWARD_SETTINGS: RewardSettings = {
  pool: [...DEFAULT_REWARD_POOL],
  notify_box: true,
  notify_step: true,
};

export const LOCAL_TIER_EVENTS_KEY = 'study-check.tier-events.v1';
export const LOCAL_REWARD_SETTINGS_KEY = 'study-check.reward-settings.v1';

/** 승급 한 칸의 id — 같은 아이·같은 달·같은 칸이면 언제나 같은 값(중복 방지). */
export function tierEventId(memberId: string, season: string, level: number): string {
  return `ev_${memberId}_${season}_${level}`;
}

export function sortTierEvents(events: TierEvent[]): TierEvent[] {
  return [...events].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
    return a.level - b.level;
  });
}

function isTierEvent(value: unknown): value is TierEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<TierEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.family_id === 'string' &&
    typeof event.member_id === 'string' &&
    typeof event.season === 'string' &&
    typeof event.tier === 'string' &&
    typeof event.tier_rank === 'number' &&
    typeof event.level === 'number' &&
    typeof event.created_at === 'string'
  );
}

export function normalizeSettings(value: unknown): RewardSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_REWARD_SETTINGS };
  const raw = value as Partial<RewardSettings>;
  const pool = Array.isArray(raw.pool)
    ? raw.pool
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
        .filter((item) => item >= 1 && item <= 120)
        .slice(0, 6)
    : [];
  return {
    pool: pool.length > 0 ? pool : [...DEFAULT_REWARD_POOL],
    notify_box: raw.notify_box !== false,
    notify_step: raw.notify_step !== false,
  };
}

/* ------------------------------------------------------------------ */
/* 데모(이 기기) 저장                                                   */
/* ------------------------------------------------------------------ */

export function loadLocalTierEvents(): TierEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_TIER_EVENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortTierEvents(parsed.filter(isTierEvent));
  } catch {
    return [];
  }
}

export function saveLocalTierEvents(events: TierEvent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_TIER_EVENTS_KEY, JSON.stringify(events.slice(-400)));
  } catch {
    /* 저장 공간이 없어도 화면은 그대로 쓸 수 있게 둡니다. */
  }
}

export function loadLocalRewardSettings(): RewardSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_REWARD_SETTINGS };
  try {
    const raw = window.localStorage.getItem(LOCAL_REWARD_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_REWARD_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REWARD_SETTINGS };
  }
}

export function saveLocalRewardSettings(settings: RewardSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_REWARD_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 무시 */
  }
}

/* ------------------------------------------------------------------ */
/* 데모 모드에서 승급 한 칸 만들기                                       */
/* ------------------------------------------------------------------ */

/**
 * 서버(study_tier_promotion)와 같은 규칙으로 한 줄을 만듭니다.
 * 큰 티어(브론즈→실버 …)면 상자를 함께 열어 줍니다.
 */
export function buildLocalTierEvent(options: {
  familyId: string;
  memberId: string;
  season: string;
  level: number;
  settings: RewardSettings;
}): TierEvent {
  const rank = Math.min(6, Math.floor(options.level / 3) + 1);
  const division = rank >= 6 ? 0 : 3 - (options.level % 3);
  const tier = tierByRank(rank);
  // 상자는 '큰 티어'가 바뀔 때만 — 실버 III(3), 골드 III(6), 플래티넘 III(9), 다이아 III(12), 마스터(15)
  const bigTier = rank >= 2 && options.level % 3 === 0;
  const minutes = bigTier ? pickRewardMinutes(options.settings.pool, rank) : null;
  return {
    id: tierEventId(options.memberId, options.season, options.level),
    family_id: options.familyId,
    member_id: options.memberId,
    season: options.season,
    tier: tier.key,
    tier_rank: tier.rank,
    level: options.level,
    division,
    box_minutes: minutes,
    created_at: new Date().toISOString(),
    opened_at: null,
    used_at: null,
    used_by: null,
  };
}
