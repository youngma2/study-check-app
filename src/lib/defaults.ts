/**
 * '기본 목록' — 고른 날짜에 그 아이가 원래 하던 공부를 한 번에 넣습니다.
 *
 * 요일마다 하는 공부가 다르므로, 그 아이의 지난 기록에서 **같은 요일 패턴**의 가장 최근 하루를 찾아
 * 그날 항목을 그대로 가져옵니다. 가족마다 다른 항목을 코드에 적어 두지 않아도 되고,
 * 아이가 실제로 해 온 목록이 기준이 됩니다.
 *
 *   · 토요일        → 지난 토요일
 *   · 월·수·금      → 지난 월·수·금 중 가장 최근 날 (격주인 '상담' 같은 항목은 빼고)
 *   · 화·목         → 지난 화·목 중 가장 최근 날
 *   · 지난 기록이 없으면 → 그 아이의 빠른 추가 항목(presets)
 *
 * 일요일·공휴일(쉬는 날)은 호출하는 쪽에서 먼저 걸러 냅니다.
 */

import { fromISODate } from './date';
import type { Member, Task } from './types';

/** 요일 패턴에 따라 다시 넣지 않는 항목 (격주로 하는 것) — 제목에 이 말이 들어가면 건너뜁니다. */
const BIWEEKLY_HINTS = ['상담'];

export interface DefaultListItem {
  title: string;
  subject: string;
}

/** 그 날짜가 어떤 요일 묶음에 속하는지. 일요일은 빈 배열(쉬는 날). */
export function patternDaysFor(iso: string): number[] {
  const day = fromISODate(iso).getDay();
  if (day === 6) return [6];
  if (day === 1 || day === 3 || day === 5) return [1, 3, 5];
  if (day === 2 || day === 4) return [2, 4];
  return [];
}

function keyOf(item: { title: string; subject: string }): string {
  return `${item.title.trim()}::${item.subject}`;
}

function isBiweekly(title: string): boolean {
  return BIWEEKLY_HINTS.some((hint) => title.includes(hint));
}

/**
 * 그 아이의 지난 기록에서 같은 요일 패턴의 가장 최근 하루 항목을 고릅니다.
 * (대상 날짜에 이미 있는 항목은 빼고 돌려줍니다)
 */
export function defaultItemsForDay(tasks: Task[], member: Member, targetIso: string): DefaultListItem[] {
  const pattern = patternDaysFor(targetIso);
  const mine = tasks.filter((task) => task.member_id === member.id);

  const taken = new Set(
    mine.filter((task) => task.due_date === targetIso).map((task) => keyOf(task)),
  );

  const picked: DefaultListItem[] = [];
  const seen = new Set<string>();

  const historyDates = Array.from(
    new Set(
      mine
        .filter((task) => task.due_date < targetIso && pattern.includes(fromISODate(task.due_date).getDay()))
        .map((task) => task.due_date),
    ),
  ).sort();
  const latest = historyDates[historyDates.length - 1];

  if (latest) {
    // 월·수·금 묶음에는 격주 항목이 섞여 있으므로 빼고 가져옵니다.
    const dropBiweekly = pattern.length === 3;
    for (const task of mine.filter((task) => task.due_date === latest)) {
      if (dropBiweekly && isBiweekly(task.title)) continue;
      const key = keyOf(task);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ title: task.title, subject: task.subject });
    }
  }

  if (picked.length === 0) {
    for (const preset of member.presets ?? []) {
      const key = keyOf(preset);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ title: preset.title, subject: preset.subject });
    }
  }

  return picked.filter((item) => !taken.has(keyOf(item)));
}
