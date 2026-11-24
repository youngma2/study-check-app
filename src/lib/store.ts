import { createSeedDB } from './seed';
import type { Member, NewTaskInput, StudyDB, Task, TaskStatus } from './types';

/**
 * 앱의 도메인 계층.
 * - 저장/동기화는 storage.ts 어댑터가 담당하고, 여기서는 데이터 규칙과 권한만 다룹니다.
 * - 모든 변경 함수는 (db, actor, ...) 를 받아 새 db 를 돌려주는 순수 함수입니다.
 *   권한이 없으면 PermissionError 를 던지므로 UI 는 메시지를 그대로 보여 주면 됩니다.
 */

export const DB_VERSION = 1;
export const DB_STORAGE_KEY = 'study-check.db.v1';
export const CLOUD_CACHE_KEY = 'study-check.cloud.v1';
export const MEMBER_STORAGE_KEY = 'study-check.member.v1';

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

/* ------------------------------------------------------------------ */
/* 저장 (데모: localStorage)                                            */
/* ------------------------------------------------------------------ */

function isStudyDB(value: unknown): value is StudyDB {
  if (!value || typeof value !== 'object') return false;
  const db = value as Partial<StudyDB>;
  return (
    db.version === DB_VERSION &&
    Array.isArray(db.families) &&
    Array.isArray(db.members) &&
    db.members.length > 0 &&
    Array.isArray(db.tasks)
  );
}

export function loadLocalDB(): StudyDB | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DB_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStudyDB(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalDB(db: StudyDB): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    // 사생활 보호 모드나 용량 초과: 화면은 계속 쓸 수 있게 두고 콘솔에만 남깁니다.
    console.warn('[study-check] localStorage 저장 실패', error);
  }
}

/**
 * 클라우드에서 마지막으로 받은 목록의 사본.
 * 잠깐 연결이 끊겨도 '샘플 데이터' 대신 가족의 진짜 목록을 보여 주기 위한 것입니다(읽기 전용 캐시).
 */
export function loadCloudCache(): StudyDB | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CLOUD_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStudyDB(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCloudCache(db: StudyDB): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(db));
  } catch {
    // 캐시는 편의 기능이라 실패해도 조용히 넘어갑니다.
  }
}

export function loadCurrentMemberId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(MEMBER_STORAGE_KEY);
}

export function saveCurrentMemberId(memberId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MEMBER_STORAGE_KEY, memberId);
}

export function createInitialDB(): StudyDB {
  return loadLocalDB() ?? createSeedDB();
}

export function createDemoDB(): StudyDB {
  return createSeedDB();
}

/* ------------------------------------------------------------------ */
/* 조회                                                                */
/* ------------------------------------------------------------------ */

export function familyOf(db: StudyDB, familyId: string) {
  return db.families.find((family) => family.id === familyId);
}

export function memberById(db: StudyDB, memberId: string): Member | undefined {
  return db.members.find((member) => member.id === memberId);
}

export function childrenOf(db: StudyDB, familyId: string): Member[] {
  return db.members.filter((member) => member.family_id === familyId && member.role === 'child');
}

export function parentsOf(db: StudyDB, familyId: string): Member[] {
  return db.members.filter((member) => member.family_id === familyId && member.role === 'parent');
}

export function tasksOfMemberOnDate(db: StudyDB, memberId: string, dateIso: string): Task[] {
  return sortTasks(db.tasks.filter((task) => task.member_id === memberId && task.due_date === dateIso));
}

export function tasksOnDate(db: StudyDB, familyId: string, dateIso: string): Task[] {
  return db.tasks.filter((task) => task.family_id === familyId && task.due_date === dateIso);
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  pending_verification: 0,
  todo: 1,
  verified: 2,
};

/** 부모가 확인할 것이 먼저, 끝난 것은 아래로 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return a.created_at.localeCompare(b.created_at);
  });
}

export interface TaskSummary {
  total: number;
  todo: number;
  pending: number;
  verified: number;
  ratio: number;
}

export function summarize(tasks: Task[]): TaskSummary {
  const total = tasks.length;
  const todo = tasks.filter((task) => task.status === 'todo').length;
  const pending = tasks.filter((task) => task.status === 'pending_verification').length;
  const verified = tasks.filter((task) => task.status === 'verified').length;
  return { total, todo, pending, verified, ratio: total === 0 ? 0 : verified / total };
}

/* ------------------------------------------------------------------ */
/* 권한                                                                */
/* ------------------------------------------------------------------ */

export function canDeleteTask(actor: Member): boolean {
  return actor.role === 'parent';
}

/** 완료 체크: 부모는 아무 숙제나, 아이는 자기 숙제만. (체크한 시각이 기록됩니다) */
export function canCompleteTask(actor: Member, task: Task): boolean {
  return actor.role === 'parent' || task.member_id === actor.id;
}

/** 완료 되돌리기: 부모만 (DB 에서는 부모 관리 PIN 까지 확인) */
export function canRevertTask(actor: Member): boolean {
  return actor.role === 'parent';
}

/** 예전 이름 — 완료 체크는 이제 아이도 할 수 있어 `canCompleteTask` 를 씁니다. */
export function canVerifyTask(actor: Member): boolean {
  return actor.role === 'parent';
}

export function canEditTask(actor: Member): boolean {
  return actor.role === 'parent';
}

/** 부모는 아무 아이에게나, 아이는 자기 몫만 추가할 수 있습니다. */
export function canAddFor(actor: Member, memberId: string): boolean {
  return actor.role === 'parent' || actor.id === memberId;
}

/* ------------------------------------------------------------------ */
/* 변경                                                                */
/* ------------------------------------------------------------------ */

function requireTask(db: StudyDB, taskId: string): Task {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) throw new PermissionError('항목을 찾을 수 없어요. 새로고침해 주세요.');
  return task;
}

function replaceTask(db: StudyDB, next: Task): StudyDB {
  return { ...db, tasks: db.tasks.map((task) => (task.id === next.id ? next : task)) };
}

function assertSameFamily(actor: Member, task: Task): void {
  if (task.family_id !== actor.family_id) {
    throw new PermissionError('다른 가족의 항목은 바꿀 수 없어요.');
  }
}

function newTaskId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function addTask(db: StudyDB, actor: Member, input: NewTaskInput): StudyDB {
  const title = input.title.trim();
  if (!title) throw new PermissionError('무엇을 공부하는지 적어 주세요.');

  const target = memberById(db, input.member_id);
  if (!target || target.family_id !== actor.family_id) {
    throw new PermissionError('같은 가족 구성원에게만 추가할 수 있어요.');
  }
  if (!canAddFor(actor, target.id)) {
    throw new PermissionError('내 숙제만 추가할 수 있어요.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) {
    throw new PermissionError('날짜를 다시 선택해 주세요.');
  }

  const task: Task = {
    id: newTaskId(),
    family_id: actor.family_id,
    member_id: target.id,
    title,
    subject: input.subject,
    due_date: input.due_date,
    status: 'todo',
    note: input.note?.trim() || undefined,
    created_by: actor.id,
    created_at: new Date().toISOString(),
    verified_by: null,
    verified_at: null,
  };

  return { ...db, tasks: [...db.tasks, task] };
}

export interface TaskPatch {
  title?: string;
  subject?: string;
  note?: string;
  due_date?: string;
}

export function editTask(db: StudyDB, actor: Member, taskId: string, patch: TaskPatch): StudyDB {
  const task = requireTask(db, taskId);
  assertSameFamily(actor, task);
  if (!canEditTask(actor)) throw new PermissionError('항목 수정은 부모님만 할 수 있어요.');

  const title = patch.title?.trim() ?? task.title;
  if (!title) throw new PermissionError('항목 이름을 비워 둘 수 없어요.');
  if (patch.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_date)) {
    throw new PermissionError('날짜를 다시 선택해 주세요.');
  }

  return replaceTask(db, {
    ...task,
    title,
    subject: patch.subject ?? task.subject,
    note: patch.note !== undefined ? patch.note.trim() || undefined : task.note,
    due_date: patch.due_date ?? task.due_date,
  });
}

/**
 * 상태 변경은 역할에 따라 다릅니다.
 * - 완료 체크(verified): 부모는 아무 숙제나, 아이는 자기 숙제만. 누가·언제 완료했는지 남깁니다.
 * - 되돌리기: 완료된 숙제는 부모만 풀 수 있습니다. (DB 에서는 부모 관리 PIN 도 확인)
 */
export function changeTaskStatus(
  db: StudyDB,
  actor: Member,
  taskId: string,
  status: TaskStatus,
): StudyDB {
  const task = requireTask(db, taskId);
  assertSameFamily(actor, task);

  if (status === 'verified') {
    if (!canCompleteTask(actor, task)) throw new PermissionError('내 숙제만 완료할 수 있어요.');
    if (task.status === 'verified') return db;
    return replaceTask(db, {
      ...task,
      status,
      verified_by: actor.id,
      verified_at: new Date().toISOString(),
    });
  }

  // 완료를 푸는 쪽은 부모만
  if (task.status === 'verified') {
    if (!canRevertTask(actor)) throw new PermissionError('완료를 되돌리는 건 부모님만 할 수 있어요.');
    return replaceTask(db, { ...task, status, verified_by: null, verified_at: null });
  }

  // 완료 전 항목(레거시 '확인 대기' 포함)의 상태 바꾸기: 부모 또는 자기 것
  if (actor.role !== 'parent' && task.member_id !== actor.id) {
    throw new PermissionError('내 공부만 바꿀 수 있어요.');
  }
  return replaceTask(db, { ...task, status, verified_by: null, verified_at: null });
}

/** 구성원 이름 바꾸기: 부모만. (아이디는 그대로라 링크·숙제가 유지됩니다) */
export function renameMember(db: StudyDB, actor: Member, memberId: string, name: string): StudyDB {
  if (actor.role !== 'parent') throw new PermissionError('이름 바꾸기는 부모님만 할 수 있어요.');
  const target = memberById(db, memberId);
  if (!target || target.family_id !== actor.family_id) {
    throw new PermissionError('같은 가족 구성원의 이름만 바꿀 수 있어요.');
  }
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 30) {
    throw new PermissionError('이름은 1~30자로 적어 주세요.');
  }
  return {
    ...db,
    members: db.members.map((member) => (member.id === memberId ? { ...member, name: trimmed } : member)),
  };
}

export function deleteTask(db: StudyDB, actor: Member, taskId: string): StudyDB {
  const task = requireTask(db, taskId);
  assertSameFamily(actor, task);
  if (!canDeleteTask(actor)) {
    throw new PermissionError('아이는 항목을 삭제할 수 없어요. 부모님께 알려 주세요.');
  }
  return { ...db, tasks: db.tasks.filter((item) => item.id !== taskId) };
}
