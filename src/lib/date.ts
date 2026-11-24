/** 날짜는 전부 기기 로컬 시간 기준 'YYYY-MM-DD' 문자열로 다룹니다. (UTC 변환으로 하루씩 밀리는 문제 방지) */

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 월요일 시작 주 */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const diff = (day.getDay() + 6) % 7;
  return addDays(day, -diff);
}

export function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function formatDayTitle(iso: string): string {
  const date = fromISODate(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_LABELS[date.getDay()]}요일`;
}

export function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const thisYear = weekStart.getFullYear();
  const sameMonth = weekStart.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${thisYear}.${weekStart.getMonth() + 1}.${weekStart.getDate()} – ${end.getDate()}`;
  }
  const endYear = end.getFullYear() !== thisYear ? `${end.getFullYear()}.` : '';
  return `${thisYear}.${weekStart.getMonth() + 1}.${weekStart.getDate()} – ${endYear}${end.getMonth() + 1}.${end.getDate()}`;
}

/** '오늘' / '내일' / '어제' 처럼 짧게 표시. 해당 없으면 null */
export function relativeDayLabel(iso: string): string | null {
  const today = todayISO();
  if (iso === today) return '오늘';
  if (iso === toISODate(addDays(new Date(), 1))) return '내일';
  if (iso === toISODate(addDays(new Date(), -1))) return '어제';
  return null;
}
