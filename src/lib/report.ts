import { addDays, fromISODate, koreaTodayISO, toISODate, WEEKDAY_LABELS } from './date';
import { DIVISIONS, formatXp, isStreakDay, isXpHiddenTask, type TierKey } from './season';
import type { TierEvent } from './rewards';
import type { Task } from './types';

/**
 * 📊 엄마·아빠 전용 통계 — 주별/월별 기간 집계.
 *
 * 화면(대시보드)과 내보내기(취합용 복사)가 같은 숫자를 쓰도록 셈은 여기서만 합니다.
 * · 📞 통화 항목은 공부 진행도에서 뺍니다(XP·티어와 같은 규칙 — season.ts 의 isXpHiddenTask).
 * · 100% 달성(올클리어)은 그 날 할 일이 있고 전부 확인 완료된 날입니다.
 * · 연속 100%는 평일(주말·공휴일 제외)만 세고, 할 일이 없던 평일은 세지도 끊지도 않습니다.
 */

function isHiddenTask(task: Task): boolean {
  return isXpHiddenTask(task);
}

export type ReportMode = 'week' | 'month';

export interface DayReport {
  date: string;
  /** 0=일 … 6=토 */
  weekday: number;
  total: number;
  verified: number;
  /** 0 ~ 1 */
  rate: number;
  allClear: boolean;
  /** 연속 100%에 세는 평일인지 */
  streakDay: boolean;
  /** 아직 오지 않은 날 */
  future: boolean;
}

export interface RewardLine {
  id: string;
  date: string;
  minutes: number;
  tier: TierKey;
  division: number;
  used: boolean;
}

export interface MemberReport {
  memberId: string;
  total: number;
  verified: number;
  /** 0 ~ 1 */
  rate: number;
  allClearDays: number;
  /** 기간 마지막 날(또는 오늘)까지 이어진 평일 연속 100% 일수 */
  streak: number;
  days: DayReport[];
  rewards: {
    /** 기간에 뽑은 보너스 게임 시간 합계(분) */
    received: number;
    /** 그중 사용 완료(분) */
    used: number;
    /** 그중 아직 안 쓴(분) */
    remaining: number;
    lines: RewardLine[];
  };
}

export interface Period {
  mode: ReportMode;
  /** 'YYYY-MM-DD' */
  start: string;
  /** 'YYYY-MM-DD' */
  end: string;
  /** 'YYYY-MM' (월별일 때 그 달) */
  season: string;
  /** '2026.11.23 – 11.29' 같은 제목 */
  label: string;
  /** '주간' / '월간' */
  kindLabel: string;
}

function dayCounts(tasks: Task[], memberId: string): Map<string, { total: number; verified: number }> {
  const map = new Map<string, { total: number; verified: number }>();
  for (const task of tasks) {
    if (task.member_id !== memberId) continue;
    if (isHiddenTask(task)) continue;
    const slot = map.get(task.due_date) ?? { total: 0, verified: 0 };
    slot.total += 1;
    if (task.status === 'verified') slot.verified += 1;
    map.set(task.due_date, slot);
  }
  return map;
}

/**
 * throughIso 까지 이어진 평일 연속 100% 일수.
 * 오늘(throughIso)이 아직 다 안 채워졌으면 오늘은 건너뛰고 어제까지를 셉니다.
 */
export function streakThrough(
  tasks: Task[],
  memberId: string,
  throughIso: string,
  todayIso: string = koreaTodayISO(),
): number {
  const counts = dayCounts(tasks, memberId);
  let streak = 0;
  let cursor = fromISODate(throughIso);

  for (let step = 0; step < 200; step += 1) {
    const iso = toISODate(cursor);
    cursor = addDays(cursor, -1);
    if (iso > todayIso) continue;

    const slot = counts.get(iso);
    if (!isStreakDay(iso)) continue;
    if (!slot || slot.total === 0) continue;
    if (slot.verified === slot.total) {
      streak += 1;
      continue;
    }
    if (iso === todayIso) continue; // 오늘은 아직 남은 항목이 있을 수 있어요
    break;
  }

  return streak;
}

/** 한 기간의 한 아이 통계. */
export function computeMemberReport(
  tasks: Task[],
  tierEvents: TierEvent[],
  memberId: string,
  period: Period,
  todayIso: string = koreaTodayISO(),
  /** 포인트(P)로 정산된 상자 id — 그 상자의 시간은 '게임 시간' 집계에서 뺍니다 */
  pointPrizeIds: Set<string> = new Set(),
): MemberReport {
  const counts = dayCounts(tasks, memberId);
  const days: DayReport[] = [];
  let total = 0;
  let verified = 0;
  let allClearDays = 0;

  const start = fromISODate(period.start);
  const end = fromISODate(period.end);
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const iso = toISODate(cursor);
    const slot = counts.get(iso) ?? { total: 0, verified: 0 };
    const allClear = slot.total > 0 && slot.verified === slot.total;
    total += slot.total;
    verified += slot.verified;
    if (allClear) allClearDays += 1;
    days.push({
      date: iso,
      weekday: cursor.getDay(),
      total: slot.total,
      verified: slot.verified,
      rate: slot.total === 0 ? 0 : slot.verified / slot.total,
      allClear,
      streakDay: isStreakDay(iso),
      future: iso > todayIso,
    });
  }

  const lines: RewardLine[] = tierEvents
    .filter(
      (event) =>
        event.member_id === memberId &&
        event.box_minutes !== null &&
        event.opened_at &&
        !pointPrizeIds.has(event.id),
    )
    .map((event) => {
      const when = event.opened_at ?? event.created_at;
      return {
        id: event.id,
        date: toISODate(new Date(when)),
        minutes: event.box_minutes ?? 0,
        tier: event.tier,
        division: event.division,
        used: event.used_at !== null,
      };
    })
    .filter((line) => line.date >= period.start && line.date <= period.end)
    .sort((a, b) => a.date.localeCompare(b.date));

  const received = lines.reduce((sum, line) => sum + line.minutes, 0);
  const used = lines.reduce((sum, line) => sum + (line.used ? line.minutes : 0), 0);

  const streakEnd = period.end > todayIso ? todayIso : period.end;

  return {
    memberId,
    total,
    verified,
    rate: total === 0 ? 0 : verified / total,
    allClearDays,
    streak: streakThrough(tasks, memberId, streakEnd, todayIso),
    days,
    rewards: { received, used, remaining: received - used, lines },
  };
}

/**
 * 지금까지 뽑았지만 아직 안 쓴 보너스 게임 시간(기간과 무관한 전체 합계).
 * 포인트(P)가 나온 상자는 시간이 아니므로 빼고 셈합니다.
 */
export function unusedBonusMinutes(
  tierEvents: TierEvent[],
  memberId: string,
  /** 포인트(P)로 정산된 상자 id — 시간이 아니라 P 를 받은 상자라 빼고 셈합니다. */
  pointPrizeIds: Set<string> = new Set(),
): number {
  return tierEvents
    .filter(
      (event) =>
        event.member_id === memberId &&
        event.box_minutes !== null &&
        event.opened_at &&
        !event.used_at &&
        !pointPrizeIds.has(event.id),
    )
    .reduce((sum, event) => sum + (event.box_minutes ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* 기간 만들기                                                          */
/* ------------------------------------------------------------------ */

/** 월요일 시작 주 — 'YYYY-MM-DD' 를 그 주 월요일로. */
export function weekPeriod(anyDateIso: string): Period {
  const date = fromISODate(anyDateIso);
  const offset = (date.getDay() + 6) % 7;
  const startDate = addDays(date, -offset);
  const endDate = addDays(startDate, 6);
  const start = toISODate(startDate);
  const end = toISODate(endDate);
  return {
    mode: 'week',
    start,
    end,
    season: start.slice(0, 7),
    label: weekRangeLabel(start, end),
    kindLabel: '주간',
  };
}

export function monthPeriod(anyDateIso: string): Period {
  const season = anyDateIso.slice(0, 7);
  const [year, month] = season.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  return {
    mode: 'month',
    start: `${season}-01`,
    end: `${season}-${String(last).padStart(2, '0')}`,
    season,
    label: `${year}년 ${month}월`,
    kindLabel: '월간',
  };
}

export function shiftPeriod(period: Period, delta: number): Period {
  if (period.mode === 'week') return weekPeriod(toISODate(addDays(fromISODate(period.start), delta * 7)));
  const [year, month] = period.season.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return monthPeriod(toISODate(date));
}

export function weekRangeLabel(start: string, end: string): string {
  const a = fromISODate(start);
  const b = fromISODate(end);
  const left = `${a.getFullYear()}.${a.getMonth() + 1}.${a.getDate()}`;
  const right =
    a.getFullYear() !== b.getFullYear()
      ? `${b.getFullYear()}.${b.getMonth() + 1}.${b.getDate()}`
      : `${b.getMonth() + 1}.${b.getDate()}`;
  return `${left} – ${right}`;
}

/** 기간을 사람이 읽는 짧은 이름: '11/23 (월)'. */
export function dayLabel(iso: string): string {
  const date = fromISODate(iso);
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAY_LABELS[date.getDay()]})`;
}

/* ------------------------------------------------------------------ */
/* 내보내기(취합용 복사)                                                */
/* ------------------------------------------------------------------ */

export interface ExportInput {
  period: Period;
  rows: Array<{
    name: string;
    grade?: string;
    tierTitle: string;
    xp: number;
    report: MemberReport;
    /** 전체 기간과 무관하게 아직 안 쓴 보너스(분) */
    unusedAll: number;
  }>;
}

const TIER_TEXT: Record<TierKey, string> = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아',
  master: '마스터',
};

/** 취합하기 좋게 — 표처럼 정렬된 텍스트. */
export function buildExportText({ period, rows }: ExportInput): string {
  const lines: string[] = [];
  lines.push(`[공부 체크] ${period.kindLabel} 통계 · ${period.label}`);
  lines.push('');

  for (const row of rows) {
    const report = row.report;
    const percent = Math.round(report.rate * 100);
    lines.push(
      `${row.name}${row.grade ? ` (${row.grade})` : ''} · ${row.tierTitle} · ${formatXp(row.xp)} XP`,
    );
    lines.push(`  진행도: 전체 ${report.total}개 · 확인 완료 ${report.verified}개 · 완료율 ${percent}%`);
    lines.push(
      `  100% 달성: ${report.allClearDays}일 · 연속 100%: ${report.streak}일차 (평일 기준, 주말·공휴일 제외)`,
    );
    lines.push(
      `  보너스 게임 시간: 받음 ${report.rewards.received}분 · 사용 ${report.rewards.used}분 · 남음 ${report.rewards.remaining}분 (전체 미사용 ${row.unusedAll}분)`,
    );
    for (const line of report.rewards.lines) {
      const tierText = `${TIER_TEXT[line.tier]}${line.division >= 1 && line.division <= 3 ? ` ${DIVISIONS[line.division]}` : ''}`;
      lines.push(`    · ${dayLabel(line.date)} ${tierText} +${line.minutes}분 ${line.used ? '(사용)' : '(남음)'}`);
    }

    const worked = report.days.filter((day) => day.total > 0);
    if (worked.length > 0) {
      lines.push(
        `  일별 달성률: ${worked.map((day) => `${dayLabel(day.date)} ${Math.round(day.rate * 100)}%`).join(' · ')}`,
      );
    } else {
      lines.push('  일별 달성률: 기록 없음');
    }
    lines.push('');
  }

  lines.push(`합계 · 아이 ${rows.length}명`);
  lines.push(
    `  확인 완료 ${rows.reduce((sum, row) => sum + row.report.verified, 0)}개 / 전체 ${rows.reduce((sum, row) => sum + row.report.total, 0)}개 · 완료율 ${(() => {
      const total = rows.reduce((sum, row) => sum + row.report.total, 0);
      const verified = rows.reduce((sum, row) => sum + row.report.verified, 0);
      return total === 0 ? 0 : Math.round((verified / total) * 100);
    })()}%`,
  );
  lines.push(
    `  보너스 게임 시간 받음 ${rows.reduce((sum, row) => sum + row.report.rewards.received, 0)}분 · 사용 ${rows.reduce((sum, row) => sum + row.report.rewards.used, 0)}분 · 남음 ${rows.reduce((sum, row) => sum + row.report.rewards.remaining, 0)}분`,
  );

  return lines.join('\n');
}

/** 클립보드에 넣기 — 안 되는 브라우저에서는 예전 방식으로 한 번 더 시도합니다. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 예전 방식으로 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 대시보드 맨 위에 쓰는 아주 짧은 요약 문구. */
export function periodSummaryText(rows: Array<{ report: MemberReport }>): string {
  const total = rows.reduce((sum, row) => sum + row.report.total, 0);
  if (total === 0) return '이 기간에는 아직 기록이 없어요';
  const verified = rows.reduce((sum, row) => sum + row.report.verified, 0);
  return `전체 ${total}개 중 ${verified}개 완료 (${Math.round((verified / total) * 100)}%)`;
}

export function memberReportLabel(report: MemberReport): string {
  return `완료율 ${Math.round(report.rate * 100)}% · 100% ${report.allClearDays}일`;
}

/** 월별 화면에서 주차별로 묶어 보여 주기 — 7일씩. */
export function weeksOf(
  period: Period,
): Array<{ index: number; start: string; end: string; label: string }> {
  const weeks: Array<{ index: number; start: string; end: string; label: string }> = [];
  let cursor = fromISODate(period.start);
  const end = fromISODate(period.end);
  let index = 1;
  while (cursor <= end) {
    const start = toISODate(cursor);
    const weekEnd = addDays(cursor, 6);
    const endIso = toISODate(weekEnd) > period.end ? period.end : toISODate(weekEnd);
    const a = fromISODate(start);
    const b = fromISODate(endIso);
    weeks.push({
      index,
      start,
      end: endIso,
      label: `${index}주 (${a.getMonth() + 1}/${a.getDate()}–${b.getMonth() + 1}/${b.getDate()})`,
    });
    cursor = addDays(cursor, 7);
    index += 1;
  }
  return weeks;
}
