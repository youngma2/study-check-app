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
        { title: '스픽 30분', subject: 'english' },
        { title: '타자 연습 20분', subject: 'etc' },
        { title: '영어 단어 5개 외우기', subject: 'english' },
        { title: '책 읽기 30분', subject: 'reading' },
        { title: '문제집과 오답 노트', subject: 'math' },
        { title: '독서록 (아빠 검사)', subject: 'reading' },
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
        { title: '온리원', subject: 'etc' },
        { title: '스픽 30분', subject: 'english' },
        { title: '문제집과 오답 노트', subject: 'math' },
        { title: '신문 요약', subject: 'korean' },
        { title: '책 읽기 30분', subject: 'reading' },
        { title: '타자 연습 20분', subject: 'etc' },
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

/** 샘플 주간 항목 — 실제로 쓰는 '기본 목록' 그대로. 첫째(스픽·단어·타자·책·문제집·독서록), 둘째(온리원·스픽·문제집·신문·책·타자) */
const WEEKLY_PLANS: Record<string, PlanItem[]> = {
  mem_child1: [
    { title: '스픽 30분', subject: 'english', days: [0, 1, 2, 3, 4, 5] },
    { title: '영어 단어 5개 외우기', subject: 'english', days: [0, 1, 2, 3, 4] },
    { title: '타자 연습 20분', subject: 'etc', days: [0, 1, 2, 3, 4] },
    { title: '책 읽기 30분', subject: 'reading', days: [0, 1, 2, 3, 4, 5] },
    { title: '문제집과 오답 노트', subject: 'math', days: [1, 3] },
    { title: '독서록 (아빠 검사)', subject: 'reading', days: [5] },
  ],
  mem_child2: [
    { title: '온리원', subject: 'etc', days: [0, 1, 2, 3, 4] },
    { title: '스픽 30분', subject: 'english', days: [0, 1, 2, 3, 4, 5] },
    { title: '문제집과 오답 노트', subject: 'math', days: [0, 1, 2, 3, 4] },
    { title: '신문 요약', subject: 'korean', days: [0, 2, 4] },
    { title: '책 읽기 30분', subject: 'reading', days: [0, 1, 2, 3, 4, 5, 6] },
    { title: '타자 연습 20분', subject: 'etc', days: [0, 1, 2, 3, 4] },
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
          // ⚖️ 샘플은 '그 날 저녁 8:40(한국 시간)'에 끝낸 것으로 둡니다 — 그 날 완료(XP 100%)로 보이게.
          // (UTC 로는 같은 날 11:40Z = KST 20:40. 20:40Z 로 두면 한국 날짜로 다음 날이 되어 50%가 됩니다)
          verified_at: verified ? `${dateIso}T11:40:00.000Z` : null,
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
