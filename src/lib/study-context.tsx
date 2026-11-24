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
  loadCurrentMemberId,
  parentsOf,
  saveCurrentMemberId,
  sortTasks,
  summarize,
  type TaskPatch,
  type TaskSummary,
} from './store';
import { createStorageAdapter, type StorageKind } from './storage';
import type { Member, NewTaskInput, StudyDB, Task, TaskStatus } from './types';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

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
  setCurrentMember: (memberId: string) => void;
  tasksFor: (memberId: string, dateIso: string) => Task[];
  summaryFor: (memberId: string, dateIso: string) => TaskSummary;
  addTask: (input: NewTaskInput) => ActionResult;
  editTask: (taskId: string, patch: TaskPatch) => ActionResult;
  setStatus: (taskId: string, status: TaskStatus) => ActionResult;
  removeTask: (taskId: string) => ActionResult;
  resetDemo: () => ActionResult;
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

export function StudyProvider({ children }: { children: ReactNode }) {
  const storage = useMemo(() => createStorageAdapter(), []);
  const [db, setDb] = useState<StudyDB>(() => createInitialDB());
  const dbRef = useRef(db);
  dbRef.current = db;

  const [currentMemberId, setCurrentMemberIdState] = useState<string>(() =>
    resolveInitialMemberId(dbRef.current),
  );
  const currentMemberIdRef = useRef(currentMemberId);
  currentMemberIdRef.current = currentMemberId;

  const [syncState, setSyncState] = useState<SyncState>(
    storage.kind === 'local' ? 'local' : 'syncing',
  );
  const skipNextSave = useRef(false);

  useEffect(() => {
    saveCurrentMemberId(currentMemberId);
  }, [currentMemberId]);

  // 클라우드 모드일 때만: 로그인한 가족의 데이터를 한 번 받아 옵니다.
  useEffect(() => {
    if (storage.kind !== 'supabase') return;
    let alive = true;

    storage
      .load()
      .then((remote) => {
        if (!alive) return;
        if (remote && remote.members.length > 0) {
          skipNextSave.current = true;
          dbRef.current = remote;
          setDb(remote);
          setCurrentMemberIdState((prev) => {
            if (remote.members.some((member) => member.id === prev)) return prev;
            return remote.members.find((member) => member.role === 'parent')?.id ?? remote.members[0].id;
          });
        }
        setSyncState('synced');
      })
      .catch((error: unknown) => {
        console.warn('[study-check] Supabase 불러오기 실패', error);
        if (alive) setSyncState('error');
      });

    return () => {
      alive = false;
    };
  }, [storage]);

  useEffect(() => {
    if (storage.kind === 'supabase' && syncState !== 'synced') return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    void storage.save(db).catch((error: unknown) => {
      console.warn('[study-check] 저장 실패', error);
    });
  }, [db, storage, syncState]);

  const run = useCallback((mutate: (current: StudyDB, actor: Member) => StudyDB): ActionResult => {
    const current = dbRef.current;
    const actor = current.members.find((member) => member.id === currentMemberIdRef.current) ?? current.members[0];
    try {
      const next = mutate(current, actor);
      if (next !== current) {
        dbRef.current = next;
        setDb(next);
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
      };
    }
  }, []);

  const addTask = useCallback(
    (input: NewTaskInput) => run((current, actor) => addTaskPure(current, actor, input)),
    [run],
  );

  const editTask = useCallback(
    (taskId: string, patch: TaskPatch) => run((current, actor) => editTaskPure(current, actor, taskId, patch)),
    [run],
  );

  const setStatus = useCallback(
    (taskId: string, status: TaskStatus) =>
      run((current, actor) => changeTaskStatus(current, actor, taskId, status)),
    [run],
  );

  const removeTask = useCallback(
    (taskId: string) => run((current, actor) => deleteTaskPure(current, actor, taskId)),
    [run],
  );

  const resetDemo = useCallback(
    () =>
      run((_current, actor) => {
        if (actor.role !== 'parent') {
          throw new PermissionError('샘플 초기화는 부모만 할 수 있어요.');
        }
        return createDemoDB();
      }),
    [run],
  );

  const setCurrentMember = useCallback((memberId: string) => {
    if (!dbRef.current.members.some((member) => member.id === memberId)) return;
    setCurrentMemberIdState(memberId);
  }, []);

  const currentMember =
    db.members.find((member) => member.id === currentMemberId) ?? db.members[0];

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
      storageKind: storage.kind,
      syncState,
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
    storage.kind,
    syncState,
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
