import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { AddTaskSheet } from './components/AddTaskSheet';
import { ChildBoard } from './components/ChildBoard';
import { DayOverview } from './components/DayOverview';
import { ProfileSheet } from './components/ProfileSheet';
import { WeekStrip, type DayProgress } from './components/WeekStrip';
import { PlusIcon, LockIcon } from './components/icons';
import { addDays, fromISODate, startOfWeek, toISODate, todayISO, weekDates } from './lib/date';
import { canDeleteTask, canEditTask, canVerifyTask, summarize } from './lib/store';
import { useStudy, type ActionResult } from './lib/study-context';
import type { NewTaskInput, Task } from './lib/types';

export default function App() {
  const study = useStudy();
  const { currentMember, children, isParent, tasksFor, addTask, editTask, setStatus, removeTask, resetDemo } = study;

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => todayISO());
  const [profileOpen, setProfileOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formMemberId, setFormMemberId] = useState<string>(currentMember.id);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** 부모는 아이들 전체를, 아이는 자기 것만 봅니다. */
  const visibleMembers = useMemo(
    () => (isParent ? children : children.filter((member) => member.id === currentMember.id)),
    [isParent, children, currentMember.id],
  );

  const weekDays = useMemo(() => weekDates(weekStart), [weekStart]);

  const progress = useMemo(() => {
    const map: Record<string, DayProgress> = {};
    for (const day of weekDays) {
      const iso = toISODate(day);
      const dayTasks = visibleMembers.flatMap((member) => tasksFor(member.id, iso));
      const summary = summarize(dayTasks);
      map[iso] = { total: summary.total, verified: summary.verified, pending: summary.pending };
    }
    return map;
  }, [weekDays, visibleMembers, tasksFor]);

  const dayTasks = useMemo(
    () => visibleMembers.flatMap((member) => tasksFor(member.id, selectedDate)),
    [visibleMembers, selectedDate, tasksFor],
  );
  const daySummary = useMemo(() => summarize(dayTasks), [dayTasks]);
  const weekPending = useMemo(
    () => Object.values(progress).reduce((sum, item) => sum + item.pending, 0),
    [progress],
  );

  const shiftWeek = (delta: number) => {
    setWeekStart(addDays(weekStart, delta * 7));
    setSelectedDate(toISODate(addDays(fromISODate(selectedDate), delta * 7)));
  };

  const goToday = () => {
    setWeekStart(startOfWeek(new Date()));
    setSelectedDate(todayISO());
  };

  const openAdd = (memberId: string) => {
    setEditingTask(null);
    setFormMemberId(memberId);
    setFormOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setFormMemberId(task.member_id);
    setFormOpen(true);
  };

  const handleSave = async (input: NewTaskInput, editingId?: string): Promise<ActionResult> => {
    const result = editingId
      ? await editTask(editingId, { title: input.title, subject: input.subject, due_date: input.due_date })
      : await addTask(input);

    if (result.ok) {
      setSelectedDate(input.due_date);
      setWeekStart(startOfWeek(fromISODate(input.due_date)));
      notify(editingId ? '수정했어요' : '공부 항목을 추가했어요');
    }
    return result;
  };

  const handleRequest = async (task: Task) => {
    const result = await setStatus(task.id, 'pending_verification');
    notify(result.ok ? '부모님께 완료 요청을 보냈어요' : result.error ?? '요청하지 못했어요');
  };

  const handleVerify = async (task: Task) => {
    const result = await setStatus(task.id, 'verified');
    notify(result.ok ? '확인 완료! 잘했어요 🎉' : result.error ?? '확인하지 못했어요');
  };

  const handleRevert = async (task: Task) => {
    const result = await setStatus(task.id, 'todo');
    notify(result.ok ? '할 일로 되돌렸어요' : result.error ?? '되돌리지 못했어요');
  };

  const handleDelete = async (task: Task) => {
    if (!window.confirm(`'${task.title}' 항목을 삭제할까요?`)) return;
    const result = await removeTask(task.id);
    notify(result.ok ? '삭제했어요' : result.error ?? '삭제하지 못했어요');
  };

  const canVerify = canVerifyTask(currentMember);
  const canEdit = canEditTask(currentMember);
  const canDelete = canDeleteTask(currentMember);

  const defaultAddMemberId = isParent
    ? (visibleMembers[0]?.id ?? currentMember.id)
    : currentMember.id;

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      <AppHeader
        familyName={study.familyName}
        currentMember={currentMember}
        isParent={isParent}
        pendingCount={isParent ? weekPending : 0}
        onOpenProfile={() => setProfileOpen(true)}
      />

      <main className="mx-auto w-full max-w-md px-4 pb-36 pt-3">
        <WeekStrip
          weekStart={weekStart}
          selectedDate={selectedDate}
          today={todayISO()}
          progress={progress}
          onSelect={setSelectedDate}
          onPrevWeek={() => shiftWeek(-1)}
          onNextWeek={() => shiftWeek(1)}
          onToday={goToday}
        />

        <DayOverview dateIso={selectedDate} summary={daySummary} />

        {study.syncState === 'setup' ? (
          <div
            data-testid="setup-banner"
            className="mt-3 rounded-2xl bg-sky-50 p-3 ring-1 ring-sky-200/70"
          >
            <p className="text-[11px] font-extrabold text-sky-900">가족 동기화 준비 중</p>
            <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-sky-800/90">
              Supabase에 넣을 SQL을 아직 실행하지 않았어요. 그 전까지는 이 기기에만 저장됩니다.
              {' '}SQL을 한 번 실행하면 폰끼리 실시간으로 이어져요.
            </p>
          </div>
        ) : null}

        {study.syncState === 'error' ? (
          <div className="mt-3 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200/70">
            <p className="text-[11px] font-extrabold text-amber-900">클라우드에 연결하지 못했어요</p>
            <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-amber-800/90">
              마지막으로 받은 목록을 보여 주고 있어요. 연결되면 자동으로 다시 맞춰지고,
              그 전까지는 바꾼 내용을 저장하지 않아요.
            </p>
          </div>
        ) : null}

        {!isParent ? (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50/80 p-3 ring-1 ring-amber-200/70">
            <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <p className="text-[10.5px] font-semibold leading-relaxed text-amber-800">
              <b className="font-extrabold">{currentMember.name}</b> 시점이에요. 공부를 추가하고{' '}
              <b className="font-extrabold">완료 요청</b>은 할 수 있지만, 항목 삭제와 최종{' '}
              <b className="font-extrabold">확인 완료</b>는 부모님만 할 수 있어요.
            </p>
          </div>
        ) : null}

        <div className="mt-3 space-y-3">
          {visibleMembers.map((member) => (
            <ChildBoard
              key={member.id}
              member={member}
              tasks={tasksFor(member.id, selectedDate)}
              canAdd={isParent || member.id === currentMember.id}
              canVerify={canVerify}
              canEdit={canEdit}
              canDelete={canDelete}
              onAdd={() => openAdd(member.id)}
              onRequest={handleRequest}
              onVerify={handleVerify}
              onRevert={handleRevert}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>

        <p className="mt-5 px-2 text-center text-[10px] font-medium leading-relaxed text-slate-400">
          아이는 항목을 지울 수 없고, 확인 완료는 부모님만 누를 수 있어요.
          <br />
          상단 이름을 눌러 아빠 · 엄마 · 첫째 · 둘째 시점을 바꿔 볼 수 있어요.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30">
        <div className="pointer-events-none h-8 bg-gradient-to-t from-[#f5f6fa] to-transparent" />
        <div data-fixed-bottom className="bg-[#f5f6fa]/95 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-md px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              data-testid="open-add"
              onClick={() => openAdd(defaultAddMemberId)}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 py-3.5 text-[13.5px] font-extrabold text-white shadow-float transition active:scale-[0.98]"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              {isParent ? '숙제 추가' : '내 공부 추가'}
            </button>
          </div>
        </div>
      </div>

      <AddTaskSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        members={isParent ? children : children.filter((member) => member.id === currentMember.id)}
        actor={currentMember}
        defaultDate={selectedDate}
        defaultMemberId={formMemberId}
        editing={editingTask}
        onSave={handleSave}
      />

      <ProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        members={study.members}
        currentMemberId={currentMember.id}
        onSelect={study.setCurrentMember}
        onResetDemo={async () => {
          const result = await resetDemo();
          notify(result.ok ? '샘플 데이터로 되돌렸어요' : result.error ?? '초기화하지 못했어요');
        }}
        canReset={isParent && study.storageKind === 'local'}
        storageKind={study.storageKind}
        syncState={study.syncState}
        realtimeState={study.realtimeState}
      />

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-6">
          <div className="animate-toast-in max-w-full truncate rounded-full bg-slate-900/90 px-4 py-2.5 text-[11.5px] font-bold text-white shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
}
