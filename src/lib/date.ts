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

/**
 * 한국(Asia/Seoul) 기준 오늘 'YYYY-MM-DD'.
 * 기기 시간대가 달라도 우리 가족의 '오늘'은 한국 날짜로 셉니다.
 */
const KOREA_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function koreaTodayISO(now: Date = new Date()): string {
  const parts = KOREA_DATE_FORMAT.formatToParts(now);

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = value('year') || String(now.getFullYear());
  const month = value('month') || String(now.getMonth() + 1).padStart(2, '0');
  const day = value('day') || String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 아직 오지 않은 날짜인지 — 그날이 되기 전에는 완료 체크를 막습니다. */
export function isFutureDate(iso: string, today: string = koreaTodayISO()): boolean {
  return iso > today;
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

/** 숙제를 완료 체크한 시각을 '오후 8:42' 처럼 보여 줍니다. */
export function formatTimeKo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hours < 12 ? '오전' : '오후';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${meridiem} ${hour12}:${minutes}`;
}

/** 복사 대상 날짜 칩에 쓰는 짧은 표기: '11/25 (화)' */
export function formatShortDate(iso: string): string {
  const date = fromISODate(iso);
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAY_LABELS[date.getDay()]})`;
}

/** '오늘' / '내일' / '어제' 처럼 짧게 표시. 해당 없으면 null */
export function relativeDayLabel(iso: string): string | null {
  const today = todayISO();
  if (iso === today) return '오늘';
  if (iso === toISODate(addDays(new Date(), 1))) return '내일';
  if (iso === toISODate(addDays(new Date(), -1))) return '어제';
  return null;
}

/* ------------------------------------------------------------------ */
/* 공휴일 (달력에 빨간색으로 표시)                                      */
/* ------------------------------------------------------------------ */

/**
 * 2026–2027년 관공서 공휴일. (한국천문연구원 월력요항 · 대체공휴일 포함)
 * 음력 명절(설날·부처님오신날·추석)과 대체공휴일은 해마다 날짜가 달라서 표로 적어 둡니다.
 * 임시공휴일(정부 수시 지정)은 들어 있지 않습니다.
 */
const HOLIDAYS_2026_2027: Record<string, string> = {
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '대체공휴일',
  '2026-05-01': '노동절',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일',
  '2026-06-03': '지방선거일',
  '2026-06-06': '현충일',
  '2026-07-17': '제헌절',
  '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  // 2027
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절',
  '2027-05-01': '노동절',
  '2027-05-03': '대체공휴일',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-07-17': '제헌절',
  '2027-07-19': '대체공휴일',
  '2027-08-15': '광복절',
  '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절',
  '2027-10-04': '대체공휴일',
  '2027-10-09': '한글날',
  '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절',
  '2027-12-27': '대체공휴일',
};

/** 해와 상관없이 같은 날짜인 공휴일 */
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
};

/** 그 날이 공휴일이면 이름을, 아니면 null. */
export function holidayName(iso: string): string | null {
  const exact = HOLIDAYS_2026_2027[iso];
  if (exact) return exact;

  const monthDay = iso.slice(5);
  const year = Number(iso.slice(0, 4));
  if (year >= 2026) {
    // 2026년부터 노동절(5/1)과 제헌절(7/17)도 공휴일입니다.
    if (monthDay === '05-01') return '노동절';
    if (monthDay === '07-17') return '제헌절';
  }
  return FIXED_HOLIDAYS[monthDay] ?? null;
}

/** 공휴일이거나 일요일이면 쉬는 날(달력에 빨간색). */
export function isRestDay(iso: string): boolean {
  return holidayName(iso) !== null || fromISODate(iso).getDay() === 0;
}
