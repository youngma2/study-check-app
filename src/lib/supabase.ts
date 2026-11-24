import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RemoteEvent, StorageAdapter, StorageChange, StorageKind } from './storage';
import type { Family, Member, MemberColor, Role, StudyDB, Task, TaskPreset, TaskStatus } from './types';

/**
 * Supabase 연결 (가족 실시간 동기화).
 *
 * · 로그인 없이 동작합니다. publishable(anon) 키는 공개 클라이언트 키라 번들에 들어가도 됩니다.
 * · 읽기는 RLS 로 열려 있고, 쓰기는 전부 study_* RPC 로만 합니다.
 *   RPC 가 '누가(actor)' 를 받아 부모/아이 권한을 DB 에서 한 번 더 검사합니다.
 * · tasks / family_members / families 변경은 Realtime 으로 즉시 다른 폰에 전달됩니다.
 *
 * 준비: README.md 5번, 테이블/RPC/시드는 supabase/schema.sql.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//.test(SUPABASE_URL));
}

/** 아직 SQL(schema.sql)을 실행하지 않았을 때. 앱은 안내 문구를 보여 주고 기기 저장으로 계속 동작합니다. */
export class StorageSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageSetupError';
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  if (typeof error === 'string') return error;
  return '잠시 후 다시 시도해 주세요.';
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883';
}

function toUserError(error: unknown): Error {
  if (isMissingSchema(error)) {
    return new StorageSetupError('Supabase에 공부 체크 표가 아직 없어요. schema.sql을 한 번 실행해 주세요.');
  }
  return new Error(messageOf(error));
}

export function createSupabaseAdapter(): SupabaseStorageAdapter | null {
  if (!isSupabaseConfigured()) return null;
  const client = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseStorageAdapter(client);
}

/* ------------------------------------------------------------------ */
/* 행 ↔ 도메인 매핑                                                     */
/* ------------------------------------------------------------------ */

interface FamilyRow {
  id: string;
  name: string;
  created_at: string;
}

interface MemberRow {
  id: string;
  family_id: string;
  name: string;
  role: Role;
  grade: string | null;
  emoji: string;
  color: MemberColor;
  presets: unknown;
  created_at: string;
}

interface TaskRow {
  id: string;
  family_id: string;
  member_id: string;
  title: string;
  subject: string;
  due_date: string;
  status: TaskStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  verified_by: string | null;
  verified_at: string | null;
}

function toPresets(value: unknown): TaskPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const preset = item as Partial<TaskPreset>;
    if (typeof preset.title !== 'string' || typeof preset.subject !== 'string') return [];
    return [{ title: preset.title, subject: preset.subject }];
  });
}

function toFamily(row: FamilyRow): Family {
  return { id: row.id, name: row.name, created_at: row.created_at };
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    family_id: row.family_id,
    name: row.name,
    role: row.role,
    grade: row.grade ?? undefined,
    emoji: row.emoji,
    color: row.color,
    presets: toPresets(row.presets),
    created_at: row.created_at,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    family_id: row.family_id,
    member_id: row.member_id,
    title: row.title,
    subject: row.subject,
    due_date: row.due_date,
    status: row.status,
    note: row.note ?? undefined,
    created_by: row.created_by ?? row.member_id,
    created_at: row.created_at,
    verified_by: row.verified_by,
    verified_at: row.verified_at,
  };
}

/* ------------------------------------------------------------------ */
/* 어댑터                                                              */
/* ------------------------------------------------------------------ */

export class SupabaseStorageAdapter implements StorageAdapter {
  readonly kind: StorageKind = 'supabase';

  constructor(private readonly client: SupabaseClient) {}

  /** 가족 전체(가족 1 + 구성원 + 숙제)를 읽어 옵니다. 표가 없으면 StorageSetupError. */
  async load(): Promise<StudyDB | null> {
    const familyRes = await this.client
      .from('families')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .retry(false); // 첫 로딩은 빨리 실패해야 안내/캐시로 바로 넘어갈 수 있습니다.
    if (familyRes.error) throw toUserError(familyRes.error);

    const familyRow = ((familyRes.data ?? []) as FamilyRow[])[0];
    if (!familyRow) return null; // 표는 있는데 가족이 아직 없음

    const [memberRes, taskRes] = await Promise.all([
      this.client.from('family_members').select('*').eq('family_id', familyRow.id).order('created_at', { ascending: true }),
      this.client.from('tasks').select('*').eq('family_id', familyRow.id).order('created_at', { ascending: true }),
    ]);
    if (memberRes.error) throw toUserError(memberRes.error);
    if (taskRes.error) throw toUserError(taskRes.error);

    return {
      version: 1,
      families: [toFamily(familyRow)],
      members: ((memberRes.data ?? []) as MemberRow[]).map(toMember),
      tasks: ((taskRes.data ?? []) as TaskRow[]).map(toTask),
    };
  }

  /** 한 건씩 서버에 반영합니다(전체 덮어쓰기 없음). */
  async save(_db: StudyDB, change: StorageChange): Promise<void> {
    switch (change.type) {
      case 'add': {
        const task = change.task;
        const { error } = await this.client.rpc('study_add_task', {
          p_actor_id: change.actorId,
          p_member_id: task.member_id,
          p_title: task.title,
          p_subject: task.subject,
          p_due_date: task.due_date,
          p_note: task.note ?? null,
          p_id: task.id,
        });
        if (error) throw toUserError(error);
        return;
      }
      case 'update': {
        const task = change.task;
        const { error } = await this.client.rpc('study_update_task', {
          p_actor_id: change.actorId,
          p_task_id: task.id,
          p_title: task.title,
          p_subject: task.subject,
          p_due_date: task.due_date,
          p_note: task.note ?? null,
        });
        if (error) throw toUserError(error);
        return;
      }
      case 'status': {
        const { error } = await this.client.rpc('study_set_task_status', {
          p_actor_id: change.actorId,
          p_task_id: change.task.id,
          p_status: change.status,
        });
        if (error) throw toUserError(error);
        return;
      }
      case 'delete': {
        const { error } = await this.client.rpc('study_delete_task', {
          p_actor_id: change.actorId,
          p_task_id: change.taskId,
        });
        if (error) throw toUserError(error);
        return;
      }
      case 'reset':
        throw new Error('클라우드 모드에서는 샘플 초기화를 쓰지 않아요.');
      default:
        return;
    }
  }

  /** 가족 데이터 변경을 실시간으로 받습니다. */
  subscribe(familyId: string, onEvent: (event: RemoteEvent) => void): () => void {
    const channel = this.client
      .channel(`study:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string } | null)?.id;
            if (id) onEvent({ kind: 'task', event: 'delete', taskId: id });
            return;
          }
          const row = payload.new as TaskRow | null;
          if (row?.id) onEvent({ kind: 'task', event: 'upsert', task: toTask(row) });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'family_members', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string } | null)?.id;
            if (id) onEvent({ kind: 'member', event: 'delete', memberId: id });
            return;
          }
          const row = payload.new as MemberRow | null;
          if (row?.id) onEvent({ kind: 'member', event: 'upsert', member: toMember(row) });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'families', filter: `id=eq.${familyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            onEvent({ kind: 'family', event: 'delete', familyId });
            return;
          }
          const row = payload.new as FamilyRow | null;
          if (row?.id) onEvent({ kind: 'family', event: 'upsert', family: toFamily(row) });
        },
      )
      .subscribe((status) => {
        const state =
          status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting';
        onEvent({ kind: 'status', state });
      });

    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
