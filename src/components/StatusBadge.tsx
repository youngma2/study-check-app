import type { TaskStatus } from '../lib/types';
import { cx } from '../lib/cx';
import { CheckIcon } from './icons';

const STYLES: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: '할 일', className: 'bg-slate-100 text-slate-500 ring-slate-200/70' },
  pending_verification: {
    label: '확인 대기',
    className: 'bg-amber-50 text-amber-600 ring-amber-200/80',
  },
  verified: { label: '완료', className: 'bg-emerald-50 text-emerald-600 ring-emerald-200/80' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ring-1',
        style.className,
      )}
    >
      {status === 'verified' ? <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      {status === 'pending_verification' ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      ) : null}
      {style.label}
    </span>
  );
}
