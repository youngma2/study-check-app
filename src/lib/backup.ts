import { normalizeAppSettings, type AppSettings } from './app-settings';
import { koreaISODateOf } from './date';
import { normalizeSettings, type RewardSettings, type TierEvent } from './rewards';
import type { FamilyNote, StudyDB } from './types';

/**
 * 💾 데이터 백업·복원 (4차 7번)
 *
 * 옵션 → `[폰에 백업 저장(.json)]` 은 지금 이 폰이 보고 있는 것을 **파일 하나**로 내려받습니다.
 *   · 공부 기록(db.tasks) · 구성원 · 한마디 · 가족 설정(옵션) · 뽑기/티어 기록
 * `[백업 파일로 복원]` 은 그 파일을 다시 읽어 되돌립니다.
 *   · 이 기기 저장(데모) 모드: 공부 기록까지 그대로 되돌립니다.
 *   · 가족 DB(Supabase) 모드: 가족 DB 가 원본이라 옵션(설정)만 되돌립니다.
 *
 * 추후 `.apk` + 구글 로그인을 붙이면 **구글 드라이브 백업 / 폰 로컬 저장 중 본인이 고르기** 로 넓힐 계획입니다.
 */

export interface BackupFile {
  app: 'study-check';
  version: 1;
  exported_at: string;
  db?: StudyDB;
  appSettings?: AppSettings;
  rewardSettings?: RewardSettings;
  notes?: FamilyNote[];
  tierEvents?: TierEvent[];
}

export const BACKUP_APP = 'study-check';

/** 백업 파일 내용을 만듭니다. */
export function buildBackup(input: {
  db: StudyDB;
  appSettings: AppSettings;
  rewardSettings: RewardSettings;
  notes: FamilyNote[];
  tierEvents: TierEvent[];
  now?: Date;
}): BackupFile {
  return {
    app: BACKUP_APP,
    version: 1,
    exported_at: (input.now ?? new Date()).toISOString(),
    db: input.db,
    appSettings: input.appSettings,
    rewardSettings: input.rewardSettings,
    notes: input.notes,
    tierEvents: input.tierEvents.map((event) => ({ ...event })),
  };
}

/** 백업 파일 이름 — study-check-백업-2026-11-29.json (한국 날짜 기준) */
export function backupFileName(now: Date = new Date()): string {
  const stamp = koreaISODateOf(now.toISOString()) ?? now.toISOString().slice(0, 10);
  return `study-check-백업-${stamp}.json`;
}

/** 내려받은 파일을 읽어 안전한 모양으로 맞춥니다. 잘못된 파일이면 null. */
export function parseBackup(text: string): BackupFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<BackupFile>;
  if (raw.app !== BACKUP_APP) return null;

  const db = raw.db && typeof raw.db === 'object' && Array.isArray((raw.db as StudyDB).tasks) ? (raw.db as StudyDB) : undefined;
  if (!db) return null;

  const notes = Array.isArray(raw.notes)
    ? raw.notes.flatMap((note) => {
        if (!note || typeof note !== 'object') return [];
        const item = note as Partial<FamilyNote>;
        if (typeof item.id !== 'string' || typeof item.content !== 'string') return [];
        if (typeof item.created_at !== 'string' || typeof item.author_id !== 'string') return [];
        return [
          {
            id: item.id,
            family_id: typeof item.family_id === 'string' ? item.family_id : '',
            author_id: item.author_id,
            author_kind: item.author_kind === 'jjokko' ? ('jjokko' as const) : ('member' as const),
            content: item.content,
            created_at: item.created_at,
          },
        ];
      })
    : [];

  const tierEvents = Array.isArray(raw.tierEvents)
    ? raw.tierEvents.flatMap((event) => {
        if (!event || typeof event !== 'object') return [];
        const item = event as Partial<TierEvent>;
        if (typeof item.id !== 'string' || typeof item.member_id !== 'string') return [];
        if (typeof item.season !== 'string' || typeof item.tier !== 'string') return [];
        return [item as TierEvent];
      })
    : [];

  return {
    app: BACKUP_APP,
    version: 1,
    exported_at: typeof raw.exported_at === 'string' ? raw.exported_at : new Date().toISOString(),
    db,
    appSettings: normalizeAppSettings(raw.appSettings),
    rewardSettings: raw.rewardSettings ? normalizeSettings(raw.rewardSettings) : undefined,
    notes,
    tierEvents,
  };
}

/** 브라우저에서 파일 하나를 내려받게 합니다. */
export function downloadJson(fileName: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
