import { formatTimeKo, koreaTodayISO, todayISO, toISODate, addDays } from './date';
import type { FamilyNote, Member } from './types';

/**
 * 💬 우리 가족 한마디 — 기기 저장(데모) 모드에서 쓰는 작은 저장소와 공통 도우미.
 *
 * Supabase 를 연결하면 notes 는 서버 표(family_notes)가 원본이 되고,
 * 여기 있는 localStorage 는 '마지막으로 받은 한마디' 캐시로만 쓰입니다.
 * (연결이 잠깐 끊겨도 알림판이 비어 보이지 않게)
 */

export const LOCAL_NOTES_KEY = 'study-check.notes.v1';
export const NOTES_SEEN_KEY = 'study-check.notes-seen.v1';
export const NOTE_MAX_LENGTH = 300;

/*
 * 🐣 쪼꼬가 자동으로 남기는 한마디(티어 승급 · 부재중 전화 등)
 *
 * DB 에는 쓴 사람을 부모로 두고(`author_kind = 'jjokko'`) 화면에서만 '쪼꼬' 로 보여 줍니다.
 * 그래야 알림이 모든 가족 폰(아이 폰 포함)으로 갑니다.
 * 예전 글은 본문이 `🐣 쪼꼬: …` 로 시작하는 경우가 있어 그것도 같은 쪼꼬 글로 알아봅니다.
 */
export const JJOKKO_NAME = '쪼꼬';
export const JJOKKO_EMOJI = '🐣';
const JJOKKO_PREFIX = /^\s*(?:🐣\s*)?쪼꼬\s*[:：]\s*/;

/** 쪼꼬가 남긴 자동 알림 글인가? */
export function isJjokkoNote(note: Pick<FamilyNote, 'author_kind' | 'content'>): boolean {
  if (note.author_kind === 'jjokko') return true;
  return JJOKKO_PREFIX.test(note.content ?? '');
}

/** 화면에 보여 줄 본문 — 쪼꼬 글은 배지가 이름을 알려 주니 본문 앞의 `🐣 쪼꼬:` 는 덜어냅니다. */
export function noteBody(note: Pick<FamilyNote, 'author_kind' | 'content'>): string {
  const text = note.content ?? '';
  if (!isJjokkoNote(note)) return text;
  const stripped = text.replace(JJOKKO_PREFIX, '').trim();
  return stripped || text;
}

/** 화면에 보여 줄 작성자 이름 (자동 알림은 '쪼꼬'). */
export function noteAuthorName(
  note: Pick<FamilyNote, 'author_id' | 'author_kind' | 'content'>,
  members: Member[],
): string {
  if (isJjokkoNote(note)) return JJOKKO_NAME;
  return members.find((member) => member.id === note.author_id)?.name ?? '가족';
}

export type NotesState = 'loading' | 'ready' | 'unavailable';

function isNote(value: unknown): value is FamilyNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<FamilyNote>;
  return (
    typeof note.id === 'string' &&
    typeof note.family_id === 'string' &&
    typeof note.author_id === 'string' &&
    typeof note.content === 'string' &&
    typeof note.created_at === 'string'
  );
}

export function loadLocalNotes(): FamilyNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_NOTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortNotes(parsed.filter(isNote));
  } catch {
    return [];
  }
}

export function saveLocalNotes(notes: FamilyNote[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.slice(0, 60)));
  } catch {
    // 사생활 보호 모드·용량 초과: 화면은 그대로 쓰게 두고 조용히 넘어갑니다.
  }
}

export function loadNotesSeenAt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(NOTES_SEEN_KEY);
  } catch {
    return null;
  }
}

export function saveNotesSeenAt(iso: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTES_SEEN_KEY, iso);
  } catch {
    /* 무시 */
  }
}

/** 서버가 주는 형식(+00:00)과 기기가 만든 형식(Z)이 섞여도 안전하게 비교하려고 숫자로 바꿉니다. */
export function noteTime(note: Pick<FamilyNote, 'created_at'> | string): number {
  const iso = typeof note === 'string' ? note : note.created_at;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
}

export function sortNotes(notes: FamilyNote[]): FamilyNote[] {
  return [...notes].sort((a, b) => noteTime(b) - noteTime(a));
}

/** 새 한마디 id. 날짜를 아는 경우 `n_2026-11-25_...` 처럼 날짜를 함께 박아 둡니다. */
export function newNoteId(dateIso?: string): string {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return dateIso ? `n_${dateIso}_${suffix}` : `n_${suffix}`;
}

/** id 에 박아 둔 날짜(`n_2026-11-25_…`) — 예전 글은 한국 날짜 기준 작성일로 셉니다. */
const NOTE_ID_DATE = /^n_(\d{4}-\d{2}-\d{2})_/;

/**
 * 이 한마디가 어느 날짜의 알림판에 붙는지 'YYYY-MM-DD' 로 돌려줍니다.
 * 날짜별로 알림판을 따로 보여 주는 기준입니다.
 */
export function noteDate(note: Pick<FamilyNote, 'id' | 'created_at'>): string {
  const fromId = NOTE_ID_DATE.exec(note.id);
  if (fromId) return fromId[1];
  const created = new Date(note.created_at);
  if (Number.isNaN(created.getTime())) return koreaTodayISO();
  return koreaTodayISO(created);
}

/** '방금', '12분 전', '오후 8:12', '어제 오후 8:12', '11/20 오후 8:12' */
export function formatNoteTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 60_000) return '방금';
  if (diff >= 0 && diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;

  const time = formatTimeKo(iso) ?? '';
  const dayIso = toISODate(date);
  if (dayIso === todayISO()) return time;
  if (dayIso === toISODate(addDays(now, -1))) return `어제 ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
