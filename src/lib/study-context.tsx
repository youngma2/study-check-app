import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createContext } from 'react';
import {
  PermissionError,
  addTask as addTaskPure,
  changeTaskStatus,
  childrenOf,
  createDemoDB,
  createInitialDB,
  deleteTask as deleteTaskPure,
  editTask as editTaskPure,
  familyOf,
  loadCloudCache,
  loadCurrentMemberId,
  parentsOf,
  renameMember as renameMemberPure,
  saveCloudCache,
  saveCurrentMemberId,
  sortTasks,
  summarize,
  type TaskPatch,
  type TaskSummary,
} from './store';
import {
  clearSessionPin,
  hasLocalPin,
  isPinFormat,
  readSessionPin,
  setLocalPin,
  verifyLocalPin,
  writeSessionPin,
} from './pin';
import {
  LOCAL_NOTES_KEY,
  NOTE_MAX_LENGTH,
  loadLocalNotes,
  loadNotesSeenAt,
  newNoteId,
  noteTime,
  saveLocalNotes,
  saveNotesSeenAt,
  sortNotes,
  type NotesState,
} from './notes';
import { LocalStorageAdapter, type RemoteEvent, type RealtimeState, type StorageChange, type StorageKind } from './storage';
import { enablePushNotifications, syncPushRegistration } from './push';
import { StorageSetupError, createSupabaseAdapter, type NotesRemoteEvent } from './supabase';
import { koreaTodayISO } from './date';
import {
  computePastSeason,
  computeSeasonStats,
  previousSeason,
  seasonOf,
  type SeasonStats,
  type TierLevel,
} from './season';
import {
  DEFAULT_REWARD_SETTINGS,
  buildLocalTierEvent,
  loadLocalRewardSettings,
  loadLocalTierEvents,
  normalizeSettings,
  saveLocalRewardSettings,
  saveLocalTierEvents,
  sortTierEvents,
  tierEventId,
  type RewardSettings,
  type TierEvent,
} from './rewards';
import type { FamilyNote, Member, NewTaskInput, StudyDB, Task, TaskStatus } from './types';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'setup' | 'error';

export interface CopyResult extends ActionResult {
  created: number;
  skipped: number;
}

export interface StudyContextValue {
  db: StudyDB;
  familyName: string;
  members: Member[];
  parents: Member[];
  children: Member[];
  currentMember: Member;
  isParent: boolean;
  storageKind: StorageKind;
  syncState: SyncState;
  realtimeState: RealtimeState;
  /** 부모 관리 PIN 잠금이 풀렸는지 (이번 탭에서) */
  parentUnlocked: boolean;
  /** 이 기기(데모)에서 처음 PIN 을 정해야 하는지 */
  parentPinSetupRequired: boolean;
  unlockParent: (pin: string) => Promise<ActionResult>;
  setParentPin: (pin: string) => Promise<ActionResult>;
  lockParent: () => void;
  setCurrentMember: (memberId: string) => void;
  /** 💬 우리 가족 한마디 — 최근 한마디 (새 글 먼저) */
  notes: FamilyNote[];
  /** 'unavailable' = Supabase 에 family_notes 표가 아직 없음(설정 전) */
  notesState: NotesState;
  /** 내가 마지막으로 본 뒤에 다른 사람이 남긴 한마디 */
  unseenNotes: FamilyNote[];
  markNotesSeen: () => void;
  addNote: (content: string, dateIso?: string) => Promise<ActionResult>;
  deleteNote: (noteId: string) => Promise<ActionResult>;
  /** 🔔 백그라운드 알림 켜기 — 알림 권한 요청 + 이 기기를 가족 알림에 등록 */
  enablePush: () => Promise<ActionResult>;
  /** 🏆 이번 달 시즌 기록(티어·XP·연속 100%) — 아이만 있습니다. */
  seasonStatsFor: (memberId: string) => SeasonStats | undefined;
  /** 지난달 최고 티어 — 기록이 없으면 null */
  lastSeasonFor: (memberId: string) => { season: string; xp: number; level: TierLevel } | null;
  /** 승급 기록 — 큰 티어 승급 줄에 뽑기 상자(box_minutes)가 붙어 있습니다. */
  tierEvents: TierEvent[];
  tierEventsFor: (memberId: string) => TierEvent[];
  tierEventsState: 'loading' | 'ready' | 'unavailable';
  /** 🎁 보상 설정(뽑기 풀·알림) */
  rewardSettings: RewardSettings;
  openReward: (eventId: string) => Promise<ActionResult>;
  useReward: (eventId: string) => Promise<ActionResult>;
  saveRewardSettings: (patch: Partial<RewardSettings>) => Promise<ActionResult>;
  tasksFor: (memberId: string, dateIso: string) => Task[];
  summaryFor: (memberId: string, dateIso: string) => TaskSummary;
  addTask: (input: NewTaskInput) => Promise<ActionResult>;
  editTask: (taskId: string, patch: TaskPatch) => Promise<ActionResult>;
  setStatus: (taskId: string, status: TaskStatus) => Promise<ActionResult>;
  removeTask: (taskId: string) => Promise<ActionResult>;
  copyTasks: (taskIds: string[], dates: string[]) => Promise<CopyResult>;
  renameMember: (memberId: string, name: string) => Promise<ActionResult>;
  resetDemo: () => Promise<ActionResult>;
}

const StudyContext = createContext<StudyContextValue | null>(null);

function resolveInitialMemberId(db: StudyDB): string {
  const fromHash =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.hash.replace(/^#/, '')).get('as')
      : null;
  const stored = loadCurrentMemberId();

  for (const candidate of [fromHash, stored]) {
    if (candidate && db.members.some((member) => member.id === candidate)) return candidate;
  }
  const parent = db.members.find((member) => member.role === 'parent');
  return parent?.id ?? db.members[0].id;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '잠시 후 다시 시도해 주세요.';
}

/** 두 스냅샷을 비교해 '이번에 바뀐 한 건'을 서버에 보낼 형태로 만듭니다. */
function changeBetween(prev: StudyDB, next: StudyDB, actorId: string): StorageChange | null {
  const before = new Map(prev.tasks.map((task) => [task.id, task] as const));
  let added: Task | null = null;
  let changed: StorageChange | null = null;

  for (const task of next.tasks) {
    const old = before.get(task.id);
    before.delete(task.id);
    if (!old) {
      added = added ?? task;
      continue;
    }
    if (old !== task && !changed) {
      changed =
        old.status !== task.status
          ? { type: 'status', actorId, task, status: task.status, fromStatus: old.status }
          : { type: 'update', actorId, task };
    }
  }

  if (added) return { type: 'add', actorId, task: added };
  const removed = before.keys().next();
  if (!removed.done) return { type: 'delete', actorId, taskId: removed.value };
  return changed;
}

export function StudyProvider({ children }: { children: ReactNode }) {
  const local = useMemo(() => new LocalStorageAdapter(), []);
  const cloud = useMemo(() => createSupabaseAdapter(), []);

  // 클라우드를 쓰는 기기는 마지막으로 받은 목록을 먼저 보여 줍니다(연결 중·끊김에도 샘플이 아니라 진짜 목록).
  const [db, setDb] = useState<StudyDB>(() => (cloud ? loadCloudCache() ?? createInitialDB() : createInitialDB()));
  const dbRef = useRef(db);
  dbRef.current = db;

  const [currentMemberId, setCurrentMemberIdState] = useState<string>(() =>
    resolveInitialMemberId(dbRef.current),
  );
  const currentMemberIdRef = useRef(currentMemberId);
  currentMemberIdRef.current = currentMemberId;

  const [mode, setMode] = useState<StorageKind>('local');
  const modeRef = useRef<StorageKind>('local');
  const [syncState, setSyncStateState] = useState<SyncState>(cloud ? 'syncing' : 'local');
  const syncStateRef = useRef<SyncState>(cloud ? 'syncing' : 'local');
  const setSyncState = useCallback((next: SyncState) => {
    syncStateRef.current = next;
    setSyncStateState(next);
  }, []);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('off');
  const [attempt, setAttempt] = useState(0);

  // 부모 관리 PIN — 잠금을 푼 PIN 은 이번 탭(sessionStorage)에만 둡니다.
  const [sessionPin, setSessionPinState] = useState<string | null>(() => readSessionPin());
  const sessionPinRef = useRef<string | null>(sessionPin);
  sessionPinRef.current = sessionPin;
  const [localPinReady, setLocalPinReady] = useState<boolean>(() => hasLocalPin());

  useEffect(() => {
    saveCurrentMemberId(currentMemberId);
  }, [currentMemberId]);

  const applyDb = useCallback((next: StudyDB) => {
    dbRef.current = next;
    setDb(next);
    setCurrentMemberIdState((prev) =>
      next.members.some((member) => member.id === prev)
        ? prev
        : next.members.find((member) => member.role === 'parent')?.id ?? next.members[0]?.id ?? prev,
    );
  }, []);

  /* ---------------------------------------------------------------- */
  /* 💬 우리 가족 한마디 (알림판)                                        */
  /* ---------------------------------------------------------------- */

  // 기기에 남아 있던 한마디를 먼저 보여 주고, 클라우드에 연결되면 서버 것이 원본이 됩니다.
  const [notes, setNotes] = useState<FamilyNote[]>(() => loadLocalNotes());
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const [notesState, setNotesState] = useState<NotesState>(() => (cloud ? 'loading' : 'ready'));
  const notesStateRef = useRef<NotesState>(notesState);
  notesStateRef.current = notesState;
  const [notesSeenAt, setNotesSeenAtState] = useState<string | null>(() => loadNotesSeenAt());
  const notesFamilyId = db.families[0]?.id;

  // 서버(family_notes)에서 최근 한마디를 읽어 옵니다. 표가 없으면 알림판만 '준비 중'이 되고
  // 공부 목록 불러오기·동기화는 그대로 동작합니다.
  useEffect(() => {
    if (!cloud) {
      setNotesState('ready');
      return;
    }
    if (syncState === 'setup') {
      setNotesState('unavailable');
      return;
    }
    if (mode !== 'supabase' || syncState !== 'synced') return;

    let alive = true;
    setNotesState((prev) => (prev === 'ready' ? prev : 'loading'));
    cloud
      .loadNotes()
      .then((remote) => {
        if (!alive) return;
        if (remote === null) {
          setNotesState('unavailable');
          return;
        }
        const sorted = sortNotes(remote);
        notesRef.current = sorted;
        setNotes(sorted);
        saveLocalNotes(sorted);
        setNotesState('ready');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        console.warn('[study-check] 알림판 불러오기 실패', error);
        setNotesState(notesRef.current.length > 0 ? 'ready' : 'unavailable');
      });

    return () => {
      alive = false;
    };
  }, [cloud, mode, syncState]);

  // 데모(기기 저장) 모드: 같은 폰의 다른 탭에서 남긴 한마디도 바로 보이게 합니다.
  useEffect(() => {
    if (cloud) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== LOCAL_NOTES_KEY) return;
      const next = loadLocalNotes();
      notesRef.current = next;
      setNotes(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [cloud]);

  /** 다른 기기에서 올라온 한마디를 즉시 반영합니다(내가 쓴 것은 이미 화면에 있어 id 로 합칩니다). */
  const applyNoteRemote = useCallback((event: NotesRemoteEvent) => {
    const prev = notesRef.current;
    const next =
      event.kind === 'delete'
        ? prev.filter((note) => note.id !== event.noteId)
        : prev.some((note) => note.id === event.note.id)
          ? prev.map((note) => (note.id === event.note.id ? event.note : note))
          : sortNotes([event.note, ...prev]);

    notesRef.current = next;
    setNotes(next);
    saveLocalNotes(next);
    if (notesStateRef.current !== 'ready') setNotesState('ready');
  }, []);

  useEffect(() => {
    if (!cloud || mode !== 'supabase' || syncState !== 'synced' || notesState !== 'ready' || !notesFamilyId) return;
    return cloud.subscribeNotes(notesFamilyId, applyNoteRemote);
  }, [cloud, mode, syncState, notesState, notesFamilyId, applyNoteRemote]);

  /** 알림판에 한마디 남기기 — 부모·아이 누구나. dateIso 를 주면 그 날짜 알림판에 붙습니다. */
  const addNote = useCallback(
    async (content: string, dateIso?: string): Promise<ActionResult> => {
      const text = content.trim();
      if (!text) return { ok: false, error: '남길 말을 적어 주세요.' };
      if (text.length > NOTE_MAX_LENGTH) {
        return { ok: false, error: `한마디는 ${NOTE_MAX_LENGTH}자까지 적을 수 있어요.` };
      }

      const current = dbRef.current;
      const actor =
        current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

      const useCloud = cloud !== null;
      if (useCloud && modeRef.current !== 'supabase') {
        return { ok: false, error: '가족 동기화에 연결된 뒤에 남길 수 있어요. 잠시 뒤 다시 시도해 주세요.' };
      }
      if (useCloud && notesStateRef.current !== 'ready') {
        return { ok: false, error: '알림판이 아직 준비 중이에요. 잠시 뒤 다시 시도해 주세요.' };
      }

      const id = newNoteId(dateIso);
      const note: FamilyNote = {
        id,
        family_id: actor.family_id,
        author_id: actor.id,
        content: text,
        created_at: new Date().toISOString(),
      };
      const optimistic = sortNotes([note, ...notesRef.current]);
      notesRef.current = optimistic;
      setNotes(optimistic);

      if (!useCloud || !cloud) {
        saveLocalNotes(optimistic);
        return { ok: true };
      }

      try {
        const saved = await cloud.addNote(actor.id, text, id);
        const merged = sortNotes([
          saved,
          ...notesRef.current.filter((item) => item.id !== saved.id && item.id !== id),
        ]);
        notesRef.current = merged;
        setNotes(merged);
        saveLocalNotes(merged);
        return { ok: true };
      } catch (error) {
        const reverted = notesRef.current.filter((item) => item.id !== id);
        notesRef.current = reverted;
        setNotes(reverted);
        return { ok: false, error: messageOf(error) };
      }
    },
    [cloud],
  );

  /** 한마디 지우기 — 내가 쓴 글, 또는 부모가 PIN 을 넣고 남의 글. */
  const deleteNote = useCallback(
    async (noteId: string): Promise<ActionResult> => {
      const note = notesRef.current.find((item) => item.id === noteId);
      if (!note) return { ok: false, error: '한마디를 찾지 못했어요.' };

      const current = dbRef.current;
      const actor =
        current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

      const mine = note.author_id === actor.id;
      if (!mine && actor.role !== 'parent') {
        return { ok: false, error: '내가 쓴 한마디만 지울 수 있어요.' };
      }
      if (!mine && !sessionPinRef.current) {
        return { ok: false, error: '부모 관리 PIN 잠금을 먼저 풀어 주세요.' };
      }

      const useCloud = cloud !== null;
      if (useCloud && modeRef.current !== 'supabase') {
        return { ok: false, error: '가족 동기화에 연결된 뒤에 지울 수 있어요. 잠시 뒤 다시 시도해 주세요.' };
      }

      const before = notesRef.current;
      const next = before.filter((item) => item.id !== noteId);
      notesRef.current = next;
      setNotes(next);

      if (!useCloud) {
        saveLocalNotes(next);
        return { ok: true };
      }

      try {
        await cloud.deleteNote(actor.id, noteId, sessionPinRef.current);
        saveLocalNotes(next);
        return { ok: true };
      } catch (error) {
        notesRef.current = before;
        setNotes(before);
        return { ok: false, error: messageOf(error) };
      }
    },
    [cloud],
  );

  /** 🔔 백그라운드 알림 켜기 — 앱을 닫아 둬도 새 한마디가 폰 알림으로 오게 합니다. */
  const enablePush = useCallback(async (): Promise<ActionResult> => {
    const current = dbRef.current;
    const actor =
      current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
    if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

    const result = await enablePushNotifications(cloud, actor.id);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }, [cloud]);

  // 알림을 이미 허용해 둔 기기는 앱을 열 때마다 조용히 다시 등록합니다.
  // (예전에 '알림 켜기'만 눌렀던 폰도, 구독이 바뀐 폰도 스스로 회복됩니다)
  useEffect(() => {
    if (!cloud || mode !== 'supabase' || syncState !== 'synced') return;
    const current = dbRef.current;
    const actor =
      current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
    if (!actor) return;
    void syncPushRegistration(cloud, actor.id);
  }, [cloud, mode, syncState, currentMemberId]);

  /* ---------------------------------------------------------------- */
  /* 🏆 월간 시즌 티어 · 🎁 보상 쭕기 상자                                */
  /* ---------------------------------------------------------------- */

  const [tierEvents, setTierEvents] = useState<TierEvent[]>(() => (cloud ? [] : loadLocalTierEvents()));
  const tierEventsRef = useRef<TierEvent[]>(tierEvents);
  tierEventsRef.current = tierEvents;
  const [tierEventsState, setTierEventsState] = useState<'loading' | 'ready' | 'unavailable'>(
    cloud ? 'loading' : 'ready',
  );

  const [rewardSettings, setRewardSettingsState] = useState<RewardSettings>(() =>
    cloud ? { ...DEFAULT_REWARD_SETTINGS } : loadLocalRewardSettings(),
  );
  const rewardSettingsRef = useRef<RewardSettings>(rewardSettings);
  rewardSettingsRef.current = rewardSettings;

  const applyTierEvents = useCallback(
    (next: TierEvent[]) => {
      tierEventsRef.current = next;
      setTierEvents(next);
      if (!cloud) saveLocalTierEvents(next);
    },
    [cloud],
  );

  // 승급 기록을 불러옵니다(표가 아직 없으면 'unavailable' — 티어 표시는 그대로 동작합니다).
  useEffect(() => {
    if (!cloud) {
      setTierEventsState('ready');
      return;
    }
    if (syncState === 'setup') {
      setTierEventsState('unavailable');
      return;
    }
    if (mode !== 'supabase' || syncState !== 'synced') return;

    let alive = true;
    cloud
      .loadTierEvents()
      .then((remote) => {
        if (!alive) return;
        if (remote === null) {
          setTierEventsState('unavailable');
          return;
        }
        const sorted = sortTierEvents(remote);
        tierEventsRef.current = sorted;
        setTierEvents(sorted);
        setTierEventsState('ready');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        console.warn('[study-check] 티어 기록 불러오기 실패', error);
        setTierEventsState('unavailable');
      });

    const familyId = dbRef.current.families[0]?.id;
    if (familyId) {
      cloud
        .loadRewardSettings(familyId)
        .then((settings) => {
          if (!alive || !settings) return;
          rewardSettingsRef.current = settings;
          setRewardSettingsState(settings);
        })
        .catch(() => {
          /* 설정은 기본값으로 계속 씁니다. */
        });
    }

    return () => {
      alive = false;
    };
  }, [cloud, mode, syncState]);

  // 다른 폰에서 상자를 열거나 사용 완료하면 바로 반영합니다.
  useEffect(() => {
    if (!cloud || mode !== 'supabase' || syncState !== 'synced' || tierEventsState !== 'ready') return;
    const familyId = dbRef.current.families[0]?.id;
    if (!familyId) return;
    return cloud.subscribeTierEvents(familyId, (event) => {
      const prev = tierEventsRef.current;
      const next =
        event.kind === 'delete'
          ? prev.filter((item) => item.id !== event.eventId)
          : prev.some((item) => item.id === event.event.id)
            ? prev.map((item) => (item.id === event.event.id ? event.event : item))
            : sortTierEvents([...prev, event.event]);
      tierEventsRef.current = next;
      setTierEvents(next);
    });
  }, [cloud, mode, syncState, tierEventsState]);

  /** 이번 달(오늘까지) 아이별 시즌 기록 — 공부 목록이 바뀌면 같이 다시 셈합니다. */
  const seasonStats = useMemo(() => {
    const map: Record<string, SeasonStats> = {};
    const today = koreaTodayISO();
    for (const member of db.members) {
      if (member.role !== 'child') continue;
      map[member.id] = computeSeasonStats(db.tasks, member.id, today);
    }
    return map;
  }, [db]);

  /** 지난달 최고 기록 — 배지로만 보여 줍니다. */
  const lastSeasonStats = useMemo(() => {
    const map: Record<string, { season: string; xp: number; level: TierLevel }> = {};
    const season = previousSeason(seasonOf(koreaTodayISO()));
    for (const member of db.members) {
      if (member.role !== 'child') continue;
      const past = computePastSeason(db.tasks, member.id, season);
      if (past.xp > 0) map[member.id] = { season, xp: past.xp, level: past.level };
    }
    return map;
  }, [db]);

  /** 진행 중인 승급 기록을 중복으로 보내지 않기 위한 잠금 */
  const promotingRef = useRef<Set<string>>(new Set());

  /**
   * 승급 한 칸을 기록합니다.
   * · 큰 티어(실버·골드…)면 서버가 뽑기 상자와 축하 한마디(=폰 푸시)를 함께 만듭니다.
   * · 같은 칸은 id 가 같아서, 폰이 여러 대여도 알림은 한 번만 갑니다.
   */
  const promoteTier = useCallback(
    async (member: Member, season: string, level: number, notify: boolean) => {
      const key = `${member.id}:${season}:${level}`;
      if (promotingRef.current.has(key)) return;
      promotingRef.current.add(key);

      const settings = rewardSettingsRef.current;
      const rank = Math.min(6, Math.floor(level / 3) + 1);
      const shouldNotify = notify && (rank >= 2 ? settings.notify_box : settings.notify_step);
      const useCloud = cloud !== null && modeRef.current === 'supabase';

      try {
        if (!useCloud) {
          const id = tierEventId(member.id, season, level);
          if (tierEventsRef.current.some((event) => event.id === id)) return;
          const event = buildLocalTierEvent({
            familyId: member.family_id,
            memberId: member.id,
            season,
            level,
            settings,
          });
          applyTierEvents(sortTierEvents([...tierEventsRef.current, event]));
          return;
        }

        const current = dbRef.current;
        const actor =
          current.members.find((item) => item.id === currentMemberIdRef.current) ?? current.members[0];
        if (!actor) return;

        const result = await cloud.tierPromotion(actor.id, member.id, season, level, shouldNotify);
        const saved = result.event;
        if (saved) {
          const others = tierEventsRef.current.filter((event) => event.id !== saved.id);
          const next = sortTierEvents([...others, saved]);
          tierEventsRef.current = next;
          setTierEvents(next);
        }
      } catch (error) {
        console.warn('[study-check] 티어 승급 기록 실패', error);
      } finally {
        promotingRef.current.delete(key);
      }
    },
    [applyTierEvents, cloud],
  );

  // 티어가 올랐는데 기록이 없으면 한 칸씩 남깁니다(놓친 칸은 알림 없이 채우고, 마지막 칸만 알립니다).
  useEffect(() => {
    if (tierEventsState !== 'ready') return;
    if (cloud && syncState !== 'synced') return;

    for (const member of db.members) {
      if (member.role !== 'child') continue;
      const stats = seasonStats[member.id];
      if (!stats) continue;
      // 0 = 브론즈 III(모두의 시작 칸)라서 승급으로 치지 않습니다.
      const known = tierEventsRef.current.reduce(
        (max, event) =>
          event.member_id === member.id && event.season === stats.season ? Math.max(max, event.level) : max,
        0,
      );
      if (stats.level.index <= known) continue;
      for (let level = known + 1; level <= stats.level.index; level += 1) {
        void promoteTier(member, stats.season, level, level === stats.level.index);
      }
    }
  }, [db, seasonStats, tierEvents, tierEventsState, syncState, cloud, promoteTier]);

  /** 🎁 상자 열기 — 뽑힌 보상은 이미 정해져 있어서 어느 폰에서 열어도 같은 값입니다. */
  const openReward = useCallback(
    async (eventId: string): Promise<ActionResult> => {
      const before = tierEventsRef.current;
      const target = before.find((event) => event.id === eventId);
      if (!target) return { ok: false, error: '상자를 찾지 못했어요.' };
      if (target.opened_at) return { ok: true };

      const current = dbRef.current;
      const actor =
        current.members.find((item) => item.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

      applyTierEvents(
        before.map((event) =>
          event.id === eventId ? { ...event, opened_at: new Date().toISOString() } : event,
        ),
      );

      if (modeRef.current !== 'supabase' || !cloud) return { ok: true };

      try {
        const saved = await cloud.openReward(actor.id, eventId);
        const next = tierEventsRef.current.map((event) => (event.id === eventId ? saved : event));
        tierEventsRef.current = next;
        setTierEvents(next);
        return { ok: true };
      } catch (error) {
        applyTierEvents(before);
        return { ok: false, error: messageOf(error) };
      }
    },
    [applyTierEvents, cloud],
  );

  /** ✅ 보상 사용 완료 — 부모(PIN 인증) 만. */
  const useReward = useCallback(
    async (eventId: string): Promise<ActionResult> => {
      const before = tierEventsRef.current;
      const target = before.find((event) => event.id === eventId);
      if (!target) return { ok: false, error: '보상을 찾지 못했어요.' };

      const current = dbRef.current;
      const actor =
        current.members.find((item) => item.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };
      if (actor.role !== 'parent') return { ok: false, error: '보상 사용 처리는 부모님만 할 수 있어요.' };

      const pin = sessionPinRef.current;
      if (modeRef.current === 'supabase' && !pin) {
        return { ok: false, error: '부모 관리 PIN 잠금을 먼저 풀어 주세요.' };
      }

      applyTierEvents(
        before.map((event) =>
          event.id === eventId
            ? { ...event, used_at: new Date().toISOString(), used_by: actor.id }
            : event,
        ),
      );

      if (modeRef.current !== 'supabase' || !cloud) return { ok: true };

      try {
        const saved = await cloud.useReward(actor.id, eventId, pin);
        const next = tierEventsRef.current.map((event) => (event.id === eventId ? saved : event));
        tierEventsRef.current = next;
        setTierEvents(next);
        return { ok: true };
      } catch (error) {
        applyTierEvents(before);
        return { ok: false, error: messageOf(error) };
      }
    },
    [applyTierEvents, cloud],
  );

  /** ⚙️ 보상 설정(뽑기 풀·알림) — 부모(PIN 인증) 만. */
  const saveRewardSettings = useCallback(
    async (patch: Partial<RewardSettings>): Promise<ActionResult> => {
      const next = normalizeSettings({ ...rewardSettingsRef.current, ...patch });
      const current = dbRef.current;
      const actor =
        current.members.find((item) => item.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

      if (modeRef.current === 'supabase' && cloud) {
        if (actor.role !== 'parent') return { ok: false, error: '보상 설정은 부모님만 바꿀 수 있어요.' };
        const pin = sessionPinRef.current;
        if (!pin) return { ok: false, error: '부모 관리 PIN 잠금을 먼저 풀어 주세요.' };
        try {
          const saved = await cloud.saveRewardSettings(actor.id, next, pin);
          rewardSettingsRef.current = saved;
          setRewardSettingsState(saved);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: messageOf(error) };
        }
      }

      rewardSettingsRef.current = next;
      setRewardSettingsState(next);
      saveLocalRewardSettings(next);
      return { ok: true };
    },
    [cloud],
  );

  const seasonStatsFor = useCallback((memberId: string) => seasonStats[memberId], [seasonStats]);
  const lastSeasonFor = useCallback((memberId: string) => lastSeasonStats[memberId] ?? null, [lastSeasonStats]);
  const tierEventsFor = useCallback(
    (memberId: string) => tierEvents.filter((event) => event.member_id === memberId),
    [tierEvents],
  );

  /** 지금까지 본 가장 최근 한마디 시각을 기억해, 다음에 새 글만 알려 줍니다. */
  const markNotesSeen = useCallback(() => {
    const latest = notesRef.current.reduce((max, note) => Math.max(max, noteTime(note)), 0);
    if (latest === 0) return;
    const iso = new Date(latest).toISOString();
    saveNotesSeenAt(iso);
    setNotesSeenAtState(iso);
  }, []);

  // 클라우드 설정이 있으면 가족 데이터를 한 번 받아 옵니다.
  // 표가 아직 없으면(설정 전) 이 기기 저장으로 계속 쓸 수 있게 두고 안내만 합니다.
  // 연결이 끊긴 경우(error)에는 마지막으로 받은 목록을 보여 주고 8초마다 다시 시도합니다.
  useEffect(() => {
    if (!cloud) {
      setSyncState('local');
      return;
    }
    let alive = true;
    if (attempt === 0) setSyncState('syncing');

    cloud
      .load()
      .then((remote) => {
        if (!alive) return;
        if (remote && remote.members.length > 0) {
          applyDb(remote);
          saveCloudCache(remote);
          modeRef.current = 'supabase';
          setMode('supabase');
          setSyncState('synced');
        } else {
          setSyncState('setup');
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        console.warn('[study-check] Supabase 불러오기 실패', error);
        if (error instanceof StorageSetupError) {
          setSyncState('setup');
          return;
        }
        const cached = attempt === 0 ? loadCloudCache() : null;
        if (cached) applyDb(cached);
        setSyncState('error');
      });

    return () => {
      alive = false;
    };
  }, [cloud, applyDb, attempt, setSyncState]);

  // 연결이 끊겼을 때 스스로 회복하도록 잠시 뒤 다시 불러옵니다.
  useEffect(() => {
    if (!cloud || syncState !== 'error') return;
    const timer = window.setTimeout(() => setAttempt((value) => value + 1), 8000);
    return () => window.clearTimeout(timer);
  }, [cloud, syncState]);

  /** 다른 폰에서 바뀐 내용을 즉시 반영합니다. */
  const applyRemote = useCallback(
    (event: RemoteEvent) => {
      if (event.kind === 'status') {
        setRealtimeState(event.state);
        return;
      }

      const prev = dbRef.current;
      let next = prev;

      switch (event.kind) {
        case 'task':
          next =
            event.event === 'delete'
              ? { ...prev, tasks: prev.tasks.filter((task) => task.id !== event.taskId) }
              : prev.tasks.some((task) => task.id === event.task.id)
                ? { ...prev, tasks: prev.tasks.map((task) => (task.id === event.task.id ? event.task : task)) }
                : { ...prev, tasks: [...prev.tasks, event.task] };
          break;        case 'member':
          next =
            event.event === 'delete'
              ? { ...prev, members: prev.members.filter((member) => member.id !== event.memberId) }
              : prev.members.some((member) => member.id === event.member.id)
                ? { ...prev, members: prev.members.map((member) => (member.id === event.member.id ? event.member : member)) }
                : { ...prev, members: [...prev.members, event.member] };
          break;
        case 'family':
          next =
            event.event === 'delete'
              ? prev
              : prev.families.some((family) => family.id === event.family.id)
                ? { ...prev, families: prev.families.map((family) => (family.id === event.family.id ? event.family : family)) }
                : { ...prev, families: [...prev.families, event.family] };
          break;
      }

      if (next !== prev) {
        dbRef.current = next;
        setDb(next);
        if (!next.members.some((member) => member.id === currentMemberIdRef.current) && next.members[0]) {
          setCurrentMemberIdState(next.members[0].id);
        }
      }
    },
    [],
  );

  // 실시간 구독 (로그인이 아니라 가족 단위 채널입니다)
  const familyId = db.families[0]?.id;
  useEffect(() => {
    if (!cloud?.subscribe || mode !== 'supabase' || syncState !== 'synced' || !familyId) return;
    setRealtimeState('connecting');
    const unsubscribe = cloud.subscribe(familyId, applyRemote);
    return () => {
      unsubscribe();
      setRealtimeState('off');
    };
  }, [cloud, mode, syncState, familyId, applyRemote]);

  /** 최신 스냅샷을 한 번 다시 받아 옵니다(실시간으로 놓친 변경을 메우는 용도). */
  const refreshFromCloud = useCallback(() => {
    if (!cloud) return;
    void cloud
      .load()
      .then((remote) => {
        if (remote && remote.members.length > 0) {
          applyDb(remote);
          saveCloudCache(remote);
        }
      })
      .catch(() => {
        /* 조용히 넘어갑니다. 다음 기회에 다시 맞춥니다. */
      });
  }, [cloud, applyDb]);

  // 폰에서 앱을 다시 열었을 때(백그라운드 동안 놓친 변경) 최신 목록으로 맞춥니다.
  useEffect(() => {
    if (!cloud || mode !== 'supabase' || syncState !== 'synced') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshFromCloud();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [cloud, mode, syncState, refreshFromCloud]);

  // 실시간 채널이 끊겼다가 다시 붙으면 놓친 변경을 받아 옵니다.
  const prevRealtime = useRef<RealtimeState>('off');
  useEffect(() => {
    const was = prevRealtime.current;
    prevRealtime.current = realtimeState;
    if (was === 'error' && realtimeState === 'live') refreshFromCloud();
  }, [realtimeState, refreshFromCloud]);

  /**
   * 화면을 먼저 바꾸고(낙관적 반영) 서버에 한 건만 보냅니다.
   * 서버가 거부하면(권한 등) 원래 상태로 되돌리고 이유를 돌려줍니다.
   */
  const run = useCallback(
    async (mutate: (current: StudyDB, actor: Member) => StudyDB): Promise<ActionResult> => {
      if (cloud && syncStateRef.current === 'error') {
        return { ok: false, error: '클라우드에 연결하지 못해 지금은 저장할 수 없어요. 연결되면 다시 시도해 주세요.' };
      }
      const current = dbRef.current;
      const actor =
        current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

      let next: StudyDB;
      try {
        next = mutate(current, actor);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      if (next === current) return { ok: true };

      const change = changeBetween(current, next, actor.id);
      dbRef.current = next;
      setDb(next);
      if (!change) return { ok: true };

      // 완료 되돌리기·삭제는 부모 관리 PIN 이 필요한 동작입니다. 이번 세션의 PIN 을 함께 보냅니다.
      if (change.type === 'delete' || (change.type === 'status' && change.fromStatus === 'verified')) {
        if (!sessionPinRef.current) {
          dbRef.current = current;
          setDb(current);
          return { ok: false, error: '부모 관리 PIN 잠금을 먼저 풀어 주세요.' };
        }
        change.pin = sessionPinRef.current;
      }

      const adapter = modeRef.current === 'supabase' ? cloud ?? local : local;
      try {
        await adapter.save(next, change);
        if (modeRef.current === 'supabase') saveCloudCache(next);
        return { ok: true };
      } catch (error) {
        console.warn('[study-check] 저장 실패', error);
        dbRef.current = current;
        setDb(current);
        if (error instanceof StorageSetupError) {
          modeRef.current = 'local';
          setMode('local');
          setSyncState('setup');
        }
        return { ok: false, error: messageOf(error) };
      }
    },
    [cloud, local],
  );

  const addTask = useCallback(
    (input: NewTaskInput) => run((current, actor) => addTaskPure(current, actor, input)),
    [run],
  );

  const editTask = useCallback(
    (taskId: string, patch: TaskPatch) => run((current, actor) => editTaskPure(current, actor, taskId, patch)),
    [run],
  );

  const setStatus = useCallback(
    (taskId: string, status: TaskStatus) => run((current, actor) => changeTaskStatus(current, actor, taskId, status)),
    [run],
  );

  const removeTask = useCallback(
    (taskId: string) => run((current, actor) => deleteTaskPure(current, actor, taskId)),
    [run],
  );

  const resetDemo = useCallback(async (): Promise<ActionResult> => {
    if (modeRef.current === 'supabase') {
      return { ok: false, error: '가족끼리 연결되어 있어 여기서 초기화할 수는 없어요.' };
    }
    const current = dbRef.current;
    const actor =
      current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
    if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };
    if (actor.role !== 'parent') {
      return { ok: false, error: new PermissionError('샘플 초기화는 부모만 할 수 있어요.').message };
    }

    const next = createDemoDB();
    dbRef.current = next;
    setDb(next);
    await local.save(next, { type: 'reset', actorId: actor.id });
    return { ok: true };
  }, [local]);

  const setCurrentMember = useCallback((memberId: string) => {
    if (!dbRef.current.members.some((member) => member.id === memberId)) return;
    setCurrentMemberIdState(memberId);
  }, []);

  /** 부모 관리 PIN 잠금 풀기 — 클라우드면 서버(bcrypt 해시)가, 데모면 이 기기가 확인합니다. */
  const unlockParent = useCallback(
    async (pin: string): Promise<ActionResult> => {
      if (!isPinFormat(pin)) return { ok: false, error: '4자리 숫자를 입력해 주세요.' };

      if (modeRef.current === 'supabase' && cloud) {
        const familyId = dbRef.current.families[0]?.id;
        if (!familyId) return { ok: false, error: '가족 정보를 불러오는 중이에요. 잠시 뒤 다시 해 주세요.' };
        try {
          const valid = await cloud.verifyParentPin(familyId, pin);
          if (!valid) return { ok: false, error: 'PIN이 맞지 않아요. 다시 입력해 주세요.' };
        } catch (error) {
          return { ok: false, error: messageOf(error) };
        }
      } else {
        if (!hasLocalPin()) return { ok: false, error: '이 기기에는 아직 부모 관리 PIN이 없어요.' };
        try {
          const valid = await verifyLocalPin(pin);
          if (!valid) return { ok: false, error: 'PIN이 맞지 않아요. 다시 입력해 주세요.' };
        } catch {
          return { ok: false, error: '이 기기에서는 PIN을 확인할 수 없어요.' };
        }
      }

      writeSessionPin(pin);
      setSessionPinState(pin);
      return { ok: true };
    },
    [cloud],
  );

  /** 기기 저장(데모) 모드에서 처음 PIN 정하기 */
  const setParentPin = useCallback(async (pin: string): Promise<ActionResult> => {
    if (!isPinFormat(pin)) return { ok: false, error: '4자리 숫자를 입력해 주세요.' };
    try {
      await setLocalPin(pin);
    } catch {
      return { ok: false, error: '이 기기에서는 PIN을 저장할 수 없어요.' };
    }
    setLocalPinReady(true);
    writeSessionPin(pin);
    setSessionPinState(pin);
    return { ok: true };
  }, []);

  /** 관리 잠금 — 이번 탭의 PIN 을 지웁니다. */
  const lockParent = useCallback(() => {
    clearSessionPin();
    setSessionPinState(null);
  }, []);

  /**
   * 공부 복사·붙여넣기: 고른 항목을 다른 날짜들로 '할 일' 상태로 새로 만듭니다.
   * 같은 날 같은 숙제가 이미 있으면 건너뜁니다. (한 건씩 저장하므로 실시간 동기화도 그대로 됩니다)
   */
  const copyTasks = useCallback(
    async (taskIds: string[], dates: string[]): Promise<CopyResult> => {
      if (dates.length === 0) return { ok: false, created: 0, skipped: 0, error: '붙여넣을 날짜를 골라 주세요.' };
      const sources = dbRef.current.tasks.filter((task) => taskIds.includes(task.id));
      if (sources.length === 0) return { ok: false, created: 0, skipped: 0, error: '복사할 항목을 찾지 못했어요.' };

      let created = 0;
      let skipped = 0;
      let firstError: string | undefined;

      for (const date of dates) {
        for (const source of sources) {
          const duplicated = dbRef.current.tasks.some(
            (task) =>
              task.member_id === source.member_id &&
              task.due_date === date &&
              task.title === source.title &&
              task.subject === source.subject,
          );
          if (duplicated) {
            skipped += 1;
            continue;
          }
          const result = await addTask({
            member_id: source.member_id,
            title: source.title,
            subject: source.subject,
            due_date: date,
            note: source.note,
          });
          if (result.ok) created += 1;
          else firstError = firstError ?? result.error;
        }
      }

      return { ok: created > 0 || skipped > 0, created, skipped, error: firstError };
    },
    [addTask],
  );

  /** 구성원 이름 바꾸기 — 부모 + PIN. */
  const renameMember = useCallback(
    async (memberId: string, name: string): Promise<ActionResult> => {
      const current = dbRef.current;
      const actor =
        current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };

      const pin = sessionPinRef.current;
      if (!pin) return { ok: false, error: '부모 관리 PIN 잠금을 먼저 풀어 주세요.' };

      let next: StudyDB;
      try {
        next = renameMemberPure(current, actor, memberId, name);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }

      const renamed = next.members.find((member) => member.id === memberId);
      if (!renamed) return { ok: false, error: '구성원을 찾지 못했어요.' };

      if (modeRef.current === 'supabase' && cloud?.renameMember) {
        try {
          await cloud.renameMember(actor.id, memberId, renamed.name, pin);
        } catch (error) {
          return { ok: false, error: messageOf(error) };
        }
        saveCloudCache(next);
      } else {
        try {
          await local.save(next, { type: 'reset', actorId: actor.id });
        } catch {
          return { ok: false, error: '이 기기에 저장하지 못했어요.' };
        }
      }

      dbRef.current = next;
      setDb(next);
      return { ok: true };
    },
    [cloud, local],
  );

  const currentMember = db.members.find((member) => member.id === currentMemberId) ?? db.members[0];

  /** 아직 확인하지 않은 새 한마디 — 다른 사람이 남긴 것만 알립니다. */
  const unseenNotes = useMemo(() => {
    const seenTime = notesSeenAt ? noteTime(notesSeenAt) : 0;
    return notes.filter((note) => note.author_id !== currentMember?.id && noteTime(note) > seenTime);
  }, [notes, notesSeenAt, currentMember]);

  const tasksFor = useCallback(
    (memberId: string, dateIso: string) =>
      sortTasks(db.tasks.filter((task) => task.member_id === memberId && task.due_date === dateIso)),
    [db],
  );

  const summaryFor = useCallback(
    (memberId: string, dateIso: string) => summarize(tasksFor(memberId, dateIso)),
    [tasksFor],
  );

  const value = useMemo<StudyContextValue>(() => {
    const family = familyOf(db, currentMember.family_id);
    return {
      db,
      familyName: family?.name ?? '우리 가족 공부방',
      members: db.members,
      parents: parentsOf(db, currentMember.family_id),
      children: childrenOf(db, currentMember.family_id),
      currentMember,
      isParent: currentMember.role === 'parent',
      storageKind: mode,
      syncState,
      realtimeState,
      notes,
      notesState,
      unseenNotes,
      markNotesSeen,
      addNote,
      deleteNote,
      enablePush,
      seasonStatsFor,
      lastSeasonFor,
      tierEvents,
      tierEventsFor,
      tierEventsState,
      rewardSettings,
      openReward,
      useReward,
      saveRewardSettings,
      parentUnlocked: sessionPin !== null,
      parentPinSetupRequired: mode === 'local' && !localPinReady && syncState !== 'syncing',
      unlockParent,
      setParentPin,
      lockParent,
      setCurrentMember,
      tasksFor,
      summaryFor,
      addTask,
      editTask,
      setStatus,
      removeTask,
      copyTasks,
      renameMember,
      resetDemo,
    };
  }, [
    db,
    currentMember,
    mode,
    syncState,
    realtimeState,
    notes,
    notesState,
    unseenNotes,
    markNotesSeen,
    addNote,
    deleteNote,
    enablePush,
    seasonStatsFor,
    lastSeasonFor,
    tierEvents,
    tierEventsFor,
    tierEventsState,
    rewardSettings,
    openReward,
    useReward,
    saveRewardSettings,
    sessionPin,
    localPinReady,
    unlockParent,
    setParentPin,
    lockParent,
    setCurrentMember,
    tasksFor,
    summaryFor,
    addTask,
    editTask,
    setStatus,
    removeTask,
    copyTasks,
    renameMember,
    resetDemo,
  ]);

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useStudy(): StudyContextValue {
  const value = useContext(StudyContext);
  if (!value) throw new Error('useStudy 는 StudyProvider 안에서만 쓸 수 있어요.');
  return value;
}
