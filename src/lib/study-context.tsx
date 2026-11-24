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
import { LocalStorageAdapter, type RemoteEvent, type RealtimeState, type StorageChange, type StorageKind } from './storage';
import { StorageSetupError, createSupabaseAdapter } from './supabase';
import type { Member, NewTaskInput, StudyDB, Task, TaskStatus } from './types';

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
