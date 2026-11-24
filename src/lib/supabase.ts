import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { StorageAdapter, StorageKind } from './storage';
import type {
  Family,
  Member,
  MemberColor,
  Role,
  StudyDB,
  Task,
  TaskPreset,
  TaskStatus,
} from './types';

/**
 * Supabase 연결 (선택 사항).
 * .env.local 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 넣으면
 * storage.ts 가 자동으로 이 어댑터를 씁니다. 설정이 없으면 localStorage 로 동작합니다.
 *
 * 준비 순서는 README.md 를 보세요. 테이블/RLS 는 supabase/schema.sql 에 있습니다.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//.test(SUPABASE_URL));
}

export function createSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  return createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

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

function toMemberRow(member: Member): MemberRow {
  return {
    id: member.id,
    family_id: member.family_id,
    name: member.name,
    role: member.role,
    grade: member.grade ?? null,
    emoji: member.emoji,
    color: member.color,
    presets: member.presets,
    created_at: member.created_at,
  };
}

function toTaskRow(task: Task): TaskRow {
  return {
    id: task.id,
    family_id: task.family_id,
    member_id: task.member_id,
    title: task.title,
    subject: task.subject,
    due_date: task.due_date,
    status: task.status,
    note: task.note ?? null,
    created_by: task.created_by,
    created_at: task.created_at,
    verified_by: task.verified_by ?? null,
    verified_at: task.verified_at ?? null,
  };
}

export class SupabaseStorageAdapter implements StorageAdapter {
  readonly kind: StorageKind = 'supabase';

  constructor(private readonly client: SupabaseClient) {}

  /** 로그인한 사용자가 속한 가족의 데이터를 통째로 읽어 옵니다. (RLS 가 다른 가족을 막아 줍니다) */
  async load(): Promise<StudyDB | null> {
    const { data: sessionData } = await this.client.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return null;

    const { data: memberships, error: membershipError } = await this.client
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .limit(1);
    if (membershipError) throw membershipError;

    const familyId = memberships?.[0]?.family_id as string | undefined;
    if (!familyId) return null;

    const [familyRes, memberRes, taskRes] = await Promise.all([
      this.client.from('families').select('*').eq('id', familyId).single(),
      this.client.from('family_members').select('*').eq('family_id', familyId),
      this.client.from('tasks').select('*').eq('family_id', familyId),
    ]);

    if (familyRes.error) throw familyRes.error;
    if (memberRes.error) throw memberRes.error;
    if (taskRes.error) throw taskRes.error;

    return {
      version: 1,
      families: [toFamily(familyRes.data as FamilyRow)],
      members: ((memberRes.data ?? []) as MemberRow[]).map(toMember),
      tasks: ((taskRes.data ?? []) as TaskRow[]).map(toTask),
    };
  }

  /**
   * 스냅샷 동기화: 현재 상태를 upsert 하고, 사라진 항목만 지웁니다.
   * 한 가족 규모(수십 건)에서는 이 방식이 가장 단순하고 안전합니다.
   * 가족이 많아지면 작업 단위(per-row) mutation 으로 바꾸면 됩니다.
   */
  async save(db: StudyDB): Promise<void> {
    const family = db.families[0];
    if (!family) return;

    const familyRes = await this.client
      .from('families')
      .upsert({ id: family.id, name: family.name }, { onConflict: 'id' });
    if (familyRes.error) throw familyRes.error;

    if (db.members.length > 0) {
      const memberRes = await this.client
        .from('family_members')
        .upsert(db.members.map(toMemberRow), { onConflict: 'id' });
      if (memberRes.error) throw memberRes.error;
    }

    if (db.tasks.length > 0) {
      const taskRes = await this.client
        .from('tasks')
        .upsert(db.tasks.map(toTaskRow), { onConflict: 'id' });
      if (taskRes.error) throw taskRes.error;
    }

    const keepIds = db.tasks.map((task) => `"${task.id}"`).join(',');
    let removeQuery = this.client.from('tasks').delete().eq('family_id', family.id);
    if (keepIds.length > 0) {
      removeQuery = removeQuery.not('id', 'in', `(${keepIds})`);
    }
    const removeRes = await removeQuery;
    if (removeRes.error) throw removeRes.error;
  }
}
