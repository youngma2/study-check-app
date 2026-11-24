import { formatDayTitle, holidayName, relativeDayLabel } from '../lib/date';
import type { TaskSummary } from '../lib/store';
import { cx } from '../lib/cx';

function ProgressRing({ ratio }: { ratio: number }) {
  const size = 54;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(ratio, 0), 1));

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eceef5" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute text-[12px] font-extrabold text-slate-800">
        {Math.round(ratio * 100)}
        <span className="text-[8px] font-bold text-slate-400">%</span>
      </span>
    </div>
  );
}

function StatChip({ label, value, dot, highlight }: { label: string; value: number; dot: string; highlight?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-2xl px-2.5 py-2 ring-1 transition',
        highlight ? 'bg-amber-50/70 ring-amber-200/70' : 'bg-white ring-slate-900/5',
      )}
    >
      <div className="flex items-center gap-1">
        <span className={cx('h-1.5 w-1.5 rounded-full', dot)} />
        <span className="text-[9.5px] font-bold text-slate-500">{label}</span>
      </div>
      <p className="mt-0.5 text-[15px] font-extrabold leading-none text-slate-900">{value}</p>
    </div>
  );
}

export function DayOverview({ dateIso, summary }: { dateIso: string; summary: TaskSummary }) {
  const label = relativeDayLabel(dateIso);
  const holiday = holidayName(dateIso);

  return (
    <>
      <section className="mt-4 flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2
              className={cx(
                'text-[17px] font-extrabold tracking-tight',
                holiday ? 'text-rose-600' : 'text-slate-900',
              )}
            >
              {formatDayTitle(dateIso)}
            </h2>
            {label ? (
              <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9.5px] font-extrabold text-indigo-600">
                {label}
              </span>
            ) : null}
            {holiday ? (
              <span
                data-testid="day-holiday"
                className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9.5px] font-extrabold text-rose-600 ring-1 ring-rose-200/70"
              >
                {holiday}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {summary.total === 0
              ? '아직 등록된 공부가 없어요'
              : `전체 ${summary.total}개 · 완료 ${summary.verified}개`}
            {summary.pending > 0 ? (
              <span className="ml-1 font-bold text-amber-600">· 확인 대기 {summary.pending}개</span>
            ) : null}
          </p>
        </div>
        <ProgressRing ratio={summary.ratio} />
      </section>

      <section className={cx('mt-2.5 grid gap-1.5', summary.pending > 0 ? 'grid-cols-3' : 'grid-cols-2')}>
        <StatChip label="할 일" value={summary.todo} dot="bg-slate-300" />
        {summary.pending > 0 ? (
          <StatChip label="확인 대기" value={summary.pending} dot="bg-amber-400" highlight />
        ) : null}
        <StatChip label="완료" value={summary.verified} dot="bg-emerald-400" />
      </section>
    </>
  );
}
