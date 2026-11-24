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
  saveCloudCache,
  saveCurrentMemberId,
  sortTasks,
  summarize,
  type TaskPatch,
  type TaskSummary,
} from './store';
import { LocalStorageAdapter, type RemoteEvent, type RealtimeState, type StorageChange, type StorageKind } from './storage';
import { StorageSetupError, createSupabaseAdapter } from './supabase';
import type { Member, NewTaskInput, StudyDB, Task, TaskStatus } from './types';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'setup' | 'error';

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
  setCurrentMember: (memberId: string) => void;
  tasksFor: (memberId: string, dateIso: string) => Task[];
  summaryFor: (memberId: string, dateIso: string) => TaskSummary;
  addTask: (input: NewTaskInput) => Promise<ActionResult>;
  editTask: (taskId: string, patch: TaskPatch) => Promise<ActionResult>;
  setStatus: (taskId: string, status: TaskStatus) => Promise<ActionResult>;
  removeTask: (taskId: string) => Promise<ActionResult>;
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
  for (const task of next.tasks) {
    const old = before.get(task.id);
    before.delete(task.id);
    if (!old) return { type: 'add', actorId, task };
    if (old !== task) {
      return old.status !== task.status
        ? { type: 'status', actorId, task, status: task.status }
        : { type: 'update', actorId, task };
    }
  }
  const removed = before.keys().next();
  if (!removed.done) return { type: 'delete', actorId, taskId: removed.value };
  return null;
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
      setCurrentMember,
      tasksFor,
      summaryFor,
      addTask,
      editTask,
      setStatus,
      removeTask,
      resetDemo,
    };
  }, [
    db,
    currentMember,
    mode,
    syncState,
    realtimeState,
    setCurrentMember,
    tasksFor,
    summaryFor,
    addTask,
    editTask,
    setStatus,
    removeTask,
    resetDemo,
  ]);

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useStudy(): StudyContextValue {
  const value = useContext(StudyContext);
  if (!value) throw new Error('useStudy 는 StudyProvider 안에서만 쓸 수 있어요.');
  return value;
}
