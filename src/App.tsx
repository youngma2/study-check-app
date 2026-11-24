import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { AddTaskSheet } from './components/AddTaskSheet';
import { ChildBoard } from './components/ChildBoard';
import { CopySheet } from './components/CopySheet';
import { DayOverview } from './components/DayOverview';
import { FamilyNotesBoard } from './components/FamilyNotesBoard';
import { ParentPinGate } from './components/ParentPinGate';
import { ProfileSheet } from './components/ProfileSheet';
import { WeekStrip, type DayProgress } from './components/WeekStrip';
import { CopyIcon, LockIcon, PlusIcon, UndoIcon, XIcon } from './components/icons';
import { playNoteChime } from './lib/chime';
import { addDays, formatTimeKo, fromISODate, isRestDay, startOfWeek, toISODate, todayISO, weekDates } from './lib/date';
import { defaultItemsForDay } from './lib/defaults';
import { formatNoteTime } from './lib/notes';
import { summarize } from './lib/store';
import { useStudy, type ActionResult } from './lib/study-context';
import type { NewTaskInput, Task } from './lib/types';

/**
 * 📞 통화 1·2 (쪼꼬가 거는 확인 전화) 항목.
 * 아이 화면은 공부에만 집중할 수 있게 이 항목을 빼고 보여 주고,
 * 부모 화면에서는 하교·통화 시간과 완료 체크를 그대로 봅니다.
 */
function isCallTask(task: Task): boolean {
  return task.title.includes('📞 통화') || task.id.includes('_call1') || task.id.includes('_call2');
}

export default function App() {
  const study = useStudy();
  const {
    currentMember,
    children,
    parents,
    isParent,
    parentUnlocked,
    parentPinSetupRequired,
    unlockParent,
    setParentPin,
    lockParent,
    copyTasks,
    renameMember,
    tasksFor,
    addTask,
    editTask,
    setStatus,
    removeTask,
    resetDemo,
    notes,
    notesState,
    unseenNotes,
    markNotesSeen,
    addNote,
    deleteNote,
  } = study;

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => todayISO());
  const [profileOpen, setProfileOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formMemberId, setFormMemberId] = useState<string>(currentMember.id);
  const [copySources, setCopySources] = useState<Task[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** 아이 화면에서 부모 관리로 돌아갈 때: PIN 화면을 반드시 거치고, 취소하면 이 아이 화면으로 돌아옵니다. */
  const [parentGateForced, setParentGateForced] = useState(false);
  const [parentGateReturnTo, setParentGateReturnTo] = useState<string | null>(null);
  /** 어느 부모 화면을 열려는지 (아빠·엄마 행을 누른 경우) */
  const [parentGateTarget, setParentGateTarget] = useState<string | null>(null);
  const [fillingDefaults, setFillingDefaults] = useState(false);
  const fillingDefaultsRef = useRef(false);
  /** 브라우저 알림 권한 ('unsupported' = 이 브라우저에 알림 기능 없음) */
  const [notifyPermission, setNotifyPermission] = useState<'granted' | 'denied' | 'default' | 'unsupported'>(
    () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'),
  );

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const latestUnseen = unseenNotes[0] ?? null;
  const latestUnseenAuthor = latestUnseen
    ? study.members.find((member) => member.id === latestUnseen.author_id)
    : undefined;

  /**
   * 새 한마디가 올라오면: 알림음 + 브라우저(OS) 알림 + 짧은 진동.
   * 앱을 보고 있어도 알려 줍니다(화면 위 배너와 함께 옵니다).
   * 같은 글에는 한 번만 반응합니다.
   */
  const notifiedNoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!latestUnseen) return;
    if (notifiedNoteRef.current === latestUnseen.id) return;
    notifiedNoteRef.current = latestUnseen.id;
    playNoteChime();

    if (notifyPermission === 'granted') {
      const title = '💬 우리 가족 한마디';
      const options: NotificationOptions = {
        body: `${latestUnseenAuthor?.name ?? '가족'}: ${latestUnseen.content}`,
        tag: `study-note-${latestUnseen.id}`,
      };
      try {
        navigator.vibrate?.([150, 80, 150]);
      } catch {
        /* 진동이 없는 기기 */
      }

      void (async () => {
        // 안드로이드 크롬은 new Notification() 을 막습니다("Illegal constructor").
        // 서비스 워커 알림(showNotification)을 먼저 쓰고, 워커가 없을 때만 new Notification 으로 넘어갑니다.
        const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
        if (sw) {
          try {
            // ready 는 워커가 활성화될 때까지 기다립니다. 너무 오래 걸리면 아래로 넘어갑니다.
            const registration = await Promise.race([
              sw.ready,
              new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2500)),
            ]);
            if (registration) {
              await registration.showNotification(title, {
                ...options,
                vibrate: [150, 80, 150],
                renotify: true,
              } as NotificationOptions);
              return;
            }
          } catch {
            /* 워커 알림이 안 되면 아래 new Notification 으로 넘어갑니다. */
          }
        }
        try {
          new Notification(title, options);
        } catch {
          /* 알림이 안 떠도 위쪽 배너로 알려 줍니다. */
        }
      })();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [latestUnseen, latestUnseenAuthor, notifyPermission]);

  /** 브라우저 알림 권한 요청 (버튼을 누를 때만) */
  const requestNotifyPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setNotifyPermission(result);
    } catch {
      /* 권한 창을 띄울 수 없는 환경 */
    }
  };

  /** 부모는 아이들 전체를, 아이는 자기 것만 봅니다. */
  const visibleMembers = useMemo(
    () => (isParent ? children : children.filter((member) => member.id === currentMember.id)),
    [isParent, children, currentMember.id],
  );

  const showCallTasks = isParent;

  /**
   * 화면에서 보는 항목 — 아이 시점에서는 📞 통화 항목을 빼고 보여 줍니다.
   * (목록·진행률·날짜 요약·복사까지 모두 이 함수를 씁니다)
   */
  const tasksForView = useCallback(
    (memberId: string, dateIso: string) => {
      const list = tasksFor(memberId, dateIso);
      return showCallTasks ? list : list.filter((task) => !isCallTask(task));
    },
    [tasksFor, showCallTasks],
  );

  /**
   * 부모 화면에서는 그 날 부모(아빠·엄마)에게 배정된 할 일도 같이 보여 줍니다.
   * (예: 토요일 아빠의 '독서록 검사') 아이 화면은 그대로 자기 것만 봅니다.
   */
  const parentBoardMembers = useMemo(
    () => (isParent ? parents.filter((member) => tasksForView(member.id, selectedDate).length > 0) : []),
    [isParent, parents, selectedDate, tasksForView],
  );
  const dayBoardMembers = useMemo(
    () => [...visibleMembers, ...parentBoardMembers],
    [visibleMembers, parentBoardMembers],
  );

  /** 주간 진행률은 부모 화면이면 부모 할 일까지 포함해 셈합니다. */
  const progressMembers = useMemo(
    () => (isParent ? [...children, ...parents] : children.filter((member) => member.id === currentMember.id)),
    [isParent, children, parents, currentMember.id],
  );

  const weekDays = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekDatesIso = useMemo(() => weekDays.map((day) => toISODate(day)), [weekDays]);

  const progress = useMemo(() => {
    const map: Record<string, DayProgress> = {};
    for (const day of weekDays) {
      const iso = toISODate(day);
      const dayTasks = progressMembers.flatMap((member) => tasksForView(member.id, iso));
      const summary = summarize(dayTasks);
      map[iso] = { total: summary.total, verified: summary.verified, pending: summary.pending };
    }
    return map;
  }, [weekDays, progressMembers, tasksForView]);

  const dayTasks = useMemo(
    () => dayBoardMembers.flatMap((member) => tasksForView(member.id, selectedDate)),
    [dayBoardMembers, selectedDate, tasksForView],
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

  /** 완료 체크 — 누르는 순간 완료로 기록되고, 그 시각이 카드에 남습니다. */
  const handleComplete = async (task: Task) => {
    const result = await setStatus(task.id, 'verified');
    if (result.ok) {
      const time = formatTimeKo(new Date().toISOString());
      notify(`완료! ${time} 완료로 기록했어요`);
      return;
    }
    notify(result.error ?? '완료하지 못했어요');
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

  const openCopyForDay = () => {
    if (dayTasks.length === 0) {
      notify('이 날은 복사할 공부가 없어요');
      return;
    }
    setCopySources(dayTasks);
  };

  const openCopyForTask = (task: Task) => setCopySources([task]);

  /**
   * 아이 화면 → 부모 관리. 프로필에서 누른 아빠·엄마를 그대로 열되,
   * 이 경우에도 항상 PIN 확인부터 시작하고 취소하면 보던 아이 화면으로 돌아갑니다(잠금은 풀리지 않음).
   */
  const handleRequestParent = (memberId: string) => {
    const target =
      study.parents.find((member) => member.id === memberId) ??
      study.members.find((member) => member.role === 'parent' && member.id === 'mem_dad') ??
      study.parents[0];
    if (!target) return;
    setProfileOpen(false);
    setParentGateTarget(target.id);
    setParentGateReturnTo(currentMember.id);
    setParentGateForced(true);
    study.setCurrentMember(target.id);
  };

  const cancelParentGate = () => {
    const back = parentGateReturnTo;
    setParentGateForced(false);
    setParentGateReturnTo(null);
    setParentGateTarget(null);
    if (back) study.setCurrentMember(back);
  };

  /**
   * 기본 목록 — 고른 날짜에 그 아이가 같은 요일 패턴(토 / 월·수·금 / 화·목)에 하던 항목을
   * 한 번에 '할 일'로 넣습니다. 지난 기록이 없으면 그 아이의 빠른 추가 항목을 씁니다.
   * 공휴일·일요일에는 넣지 않습니다.
   */
  const handleFillDefaults = async () => {
    if (!isParent || fillingDefaultsRef.current) return;
    if (isRestDay(selectedDate)) {
      notify('쉬는 날에는 기본 목록을 넣지 않아요');
      return;
    }

    fillingDefaultsRef.current = true;
    setFillingDefaults(true);
    let added = 0;
    let failed = 0;
    let firstError: string | undefined;
    try {
      for (const member of visibleMembers) {
        for (const item of defaultItemsForDay(study.db.tasks, member, selectedDate)) {
          const result = await addTask({
            member_id: member.id,
            title: item.title,
            subject: item.subject,
            due_date: selectedDate,
          });
          if (result.ok) added += 1;
          else {
            failed += 1;
            firstError = firstError ?? result.error;
          }
        }
      }
    } finally {
      fillingDefaultsRef.current = false;
      setFillingDefaults(false);
    }

    if (added > 0) {
      notify(
        failed > 0
          ? `기본 목록 ${added}개를 추가했어요 · ${failed}개는 넣지 못했어요`
          : `기본 목록 ${added}개를 추가했어요`,
      );
      return;
    }
    notify(failed > 0 ? firstError ?? '기본 목록을 넣지 못했어요' : '기본 목록이 이미 다 들어 있어요');
  };

  /** 어제 공부를 오늘(보고 있는 날)로 한 번에 가져옵니다. */
  const handleCopyYesterday = async () => {
    const yesterday = toISODate(addDays(fromISODate(selectedDate), -1));
    const sources = visibleMembers.flatMap((member) => tasksForView(member.id, yesterday));
    if (sources.length === 0) {
      notify('어제는 복사할 공부가 없었어요');
      return;
    }
    const result = await copyTasks(
      sources.map((task) => task.id),
      [selectedDate],
    );
    if (!result.ok) {
      notify(result.error ?? '복사하지 못했어요');
      return;
    }
    const parts = [`어제 공부 ${result.created}개를 가져왔어요`];
    if (result.skipped > 0) parts.push(`이미 있어서 ${result.skipped}개는 건너뛰었어요`);
    notify(parts.join(' · '));
  };

  const parentLocked = isParent && (!parentUnlocked || parentGateForced);

  const defaultAddMemberId = isParent
    ? (visibleMembers[0]?.id ?? currentMember.id)
    : currentMember.id;

  if (parentLocked) {
    return (
      <div className="min-h-screen bg-[#f5f6fa]">
        <ParentPinGate
          familyName={study.familyName}
          mode={parentPinSetupRequired ? 'setup' : 'unlock'}
          targetName={parentGateTarget ? study.members.find((member) => member.id === parentGateTarget)?.name : undefined}
          children={study.children}
          onSubmit={async (pin) => {
            const result = parentPinSetupRequired ? await setParentPin(pin) : await unlockParent(pin);
            if (result.ok) {
              setParentGateForced(false);
              setParentGateReturnTo(null);
              setParentGateTarget(null);
            }
            return result;
          }}
          onSwitchChild={(memberId) => {
            setParentGateForced(false);
            setParentGateReturnTo(null);
            setParentGateTarget(null);
            study.setCurrentMember(memberId);
          }}
          onCancel={parentGateReturnTo ? cancelParentGate : undefined}
        />
        {toast ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-6">
            <div className="animate-toast-in max-w-full truncate rounded-full bg-slate-900/90 px-4 py-2.5 text-[11.5px] font-bold text-white shadow-lg">
              {toast}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

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
        {latestUnseen ? (
          <div
            data-testid="family-note-alert"
            className="mb-3 flex items-start gap-2 rounded-[22px] bg-gradient-to-r from-indigo-600 to-violet-600 p-3 text-white shadow-lg shadow-indigo-500/25"
          >
            <span aria-hidden className="mt-0.5 text-[16px]">
              💬
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-extrabold tracking-wide text-white/75">
                새 한마디 · {latestUnseenAuthor?.name ?? '가족'}
              </p>
              <p className="mt-0.5 break-words text-[12.5px] font-extrabold leading-snug">
                {latestUnseen.content}
              </p>
              <p className="mt-1 text-[9.5px] font-bold text-white/60">
                {formatNoteTime(latestUnseen.created_at)}
              </p>
            </div>
            <button
              type="button"
              data-testid="dismiss-note-alert"
              aria-label="새 한마디 알림 닫기"
              onClick={markNotesSeen}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15 text-white transition active:scale-90"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

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

        {isParent ? (
          <button
            type="button"
            data-testid="fill-defaults"
            onClick={handleFillDefaults}
            disabled={fillingDefaults}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-indigo-50 py-2.5 text-[12px] font-extrabold text-indigo-700 ring-1 ring-indigo-200 transition active:scale-[0.98] disabled:opacity-60"
          >
            <span aria-hidden>📋</span>
            기본 목록
            <span className="text-[9.5px] font-bold text-indigo-400">
              {fillingDefaults ? '넣는 중…' : '이 날 한 번에 넣기'}
            </span>
          </button>
        ) : null}

        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            data-testid="open-copy-day"
            onClick={openCopyForDay}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white py-2 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-900/5 transition active:scale-[0.98]"
          >
            <CopyIcon className="h-3.5 w-3.5 text-indigo-500" />
            이 날 공부 복사
          </button>
          <button
            type="button"
            data-testid="copy-yesterday"
            onClick={handleCopyYesterday}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white py-2 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-900/5 transition active:scale-[0.98]"
          >
            <UndoIcon className="h-3.5 w-3.5 text-slate-400" />
            어제 것 가져오기
          </button>
        </div>

        <FamilyNotesBoard
          notes={notes}
          members={study.members}
          currentMemberId={currentMember.id}
          isParent={isParent}
          state={notesState}
          onSubmit={addNote}
          onDelete={deleteNote}
          onSeen={markNotesSeen}
          notifyPermission={notifyPermission}
          onEnableAlerts={requestNotifyPermission}
        />

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
              <b className="font-extrabold">완료</b>를 누르면 바로 완료로 기록돼요. 항목{' '}
              <b className="font-extrabold">삭제·되돌리기</b>는 부모님만 할 수 있어요.
            </p>
          </div>
        ) : null}

        <div className="mt-3 space-y-3">
          {visibleMembers.map((member) => (
            <ChildBoard
              key={member.id}
              member={member}
              tasks={tasksForView(member.id, selectedDate)}
              canAdd={isParent || member.id === currentMember.id}
              canComplete={isParent || member.id === currentMember.id}
              canManage={isParent}
              onAdd={() => openAdd(member.id)}
              onComplete={handleComplete}
              onRevert={handleRevert}
              onEdit={openEdit}
              onDelete={handleDelete}
              onCopy={openCopyForTask}
            />
          ))}

          {parentBoardMembers.length > 0 ? (
            <div data-testid="parent-boards" className="space-y-2 pt-1">
              <p className="px-1 text-[10px] font-extrabold tracking-wide text-slate-400">부모 할 일</p>
              {parentBoardMembers.map((member) => (
                <ChildBoard
                  key={member.id}
                  member={member}
                  tasks={tasksForView(member.id, selectedDate)}
                  canAdd
                  canComplete
                  canManage
                  onAdd={() => openAdd(member.id)}
                  onComplete={handleComplete}
                  onRevert={handleRevert}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onCopy={openCopyForTask}
                />
              ))}
            </div>
          ) : null}
        </div>

        <p className="mt-5 px-2 text-center text-[10px] font-medium leading-relaxed text-slate-400">
          {isParent
            ? '완료를 누르면 그 시각이 기록돼요. 되돌리기·삭제는 부모 관리 PIN으로 잠겨 있어요.'
            : '완료를 누르면 그 시각이 바로 기록돼요. 삭제·되돌리기는 부모님만 할 수 있어요.'}
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

      <CopySheet
        open={copySources !== null}
        onClose={() => setCopySources(null)}
        sources={copySources ?? []}
        members={isParent ? children : children.filter((member) => member.id === currentMember.id)}
        dates={weekDatesIso}
        selectedDate={selectedDate}
        onCopy={copyTasks}
        onDone={notify}
      />

      <ProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        members={study.members}
        currentMemberId={currentMember.id}
        viewerIsParent={isParent}
        onSelect={study.setCurrentMember}
        onRequestParent={handleRequestParent}
        onLock={lockParent}
        onRename={renameMember}
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
