import { cx } from '../lib/cx';
import { subjectMeta } from '../lib/theme';
import type { Task } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { CheckIcon, PencilIcon, TrashIcon } from './icons';

interface TaskCardProps {
  task: Task;
  /** 부모 시점: 확인/수정/삭제 가능 */
  canVerify: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onRequest: (task: Task) => void;
  onVerify: (task: Task) => void;
  onRevert: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskCard({
  task,
  canVerify,
  canEdit,
  canDelete,
  onRequest,
  onVerify,
  onRevert,
  onEdit,
  onDelete,
}: TaskCardProps) {
  const subject = subjectMeta(task.subject);
  const verified = task.status === 'verified';
  const pending = task.status === 'pending_verification';

  return (
    <li
      data-testid="task-card"
      className={cx(
        'rounded-2xl bg-white p-2.5 ring-1 transition',
        pending ? 'ring-amber-200/80' : 'ring-slate-900/5',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cx(
            'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[12px] font-extrabold ring-1',
            subject.tile,
          )}
          aria-hidden
        >
          {subject.short}
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
            <span className="text-[9.5px] font-semibold text-slate-400">{subject.label}</span>

            <div className="flex items-center gap-1">
              {canVerify ? (
                <>
                  {!verified ? (
                    <button
                      type="button"
                      data-testid="verify-task"
                      onClick={() => onVerify(task)}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-600 px-2.5 text-[10px] font-extrabold text-white shadow-sm shadow-indigo-600/30 transition active:scale-95"
                    >
                      <CheckIcon className="h-3 w-3" strokeWidth={3} />
                      확인 완료
                    </button>
                  ) : null}

                  {task.status !== 'todo' ? (
                    <button
                      type="button"
                      onClick={() => onRevert(task)}
                      className="h-7 rounded-full px-2 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200 transition active:scale-95"
                    >
                      되돌리기
                    </button>
                  ) : null}

                  {canEdit ? (
                    <button
                      type="button"
                      aria-label="수정"
                      onClick={() => onEdit(task)}
                      className="grid h-7 w-7 place-items-center rounded-full text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-90"
                    >
                      <PencilIcon className="h-3 w-3" />
                    </button>
                  ) : null}

                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="삭제"
                      data-testid="delete-task"
                      onClick={() => onDelete(task)}
                      className="grid h-7 w-7 place-items-center rounded-full text-slate-300 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-500 hover:ring-rose-200 active:scale-90"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  ) : null}
                </>
              ) : pending ? (
                <button
                  type="button"
                  onClick={() => onRevert(task)}
                  className="h-7 rounded-full px-2.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200 transition active:scale-95"
                >
                  요청 취소
                </button>
              ) : verified ? null : (
                <button
                  type="button"
                  data-testid="request-task"
                  onClick={() => onRequest(task)}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-50 px-2.5 text-[10px] font-extrabold text-indigo-600 ring-1 ring-indigo-200 transition active:scale-95"
                >
                  <CheckIcon className="h-3 w-3" strokeWidth={3} />
                  완료 요청
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
