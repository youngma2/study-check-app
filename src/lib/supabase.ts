import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RemoteEvent, StorageAdapter, StorageChange, StorageKind } from './storage';
import type { Family, FamilyNote, Member, MemberColor, Role, StudyDB, Task, TaskPreset, TaskStatus } from './types';
import { normalizeAppSettings, type AppSettings } from './app-settings';
import { normalizeSettings, type RewardSettings, type TierEvent } from './rewards';
import type { TierKey } from './season';

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

/** 서비스 워커에 넘길 공개 값(publishable 키 — 브라우저 번들에 이미 들어 있는 값입니다). */
export function supabasePublicConfig(): { url: string; anonKey: string } | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
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

interface FamilyNoteRow {
  id: string;
  family_id: string;
  author_id: string;
  /** 'jjokko' = 쪼꼬가 자동으로 올린 알림(티어 승급·부재중 전화 등) — supabase/notes-jjokko.sql */
  author_kind?: string | null;
  content: string;
  created_at: string;
  push_sent_at?: string | null;
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
  updated_at?: string | null;
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

function toNote(row: FamilyNoteRow): FamilyNote {
  return {
    id: row.id,
    family_id: row.family_id,
    author_id: row.author_id,
    author_kind: row.author_kind === 'jjokko' ? 'jjokko' : 'member',
    content: row.content,
    created_at: row.created_at,
  };
}

/** 알림판(💬 우리 가족 한마디) 실시간 변경 */
export type NotesRemoteEvent =
  | { kind: 'upsert'; note: FamilyNote }
  | { kind: 'delete'; noteId: string };

/* 🏆 시즌 티어 · 🎁 보상 뽑기 상자 (supabase/tier-season.sql) */

interface TierEventRow {
  id: string;
  family_id: string;
  member_id: string;
  season: string;
  tier: TierKey;
  tier_rank: number;
  level: number;
  division: number;
  box_minutes: number | null;
  created_at: string;
  opened_at: string | null;
  used_at: string | null;
  used_by: string | null;
}

function toTierEvent(row: TierEventRow): TierEvent {
  return {
    id: row.id,
    family_id: row.family_id,
    member_id: row.member_id,
    season: row.season,
    tier: (row.tier as TierKey) ?? 'bronze',
    tier_rank: row.tier_rank,
    level: row.level,
    division: row.division,
    box_minutes: row.box_minutes ?? null,
    created_at: row.created_at,
    opened_at: row.opened_at ?? null,
    used_at: row.used_at ?? null,
    used_by: row.used_by ?? null,
  };
}

/** 다른 기기에서 연 상자·사용 완료 표시 */
export type TierRemoteEvent =
  | { kind: 'upsert'; event: TierEvent }
  | { kind: 'delete'; eventId: string };

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
    updated_at: row.updated_at ?? null,
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
          // 완료 되돌리기(부모 전용)일 때 서버가 PIN 을 확인합니다. 그 밖에는 null 이라 무시됩니다.
          p_pin: change.fromStatus === 'verified' ? change.pin ?? null : null,
        });
        if (error) throw toUserError(error);
        return;
      }
      case 'delete': {
        const { error } = await this.client.rpc('study_delete_task', {
          p_actor_id: change.actorId,
          p_task_id: change.taskId,
          // 삭제는 부모 + 부모 관리 PIN 이 있어야 합니다.
          p_pin: change.pin ?? null,
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

  /* ---------------------------------------------------------------- */
  /* 💬 우리 가족 한마디 (family_notes)                                  */
  /* ---------------------------------------------------------------- */

  /**
   * 최근 한마디를 읽어 옵니다.
   * 표가 아직 없으면(설정 전) null 을 돌려줍니다 — 공부 목록 불러오기는 그대로 동작해야 하니까요.
   */
  async loadNotes(): Promise<FamilyNote[] | null> {
    const res = await this.client
      .from('family_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60)
      .retry(false);
    if (res.error) {
      if (isMissingSchema(res.error)) return null;
      throw toUserError(res.error);
    }
    return ((res.data ?? []) as FamilyNoteRow[]).map(toNote);
  }

  /** 한마디 남기기 — 가족이면 누구나(부모·아이) 쓸 수 있습니다. */
  async addNote(actorId: string, content: string, id: string): Promise<FamilyNote> {
    const { data, error } = await this.client.rpc('study_add_note', {
      p_actor_id: actorId,
      p_content: content,
      p_id: id,
    });
    if (error) throw toUserError(error);
    if (!data) throw new Error('한마디를 남기지 못했어요.');
    return toNote(data as FamilyNoteRow);
  }

  /**
   * 🐣 쪼꼬 명의로 한마디 남기기 — 100% 달성 축하처럼 앱이 스스로 남기는 글.
   * 서버 함수(study_add_jjokko_note)가 화면 표시를 '쪼꼬' 로 바꿔 두고, 알림은 가족 폰으로 갑니다.
   */
  async addJjokkoNote(actorId: string, content: string, id: string): Promise<FamilyNote> {
    const { data, error } = await this.client.rpc('study_add_jjokko_note', {
      p_actor_id: actorId,
      p_content: content,
      p_id: id,
    });
    if (error) throw toUserError(error);
    if (!data) throw new Error('한마디를 남기지 못했어요.');
    return toNote(data as FamilyNoteRow);
  }

  /** 한마디 지우기 — 내가 쓴 글, 또는 부모가 PIN 을 넣고 남의 글. (서버가 한 번 더 확인합니다) */
  async deleteNote(actorId: string, noteId: string, pin?: string | null): Promise<void> {
    const { error } = await this.client.rpc('study_delete_note', {
      p_actor_id: actorId,
      p_note_id: noteId,
      p_pin: pin ?? null,
    });
    if (error) throw toUserError(error);
  }

  /**
   * 알림판 실시간 구독 — tasks 와 따로 채널을 둡니다.
   * (family_notes 표가 아직 없을 때 이 채널만 조용히 비고, 공부 목록 구독은 영향을 받지 않습니다)
   */
  subscribeNotes(familyId: string, onEvent: (event: NotesRemoteEvent) => void): () => void {
    const channel = this.client
      .channel(`study-notes:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'family_notes', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string } | null)?.id;
            if (id) onEvent({ kind: 'delete', noteId: id });
            return;
          }
          const row = payload.new as FamilyNoteRow | null;
          if (row?.id) onEvent({ kind: 'upsert', note: toNote(row) });
        },
      )
      .subscribe();

    return () => {
      void this.client.removeChannel(channel);
    };
  }

  /* ---------------------------------------------------------------- */
  /* 🔔 백그라운드 알림 (Web Push)                                       */
  /* ---------------------------------------------------------------- */

  /** 앱이 읽는 알림 설정은 VAPID 공개키 한 줄뿐입니다(RLS 정책도 그 한 줄만 엽니다). */
  async loadPushPublicKey(): Promise<string | null> {
    const res = await this.client
      .from('push_config')
      .select('value')
      .eq('key', 'vapid_public_key')
      .limit(1);
    if (res.error) return null;
    const row = ((res.data ?? []) as Array<{ value: string }>)[0];
    return row?.value ?? null;
  }

  /**
   * 공개키가 없으면 알림 함수를 한 번 불러 키를 만들게 합니다.
   * (함수가 아직 배포 전이면 null — 앱은 '알림 준비 전'으로 조용히 넘어갑니다)
   */
  async ensurePushPublicKey(): Promise<string | null> {
    const stored = await this.loadPushPublicKey();
    if (stored) return stored;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-note-push`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { publicKey?: unknown };
        if (typeof data?.publicKey === 'string' && data.publicKey) return data.publicKey;
      }
    } catch {
      /* 함수 배포 전·오프라인 */
    }
    return this.loadPushPublicKey();
  }

  /** 이 기기를 알림 대상으로 등록합니다(같은 주소면 갱신). */
  async registerPushDevice(
    actorId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    userAgent?: string,
  ): Promise<void> {
    const { error } = await this.client.rpc('study_register_push', {
      p_actor_id: actorId,
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: userAgent ?? null,
    });
    if (error) throw toUserError(error);
  }

  /** 이 기기를 알림 대상에서 뺍니다. */
  async removePushDevice(actorId: string, endpoint: string): Promise<void> {
    const { error } = await this.client.rpc('study_delete_push', {
      p_actor_id: actorId,
      p_endpoint: endpoint,
    });
    if (error) throw toUserError(error);
  }

  /** 부모 관리 PIN 확인 — 서버(family_secrets 의 bcrypt 해시)에서만 판단합니다. */
  async verifyParentPin(familyId: string, pin: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('study_verify_parent_pin', {
      p_family_id: familyId,
      p_pin: pin,
    });
    if (error) throw toUserError(error);
    return data === true;
  }

  /* ---------------------------------------------------------------- */
  /* 🏆 시즌 티어 · 🎁 보상 뽑기 상자                                     */
  /* ---------------------------------------------------------------- */

  /** 승급 기록 — 표가 아직 없으면(설정 전) null. */
  async loadTierEvents(): Promise<TierEvent[] | null> {
    const res = await this.client
      .from('family_tier_events')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(400)
      .retry(false);
    if (res.error) {
      if (isMissingSchema(res.error)) return null;
      throw toUserError(res.error);
    }
    return ((res.data ?? []) as TierEventRow[]).map(toTierEvent);
  }

  async loadRewardSettings(familyId: string): Promise<RewardSettings | null> {
    const res = await this.client
      .from('family_reward_settings')
      .select('pool, notify_box, notify_step')
      .eq('family_id', familyId)
      .limit(1)
      .retry(false);
    if (res.error) {
      if (isMissingSchema(res.error)) return null;
      throw toUserError(res.error);
    }
    const row = ((res.data ?? []) as Array<Partial<RewardSettings>>)[0];
    return normalizeSettings(row ?? {});
  }

  /**
   * 승급 한 칸 기록. 큰 티어면 서버가 상자와 축하 한마디(=폰 푸시)를 함께 만듭니다.
   * 같은 칸은 한 번만 만들어져서, 폰이 여러 대여도 알림이 중복되지 않습니다.
   */
  async tierPromotion(
    actorId: string,
    memberId: string,
    season: string,
    level: number,
    notify: boolean,
  ): Promise<{ created: boolean; noted: boolean; event: TierEvent | null }> {
    const { data, error } = await this.client.rpc('study_tier_promotion', {
      p_actor_id: actorId,
      p_member_id: memberId,
      p_season: season,
      p_level: level,
      p_notify: notify,
    });
    if (error) throw toUserError(error);
    const payload = (data ?? {}) as { created?: boolean; noted?: boolean; event?: TierEventRow | null };
    return {
      created: payload.created === true,
      noted: payload.noted === true,
      event: payload.event ? toTierEvent(payload.event) : null,
    };
  }

  async openReward(actorId: string, eventId: string): Promise<TierEvent> {
    const { data, error } = await this.client.rpc('study_open_reward', {
      p_actor_id: actorId,
      p_event_id: eventId,
    });
    if (error) throw toUserError(error);
    if (!data) throw new Error('상자를 열지 못했어요.');
    return toTierEvent(data as TierEventRow);
  }

  async useReward(actorId: string, eventId: string, pin?: string | null): Promise<TierEvent> {
    const { data, error } = await this.client.rpc('study_use_reward', {
      p_actor_id: actorId,
      p_event_id: eventId,
      p_pin: pin ?? null,
    });
    if (error) throw toUserError(error);
    if (!data) throw new Error('적립 완료로 바꾸지 못했어요.');
    return toTierEvent(data as TierEventRow);
  }

  async saveRewardSettings(actorId: string, settings: RewardSettings, pin?: string | null): Promise<RewardSettings> {
    const { data, error } = await this.client.rpc('study_set_reward_settings', {
      p_actor_id: actorId,
      p_pool: settings.pool,
      p_notify_box: settings.notify_box,
      p_notify_step: settings.notify_step,
      p_pin: pin ?? null,
    });
    if (error) throw toUserError(error);
    const row = (data ?? {}) as Partial<RewardSettings> & { pool?: number[] | null };
    return normalizeSettings({ ...settings, ...row, pool: row.pool ?? settings.pool });
  }

  /** 승급 기록·상자 변경을 실시간으로 받습니다. */
  subscribeTierEvents(familyId: string, onEvent: (event: TierRemoteEvent) => void): () => void {
    const channel = this.client
      .channel(`study-tier:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'family_tier_events', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string } | null)?.id;
            if (id) onEvent({ kind: 'delete', eventId: id });
            return;
          }
          const row = payload.new as TierEventRow | null;
          if (row?.id) onEvent({ kind: 'upsert', event: toTierEvent(row) });
        },
      )
      .subscribe();

    return () => {
      void this.client.removeChannel(channel);
    };
  }

  /* ---------------------------------------------------------------- */
  /* ⚙️ 가족 설정 (기본 목록·버스트 타임·연속 보너스·타이머 기록)            */
  /* ---------------------------------------------------------------- */

  /**
   * 가족 설정을 읽어 옵니다.
   * `family_app_settings` 표가 아직 없으면(설정 전) `available:false` 를 돌려주고,
   * 앱은 이 기기(localStorage) 값으로 계속 동작합니다 — 에러를 던지지 않습니다.
   */
  async loadAppSettings(familyId: string): Promise<{ available: boolean; settings: AppSettings | null }> {
    const res = await this.client
      .from('family_app_settings')
      .select('settings')
      .eq('family_id', familyId)
      .limit(1)
      .retry(false);
    if (res.error) {
      if (isMissingSchema(res.error)) {
        return { available: false, settings: null };
      }
      throw toUserError(res.error);
    }
    const row = ((res.data ?? []) as Array<{ settings?: unknown }>)[0];
    // 표는 있는데 아직 저장된 줄이 없으면(null) 이 폰의 설정을 그대로 씁니다.
    return { available: true, settings: row ? normalizeAppSettings(row.settings) : null };
  }

  /** 가족 설정 저장 — 부모 + PIN 이 있어야 합니다(서버가 한 번 더 확인). */
  async saveAppSettings(actorId: string, settings: AppSettings, pin?: string | null): Promise<AppSettings> {
    const { data, error } = await this.client.rpc('study_set_app_settings', {
      p_actor_id: actorId,
      p_settings: settings,
      p_pin: pin ?? null,
    });
    if (error) throw toUserError(error);
    const payload = (data ?? {}) as { settings?: unknown };
    return normalizeAppSettings(payload.settings ?? payload);
  }

  /** 다른 폰에서 버스트 타임을 켜거나 기본 목록을 바꾸면 바로 반영합니다. */
  subscribeAppSettings(familyId: string, onSettings: (settings: AppSettings) => void): () => void {
    const channel = this.client
      .channel(`study-settings:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'family_app_settings', filter: `family_id=eq.${familyId}` },
        (payload) => {
          const row = payload.new as { settings?: unknown } | null;
          if (row && 'settings' in row) onSettings(normalizeAppSettings(row.settings));
        },
      )
      .subscribe();

    return () => {
      void this.client.removeChannel(channel);
    };
  }

  /**
   * 구성원 이름 바꾸기 — 부모 + PIN. (아이디는 그대로라 링크·숙제가 유지됩니다)
   */  async renameMember(actorId: string, memberId: string, name: string, pin: string): Promise<Member> {
    const { data, error } = await this.client.rpc('study_rename_member', {
      p_actor_id: actorId,
      p_member_id: memberId,
      p_name: name,
      p_pin: pin,
    });
    if (error) throw toUserError(error);
    if (!data) throw new Error('이름을 바꾸지 못했어요.');
    return toMember(data as MemberRow);
  }

  /**
   * 🆕 새 프로필(구성원) 만들기 — 부모 + PIN.
   * schema.sql 을 다시 실행해 `study_add_member` 함수가 들어 있으면 표에 구성원을 만들고,
   * 아직 없으면 null 을 돌려줍니다(앱은 가족 설정 JSON 만으로 그대로 동작).
   */
  async addMember(
    actorId: string,
    member: { id: string; name: string; role: 'parent' | 'child'; emoji: string },
    pin: string | null,
  ): Promise<Member | null> {
    const { data, error } = await this.client.rpc('study_add_member', {
      p_actor_id: actorId,
      p_member_id: member.id,
      p_name: member.name,
      p_role: member.role,
      p_emoji: member.emoji,
      p_pin: pin ?? null,
    });
    if (error) {
      if (isMissingSchema(error)) return null;
      throw toUserError(error);
    }
    return data ? toMember(data as MemberRow) : null;
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
