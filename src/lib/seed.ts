import { addDays, startOfWeek, toISODate } from './date';
import type { Member, StudyDB, Task, TaskStatus } from './types';

export const DEMO_FAMILY_ID = 'fam_demo';

const FAMILY_NAME = '우리 가족 공부방';

function members(now: Date): Member[] {
  const createdAt = now.toISOString();
  return [
    {
      id: 'mem_dad',
      family_id: DEMO_FAMILY_ID,
      name: '아빠',
      role: 'parent',
      emoji: '👨🏻',
      color: 'sky',
      presets: [],
      created_at: createdAt,
    },
    {
      id: 'mem_mom',
      family_id: DEMO_FAMILY_ID,
      name: '엄마',
      role: 'parent',
      emoji: '👩🏻',
      color: 'violet',
      presets: [],
      created_at: createdAt,
    },
    {
      id: 'mem_child1',
      family_id: DEMO_FAMILY_ID,
      name: '첫째',
      role: 'child',
      grade: '중1',
      emoji: '🌸',
      color: 'rose',
      presets: [
        { title: '스픽 10분 말하기', subject: 'english' },
        { title: '영어 단어 10개 외우기', subject: 'english' },
        { title: '받아쓰기 연습', subject: 'korean' },
        { title: '수학 문제집 2쪽', subject: 'math' },
      ],
      created_at: createdAt,
    },
    {
      id: 'mem_child2',
      family_id: DEMO_FAMILY_ID,
      name: '둘째',
      role: 'child',
      grade: '초4',
      emoji: '⚡',
      color: 'amber',
      presets: [
        { title: '온리원 강의 듣기', subject: 'etc' },
        { title: '스픽 10분 말하기', subject: 'english' },
        { title: '문제집 2장 풀기', subject: 'math' },
        { title: '책 읽기 20분', subject: 'reading' },
      ],
      created_at: createdAt,
    },
  ];
}

interface PlanItem {
  title: string;
  subject: string;
  /** 0 = 월요일 … 6 = 일요일 */
  days: number[];
}

/** 샘플 주간 항목: 둘째(온리원·스픽·문제집·책 읽기), 첫째(스픽·영어 단어·받아쓰기·문제집) */
const WEEKLY_PLANS: Record<string, PlanItem[]> = {
  mem_child1: [
    { title: '스픽 10분 말하기', subject: 'english', days: [0, 1, 2, 3, 4, 5] },
    { title: '영어 단어 10개 외우기', subject: 'english', days: [0, 1, 2, 3, 4] },
    { title: '받아쓰기 연습', subject: 'korean', days: [0, 2, 4] },
    { title: '수학 문제집 2쪽', subject: 'math', days: [1, 3] },
  ],
  mem_child2: [
    { title: '온리원 강의 듣기', subject: 'etc', days: [0, 1, 2, 3, 4] },
    { title: '스픽 10분 말하기', subject: 'english', days: [0, 1, 2, 3, 4, 5] },
    { title: '문제집 2장 풀기', subject: 'math', days: [0, 1, 2, 3, 4] },
    { title: '책 읽기 20분', subject: 'reading', days: [0, 1, 2, 3, 4, 5, 6] },
  ],
};

function statusFor(dateIso: string, todayIso: string, yesterdayIso: string, order: number): TaskStatus {
  if (dateIso > todayIso) return 'todo';
  if (dateIso === todayIso) {
    if (order === 0) return 'verified';
    if (order === 1) return 'pending_verification';
    return 'todo';
  }
  // 어제 것은 한 개만 남겨 두어 부모가 '확인 완료'를 눌러 볼 수 있게 합니다.
  if (dateIso === yesterdayIso && order === 0) return 'pending_verification';
  return 'verified';
}

/** 이번 주(월~일) 샘플 데이터. 언제 열어도 '오늘' 기준으로 채워집니다. */
export function createSeedDB(now: Date = new Date()): StudyDB {
  const todayIso = toISODate(now);
  const yesterdayIso = toISODate(addDays(now, -1));
  const weekStart = startOfWeek(now);
  const family = { id: DEMO_FAMILY_ID, name: FAMILY_NAME, created_at: now.toISOString() };
  const familyMembers = members(now);
  const tasks: Task[] = [];

  for (const member of familyMembers) {
    if (member.role !== 'child') continue;
    const plan = WEEKLY_PLANS[member.id] ?? [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dateIso = toISODate(addDays(weekStart, dayIndex));
      let order = 0;

      for (const item of plan) {
        if (!item.days.includes(dayIndex)) continue;
        const status = statusFor(dateIso, todayIso, yesterdayIso, order);
        const verified = status === 'verified';
        tasks.push({
          id: `t_${member.id}_${dateIso}_${order}`,
          family_id: DEMO_FAMILY_ID,
          member_id: member.id,
          title: item.title,
          subject: item.subject,
          due_date: dateIso,
          status,
          created_by: member.id,
          created_at: `${dateIso}T08:10:00.000Z`,
          verified_by: verified ? 'mem_mom' : null,
          verified_at: verified ? `${dateIso}T20:40:00.000Z` : null,
        });
        order += 1;
      }
    }
  }

  return {
    version: 1,
    families: [family],
    members: familyMembers,
    tasks,
  };
}
