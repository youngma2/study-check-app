/** 앱 전체에서 쓰는 도메인 타입. Supabase 테이블 구조(supabase/schema.sql)와 1:1로 맞춰 두었습니다. */

export type Role = 'parent' | 'child';

/** 숙제 상태: 할 일 → 확인 대기(아이 완료 요청) → 확인 완료(부모 검증) */
export type TaskStatus = 'todo' | 'pending_verification' | 'verified';

export type MemberColor = 'sky' | 'violet' | 'rose' | 'amber';

export interface TaskPreset {
  title: string;
  subject: string;
}

/** 가족 단위. 가족이 늘어나도 family_id 로만 구분되도록 모든 행에 family_id 를 둡니다. */
export interface Family {
  id: string;
  name: string;
  created_at: string;
}

export interface Member {
  id: string;
  family_id: string;
  name: string;
  role: Role;
  /** '중1', '초4' 처럼 학년을 자유롭게 적습니다. 부모는 비워 둡니다. */
  grade?: string;
  emoji: string;
  color: MemberColor;
  /** 빠른 추가용 자주 쓰는 항목 */
  presets: TaskPreset[];
  created_at: string;
}

export interface Task {
  id: string;
  family_id: string;
  member_id: string;
  title: string;
  subject: string;
  /** YYYY-MM-DD (기기 로컬 날짜 기준) */
  due_date: string;
  status: TaskStatus;
  note?: string;
  created_by: string;
  created_at: string;
  verified_by?: string | null;
  verified_at?: string | null;
  /** 마지막으로 바꾼 시각 — completed_at·updated_at 이 없는 예전 행의 완료 시각으로 씁니다. */
  updated_at?: string | null;
}

/**
 * 한마디를 남긴 주체.
 * · 'member' — 가족이 직접 남긴 글
 * · 'jjokko' — 쪼꼬가 자동으로 남긴 알림(티어 승급·부재중 전화 등). 화면에는 '🐣 쪼꼬' 로 보입니다.
 */
export type NoteAuthorKind = 'member' | 'jjokko';

/** 💬 우리 가족 한마디 — 가족 알림판에 남긴 짧은 글. */
export interface FamilyNote {
  id: string;
  family_id: string;
  /** 쓴 사람 (family_members.id) — 쪼꼬 글도 DB 에는 부모 id 로 들어갑니다(알림이 모든 폰에 가도록). */
  author_id: string;
  /** 자동 알림이면 'jjokko'. 예전 글·기기 저장 모드에는 없을 수 있습니다. */
  author_kind?: NoteAuthorKind;
  content: string;
  created_at: string;
}

export interface StudyDB {
  version: number;
  families: Family[];
  members: Member[];
  tasks: Task[];
}

export interface NewTaskInput {
  /** 미리 정한 id (상점 장부처럼 여러 폰에서 같은 줄이 겹치지 않게 할 때) — 없으면 새로 만듭니다. */
  id?: string;
  member_id: string;
  title: string;
  subject: string;
  due_date: string;
  note?: string;
}
