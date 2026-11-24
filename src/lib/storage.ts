import { SupabaseStorageAdapter, createSupabaseClient, isSupabaseConfigured } from './supabase';
import { loadLocalDB, saveLocalDB } from './store';
import type { StudyDB } from './types';

/**
 * 저장/동기화 경계.
 * UI 는 이 인터페이스만 알고, 데모(localStorage)와 클라우드(Supabase)를 갈아끼웁니다.
 */

export type StorageKind = 'local' | 'supabase';

export interface StorageAdapter {
  readonly kind: StorageKind;
  load(): Promise<StudyDB | null>;
  save(db: StudyDB): Promise<void>;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;

  async load(): Promise<StudyDB | null> {
    return loadLocalDB();
  }

  async save(db: StudyDB): Promise<void> {
    saveLocalDB(db);
  }
}

export function createStorageAdapter(): StorageAdapter {
  const client = isSupabaseConfigured() ? createSupabaseClient() : null;
  return client ? new SupabaseStorageAdapter(client) : new LocalStorageAdapter();
}
