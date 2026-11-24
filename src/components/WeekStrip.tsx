import { WEEKDAY_LABELS, formatMonthTitle, formatWeekRange, holidayName, toISODate, weekDates } from '../lib/date';
import { cx } from '../lib/cx';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

export interface DayProgress {
  total: number;
  verified: number;
  pending: number;
}

interface WeekStripProps {
  weekStart: Date;
  selectedDate: string;
  today: string;
  progress: Record<string, DayProgress>;
  onSelect: (dateIso: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}

export function WeekStrip({
  weekStart,
  selectedDate,
  today,
  progress,
  onSelect,
  onPrevWeek,
  onNextWeek,
  onToday,
}: WeekStripProps) {
  const days = weekDates(weekStart);
  const weekHolidays = days
    .map((day) => ({ iso: toISODate(day), name: holidayName(toISODate(day)) }))
    .filter((item): item is { iso: string; name: string } => item.name !== null);

  return (
    <section className="rounded-[26px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
      <div className="flex items-center justify-between gap-2">
        <div className="pl-1">
          <p className="text-[13px] font-extrabold tracking-tight text-slate-900">
            {formatMonthTitle(weekStart)}
          </p>
          <p className="text-[10px] font-semibold text-slate-400">{formatWeekRange(weekStart)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 주"
            onClick={onPrevWeek}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-90"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="h-8 rounded-full bg-indigo-50 px-3 text-[11px] font-extrabold text-indigo-600 ring-1 ring-indigo-100 transition active:scale-95"
          >
            오늘
          </button>
          <button
            type="button"
            aria-label="다음 주"
            onClick={onNextWeek}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-90"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const iso = toISODate(day);
          const selected = iso === selectedDate;
          const isToday = iso === today;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const isSunday = day.getDay() === 0;
          const holiday = holidayName(iso);
          const info = progress[iso] ?? { total: 0, verified: 0, pending: 0 };
          const ratio = info.total === 0 ? 0 : info.verified / info.total;
          const complete = info.total > 0 && info.verified === info.total;
          const started = ratio > 0;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              aria-pressed={selected}
              aria-label={`${day.getMonth() + 1}월 ${day.getDate()}일 ${WEEKDAY_LABELS[day.getDay()]}요일${holiday ? ` · ${holiday}` : ''}`}
              className={cx(
                'relative flex flex-col items-center gap-1 rounded-2xl pb-1.5 pt-1.5 transition active:scale-95',
                selected
                  ? 'bg-gradient-to-b from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30'
                  : isToday
                    ? 'bg-indigo-50/60 text-slate-800 ring-1 ring-indigo-200'
                    : 'text-slate-800 hover:bg-slate-50',
              )}
            >
              {holiday ? (
                <span
                  data-testid={`holiday-dot-${iso}`}
                  aria-hidden
                  className={cx(
                    'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
                    selected ? 'bg-white' : 'bg-rose-500',
                  )}
                />
              ) : null}
              <span
                className={cx(
                  'text-[9.5px] font-bold leading-none',
                  selected ? 'text-white/75' : holiday ? 'text-rose-500' : isWeekend ? 'text-rose-400' : 'text-slate-400',
                )}
              >
                {WEEKDAY_LABELS[day.getDay()]}
              </span>
              <span
                className={cx(
                  'text-[15px] font-extrabold leading-none',
                  selected ? 'text-white' : holiday || isSunday ? 'text-rose-600' : 'text-slate-800',
                )}
              >
                {day.getDate()}
              </span>
              <span className="mt-0.5 flex h-1.5 w-6 items-center">
                {info.total > 0 ? (
                  <span
                    className={cx(
                      'h-1 w-full overflow-hidden rounded-full',
                      selected ? 'bg-white/30' : 'bg-slate-200/80',
                    )}
                  >
                    <span
                      className={cx(
                        'block h-full rounded-full',
                        selected
                          ? started
                            ? 'bg-white'
                            : 'bg-white/50'
                          : complete
                            ? 'bg-emerald-400'
                            : started
                              ? 'bg-indigo-400'
                              : 'bg-slate-300',
                      )}
                      style={{ width: started ? `${Math.max(ratio * 100, 18)}%` : '18%' }}
                    />
                  </span>
                ) : isToday ? (
                  <span
                    className={cx('h-1 w-1 rounded-full', selected ? 'bg-white' : 'bg-indigo-300')}
                  />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-transparent" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {weekHolidays.length > 0 ? (
        <p data-testid="week-holidays" className="mt-1.5 px-1 text-[9.5px] font-bold text-rose-500">
          {weekHolidays
            .map((item) => `${Number(item.iso.slice(5, 7))}/${Number(item.iso.slice(8, 10))} ${item.name}`)
            .join(' · ')}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[9.5px] font-semibold text-slate-400">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          확인 대기
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          진행 중
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          모두 완료
        </span>
        {weekHolidays.length > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            공휴일
          </span>
        ) : null}
      </div>
    </section>
  );
}
