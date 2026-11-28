import { cx } from '../lib/cx';
import { needParentOf } from '../lib/approval';
import { formatTimeKo, isFutureDate, koreaTodayISO } from '../lib/date';
import { formatXp, isXpHiddenTask, XP_PER_TASK, xpForTask } from '../lib/season';
import { useStudy } from '../lib/study-context';
import { subjectMeta } from '../lib/theme';
import type { Task } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { CheckIcon, CopyIcon, LockIcon, PencilIcon, TrashIcon, UndoIcon } from './icons';

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
  /** ✅ 부모 확인이 필요한 항목 — 아이는 '확인 요청', 부모는 '확인' */
  onRequestCheck: (task: Task) => void;
  onApprove: (task: Task) => void;
  /** 오늘 날짜 (한국 시간 기준 'YYYY-MM-DD') — 아직 안 온 날짜는 완료를 잠급니다. */
  today?: string;
}

export function TaskCard({
  task,
  canComplete,
  canManage,
  onComplete,
  onRevert,
  onEdit,
  onDelete,
  onCopy,
  onRequestCheck,
  onApprove,
  today,
}: TaskCardProps) {
  const subject = subjectMeta(task.subject);
  const study = useStudy();
  const verified = task.status === 'verified';
  /** 그날이 되기 전에는 완료 버튼을 잠깁니다. (오늘·지난 날짜는 그대로 완료) */
  const lockedUntilDue = !verified && isFutureDate(task.due_date, today);
  const pending = task.status === 'pending_verification';
  /** ✅ 부모 확인이 필요한 항목 — 아이는 혼자 완료하지 못하고 확인을 요청합니다. */
  const needParent = needParentOf(task);
  const childWaiting = needParent && pending && !study.isParent;
  const canRequest = needParent && canComplete && !study.isParent && !verified && !pending && !lockedUntilDue;
  const canApprove = needParent && pending && study.isParent;
  const completedAt = verified ? formatTimeKo(task.verified_at) : null;
  const canCopy = canManage || canComplete;
  /** ⚖️ 완료 시점별 XP — 완료했으면 받은 XP, 아직이면 지금 완료하면 받을 XP */
  const xp = isXpHiddenTask(task) ? null : xpForTask(task, today ?? koreaTodayISO(), study.xpRules);
  const xpChip = xp
    ? xp.percent === 100
      ? 'bg-indigo-50 text-indigo-600 ring-indigo-100'
      : xp.percent === 50
        ? 'bg-amber-50 text-amber-700 ring-amber-200/80'
        : 'bg-rose-50 text-rose-600 ring-rose-200/80'
    : '';

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
              {xp ? (
                <span
                  data-testid="task-xp"
                  title={
                    xp.burst
                      ? `🔥 버스트 타임(경험치 ${study.burstFactorText}) — ${xp.label}`
                      : xp.percent === 100
                        ? '그 날 완료해서 XP 100%'
                        : `${xp.label} — 그 날 완료했다면 ${XP_PER_TASK} XP`
                  }
                  className={cx(
                    'ml-1 inline-flex items-center whitespace-nowrap rounded-full px-1 py-0.5 text-[9px] font-extrabold leading-none ring-1',
                    xp.burst ? 'bg-orange-50 text-orange-600 ring-orange-200/80' : xpChip,
                  )}
                >
                  +{formatXp(xp.xp)} XP
                  {xp.burst ? (
                    <span data-testid="task-xp-burst" className="ml-0.5 font-bold">
                      🔥×2
                    </span>
                  ) : null}
                  {xp.percent === 100 ? null : (
                    <span data-testid="task-xp-delay" className="ml-0.5 font-bold">
                      · {xp.label}
                    </span>
                  )}
                </span>
              ) : null}
            </span>

            <div className="flex shrink-0 items-center gap-1">
              {canApprove ? (
                <button
                  type="button"
                  data-testid="approve-task"
                  onClick={() => onApprove(task)}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-emerald-600 px-2.5 text-[10.5px] font-extrabold text-white shadow-sm shadow-emerald-600/30 transition active:scale-95"
                >
                  <CheckIcon className="h-3 w-3" strokeWidth={3} />
                  확인
                </button>
              ) : null}

              {canRequest ? (
                <button
                  type="button"
                  data-testid="request-check"
                  onClick={() => onRequestCheck(task)}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-500 px-2.5 text-[10.5px] font-extrabold text-white shadow-sm shadow-amber-500/30 transition active:scale-95"
                >
                  🙋 확인 요청
                </button>
              ) : null}

              {childWaiting ? (
                <span
                  data-testid="waiting-parent"
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-50 px-2 text-[9.5px] font-extrabold text-amber-700 ring-1 ring-amber-200/80"
                >
                  부모 확인 대기
                </span>
              ) : null}

              {!verified && canComplete && !canRequest && !childWaiting && !canApprove ? (
                lockedUntilDue ? (
                  <button
                    type="button"
                    data-testid="complete-locked"
                    disabled
                    aria-disabled="true"
                    aria-label="그날이 되어야 완료할 수 있어요"
                    title="그날이 되어야 완료할 수 있어요"
                    className="inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-full bg-slate-100 px-2.5 text-[10.5px] font-extrabold text-slate-400 ring-1 ring-slate-200/80"
                  >
                    <LockIcon className="h-3 w-3" strokeWidth={2.4} />
                    완료
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="complete-task"
                    onClick={() => onComplete(task)}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-600 px-2.5 text-[10.5px] font-extrabold text-white shadow-sm shadow-indigo-600/30 transition active:scale-95"
                  >
                    <CheckIcon className="h-3 w-3" strokeWidth={3} />
                    완료
                  </button>
                )
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
