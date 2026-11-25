import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { fromISODate, koreaTodayISO, WEEKDAY_LABELS } from '../lib/date';
import { displayGrade } from '../lib/grade';
import {
  buildExportText,
  computeMemberReport,
  copyText,
  monthPeriod,
  shiftPeriod,
  unusedBonusMinutes,
  weekPeriod,
  weeksOf,
  type MemberReport,
  type Period,
  type ReportMode,
} from '../lib/report';
import type { TierLevel } from '../lib/season';
import { useStudy } from '../lib/study-context';
import type { Member } from '../lib/types';
import { TierEmblem } from './TierBadge';
import { ArrowLeftIcon, BarChartIcon } from './icons';

/**
 * 📊 엄마·아빠 전용 통계.
 *
 * · ParentWeekSummary — 부모 메인 화면 위쪽의 '이번 주 간단 요약' 카드(아주 짧게).
 * · ParentDashboard  — 카드를 누르면 열리는 상세 페이지(주별/월별 전환·기간 이동·내보내기).
 *
 * 두 화면 모두 App 에서 부모일 때만 그립니다(아이 화면에는 나오지 않아요).
 */

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function rewardSummary(report: MemberReport): string {
  return `받음 ${report.rewards.received}분 · 사용 ${report.rewards.used}분 · 남음 ${report.rewards.remaining}분`;
}

/** 이 기간 동안의 아이별 통계를 한 번에 셈합니다. */
function useReports(period: Period) {
  const study = useStudy();
  const today = koreaTodayISO();
  return useMemo(
    () =>
      study.children.map((member) => ({
        member,
        report: computeMemberReport(study.db.tasks, study.tierEvents, member.id, period, today),
        unusedAll: unusedBonusMinutes(study.tierEvents, member.id),
        tier: study.seasonStatsFor(member.id)?.level ?? null,
        xp: study.seasonStatsFor(member.id)?.xp ?? 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [study.db.tasks, study.tierEvents, study.children, period.start, period.end, today],
  );
}

/* ------------------------------------------------------------------ */
/* 이번 주 간단 요약 카드 (부모 메인 화면)                                */
/* ------------------------------------------------------------------ */

export function ParentWeekSummary({ onOpen }: { onOpen: () => void }) {
  const today = koreaTodayISO();
  const period = useMemo(() => weekPeriod(today), [today]);
  const rows = useReports(period);

  return (
    <button
      type="button"
      data-testid="parent-week-summary"
      onClick={onOpen}
      className="mt-2.5 w-full rounded-[22px] bg-white p-3 text-left shadow-card ring-1 ring-slate-900/5 transition active:scale-[0.99]"
      aria-label="이번 주 요약 — 눌러서 자세한 통계 보기"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-800">
          <BarChartIcon className="h-3.5 w-3.5 text-indigo-500" />
          이번 주 요약
        </p>
        <span className="flex items-center gap-0.5 text-[9.5px] font-extrabold text-indigo-500">
          자세히
          <span aria-hidden className="text-[11px] leading-none">›</span>
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {rows.map(({ member, report, unusedAll }) => (
          <div key={member.id} data-testid={`summary-child-${member.id}`} className="flex items-center gap-2">
            <span className="w-10 shrink-0 truncate text-[10.5px] font-extrabold text-slate-700">
              {member.emoji} {member.name}
            </span>
            <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span
                className={cx('block h-full rounded-full', report.rate >= 1 ? 'bg-emerald-400' : 'bg-indigo-400')}
                style={{ width: `${Math.max(Math.round(report.rate * 100), report.total === 0 ? 0 : 6)}%` }}
              />
            </span>
            <span className="w-9 shrink-0 text-right text-[10px] font-extrabold tabular-nums text-slate-700">
              {percent(report.rate)}
            </span>
            <span
              className="w-[74px] shrink-0 text-right text-[9px] font-bold text-slate-400"
              title={`연속 100% ${report.streak}일차 · 아직 안 쓴 보너스 ${unusedAll}분`}
            >
              🔥{report.streak}일 · 🎁{unusedAll}분
            </span>
          </div>
        ))}
      </div>

      <p className="mt-1.5 text-[8.5px] font-semibold text-slate-400">
        주간 완료율 · 🔥 연속 100% · 🎁 남은 보너스 시간
      </p>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 상세 대시보드 (전체 화면)                                            */
/* ------------------------------------------------------------------ */

function rateTone(rate: number, total: number): string {
  if (total === 0) return 'bg-slate-100 text-slate-300';
  if (rate >= 1) return 'bg-emerald-400 text-white';
  if (rate >= 0.7) return 'bg-indigo-400 text-white';
  if (rate >= 0.4) return 'bg-indigo-300 text-white';
  if (rate > 0) return 'bg-indigo-200 text-indigo-700';
  return 'bg-slate-200 text-slate-500';
}

function DayBars({ report, compact }: { report: MemberReport; compact?: boolean }) {
  return (
    <div className={cx('mt-2 flex items-end gap-1', compact ? 'h-10' : 'h-14')}>
      {report.days.map((day) => (
        <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5">
          <div
            title={`${day.date} · ${day.total === 0 ? '기록 없음' : `${day.verified}/${day.total} (${percent(day.rate)})`}`}
            data-testid={`dash-day-${report.memberId}-${day.date}`}
            className={cx(
              'w-full rounded-t-md transition-all',
              day.total === 0 ? 'bg-slate-100' : day.allClear ? 'bg-emerald-400' : 'bg-indigo-300',
            )}
            style={{ height: `${day.total === 0 ? 4 : Math.max(Math.round(day.rate * 100), 8)}%` }}
          />
          <span
            className={cx(
              'text-[8px] font-bold leading-none',
              day.date === koreaTodayISO() ? 'text-indigo-600' : 'text-slate-400',
            )}
          >
            {WEEKDAY_LABELS[day.weekday]}
          </span>
        </div>
      ))}
    </div>
  );
}

function MonthCalendar({ report }: { report: MemberReport }) {
  const first = report.days[0];
  if (!first) return null;
  const lead = (fromISODate(first.date).getDay() + 6) % 7; // 월요일 시작
  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-1">
        {['월', '화', '수', '목', '금', '토', '일'].map((label) => (
          <p key={label} className="text-center text-[8px] font-extrabold text-slate-300">
            {label}
          </p>
        ))}
        {Array.from({ length: lead }, (_, index) => (
          <span key={`lead-${index}`} />
        ))}
        {report.days.map((day) => (
          <div
            key={day.date}
            data-testid={`dash-cell-${report.memberId}-${day.date}`}
            title={`${day.date} · ${day.total === 0 ? '기록 없음' : `${day.verified}/${day.total} (${percent(day.rate)})`}`}
            className={cx(
              'flex aspect-square flex-col items-center justify-center rounded-lg text-[8px] font-extrabold leading-tight',
              rateTone(day.rate, day.total),
            )}
          >
            <span>{Number(day.date.slice(-2))}</span>
            <span className="text-[7px] font-bold opacity-90">
              {day.total === 0 ? '·' : percent(day.rate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekTable({ report, period }: { report: MemberReport; period: Period }) {
  const weeks = weeksOf(period);
  return (
    <div className="mt-2 space-y-1">
      {weeks.map((week) => {
        const days = report.days.filter((day) => day.date >= week.start && day.date <= week.end);
        const total = days.reduce((sum, day) => sum + day.total, 0);
        const verified = days.reduce((sum, day) => sum + day.verified, 0);
        const rate = total === 0 ? 0 : verified / total;
        return (
          <div key={week.start} className="flex items-center gap-2">
            <span className="w-[92px] shrink-0 text-[8.5px] font-bold text-slate-400">{week.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span
                className={cx('block h-full rounded-full', rate >= 1 ? 'bg-emerald-400' : 'bg-indigo-400')}
                style={{ width: `${Math.round(rate * 100)}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-[9px] font-extrabold tabular-nums text-slate-500">
              {verified}/{total} · {percent(rate)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ChildReportCard({
  member,
  report,
  mode,
  period,
  tier,
  xp,
  unusedAll,
}: {
  member: Member;
  report: MemberReport;
  mode: ReportMode;
  period: Period;
  tier: TierLevel | null;
  xp: number;
  unusedAll: number;
}) {
  return (
    <section
      data-testid={`dash-child-${member.id}`}
      className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
    >
      <header className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-2xl bg-slate-100 text-[15px]" aria-hidden>
          {member.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[12.5px] font-extrabold text-slate-900">
            {member.name}
            {member.grade ? (
              <span className="text-[9px] font-bold text-slate-400">{displayGrade(member.grade)}</span>
            ) : null}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[9.5px] font-bold text-slate-400">
            <TierEmblem tier={tier?.key ?? 'bronze'} division={tier?.division ?? 0} size="xs" />
            {tier?.title ?? '브론즈 III'} · {xp} XP
          </p>
        </div>
        <div className="text-right">
          <p data-testid={`dash-rate-${member.id}`} className="text-[18px] font-extrabold leading-none tabular-nums text-indigo-600">
            {percent(report.rate)}
          </p>
          <p className="mt-0.5 text-[9px] font-bold text-slate-400">
            {report.verified}/{report.total}개
          </p>
        </div>
      </header>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <div className="rounded-xl bg-slate-50 px-1.5 py-1.5 text-center">
          <p className="text-[8px] font-extrabold text-slate-400">확인 완료</p>
          <p className="mt-0.5 text-[12px] font-extrabold leading-none tabular-nums text-slate-800">
            {report.verified}
            <span className="text-[9px] font-bold text-slate-400">/{report.total}</span>
          </p>
        </div>
        <div className="rounded-xl bg-orange-50 px-1.5 py-1.5 text-center">
          <p className="text-[8px] font-extrabold text-orange-400">연속 100%</p>
          <p data-testid={`dash-streak-${member.id}`} className="mt-0.5 text-[12px] font-extrabold leading-none tabular-nums text-orange-600">
            {report.streak}일차
            <span className="ml-0.5 text-[8.5px] font-bold text-orange-400">· {report.allClearDays}일</span>
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 px-1.5 py-1.5 text-center">
          <p className="text-[8px] font-extrabold text-amber-500">보너스 시간</p>
          <p data-testid={`dash-bonus-${member.id}`} className="mt-0.5 text-[12px] font-extrabold leading-none tabular-nums text-amber-700">
            {report.rewards.remaining}분
            <span className="ml-0.5 text-[8.5px] font-bold text-amber-500">남음</span>
          </p>
        </div>
      </div>

      <p data-testid={`dash-bonus-line-${member.id}`} className="mt-1.5 text-[9.5px] font-bold text-slate-500">
        🎁 이 기간 {rewardSummary(report)} <span className="text-slate-300">|</span> 전체 미사용 {unusedAll}분
      </p>

      {report.rewards.lines.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {report.rewards.lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-2 text-[9px] font-bold text-slate-400">
              <span className="truncate">
                {Number(line.date.slice(5, 7))}/{Number(line.date.slice(8, 10))} 뽑기 · +{line.minutes}분
              </span>
              <span className={cx('shrink-0 font-extrabold', line.used ? 'text-emerald-500' : 'text-amber-500')}>
                {line.used ? '사용 완료' : '남음'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[9px] font-bold text-slate-300">이 기간에 뽑은 상자가 없어요</p>
      )}

      {mode === 'week' ? <DayBars report={report} /> : <MonthCalendar report={report} />}
      {mode === 'month' ? <WeekTable report={report} period={period} /> : null}
    </section>
  );
}

export function ParentDashboard({ onClose }: { onClose: () => void }) {
  const study = useStudy();
  const today = koreaTodayISO();
  const [mode, setMode] = useState<ReportMode>('week');
  const [anchor, setAnchor] = useState<string>(today);
  const [toast, setToast] = useState<string | null>(null);

  const period = useMemo(
    () => (mode === 'week' ? weekPeriod(anchor) : monthPeriod(anchor)),
    [mode, anchor],
  );
  const rows = useReports(period);
  const currentPeriod = mode === 'week' ? weekPeriod(today) : monthPeriod(today);
  const atCurrent = period.start === currentPeriod.start;

  const move = (delta: number) => {
    const next = shiftPeriod(period, delta);
    setAnchor(next.start);
  };

  const switchMode = (next: ReportMode) => {
    setMode(next);
    setAnchor(today);
  };

  const exportText = useMemo(
    () =>
      buildExportText({
        period,
        rows: rows.map((row) => ({
          name: row.member.name,
          grade: row.member.grade ? displayGrade(row.member.grade) : undefined,
          tierTitle: row.tier?.title ?? '브론즈 III',
          xp: row.xp,
          report: row.report,
          unusedAll: row.unusedAll,
        })),
      }),
    [period, rows],
  );

  const copy = async () => {
    const ok = await copyText(exportText);
    setToast(ok ? '통계를 복사했어요 · 붙여넣기해서 취합하세요' : '복사하지 못했어요. 다시 눌러 주세요');
  };

  return (
    <div data-testid="parent-dashboard" className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f6fa]">
      <div className="sticky top-0 z-10 bg-[#f5f6fa]/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-4 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="dashboard-close"
              onClick={onClose}
              aria-label="대시보드 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">📊 학습 대시보드</h1>
              <p className="text-[9.5px] font-bold text-slate-400">엄마·아빠만 볼 수 있어요</p>
            </div>
            <button
              type="button"
              data-testid="dash-export"
              onClick={copy}
              className="shrink-0 rounded-full bg-indigo-600 px-2.5 py-1.5 text-[9.5px] font-extrabold text-white shadow-lg shadow-indigo-500/25 transition active:scale-95"
            >
              📋 취합용 복사
            </button>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex rounded-full bg-slate-200/70 p-0.5">
              <button
                type="button"
                data-testid="dash-tab-week"
                onClick={() => switchMode('week')}
                className={cx(
                  'rounded-full px-2.5 py-1 text-[10px] font-extrabold transition',
                  mode === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
              >
                주별
              </button>
              <button
                type="button"
                data-testid="dash-tab-month"
                onClick={() => switchMode('month')}
                className={cx(
                  'rounded-full px-2.5 py-1 text-[10px] font-extrabold transition',
                  mode === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
              >
                월별
              </button>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                data-testid="dash-prev"
                onClick={() => move(-1)}
                aria-label={mode === 'week' ? '지난 주' : '지난달'}
                className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
              >
                ‹
              </button>
              <span
                data-testid="dash-period"
                className="min-w-[104px] text-center text-[10px] font-extrabold tabular-nums text-slate-700"
              >
                {period.label}
              </span>
              <button
                type="button"
                data-testid="dash-next"
                onClick={() => move(1)}
                aria-label={mode === 'week' ? '다음 주' : '다음 달'}
                className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
              >
                ›
              </button>
              {!atCurrent ? (
                <button
                  type="button"
                  data-testid="dash-today"
                  onClick={() => setAnchor(today)}
                  className="rounded-full bg-white px-1.5 py-1 text-[9px] font-extrabold text-indigo-600 shadow-card ring-1 ring-slate-900/5"
                >
                  {mode === 'week' ? '이번 주' : '이번 달'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2.5 px-4 pb-28 pt-1">
        {rows.map(({ member, report, tier, xp, unusedAll }) => (
          <ChildReportCard
            key={member.id}
            member={member}
            report={report}
            mode={mode}
            period={period}
            tier={tier}
            xp={xp}
            unusedAll={unusedAll}
          />
        ))}

        <p className="px-1 pt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · 완료율은 부모 확인 완료 기준이고, 📞 통화 항목은 공부 진행도에서 뺐어요.
          <br />· 연속 100%는 평일(토·일·공휴일 제외)만 세고, 할 일이 없던 평일은 세지도 끊지도 않아요.
          <br />· 보너스 시간은 기간에 뽑은 상자 기준이고, '전체 미사용'은 지금까지 안 쓴 합계예요.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10">
        <div className="pointer-events-none h-8 bg-gradient-to-t from-[#f5f6fa] to-transparent" />
        <div className="bg-[#f5f6fa]/95 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-md px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              data-testid="dash-export-bottom"
              onClick={copy}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-slate-900 py-3 text-[12.5px] font-extrabold text-white shadow-float transition active:scale-[0.98]"
            >
              📋 {period.kindLabel} 통계 복사하기
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 flex justify-center px-6">
          <div className="animate-toast-in max-w-full truncate rounded-full bg-slate-900/90 px-4 py-2.5 text-[11.5px] font-bold text-white shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}

      {/* 아이 목록이 비어 있을 때(설정 전) */}
      {study.children.length === 0 ? (
        <p className="mx-auto max-w-md px-4 text-[11px] font-bold text-slate-400">아직 등록된 아이가 없어요.</p>
      ) : null}
    </div>
  );
}
