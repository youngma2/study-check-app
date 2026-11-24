import { cx } from '../lib/cx';
import { displayGrade } from '../lib/grade';
import { memberTheme } from '../lib/theme';
import { summarize } from '../lib/store';
import type { Member, Task } from '../lib/types';
import { PlusIcon } from './icons';
import { TaskCard } from './TaskCard';

interface ChildBoardProps {
  member: Member;
  tasks: Task[];
  canAdd: boolean;
  canComplete: boolean;
  canManage: boolean;
  onAdd: () => void;
  onComplete: (task: Task) => void;
  onRevert: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCopy: (task: Task) => void;
}

export function ChildBoard({
  member,
  tasks,
  canAdd,
  canComplete,
  canManage,
  onAdd,
  onComplete,
  onRevert,
  onEdit,
  onDelete,
  onCopy,
}: ChildBoardProps) {
  const theme = memberTheme(member.color);
  const summary = summarize(tasks);

  return (
    <section className="rounded-[26px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
      <header className="flex items-center gap-2 px-0.5 pb-2.5">
        <span
          className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-[17px]', theme.soft)}
          aria-hidden
        >
          {member.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[13.5px] font-extrabold text-slate-900">
            {member.name}
            {member.grade ? (
              <span data-testid={`member-grade-${member.id}`} className="text-[9.5px] font-bold text-slate-400">
                {displayGrade(member.grade)}
              </span>
            ) : null}
            {member.role === 'parent' ? (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                부모
              </span>
            ) : null}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-slate-100">
              <span
                className={cx('block h-full rounded-full transition-all', summary.ratio === 1 ? 'bg-emerald-400' : theme.bar)}
                style={{ width: `${Math.max(summary.ratio * 100, summary.total === 0 ? 0 : 8)}%` }}
              />
            </span>
            <span className="text-[9.5px] font-semibold text-slate-400">
              {summary.verified}/{summary.total} 완료
              {summary.pending > 0 ? (
                <span className="ml-1 font-bold text-amber-600">· 확인 대기 {summary.pending}</span>
              ) : null}
            </span>
          </div>
        </div>
        {canAdd ? (
          <button
            type="button"
            aria-label={`${member.name} 숙제 추가`}
            onClick={onAdd}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-90"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-center">
          <p className="text-[11px] font-semibold text-slate-400">이 날은 등록된 공부가 없어요</p>
          {canAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="mt-1.5 text-[11px] font-extrabold text-indigo-600 active:opacity-70"
            >
              + 항목 추가하기
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              canComplete={canComplete && task.member_id === member.id}
              canManage={canManage && task.member_id === member.id}
              onComplete={onComplete}
              onRevert={onRevert}
              onEdit={onEdit}
              onDelete={onDelete}
              onCopy={onCopy}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
