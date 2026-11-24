import { formatDayTitle, holidayName, relativeDayLabel } from '../lib/date';
import type { TaskSummary } from '../lib/store';
import { memberTheme } from '../lib/theme';
import type { Member } from '../lib/types';
import { cx } from '../lib/cx';

/** 그 날 한 사람의 진행 상황 — 이름은 항상 members 에서 오고, 코드에 이름을 적지 않습니다. */
export interface MemberDayStat {
  member: Member;
  summary: TaskSummary;
}

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

/**
 * 한 사람의 완료율 카드 — 부모 화면에서는 아이마다 한 장씩 나란히,
 * 아이 화면에서는 자기 카드 한 장만 넓게 보여 줍니다.
 */
function MemberStatCard({
  member,
  summary,
  wide,
}: {
  member: Member;
  summary: TaskSummary;
  wide?: boolean;
}) {
  const theme = memberTheme(member.color);
  const percent = Math.round(summary.ratio * 100);
  const allDone = summary.total > 0 && summary.verified === summary.total;

  return (
    <div
      data-testid={`day-stat-${member.id}`}
      aria-label={`${member.name} 완료 ${summary.verified}개 / 전체 ${summary.total}개 (${percent}%)`}
      className={cx(
        'rounded-2xl bg-white ring-1 ring-slate-900/5 transition',
        wide ? 'px-3 py-2.5' : 'px-2.5 py-2',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cx(
            'grid shrink-0 place-items-center rounded-lg',
            wide ? 'h-7 w-7 text-[14px]' : 'h-6 w-6 text-[12px]',
            theme.soft,
          )}
          aria-hidden
        >
          {member.emoji}
        </span>
        <span
          className={cx(
            'min-w-0 flex-1 truncate font-extrabold text-slate-800',
            wide ? 'text-[13px]' : 'text-[12px]',
          )}
        >
          {member.name}
        </span>
        {member.role === 'parent' ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-1 py-0.5 text-[8px] font-bold text-slate-500">
            부모
          </span>
        ) : null}
        <span
          className={cx(
            'shrink-0 font-extrabold leading-none tabular-nums',
            wide ? 'text-[15px]' : 'text-[13px]',
            allDone ? 'text-emerald-600' : 'text-slate-900',
          )}
        >
          {percent}
          <span className="text-[8.5px] font-bold text-slate-400">%</span>
        </span>
      </div>

      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100">
        <span
          data-testid={`day-stat-bar-${member.id}`}
          className={cx(
            'block h-full rounded-full transition-all duration-500',
            allDone ? 'bg-emerald-400' : theme.bar,
          )}
          style={{ width: `${percent}%` }}
        />
      </span>

      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[9.5px] font-semibold text-slate-400">
        <span className={cx('font-extrabold tabular-nums text-slate-700', wide ? 'text-[12px]' : 'text-[11px]')}>
          {summary.verified} / {summary.total}개
        </span>
        {summary.pending > 0 ? (
          <span className="font-bold text-amber-600">확인 대기 {summary.pending}</span>
        ) : null}
      </p>
    </div>
  );
}

export function DayOverview({
  dateIso,
  summary,
  memberSummaries,
}: {
  dateIso: string;
  summary: TaskSummary;
  /** 부모 화면이면 아이들(과 그날 부모 할 일이 있는 부모) 각각, 아이 화면이면 자기 한 명. */
  memberSummaries: MemberDayStat[];
}) {
  const label = relativeDayLabel(dateIso);
  const holiday = holidayName(dateIso);
  const split = memberSummaries.length > 1;

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

      <section
        data-testid="day-member-stats"
        className={cx('mt-2.5 grid gap-1.5', split ? 'grid-cols-2' : 'grid-cols-1')}
      >
        {memberSummaries.map((item, index) => {
          // 홀수로 남는 마지막 카드는 한 줄을 다 씁니다(어중간하게 잘리지 않게).
          const wide = !split || (memberSummaries.length % 2 === 1 && index === memberSummaries.length - 1);
          return (
            <div key={item.member.id} className={wide && split ? 'col-span-2' : undefined}>
              <MemberStatCard member={item.member} summary={item.summary} wide={wide} />
            </div>
          );
        })}
      </section>

      {split ? null : (
        <section className={cx('mt-1.5 grid gap-1.5', summary.pending > 0 ? 'grid-cols-3' : 'grid-cols-2')}>
          <StatChip label="할 일" value={summary.todo} dot="bg-slate-300" />
          {summary.pending > 0 ? (
            <StatChip label="확인 대기" value={summary.pending} dot="bg-amber-400" highlight />
          ) : null}
          <StatChip label="완료" value={summary.verified} dot="bg-emerald-400" />
        </section>
      )}
    </>
  );
}
