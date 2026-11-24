import { formatTimeKo, todayISO, toISODate, addDays } from './date';
import type { FamilyNote } from './types';

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

export function newNoteId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
