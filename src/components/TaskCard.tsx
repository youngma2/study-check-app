import { cx } from '../lib/cx';
import { formatTimeKo } from '../lib/date';
import { subjectMeta } from '../lib/theme';
import type { Task } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { CheckIcon, CopyIcon, PencilIcon, TrashIcon, UndoIcon } from './icons';

interface TaskCardProps {
  task: Task;
  /** 이 숙제를 완료 체크할 수 있는 사람인지 (아이는 자기 것만, 부모는 모두) */
  canComplete: boolean;
  /** 부모: 되돌리기 · 수정 · 삭제 */
  canManage: boolean;
  onComplete: (task: Task) => void;
  onRevert: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCopy: (task: Task) => void;
}

export function TaskCard({ task, canComplete, canManage, onComplete, onRevert, onEdit, onDelete, onCopy }: TaskCardProps) {
  const subject = subjectMeta(task.subject);
  const verified = task.status === 'verified';
  const pending = task.status === 'pending_verification';
  const completedAt = verified ? formatTimeKo(task.verified_at) : null;
  const canCopy = canManage || canComplete;

  return (
    <li
      data-testid="task-card"
      className={cx(
        'rounded-2xl bg-white p-2.5 ring-1 transition',
        verified ? 'ring-emerald-100' : pending ? 'ring-amber-200/80' : 'ring-slate-900/5',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cx(
            'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[12px] font-extrabold ring-1',
            verified ? 'bg-emerald-50 text-emerald-600 ring-emerald-100' : subject.tile,
          )}
          aria-hidden
        >
          {verified ? <CheckIcon className="h-4 w-4" strokeWidth={3} /> : subject.short}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <p
              className={cx(
                'min-w-0 flex-1 text-[13px] font-semibold leading-snug',
                verified ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-800',
              )}
              title={task.title}
            >
              {task.title}
            </p>
            <StatusBadge status={task.status} />
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="min-w-0 text-[9.5px] font-semibold text-slate-400">
              {subject.label}
              {completedAt ? (
                <span data-testid="completed-at" className="ml-1 font-extrabold text-emerald-600">
                  · {completedAt} 완료
                </span>
              ) : null}
            </span>

            <div className="flex shrink-0 items-center gap-1">
              {!verified && canComplete ? (
                <button
                  type="button"
                  data-testid="complete-task"
                  onClick={() => onComplete(task)}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-600 px-2.5 text-[10.5px] font-extrabold text-white shadow-sm shadow-indigo-600/30 transition active:scale-95"
                >
                  <CheckIcon className="h-3 w-3" strokeWidth={3} />
                  완료
                </button>
              ) : null}

              {verified && canManage ? (
                <button
                  type="button"
                  data-testid="revert-task"
                  onClick={() => onRevert(task)}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200 transition active:scale-95"
                >
                  <UndoIcon className="h-3 w-3" />
                  되돌리기
                </button>
              ) : null}

              {canCopy ? (
                <button
                  type="button"
                  aria-label="복사"
                  data-testid="copy-task"
                  onClick={() => onCopy(task)}
                  className="grid h-7 w-7 place-items-center rounded-full text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-90"
                >
                  <CopyIcon className="h-3 w-3" />
                </button>
              ) : null}

              {canManage ? (
                <>
                  <button
                    type="button"
                    aria-label="수정"
                    onClick={() => onEdit(task)}
                    className="grid h-7 w-7 place-items-center rounded-full text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-90"
                  >
                    <PencilIcon className="h-3 w-3" />
                  </button>

                  <button
                    type="button"
                    aria-label="삭제"
                    data-testid="delete-task"
                    onClick={() => onDelete(task)}
                    className="grid h-7 w-7 place-items-center rounded-full text-slate-300 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-500 hover:ring-rose-200 active:scale-90"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
