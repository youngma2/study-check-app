import { loadLocalDB, saveLocalDB } from './store';
import type { Family, Member, StudyDB, Task, TaskStatus } from './types';

/**
 * 저장/동기화 경계.
 * UI 는 이 인터페이스만 알고, 기기 저장(local)과 클라우드(Supabase)를 갈아끼웁니다.
 *
 * 앱은 화면을 먼저 바꾸고(낙관적 반영) 아래 save() 로 한 건씩 서버에 보냅니다.
 * Supabase 쪽은 표를 직접 고치지 않고 RPC(study_*)로만 쓰기 때문에,
 * 부모/아이 권한을 DB 에서도 한 번 더 검사합니다.
 */

export type StorageKind = 'local' | 'supabase';

export type StorageChange =
  | { type: 'add'; actorId: string; task: Task }
  | { type: 'update'; actorId: string; task: Task }
  | { type: 'status'; actorId: string; task: Task; status: TaskStatus }
  | { type: 'delete'; actorId: string; taskId: string }
  | { type: 'reset'; actorId: string };

/** 실시간 채널 상태 */
export type RealtimeState = 'off' | 'connecting' | 'live' | 'error';

/** 다른 기기에서 일어난 변경(Realtime) */
export type RemoteEvent =
  | { kind: 'task'; event: 'upsert'; task: Task }
  | { kind: 'task'; event: 'delete'; taskId: string }
  | { kind: 'member'; event: 'upsert'; member: Member }
  | { kind: 'member'; event: 'delete'; memberId: string }
  | { kind: 'family'; event: 'upsert'; family: Family }
  | { kind: 'family'; event: 'delete'; familyId: string }
  | { kind: 'status'; state: RealtimeState };

export interface StorageAdapter {
  readonly kind: StorageKind;
  load(): Promise<StudyDB | null>;
  save(db: StudyDB, change: StorageChange): Promise<void>;
  /** 실시간 구독(있으면). 반환값은 구독 해제 함수입니다. */
  subscribe?(familyId: string, onEvent: (event: RemoteEvent) => void): () => void;
}

/* ------------------------------------------------------------------ */
/* 기기 저장(localStorage)                                              */
/* ------------------------------------------------------------------ */

export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;

  async load(): Promise<StudyDB | null> {
    return loadLocalDB();
  }

  async save(db: StudyDB, _change?: StorageChange): Promise<void> {
    saveLocalDB(db);
  }
}
