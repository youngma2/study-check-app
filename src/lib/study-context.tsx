import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createContext } from 'react';
import {
  PermissionError,
  addTask as addTaskPure,
  changeTaskStatus,
  createDemoDB,
  createInitialDB,
  deleteTask as deleteTaskPure,
  editTask as editTaskPure,
  familyOf,
  loadCloudCache,
  loadCurrentMemberId,
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
  hashPin,
  isPinFormat,
  readSessionPin,
  setDeviceRecoveryPin,
  setLocalPin,
  verifyDeviceRecoveryPin,
  verifyHashedPin,
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
  addTimeGrant,
  addTimeUsage,
  boxIsPointsPrize,
  boxRewardFor,
  burstActiveToday,
  burstFactorLabel,
  loadLocalAppSettings,
  loadSelfProfiles,
  newProfileId,
  normalizeAppSettings,
  remainingBonusMinutes,
  saveLocalAppSettings,
  saveSelfProfiles,
  type AppSettings,
  type ParentRecovery,
  type ProfilePin,
  type SelfProfile,
} from './app-settings';
import { unusedBonusMinutes } from './report';
import { isShopTask, pointPrizeEventIds, prizeTaskInput } from './shop';
import {
  completionDateOf,
  computePastSeason,
  computeSeasonStats,
  isXpHiddenTask,
  previousSeason,
  recentSeasons,
  seasonOf,
  settlementOf,
  type MonthSettlement,
  type SeasonStats,
  type TierLevel,
  type XpRules,
} from './season';
import {
  DEFAULT_REWARD_SETTINGS,
  buildLocalTierEvent,
  loadLocalRewardSettings,
  loadLocalTierEvents,
  normalizeSettings,
  rememberRewardOpen,
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
  /** 🔐 지금 쓰는 PIN 을 알고 새 PIN 으로 바꾸기 (부모 관리) */
  changeParentPin: (currentPin: string, newPin: string) => Promise<ActionResult>;
  /** 🔐 비상 복구 질문·답·6자리 코드 저장 (부모 관리) — 솔트+해시만 */
  saveParentRecovery: (input: {
    question: string;
    answer: string;
    code: string;
  }) => Promise<ActionResult & { localOnly?: boolean }>;
  /** 🔐 복구 코드 또는 질문의 답으로 부모 PIN 재설정 */
  resetParentPinWithRecovery: (secret: string, newPin: string) => Promise<ActionResult & { deviceOnly?: boolean }>;
  /** 🔐 저장된 비상 복구 질문·코드 (없으면 null) */
  parentRecovery: ParentRecovery | null;
  /** 복구로 이 폰에서만 연 상태 (서버 PIN 은 그대로) */
  parentPinRecoveryMode: boolean;
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
  /** 💬 쪼꼬 명의로 한마디 남기기 — 100% 달성 축하처럼 앱이 스스로 쓰는 글 */
  postJjokkoNote: (content: string, dateIso: string, id: string) => Promise<ActionResult>;
  /** ⚙️ 부모 옵션 — 기본 공부 목록 · 🔥 버스트 타임 · ⑤ 연속 보너스 · 타이머 기록 */
  appSettings: AppSettings;
  /** 🖼 아이 프로필 아이콘 바꾸기 — 부모(PIN) 만 */
  setMemberEmoji: (memberId: string, emoji: string) => Promise<ActionResult>;
  /** 🔥 버스트 타임 배수(1.25 · 1.5 · 1.75 · 2) — 배너·배지에 씁니다. */
  burstFactor: number;
  /** 🔥 배수 문구('1.5배') */
  burstFactorText: string;
  /** 🔐 프로필별 4자리 PIN — 평문 없이 솔트+해시만 (추가 SQL 없이 가족 설정 JSON) */
  profilePins: Record<string, ProfilePin>;
  hasProfilePin: (memberId: string) => boolean;
  verifyProfilePin: (memberId: string, pin: string) => Promise<ActionResult>;
  /** 🔐 아이 프로필 개인 PIN 정하기·바꾸기 (부모·PIN 만) */
  setProfilePin: (memberId: string, pin: string) => Promise<ActionResult>;
  resetProfilePin: (memberId: string) => Promise<ActionResult>;
  /** 🏷 아이 전용 프로필 창(2·5번) — 닉네임·학년·아이콘 저장 */
  saveChildProfile: (
    memberId: string,
    patch: { name?: string; grade?: string; emoji?: string },
  ) => Promise<ActionResult & { deviceOnly?: boolean }>;
  /** 🏷 아이가 자기 PIN 을 정하기·바꾸기 (지금 PIN 확인 후) */
  setChildProfilePin: (
    memberId: string,
    pin: string,
    currentPin?: string,
  ) => Promise<ActionResult & { deviceOnly?: boolean }>;
  /** 🏷 아이가 자기 PIN 을 지우기 (지금 PIN 확인 후) */
  resetChildProfilePin: (memberId: string, currentPin?: string) => Promise<ActionResult & { deviceOnly?: boolean }>;
  /** 🆕 새 프로필 만들기 — 부모 PIN 이 풀려 있어야 저장됩니다(추가 SQL 없음). */
  createProfile: (
    input: {
      name: string;
      emoji: string;
      role: 'parent' | 'child';
      pin?: string;
    },
    actorId?: string,
  ) => Promise<ActionResult & { memberId?: string }>;
  /** 📅 최근 12개월 월말 결산 최종 티어 (지난달부터) */
  monthlySettlementsFor: (memberId: string) => MonthSettlement[];
  /** 'cloud' = 가족 폰이 함께 씀 / 'local' = 이 기기에만(SQL 실행 전) */
  settingsSync: 'cloud' | 'local';
  saveAppSettings: (patch: Partial<AppSettings>) => Promise<ActionResult & { localOnly?: boolean }>;
  /** ② 뽑기로 받은 시간에서 분을 차감할 때 (부모 전용) — mode 'timer' 는 타이머 시작, 'direct' 는 바로 차감 */
  consumeBonusTime: (
    memberId: string,
    minutes: number,
    mode?: 'timer' | 'direct',
    reason?: string,
  ) => Promise<ActionResult>;
  /** ⏱ 부모가 시간을 직접 더할 때 (8번) — 남은 시간에 바로 적립 */
  grantBonusTime: (memberId: string, minutes: number, reason?: string) => Promise<ActionResult>;
  /** XP 계산 규칙(버스트 타임·연속 보너스) */
  xpRules: XpRules;
  /** 🔥 버스트 타임이 지금 켜져 있는지 */
  burstActive: boolean;
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

/** 체험 데모(demo.html)도 같은 팝업을 쓰도록 열어 둡니다 — 실제 앱은 아래 StudyProvider 만 씁니다. */
export const StudyContext = createContext<StudyContextValue | null>(null);

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
  /** 복구로 이 폰에서만 연 상태인지 (서버 PIN 은 그대로 — 옵션에 안내를 띄웁니다) */
  const [parentPinRecoveryMode, setParentPinRecoveryMode] = useState(false);
  const [localPinReady, setLocalPinReady] = useState<boolean>(() => hasLocalPin());

  useEffect(() => {
    saveCurrentMemberId(currentMemberId);
  }, [currentMemberId]);

  const applyDb = useCallback((next: StudyDB) => {
    dbRef.current = next;
    setDb(next);
    setCurrentMemberIdState((prev) =>
      next.members.some((member) => member.id === prev) ||
      appSettingsRef.current.extraMembers.some((member) => member.id === prev)
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

  /**
   * 🐣 쪼꼬 명의로 한마디 남기기 — 100% 달성 축하처럼 앱이 스스로 쓰는 글.
   * id 를 정해 두어(날짜·아이) 여러 폰·여러 번 실행에도 같은 날 한 번만 올라갑니다.
   */
  const postJjokkoNote = useCallback(
    async (content: string, _dateIso: string, id: string): Promise<ActionResult> => {
      const text = content.trim();
      if (!text) return { ok: false, error: '남길 말이 없어요.' };
      if (notesRef.current.some((note) => note.id === id)) return { ok: true };

      const current = dbRef.current;
      const actor =
        current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };
      // 쪼꼬 글도 DB 에는 부모 id 로 들어갑니다 — 그래야 아이 폰까지 알림이 갑니다.
      const author = actor.role === 'parent' ? actor : current.members.find((member) => member.role === 'parent') ?? actor;

      const note: FamilyNote = {
        id,
        family_id: author.family_id,
        author_id: author.id,
        author_kind: 'jjokko',
        content: text,
        created_at: new Date().toISOString(),
      };
      const optimistic = sortNotes([note, ...notesRef.current]);
      notesRef.current = optimistic;
      setNotes(optimistic);

      if (!cloud || modeRef.current !== 'supabase') {
        saveLocalNotes(optimistic);
        return { ok: true };
      }

      try {
        const saved = await cloud.addJjokkoNote(author.id, text, id);
        const merged = sortNotes([
          saved,
          ...notesRef.current.filter((item) => item.id !== saved.id && item.id !== id),
        ]);
        notesRef.current = merged;
        setNotes(merged);
        saveLocalNotes(merged);
        return { ok: true };
      } catch (error) {
        // 다른 폰이 먼저 같은 글을 남겼을 수 있습니다. 화면에는 그대로 두고 조용히 넘어갑니다.
        console.warn('[study-check] 쪼꼬 한마디 저장 실패', error);
        saveLocalNotes(notesRef.current);
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

  /* ---------------------------------------------------------------- */
  /* ⚙️ 부모 옵션 설정 (기본 목록·버스트 타임·연속 보너스·타이머 기록)          */
  /* ---------------------------------------------------------------- */

  const [appSettings, setAppSettingsState] = useState<AppSettings>(() => loadLocalAppSettings());
  const appSettingsRef = useRef<AppSettings>(appSettings);
  appSettingsRef.current = appSettings;
  /** 🏷 아이가 자기 화면(`⋮` → 프로필 관리)에서 바꾼 값 — 이 폰에만 저장합니다. */
  const [selfProfiles, setSelfProfilesState] = useState<Record<string, SelfProfile>>(() => loadSelfProfiles());
  const selfProfilesRef = useRef<Record<string, SelfProfile>>(selfProfiles);
  selfProfilesRef.current = selfProfiles;
  const applySelfProfiles = useCallback((next: Record<string, SelfProfile>) => {
    selfProfilesRef.current = next;
    setSelfProfilesState(next);
    saveSelfProfiles(next);
  }, []);
  /** 'cloud' 면 가족 폰이 같은 설정을 쓰고, 'local' 이면 이 폰에만 저장합니다. */
  const [settingsSync, setSettingsSync] = useState<'cloud' | 'local'>('local');
  const settingsSyncRef = useRef<'cloud' | 'local'>('local');
  settingsSyncRef.current = settingsSync;

  const applyAppSettings = useCallback((next: AppSettings) => {
    appSettingsRef.current = next;
    setAppSettingsState(next);
    saveLocalAppSettings(next);
  }, []);

  /** addTask 는 아래에서 만들어지므로, 상자 정산(openReward)이 나중에 부를 수 있게 참조만 둡니다. */
  const addTaskRef = useRef<((input: NewTaskInput) => Promise<ActionResult>) | null>(null);
  const settledPrizeRef = useRef<Set<string>>(new Set());

  /**
   * 🎁 상자를 열 때 그 상자의 보상을 '그 순간' 확정합니다.
   * 포인트(P) 보상이면 포인트 장부에 한 줄 남기고, 분 보상이면 아무것도 하지 않습니다(시간은 box_minutes 로).
   * 나중에 보상 목록을 고쳐도 이미 연 상자의 보상은 바뀌지 않습니다.
   */
  const settleBoxPrize = useCallback((eventId: string, memberId: string, boxMinutes: number | null) => {
    const rewards = appSettingsRef.current.boxRewards;
    if (!boxIsPointsPrize(rewards, eventId)) return;
    const id = `pt_prize_${eventId}`;
    if (dbRef.current.tasks.some((task) => task.id === id)) return;
    if (settledPrizeRef.current.has(id)) return;
    settledPrizeRef.current.add(id);
    const prize = boxRewardFor(rewards, eventId, boxMinutes);
    void addTaskRef.current?.(prizeTaskInput(memberId, prize.value, '뽑기 상자 포인트', eventId));
  }, []);

  const xpRules = useMemo<XpRules>(
    () => ({
      burstWindows: appSettings.burstWindows,
      streakBonuses: appSettings.streakBonuses,
      // 자동 버스트 타임이 꺼져 있으면 0 — '자동 없음'으로 셈합니다.
      burstAutoDays: appSettings.burstAuto ? appSettings.burstAutoDays : 0,
      burstOverlap: appSettings.burstOverlap,
      burstPercent: appSettings.burstPercent,
      // 켠 날 이전 기록에는 소급 적용하지 않습니다.
      burstAutoFrom: appSettings.burstAutoFrom,
      tierDifficulty: appSettings.tierDifficulty,
    }),
    [
      appSettings.burstWindows,
      appSettings.streakBonuses,
      appSettings.burstAuto,
      appSettings.burstAutoDays,
      appSettings.burstOverlap,
      appSettings.burstPercent,
      appSettings.burstAutoFrom,
      appSettings.tierDifficulty,
    ],
  );

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

  // 가족 설정(⚙️)을 불러옵니다 — 표가 아직 없으면(SQL 전) 이 폰 저장으로 계속 동작합니다.
  useEffect(() => {
    if (!cloud) return;
    if (mode !== 'supabase' || syncState !== 'synced') return;
    const familyId = dbRef.current.families[0]?.id;
    if (!familyId) return;
    let alive = true;
    cloud
      .loadAppSettings(familyId)
      .then(({ available, settings }) => {
        if (!alive) return;
        if (!available) {
          setSettingsSync('local');
          return;
        }
        // 표에 아직 저장된 줄이 없으면, 이 폰에서 정해 둔 설정을 그대로 이어서 씁니다.
        if (settings) applyAppSettings(settings);
        setSettingsSync('cloud');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        console.warn('[study-check] 가족 설정 불러오기 실패 — 이 폰 설정으로 계속합니다', error);
        setSettingsSync('local');
      });
    return () => {
      alive = false;
    };
  }, [cloud, mode, syncState, applyAppSettings]);

  // 다른 폰에서 버스트 타임을 켜거나 기본 목록을 바꾸면 바로 반영합니다.
  useEffect(() => {
    if (!cloud || mode !== 'supabase' || syncState !== 'synced' || settingsSync !== 'cloud') return;
    const familyId = dbRef.current.families[0]?.id;
    if (!familyId) return;
    return cloud.subscribeAppSettings(familyId, (settings) => applyAppSettings(settings));
  }, [cloud, mode, syncState, settingsSync, applyAppSettings]);

  /**
   * ⚙️ 부모 옵션 저장 — 가족 DB 가 있으면 모든 폰에, 없으면 이 폰에만 저장합니다.
   * `actorId` 는 저장을 요청한 사람(보통 지금 보고 있는 사람). 새 프로필 만들기는 아직 화면에 들어가기 전이라
   * 부모 PIN 을 확인한 부모 계정을 직접 넘깁니다.
   */
  const saveSettingsAs = useCallback(
    async (actorId: string, patch: Partial<AppSettings>): Promise<ActionResult & { localOnly?: boolean }> => {
      const current = appSettingsRef.current;
      const next = normalizeAppSettings({ ...current, ...patch });
      const db = dbRef.current;
      const actor = db.members.find((member) => member.id === actorId) ?? db.members[0];
      if (!actor) return { ok: false, error: '가족 정보를 불러오지 못했어요.' };
      if (actor.role !== 'parent') return { ok: false, error: '옵션은 부모님만 바꿀 수 있어요.' };

      if (cloud && modeRef.current === 'supabase') {
        const pin = sessionPinRef.current;
        if (!pin) return { ok: false, error: '부모 관리 PIN 잠금을 먼저 풀어 주세요.' };
        try {
          const saved = await cloud.saveAppSettings(actor.id, next, pin);
          applyAppSettings(saved);
          setSettingsSync('cloud');
          return { ok: true };
        } catch (error) {
          if (error instanceof StorageSetupError) {
            // 아직 표(SQL)가 없는 DB — 에러 없이 이 폰에만 적용하고 그렇게 알려 줍니다.
            applyAppSettings(next);
            setSettingsSync('local');
            return { ok: true, localOnly: true };
          }
          return { ok: false, error: messageOf(error) };
        }
      }

      applyAppSettings(next);
      return { ok: true, localOnly: cloud !== null ? true : undefined };
    },
    [applyAppSettings, cloud],
  );

  /** ⚙️ 부모 옵션 저장 — 지금 보고 있는 사람 명의로 저장합니다. */
  const saveAppSettings = useCallback(
    (patch: Partial<AppSettings>) => saveSettingsAs(currentMemberIdRef.current, patch),
    [saveSettingsAs],
  );

  /** ② 뽑기로 받은 시간에서 분을 나눠 씁니다(부모 전용) — 타이머로 쓸 수도, 바로 차감할 수도 있습니다. */
  const consumeBonusTime = useCallback(
    async (
      memberId: string,
      minutes: number,
      mode: 'timer' | 'direct' = 'timer',
      reason?: string,
    ): Promise<ActionResult> => {
      const db = dbRef.current;
      const actor =
        db.members.find((member) => member.id === currentMemberIdRef.current) ?? db.members[0];
      if (!actor || actor.role !== 'parent') {
        return { ok: false, error: '부모 화면에서만 시간을 쓸 수 있어요.' };
      }
      const wanted = Math.round(minutes);
      if (!Number.isFinite(wanted) || wanted < 1) return { ok: false, error: '1분 이상 입력해 주세요.' };

      const remaining = remainingBonusMinutes(
        appSettingsRef.current,
        memberId,
        unusedBonusMinutes(tierEventsRef.current, memberId, pointPrizeEventIds(dbRef.current.tasks)),
      );
      if (wanted > remaining) {
        return { ok: false, error: `뽑기로 받은 남은 시간은 ${remaining}분이에요.` };
      }

      const next = addTimeUsage(appSettingsRef.current, memberId, wanted, mode, reason);
      return saveAppSettings({ timeUsage: next.timeUsage });
    },
    [saveAppSettings],
  );

  /** ⏱ 부모가 아이 시간을 직접 더합니다(8번) — 남은 시간에 바로 적립되고 내역에 +N분으로 남아요. */
  const grantBonusTime = useCallback(
    async (memberId: string, minutes: number, reason?: string): Promise<ActionResult> => {
      const db = dbRef.current;
      const actor =
        db.members.find((member) => member.id === currentMemberIdRef.current) ?? db.members[0];
      if (!actor || actor.role !== 'parent') {
        return { ok: false, error: '부모 화면에서만 시간을 더할 수 있어요.' };
      }
      const wanted = Math.round(minutes);
      if (!Number.isFinite(wanted) || wanted < 1) return { ok: false, error: '1분 이상 입력해 주세요.' };
      if (wanted > 600) return { ok: false, error: '한 번에 600분(10시간)까지 더할 수 있어요.' };

      const next = addTimeGrant(appSettingsRef.current, memberId, wanted, reason);
      return saveAppSettings({ timeGrants: next.timeGrants });
    },
    [saveAppSettings],
  );

  /** 이번 달(오늘까지) 아이별 시즌 기록 — 공부 목록이 바뀌면 같이 다시 셈합니다. */
  const seasonStats = useMemo(() => {
    const map: Record<string, SeasonStats> = {};
    const today = koreaTodayISO();
    for (const member of db.members) {
      if (member.role !== 'child') continue;
      map[member.id] = computeSeasonStats(db.tasks, member.id, today, xpRules);
    }
    return map;
  }, [db, xpRules]);

  /** 지난달 최고 기록 — 배지로만 보여 줍니다. */
  const lastSeasonStats = useMemo(() => {
    const map: Record<string, { season: string; xp: number; level: TierLevel }> = {};
    const season = previousSeason(seasonOf(koreaTodayISO()));
    for (const member of db.members) {
      if (member.role !== 'child') continue;
      const past = computePastSeason(db.tasks, member.id, season, xpRules);
      if (past.xp > 0) map[member.id] = { season, xp: past.xp, level: past.level };
    }
    return map;
  }, [db, xpRules]);

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

      const openedAt = new Date().toISOString();
      applyTierEvents(
        before.map((event) => (event.id === eventId ? { ...event, opened_at: openedAt } : event)),
      );

      if (modeRef.current !== 'supabase' || !cloud) {
        // 이 기기 기록 — 클라우드가 없어도 '몇 분을 뽑았는지'가 폰에 남습니다.
        if (target.box_minutes !== null) {
          rememberRewardOpen({
            event_id: eventId,
            member_id: target.member_id,
            minutes: target.box_minutes,
            opened_at: openedAt,
          });
        }
        settleBoxPrize(eventId, target.member_id, target.box_minutes);
        return { ok: true };
      }

      try {
        const saved = await cloud.openReward(actor.id, eventId);
        const next = tierEventsRef.current.map((event) => (event.id === eventId ? saved : event));
        tierEventsRef.current = next;
        setTierEvents(next);
        if (saved.box_minutes !== null) {
          rememberRewardOpen({
            event_id: saved.id,
            member_id: saved.member_id,
            minutes: saved.box_minutes,
            opened_at: saved.opened_at ?? openedAt,
          });
        }
        settleBoxPrize(saved.id, saved.member_id, saved.box_minutes);
        return { ok: true };
      } catch (error) {
        applyTierEvents(before);
        return { ok: false, error: messageOf(error) };
      }
    },
    [applyTierEvents, cloud, settleBoxPrize],
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
        if (
          !next.members.some((member) => member.id === currentMemberIdRef.current) &&
          !appSettingsRef.current.extraMembers.some((member) => member.id === currentMemberIdRef.current) &&
          next.members[0]
        ) {
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
    (input: NewTaskInput) => {
      // 🆕 부모가 만든 프로필(설정 JSON)이 아직 가족 DB 구성원표에 없으면, 서버가 거절합니다.
      //    그 자리에서 알아보기 쉽게 안내합니다(함수가 들어 있으면 db.members 에 있어 그냥 저장됩니다).
      const extraOnly =
        modeRef.current === 'supabase' &&
        appSettingsRef.current.extraMembers.some((member) => member.id === input.member_id) &&
        !dbRef.current.members.some((member) => member.id === input.member_id);
      if (extraOnly) {
        return Promise.resolve({
          ok: false,
          error: '새로 만든 프로필은 아직 가족 DB에 등록되지 않았어요 · 부모님이 설정 페이지(setup.html)의 SQL을 한 번 실행하면 공부가 저장돼요.',
        });
      }
      return run((current, actor) => addTaskPure(current, actor, input));
    },
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

  // 상자 정산이 addTask 를 부를 수 있게 연결해 둡니다(렌더 때마다 최신 함수).
  addTaskRef.current = addTask;

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
    // 가족 DB 구성원 + 부모가 새로 만든 프로필(가족 설정 JSON) 모두 고를 수 있습니다.
    const known =
      dbRef.current.members.some((member) => member.id === memberId) ||
      appSettingsRef.current.extraMembers.some((member) => member.id === memberId);
    if (!known) return;
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
          if (!valid) {
            // 복구 코드로 이 폰에 정해 둔 PIN 이면 그걸로 열어 줍니다(서버 PIN 은 그대로).
            const recovered = await verifyDeviceRecoveryPin(pin);
            if (recovered) {
              writeSessionPin(pin);
              setSessionPinState(pin);
              setParentPinRecoveryMode(true);
              return { ok: true };
            }
            return { ok: false, error: 'PIN이 맞지 않아요. 다시 입력해 주세요.' };
          }
        } catch (error) {
          const recovered = await verifyDeviceRecoveryPin(pin);
          if (recovered) {
            writeSessionPin(pin);
            setSessionPinState(pin);
            setParentPinRecoveryMode(true);
            return { ok: true };
          }
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
      setParentPinRecoveryMode(false);
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

  /** 🔐 부모 PIN 바꾸기 — 지금 쓰는 PIN 을 알아야 바뀝니다(가족 DB면 서버 해시까지). */
  const changeParentPin = useCallback(
    async (currentPin: string, newPin: string): Promise<ActionResult> => {
      if (!isPinFormat(currentPin) || !isPinFormat(newPin)) {
        return { ok: false, error: 'PIN은 4자리 숫자로 넣어 주세요.' };
      }
      const familyId = dbRef.current.families[0]?.id;
      if (modeRef.current === 'supabase' && cloud && familyId) {
        try {
          await cloud.setParentPin(familyId, newPin, currentPin);
        } catch (error) {
          return { ok: false, error: messageOf(error) };
        }
        writeSessionPin(newPin);
        setSessionPinState(newPin);
        setParentPinRecoveryMode(false);
        return { ok: true };
      }
      // 이 기기 저장(데모) — 지금 PIN 을 먼저 확인합니다.
      if (hasLocalPin()) {
        const valid = await verifyLocalPin(currentPin);
        if (!valid) return { ok: false, error: '지금 쓰는 PIN이 맞지 않아요.' };
      }
      try {
        await setLocalPin(newPin);
      } catch {
        return { ok: false, error: '이 기기에서는 PIN을 저장할 수 없어요.' };
      }
      setLocalPinReady(true);
      writeSessionPin(newPin);
      setSessionPinState(newPin);
      return { ok: true };
    },
    [cloud],
  );

  /** 🔐 비상 복구 질문·답·6자리 코드 저장 — 답·코드는 솔트+해시만 둡니다. */
  const saveParentRecovery = useCallback(
    async (input: {
      question: string;
      answer: string;
      code: string;
    }): Promise<ActionResult & { localOnly?: boolean }> => {
      const question = input.question.trim().slice(0, 60);
      const answer = input.answer.trim();
      const code = input.code.trim();
      if (!question) return { ok: false, error: '비상 복구 질문을 적어 주세요.' };
      if (answer.length < 2) return { ok: false, error: '질문의 답을 2자 이상 적어 주세요.' };
      if (!/^\d{6}$/.test(code)) return { ok: false, error: '복구 코드는 숫자 6자리로 정해 주세요.' };

      const answerRecord = await hashPin(answer.toLowerCase());
      const codeRecord = await hashPin(code);
      const recovery: ParentRecovery = {
        question,
        salt: answerRecord.salt,
        hash: answerRecord.hash,
        codeSalt: codeRecord.salt,
        codeHash: codeRecord.hash,
        updated_at: new Date().toISOString(),
      };
      const result = await saveAppSettings({ parentRecovery: recovery });
      return result.ok ? { ok: true, localOnly: result.localOnly } : { ok: false, error: result.error };
    },
    [saveAppSettings],
  );

  /**
   * 🔐 비상 복구 코드(질문의 답)를 확인하고 새 부모 PIN 으로 재설정합니다.
   * · 이 기기 저장(데모): 바로 새 PIN 으로 바뀝니다.
   * · 가족 DB: 서버 PIN 은 지금 PIN 을 알아야만 바꿀 수 있어, 먼저 서버에 시도하고
   *   안 되면 **이 폰에서만** 새 PIN 으로 열리게 합니다(옵션에 안내).
   */
  const resetParentPinWithRecovery = useCallback(
    async (secret: string, newPin: string): Promise<ActionResult & { deviceOnly?: boolean }> => {
      if (!isPinFormat(newPin)) return { ok: false, error: '새 PIN은 4자리 숫자로 정해 주세요.' };
      const recovery = appSettingsRef.current.parentRecovery;
      if (!recovery) return { ok: false, error: '등록된 비상 복구 질문·코드가 없어요. 부모님께 설정을 부탁해 주세요.' };
      const text = secret.trim();
      if (!text) return { ok: false, error: '복구 코드(6자리) 또는 질문의 답을 넣어 주세요.' };

      const byCode = /^\d{6}$/.test(text) && (await verifyHashedPin(text, { salt: recovery.codeSalt, hash: recovery.codeHash }));
      const byAnswer =
        !byCode &&
        (await verifyHashedPin(text.toLowerCase(), { salt: recovery.salt, hash: recovery.hash }));
      if (!byCode && !byAnswer) {
        return { ok: false, error: '복구 코드나 답이 맞지 않아요. 다시 확인해 주세요.' };
      }

      const familyId = dbRef.current.families[0]?.id;
      if (modeRef.current === 'supabase' && cloud && familyId) {
        try {
          // 서버에 아직 PIN 이 없거나(NULL) 바뀌는 경우 — 지금 PIN 없이도 되는 건 서버가 판단합니다.
          await cloud.setParentPin(familyId, newPin, null);
          writeSessionPin(newPin);
          setSessionPinState(newPin);
          setParentPinRecoveryMode(false);
          return { ok: true };
        } catch {
          // 서버가 "지금 쓰는 PIN" 을 요구함 — 이 폰에서만 새 PIN 으로 열리게 합니다.
          await setDeviceRecoveryPin(newPin);
          writeSessionPin(newPin);
          setSessionPinState(newPin);
          setParentPinRecoveryMode(true);
          return { ok: true, deviceOnly: true };
        }
      }

      try {
        await setLocalPin(newPin);
      } catch {
        return { ok: false, error: '이 기기에서는 PIN을 저장할 수 없어요.' };
      }
      setLocalPinReady(true);
      writeSessionPin(newPin);
      setSessionPinState(newPin);
      setParentPinRecoveryMode(false);
      return { ok: true };
    },
    [cloud],
  );

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

  /* ---------------------------------------------------------------- */
  /* 🎉 당일 100% 달성 → 🐣 쪼꼬 축하 한마디 (하루·아이당 한 번)            */
  /* ---------------------------------------------------------------- */

  const congratsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (notesState !== 'ready') return;
    if (cloud && syncState !== 'synced') return;
    const today = koreaTodayISO();

    for (const child of db.members) {
      if (child.role !== 'child') continue;
      // 당일분만 봅니다 — 지난 날짜 이월분은 세지 않고, 부모 전화·상점 장부도 뺍니다.
      const todayTasks = db.tasks.filter(
        (task) => task.member_id === child.id && task.due_date === today && !isXpHiddenTask(task),
      );
      if (todayTasks.length === 0) continue;
      // ② 그 날 실제로 체크한 항목만 100% 로 칩니다(다른 날 체크한 이월분은 제외).
      if (!todayTasks.every((task) => task.status === 'verified' && completionDateOf(task).date === today)) continue;

      const id = `n_${today}_congrats_${child.id}`;
      if (congratsRef.current.has(id) || notesRef.current.some((note) => note.id === id)) continue;
      congratsRef.current.add(id);
      void postJjokkoNote(`${child.name}, 오늘 공부 100% 완료 축하해요! 짝짝짝 👏`, today, id);
    }
  }, [db, notesState, syncState, cloud, postJjokkoNote]);

  /** 🖼 아이가 고른 프로필 아이콘(⚙️ 옵션에 저장)을 모든 화면에 반영합니다. */
  const allMembers = useMemo(() => {
    const known = new Set(db.members.map((member) => member.id));
    // 🆕 부모가 만든 프로필(가족 설정 JSON)을 DB 구성원 뒤에 붙입니다.
    const extra = appSettings.extraMembers.filter((member) => !known.has(member.id));
    return [...db.members, ...extra];
  }, [db.members, appSettings.extraMembers]);

  const displayMembers = useMemo(
    () =>
      allMembers.map((member) => {
        const self = selfProfiles[member.id];
        const name = self?.name ?? appSettings.profileNames[member.id] ?? member.name;
        const grade = self?.grade ?? appSettings.profileGrades[member.id] ?? member.grade;
        const emoji = self?.emoji ?? appSettings.profileEmoji[member.id] ?? member.emoji;
        if (name === member.name && grade === member.grade && emoji === member.emoji) return member;
        return { ...member, name, grade, emoji };
      }),
    [allMembers, appSettings.profileEmoji, appSettings.profileNames, appSettings.profileGrades, selfProfiles],
  );

  /** 🖼 프로필 아이콘 바꾸기 — 부모(PIN) 만. */
  const setMemberEmoji = useCallback(
    async (memberId: string, emoji: string): Promise<ActionResult> => {
      const clean = emoji.trim().slice(0, 8);
      if (!clean) return { ok: false, error: '아이콘을 골라 주세요.' };
      if (!dbRef.current.members.some((member) => member.id === memberId)) {
        return { ok: false, error: '구성원을 찾지 못했어요.' };
      }
      const result = await saveAppSettings({
        profileEmoji: { ...appSettingsRef.current.profileEmoji, [memberId]: clean },
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [saveAppSettings],
  );

  /** 🔐 프로필 PIN — 그 사람 PIN 이 정해져 있는지 (가족 설정 또는 이 폰에서 정한 것) */
  const hasProfilePin = useCallback(
    (memberId: string) =>
      Boolean(selfProfilesRef.current[memberId]?.pin) || Boolean(appSettingsRef.current.profilePins[memberId]),
    [],
  );

  /** 🔐 프로필 PIN 확인 — 맞으면 ok, 틀리면 이유를 돌려줍니다. (이 폰 PIN 을 먼저 봅니다) */
  const verifyProfilePin = useCallback(
    async (memberId: string, pin: string): Promise<ActionResult> => {
      if (!isPinFormat(pin)) return { ok: false, error: '4자리 숫자를 입력해 주세요.' };
      const localPin = selfProfilesRef.current[memberId]?.pin;
      const record = localPin ?? appSettingsRef.current.profilePins[memberId];
      if (!record) return { ok: true };
      const valid = await verifyHashedPin(pin, record);
      return valid ? { ok: true } : { ok: false, error: 'PIN이 맞지 않아요. 다시 입력해 주세요.' };
    },
    [],
  );

  /** 🔐 프로필 PIN 정하기·바꾸기 — 부모(PIN) 만. (이 폰에 남아 있던 아이 PIN 은 지웁니다) */
  const setProfilePin = useCallback(
    async (memberId: string, pin: string): Promise<ActionResult> => {
      if (!isPinFormat(pin)) return { ok: false, error: '4자리 숫자를 입력해 주세요.' };
      const record = await hashPin(pin);
      const result = await saveAppSettings({
        profilePins: { ...appSettingsRef.current.profilePins, [memberId]: record },
      });
      if (result.ok && selfProfilesRef.current[memberId]?.pin) {
        const overlays = { ...selfProfilesRef.current };
        const entry = { ...overlays[memberId] };
        delete entry.pin;
        if (Object.keys(entry).length > 0) overlays[memberId] = entry;
        else delete overlays[memberId];
        applySelfProfiles(overlays);
      }
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [applySelfProfiles, saveAppSettings],
  );

  /** 🔐 프로필 PIN 지우기(초기화) — 부모(PIN) 만. 다음부터는 PIN 없이 들어갑니다. */
  const resetProfilePin = useCallback(
    async (memberId: string): Promise<ActionResult> => {
      const next = { ...appSettingsRef.current.profilePins };
      delete next[memberId];
      const overlays = { ...selfProfilesRef.current };
      if (overlays[memberId]?.pin) {
        const entry = { ...overlays[memberId] };
        delete entry.pin;
        if (Object.keys(entry).length > 0) overlays[memberId] = entry;
        else delete overlays[memberId];
        applySelfProfiles(overlays);
      }
      const result = await saveAppSettings({ profilePins: next });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [applySelfProfiles, saveAppSettings],
  );

  /* ---------------------------------------------------------------- */
  /* 🏷 아이 전용 프로필 창 (4차 2·5번) — 닉네임·학년·아이콘·아이 PIN            */
  /* ---------------------------------------------------------------- */

  /**
   * 아이 프로필 값 저장 — 부모면 가족 설정(폰끼리 함께)에, 아이면 이 폰에만 저장합니다.
   * (가족 설정은 부모 + PIN 이 있어야 저장되는 구조라, 아이 혼자 바꾼 값은 이 폰에 둡니다)
   */
  const saveChildProfile = useCallback(
    async (
      memberId: string,
      patch: { name?: string; grade?: string; emoji?: string },
    ): Promise<ActionResult & { deviceOnly?: boolean }> => {
      const known =
        dbRef.current.members.some((member) => member.id === memberId) ||
        appSettingsRef.current.extraMembers.some((member) => member.id === memberId);
      if (!known) return { ok: false, error: '구성원을 찾지 못했어요.' };

      const name = patch.name?.trim().slice(0, 20);
      const grade = patch.grade?.trim().slice(0, 10);
      const emoji = patch.emoji?.trim().slice(0, 8);
      if (!name && !grade && !emoji) return { ok: false, error: '바꿀 값을 하나 이상 적어 주세요.' };

      const actor =
        dbRef.current.members.find((member) => member.id === currentMemberIdRef.current) ??
        dbRef.current.members[0];
      const viewerIsParent = actor?.role === 'parent';

      // 아이가 바꾸는 값은 이 폰에만 (가족 설정은 부모만 저장할 수 있음)
      if (!viewerIsParent) {
        const next = { ...selfProfilesRef.current };
        const entry: SelfProfile = { ...(next[memberId] ?? {}) };
        if (name) entry.name = name;
        if (grade) entry.grade = grade;
        if (emoji) entry.emoji = emoji;
        next[memberId] = entry;
        applySelfProfiles(next);
        return { ok: true, deviceOnly: true };
      }

      const patchSettings: Partial<AppSettings> = {};
      if (name) patchSettings.profileNames = { ...appSettingsRef.current.profileNames, [memberId]: name };
      if (grade) patchSettings.profileGrades = { ...appSettingsRef.current.profileGrades, [memberId]: grade };
      if (emoji) patchSettings.profileEmoji = { ...appSettingsRef.current.profileEmoji, [memberId]: emoji };
      const result = await saveAppSettings(patchSettings);
      if (!result.ok) return { ok: false, error: result.error };

      // 부모가 정한 값이면 이 폰의 예전 아이 설정은 지워 둡니다(같은 값이 두 번 덮이지 않게).
      // 아이가 이 폰에서 정해 둔 PIN 은 지우지 않고 그대로 둡니다.
      if (selfProfilesRef.current[memberId]) {
        const next = { ...selfProfilesRef.current };
        const entry = { ...next[memberId] };
        delete entry.name;
        delete entry.grade;
        delete entry.emoji;
        if (Object.keys(entry).length > 0) next[memberId] = entry;
        else delete next[memberId];
        applySelfProfiles(next);
      }
      return { ok: true };
    },
    [applySelfProfiles, saveAppSettings],
  );

  /** 🏷 아이가 자기 PIN 을 정하기·바꾸기 — 지금 PIN 이 있으면 먼저 확인합니다. */
  const setChildProfilePin = useCallback(
    async (
      memberId: string,
      pin: string,
      currentPin?: string,
    ): Promise<ActionResult & { deviceOnly?: boolean }> => {
      if (!isPinFormat(pin)) return { ok: false, error: 'PIN은 4자리 숫자로 정해 주세요.' };
      const known =
        dbRef.current.members.some((member) => member.id === memberId) ||
        appSettingsRef.current.extraMembers.some((member) => member.id === memberId);
      if (!known) return { ok: false, error: '구성원을 찾지 못했어요.' };

      const existing = selfProfilesRef.current[memberId]?.pin ?? appSettingsRef.current.profilePins[memberId];
      if (existing) {
        if (!currentPin || !isPinFormat(currentPin)) {
          return { ok: false, error: '지금 쓰는 아이 PIN 4자리를 먼저 넣어 주세요.' };
        }
        const valid = await verifyHashedPin(currentPin, existing);
        if (!valid) return { ok: false, error: '지금 쓰는 PIN이 맞지 않아요.' };
      }

      const record = await hashPin(pin);
      const actor =
        dbRef.current.members.find((member) => member.id === currentMemberIdRef.current) ??
        dbRef.current.members[0];

      // 부모 화면에서 바꾸면 가족 설정에 (아이 폰에서도 같은 PIN)
      if (actor?.role === 'parent') {
        const result = await saveAppSettings({
          profilePins: { ...appSettingsRef.current.profilePins, [memberId]: record },
        });
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      const next = { ...selfProfilesRef.current };
      next[memberId] = { ...(next[memberId] ?? {}), pin: record };
      applySelfProfiles(next);
      return { ok: true, deviceOnly: true };
    },
    [applySelfProfiles, saveAppSettings],
  );

  /** 🏷 아이가 자기 PIN 을 지우기 — 지금 PIN 확인 후 */
  const resetChildProfilePin = useCallback(
    async (memberId: string, currentPin?: string): Promise<ActionResult & { deviceOnly?: boolean }> => {
      const existing = selfProfilesRef.current[memberId]?.pin ?? appSettingsRef.current.profilePins[memberId];
      if (existing) {
        if (!currentPin || !isPinFormat(currentPin)) {
          return { ok: false, error: '지금 쓰는 아이 PIN 4자리를 먼저 넣어 주세요.' };
        }
        const valid = await verifyHashedPin(currentPin, existing);
        if (!valid) return { ok: false, error: '지금 쓰는 PIN이 맞지 않아요.' };
      }
      const actor =
        dbRef.current.members.find((member) => member.id === currentMemberIdRef.current) ??
        dbRef.current.members[0];
      if (actor?.role === 'parent') {
        const next = { ...appSettingsRef.current.profilePins };
        delete next[memberId];
        const result = await saveAppSettings({ profilePins: next });
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }
      const overlays = { ...selfProfilesRef.current };
      if (overlays[memberId]?.pin) {
        const entry = { ...overlays[memberId] };
        delete entry.pin;
        if (Object.keys(entry).length > 0) overlays[memberId] = entry;
        else delete overlays[memberId];
        applySelfProfiles(overlays);
      }
      return { ok: true, deviceOnly: true };
    },
    [applySelfProfiles, saveAppSettings],
  );

  /** 🆕 새 프로필 만들기 — 이름·아이콘·역할·PIN. 추가 SQL 없이 가족 설정 JSON 에 저장합니다. */
  const createProfile = useCallback(
    async (
      input: {
        name: string;
        emoji: string;
        role: 'parent' | 'child';
        pin?: string;
      },
      /** 부모 PIN 을 확인한 부모 계정 id — 없으면 지금 보고 있는 사람 */
      actorId?: string,
    ): Promise<ActionResult & { memberId?: string }> => {
      const name = input.name.trim().slice(0, 20);
      if (!name) return { ok: false, error: '이름을 적어 주세요.' };
      if (input.pin && !isPinFormat(input.pin)) {
        return { ok: false, error: 'PIN은 4자리 숫자로 정해 주세요.' };
      }
      const current = appSettingsRef.current;
      if (current.extraMembers.length >= 8) {
        return { ok: false, error: '새 프로필은 8개까지 만들 수 있어요.' };
      }
      const db = dbRef.current;
      const actor =
        db.members.find((member) => member.id === (actorId ?? currentMemberIdRef.current)) ??
        db.members.find((member) => member.role === 'parent') ??
        db.members[0];
      const colors = ['sky', 'violet', 'rose', 'amber'] as const;
      const id = newProfileId(input.role);
      const member: Member = {
        id,
        family_id: actor?.family_id ?? db.families[0]?.id ?? '',
        name,
        role: input.role,
        emoji: input.emoji.trim() || (input.role === 'parent' ? '🧑' : '🙂'),
        color: colors[current.extraMembers.length % colors.length],
        presets: [],
        created_at: new Date().toISOString(),
      };
      const patch: Partial<AppSettings> = {
        extraMembers: [...current.extraMembers, member].slice(0, 8),
      };
      if (input.pin) {
        patch.profilePins = { ...current.profilePins, [id]: await hashPin(input.pin) };
      }
      const result = await saveSettingsAs(actor?.id ?? '', patch);
      if (!result.ok) return { ok: false, error: result.error };

      // 가족 DB 에 구성원을 만들 수 있으면(study_add_member 함수가 있으면) 공부까지 함께 저장됩니다.
      if (cloud && modeRef.current === 'supabase' && actor) {
        try {
          const saved = await cloud.addMember(
            actor.id,
            { id: member.id, name: member.name, role: member.role, emoji: member.emoji },
            sessionPinRef.current,
          );
          if (saved) {
            dbRef.current = { ...dbRef.current, members: [...dbRef.current.members, saved] };
            setDb(dbRef.current);
          }
        } catch (error) {
          // 함수가 없거나(설정만 저장됨) 이름이 겹치는 경우 — 프로필은 설정 JSON 으로 계속 살아 있습니다.
          console.warn('[study-check] 구성원 표에 새 프로필을 만들지 못했습니다', error);
        }
      }

      return { ok: true, memberId: id };
    },
    [cloud, saveSettingsAs],
  );

  /** 📅 최근 12개월 월말 결산 — 이미 남긴 결산(난이도 바꿀 때 고정)이 있으면 그것을 그대로 보여 줍니다. */
  const monthlySettlements = useMemo(() => {
    const map: Record<string, MonthSettlement[]> = {};
    const today = koreaTodayISO();
    const seasons = recentSeasons(today);
    for (const member of db.members) {
      if (member.role !== 'child') continue;
      const frozen = appSettings.settlements[member.id] ?? {};
      map[member.id] = seasons.map((season) => {
        const saved = frozen[season];
        return settlementOf(
          db.tasks,
          member.id,
          season,
          today,
          xpRules,
          saved
            ? { xp: saved.xp, title: saved.title, tier: saved.tier, division: saved.division, level: saved.level }
            : null,
        );
      });
    }
    return map;
  }, [db.tasks, db.members, appSettings.settlements, xpRules]);

  const monthlySettlementsFor = useCallback(
    (memberId: string) => monthlySettlements[memberId] ?? [],
    [monthlySettlements],
  );

  const currentMember = displayMembers.find((member) => member.id === currentMemberId) ?? displayMembers[0];

  /** 아직 확인하지 않은 새 한마디 — 다른 사람이 남긴 것만 알립니다. */
  const unseenNotes = useMemo(() => {
    const seenTime = notesSeenAt ? noteTime(notesSeenAt) : 0;
    return notes.filter((note) => note.author_id !== currentMember?.id && noteTime(note) > seenTime);
  }, [notes, notesSeenAt, currentMember]);

  const tasksFor = useCallback(
    (memberId: string, dateIso: string) =>
      sortTasks(
        db.tasks.filter(
          (task) => task.member_id === memberId && task.due_date === dateIso && !isShopTask(task),
        ),
      ),
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
      members: displayMembers,
      parents: displayMembers.filter((member) => member.family_id === currentMember.family_id && member.role === 'parent'),
      children: displayMembers.filter((member) => member.family_id === currentMember.family_id && member.role === 'child'),
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
      postJjokkoNote,
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
      appSettings,
      setMemberEmoji,
      burstFactor: 1 + appSettings.burstPercent / 100,
      burstFactorText: burstFactorLabel(appSettings.burstPercent),
      profilePins: appSettings.profilePins,
      hasProfilePin,
      verifyProfilePin,
      setProfilePin,
      resetProfilePin,
      saveChildProfile,
      setChildProfilePin,
      resetChildProfilePin,
      createProfile,
      monthlySettlementsFor,
      settingsSync,
      saveAppSettings,
      consumeBonusTime,
      grantBonusTime,
      parentRecovery: appSettings.parentRecovery,
      saveParentRecovery,
      resetParentPinWithRecovery,
      changeParentPin,
      parentPinRecoveryMode,
      xpRules,
      burstActive: burstActiveToday(appSettings, koreaTodayISO()),
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
    postJjokkoNote,
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
    appSettings,
    settingsSync,
    saveAppSettings,
    consumeBonusTime,
    grantBonusTime,
    xpRules,
    sessionPin,
    localPinReady,
    setMemberEmoji,
    hasProfilePin,
    verifyProfilePin,
    setProfilePin,
    resetProfilePin,
    saveChildProfile,
    setChildProfilePin,
    resetChildProfilePin,
    createProfile,
    monthlySettlementsFor,
    displayMembers,
    unlockParent,
    setParentPin,
    saveParentRecovery,
    resetParentPinWithRecovery,
    changeParentPin,
    parentPinRecoveryMode,
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
