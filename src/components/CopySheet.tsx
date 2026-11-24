import { useEffect, useMemo, useState } from 'react';
import { addDays, formatShortDate, toISODate } from '../lib/date';
import { cx } from '../lib/cx';
import { memberTheme, subjectMeta } from '../lib/theme';
import type { Member, Task } from '../lib/types';
import { Sheet } from './Sheet';
import { CopyIcon } from './icons';

interface CopySheetProps {
  open: boolean;
  onClose: () => void;
  /** 복사할 원본 항목 */
  sources: Task[];
  /** 원본이 여러 아이에 걸쳐 있을 때 고를 수 있는 구성원 */
  members: Member[];
  /** 이번 주 날짜(붙여넣을 날짜 후보) */
  dates: string[];
  selectedDate: string;
  onCopy: (
    taskIds: string[],
    dates: string[],
  ) => Promise<{ ok: boolean; created: number; skipped: number; error?: string }>;
  onDone: (message: string) => void;
}

const DAY_LABEL: Record<string, string> = {};

/** 공부 복사·붙여넣기 시트. 고른 항목을 다른 날짜로 '할 일' 상태로 새로 만듭니다. */
export function CopySheet({ open, onClose, sources, members, dates, selectedDate, onCopy, onDone }: CopySheetProps) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tomorrow = useMemo(() => toISODate(addDays(new Date(), 1)), []);
  const dayAfter = useMemo(() => toISODate(addDays(new Date(), 2)), []);

  useEffect(() => {
    if (!open) return;
    setExcluded([]);
    setTargets([]);
    setError(null);
    setBusy(false);
  }, [open, sources]);

  const sourceMembers = useMemo(() => {
    const ids = new Set(sources.map((task) => task.member_id));
    return members.filter((member) => ids.has(member.id));
  }, [sources, members]);

  const picked = useMemo(
    () => sources.filter((task) => !excluded.includes(task.member_id)),
    [sources, excluded],
  );

  const countFor = (memberId: string) => sources.filter((task) => task.member_id === memberId).length;

  // 이번 주 날짜 + (주 밖이면) 내일/모레도 함께 보여 줍니다.
  const dateOptions = useMemo(() => {
    const set = new Set(dates);
    for (const extra of [tomorrow, dayAfter, selectedDate]) set.add(extra);
    return Array.from(set).sort();
  }, [dates, tomorrow, dayAfter, selectedDate]);

  const toggleTarget = (iso: string) => {
    setTargets((prev) => (prev.includes(iso) ? prev.filter((item) => item !== iso) : [...prev, iso]));
  };

  const submit = async () => {
    if (picked.length === 0) {
      setError('복사할 항목을 골라 주세요.');
      return;
    }
    if (targets.length === 0) {
      setError('붙여넣을 날짜를 골라 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onCopy(
      picked.map((task) => task.id),
      targets,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? '복사하지 못했어요.');
      return;
    }
    const parts = [`${result.created}개 복사했어요`];
    if (result.skipped > 0) parts.push(`이미 있어서 ${result.skipped}개는 건너뛰었어요`);
    onDone(parts.join(' · '));
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="공부 복사하기"
      subtitle="고른 숙제를 다른 날에 '할 일'로 새로 만들어요. 완료 기록은 따라가지 않아요."
    >
      <div className="space-y-4 pb-1">
        {sourceMembers.length > 1 ? (
          <div>
            <p className="mb-1.5 px-1 text-[10px] font-extrabold tracking-wide text-slate-400">누구 공부를 복사할까요?</p>
            <div className="flex flex-wrap gap-1.5">
              {sourceMembers.map((member) => {
                const theme = memberTheme(member.color);
                const active = !excluded.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    data-testid={`copy-member-${member.id}`}
                    onClick={() =>
                      setExcluded((prev) =>
                        prev.includes(member.id) ? prev.filter((id) => id !== member.id) : [...prev, member.id],
                      )
                    }
                    className={cx(
                      'flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-extrabold ring-1 transition active:scale-95',
                      active ? cx('bg-white text-slate-800', theme.ring) : 'bg-slate-100 text-slate-400 ring-slate-200',
                    )}
                  >
                    <span aria-hidden>{member.emoji}</span>
                    {member.name}
                    <span className={cx('text-[10px] font-bold', active ? 'text-indigo-500' : 'text-slate-400')}>
                      {countFor(member.id)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-900/5">
          <p className="mb-1.5 flex items-center gap-1 text-[10.5px] font-extrabold text-slate-500">
            <CopyIcon className="h-3.5 w-3.5" />
            복사할 항목 {picked.length}개
          </p>
          <ul className="space-y-1">
            {picked.slice(0, 6).map((task) => {
              const subject = subjectMeta(task.subject);
              return (
                <li key={task.id} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
                  <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', subject.dot)} />
                  <span className="truncate">{task.title}</span>
                  <span className="shrink-0 text-[10px] font-bold text-slate-400">{subject.label}</span>
                </li>
              );
            })}
            {picked.length > 6 ? (
              <li className="text-[10.5px] font-bold text-slate-400">외 {picked.length - 6}개</li>
            ) : null}
            {picked.length === 0 ? <li className="text-[11px] font-bold text-rose-400">복사할 항목이 없어요</li> : null}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 px-1 text-[10px] font-extrabold tracking-wide text-slate-400">어디에 붙여넣을까요?</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <QuickDate label="내일" iso={tomorrow} targets={targets} onToggle={toggleTarget} />
            <QuickDate label="모레" iso={dayAfter} targets={targets} onToggle={toggleTarget} />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {dateOptions.map((iso) => {
              const active = targets.includes(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  data-testid={`copy-date-${iso}`}
                  onClick={() => toggleTarget(iso)}
                  className={cx(
                    'rounded-xl px-1 py-2 text-[11px] font-extrabold ring-1 transition active:scale-95',
                    active
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : iso === selectedDate
                        ? 'bg-indigo-50 text-indigo-600 ring-indigo-200'
                        : 'bg-white text-slate-600 ring-slate-900/5',
                  )}
                >
                  {DAY_LABEL[iso] ?? formatShortDate(iso)}
                </button>
              );
            })}
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-900/5">
            <span className="text-[10.5px] font-extrabold text-slate-500">다른 날</span>
            <input
              type="date"
              data-testid="copy-other-date"
              value=""
              onChange={(event) => {
                if (event.target.value) toggleTarget(event.target.value);
              }}
              className="flex-1 bg-transparent text-[11.5px] font-bold text-slate-700 outline-none"
            />
          </label>
        </div>

        {error ? <p className="px-1 text-[11px] font-bold text-rose-500">{error}</p> : null}

        <button
          type="button"
          data-testid="copy-submit"
          onClick={submit}
          disabled={busy || picked.length === 0 || targets.length === 0}
          className="w-full rounded-2xl bg-indigo-600 py-3 text-[13px] font-extrabold text-white shadow-float transition active:scale-[0.99] disabled:opacity-40"
        >
          {busy
            ? '복사하는 중…'
            : targets.length === 0
              ? `${picked.length}개 항목 · 날짜를 골라 주세요`
              : targets.length === 1
                ? `${picked.length}개를 ${formatShortDate(targets[0])}로 복사`
                : `${picked.length}개를 ${targets.length}일에 복사`}
        </button>
      </div>
    </Sheet>
  );
}

function QuickDate({
  label,
  iso,
  targets,
  onToggle,
}: {
  label: string;
  iso: string;
  targets: string[];
  onToggle: (iso: string) => void;
}) {
  const active = targets.includes(iso);
  return (
    <button
      type="button"
      data-testid={`copy-quick-${label}`}
      onClick={() => onToggle(iso)}
      className={cx(
        'rounded-full px-3 py-1.5 text-[11.5px] font-extrabold ring-1 transition active:scale-95',
        active ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-900/10',
      )}
    >
      {label} · {formatShortDate(iso)}
    </button>
  );
}
