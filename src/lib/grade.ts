/**
 * 학년 자동 진급 — 저장된 학년에 지난 학년도를 더해 화면에 보여 줍니다.
 *
 * 저장값(member.grade)은 부모가 적어 둔 그대로 두고, 보여 줄 때만 계산합니다.
 * (해가 바뀌어도 저장값을 고치지 않아도 되고, 되돌릴 일도 없습니다)
 *
 * 한국 학교는 3월 1일에 새 학년도가 시작합니다.
 * 그래서 1·2월은 아직 지난 학년도이고, 3월 1일부터 한 학년 올라갑니다.
 */

const KOREA_TIME_ZONE = 'Asia/Seoul';

/** 초1~고3 을 1~12 로 이어 붙인 값. */
const LEVELS = [
  { mark: '초', max: 6, start: 1 },
  { mark: '중', max: 3, start: 7 },
  { mark: '고', max: 3, start: 10 },
] as const;

export const GRADUATED_GRADE = '졸업';

/** 한국 시간(Asia/Seoul) 기준 오늘의 연·월 */
const KOREA_YEAR_MONTH = new Intl.DateTimeFormat('en-US', {
  timeZone: KOREA_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
});

function koreaYearMonth(now: Date): { year: number; month: number } {
  const parts = KOREA_YEAR_MONTH.formatToParts(now);

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return {
    year: Number.isFinite(year) ? year : now.getFullYear(),
    month: Number.isFinite(month) ? month : now.getMonth() + 1,
  };
}

/**
 * '학년도' — 3월부터 새 학년도입니다.
 * 2026-11-24 → 2026, 2027-02-28 → 2026, 2027-03-01 → 2027
 */
export function schoolYearOf(now: Date = new Date()): number {
  const { year, month } = koreaYearMonth(now);
  return month >= 3 ? year : year - 1;
}

/** '초1'~'고3' 을 1~12 로. 학년 형태가 아니면 null. */
function toGradeIndex(grade: string): number | null {
  const trimmed = grade.trim();
  for (const level of LEVELS) {
    if (!trimmed.startsWith(level.mark)) continue;
    const rest = trimmed.slice(level.mark.length);
    if (!/^[0-9]$/.test(rest)) continue;
    const number = Number(rest);
    if (number < 1 || number > level.max) return null;
    return level.start + number - 1;
  }
  return null;
}

/** 1~12 를 다시 '초1'~'고3' 으로. */
function fromGradeIndex(index: number): string {
  if (index <= 6) return `초${index}`;
  if (index <= 9) return `중${index - 6}`;
  return `고${index - 9}`;
}

/**
 * 저장된 학년을 오늘 기준으로 보여 줄 학년으로 바꿉니다.
 *
 * @param savedGrade 저장된 학년 ('초4', '중1' …)
 * @param baseYear   그 학년을 적어 둔 학년도 (기본 2026 = 이 앱을 쓰기 시작한 해)
 * @param now        오늘 (테스트용으로 넣을 수 있습니다)
 *
 * 학년 형태가 아니면(빈 값·'유치원' 등) 적힌 그대로 돌려줍니다.
 * 고3 을 지나면 '졸업'.
 */
export function displayGrade(savedGrade: string, baseYear = 2026, now: Date = new Date()): string {
  const index = toGradeIndex(savedGrade);
  if (index === null) return savedGrade;

  const delta = Math.max(0, schoolYearOf(now) - baseYear);
  if (delta === 0) return fromGradeIndex(index);

  const next = index + delta;
  return next > 12 ? GRADUATED_GRADE : fromGradeIndex(next);
}
