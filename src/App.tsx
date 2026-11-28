import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { AddTaskSheet } from './components/AddTaskSheet';
import { ChildBoard } from './components/ChildBoard';
import { CopySheet } from './components/CopySheet';
import { DayOverview } from './components/DayOverview';
import { FamilyNotesBoard } from './components/FamilyNotesBoard';
import { ParentDashboard, ParentWeekSummary } from './components/ParentDashboard';
import { ParentPinGate } from './components/ParentPinGate';
import { OptionsPage } from './components/OptionsPage';
import { ShopPage } from './components/ShopPage';
import { TimerPanel } from './components/TimerPanel';
import { ProfileSheet } from './components/ProfileSheet';
import { WeekStrip, type DayProgress } from './components/WeekStrip';
import { CopyIcon, LockIcon, PlusIcon, XIcon } from './components/icons';
import { closeTopOverlay, useOverlayBack } from './lib/back-guard';
import { streakBonusXp } from './lib/app-settings';
import { playNoteChime } from './lib/chime';
import { vibrateNoteAlert } from './lib/haptics';
import { addDays, formatTimeKo, fromISODate, isFutureDate, koreaTodayISO, startOfWeek, toISODate, todayISO, weekDates } from './lib/date';
import { deepLinkDate } from './lib/deeplink';
import { JJOKKO_EMOJI, formatNoteTime, noteAuthorName, noteBody, noteDate } from './lib/notes';
import { summarize } from './lib/store';
import { pointsFor } from './lib/shop';
import { formatXp, xpChangeForStatus } from './lib/season';
import { useStudy, type ActionResult } from './lib/study-context';
import { useTimer } from './lib/timer-context';
import { streakThrough } from './lib/report';
import type { NewTaskInput, Task } from './lib/types';

/**
 * 📞 통화 1·2 (쪼꼬가 거는 확인 전화) 항목.
 * 아이 화면은 공부에만 집중할 수 있게 이 항목을 빼고 보여 주고,
 * 부모 화면에서는 하교·통화 시간과 완료 체크를 그대로 봅니다.
 */
function isCallTask(task: Task): boolean {
  return task.title.includes('📞 통화') || task.id.includes('_call1') || task.id.includes('_call2');
}

/** 📱 뒤로가기로 앱을 닫으려 할 때 뜨는 확인 — 메인 화면과 부모 PIN 화면 양쪽에서 씁니다. */
function ExitConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      data-testid="exit-modal"
      role="dialog"
      aria-modal="true"
      aria-label="앱을 종료하시겠습니까?"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 px-6 backdrop-blur-sm"
    >
      <div className="animate-gift-in w-full max-w-[300px] rounded-[26px] bg-white p-5 text-center shadow-2xl">
        <p className="text-[30px] leading-none" aria-hidden>
          📚
        </p>
        <h2 className="mt-2 text-[15.5px] font-extrabold tracking-tight text-slate-900">앱을 종료하시겠습니까?</h2>
        <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-slate-500">
          공부 기록은 그대로 저장돼 있어요.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            data-testid="exit-cancel"
            onClick={onCancel}
            className="flex-1 rounded-2xl bg-slate-100 py-2.5 text-[12px] font-extrabold text-slate-600 transition active:scale-[0.98]"
          >
            취소
          </button>
          <button
            type="button"
            data-testid="exit-confirm-ok"
            onClick={onConfirm}
            className="flex-1 rounded-2xl bg-slate-900 py-2.5 text-[12px] font-extrabold text-white transition active:scale-[0.98]"
          >
            종료
          </button>
        </div>
      </div>
    </div>
  );
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
    enablePush,
  } = study;

  // 알림을 눌러 열었으면 그 한마디가 붙은 날짜로 바로 시작합니다.
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(fromISODate(deepLinkDate() ?? todayISO())),
  );
  const [selectedDate, setSelectedDate] = useState<string>(() => deepLinkDate() ?? todayISO());
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
  /** 📊 부모 전용 상세 대시보드 */
  const [dashboardOpen, setDashboardOpen] = useState(false);
  /** ⚙️ 부모 전용 옵션(기본 공부 목록·버스트 타임·연속 보너스) */
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** 🛒 포인트 상점 */
  const [shopOpen, setShopOpen] = useState(false);
  /** ⏱ 부모 전용 시간 타이머 */
  const [timerOpen, setTimerOpen] = useState(false);
  /** 📱 뒤로가기로 앱을 닫으려 할 때 띄우는 확인 */
  const [exitOpen, setExitOpen] = useState(false);
  const timer = useTimer();
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

  /* ---------------------------------------------------------------- */
  /* 📱 안드로이드 뒤로가기 — 창을 먼저 닫고, 메인 화면이면 종료 확인       */
  /* ---------------------------------------------------------------- */

  const exitOpenRef = useRef(false);
  exitOpenRef.current = exitOpen;
  const popHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    /** 뒤로가기가 앱을 닫지 않고 우리가 잡을 수 있도록 기록을 하나 쌓아 둔다. */
    const pushGuard = () => {
      try {
        window.history.pushState({ studyGuard: Date.now() }, '');
      } catch {
        /* 히스토리를 못 쓰는 환경(샌드박스·file://)에서는 그냥 두기 */
      }
    };

    pushGuard();

    const onPop = () => {
      // 1) 열려 있는 탭·모달이 있으면 그것만 먼저 닫는다.
      if (closeTopOverlay()) {
        pushGuard();
        return;
      }
      // 2) 종료 확인이 떠 있으면 다시 누를 때는 확인을 닫는다(취소).
      if (exitOpenRef.current) {
        setExitOpen(false);
        pushGuard();
        return;
      }
      // 3) 메인 화면 — 「앱을 종료하시겠습니까?」
      setExitOpen(true);
      pushGuard();
    };

    popHandlerRef.current = onPop;
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      popHandlerRef.current = null;
    };
  }, []);

  /**
   * [종료] — ① 설치형 앱에서는 창을 실제로 닫아 보고,
   *        ② 안 닫히면 가드로 쌓아 둔 기록을 한 칸씩 되돌아 나가 이전 화면(또는 홈 화면)으로 나갑니다.
   *        (기록 수를 세지 않아도 되게, 한 칸씩 뒤로 가며 페이지가 떠날 때까지 반복합니다)
   */
  const confirmExit = () => {
    setExitOpen(false);
    const handler = popHandlerRef.current;
    if (handler) window.removeEventListener('popstate', handler);
    popHandlerRef.current = null;

    try {
      window.close();
    } catch {
      /* 브라우저 탭이면 close 는 막혀 있습니다 — 아래에서 이전 화면으로 나갑니다. */
    }

    window.setTimeout(() => {
      let hops = 0;
      const step = () => {
        hops += 1;
        if (hops > 30) {
          // 여기까지 남아 있다면 돌아갈 기록이 없는 창입니다(첫 화면).
          if (document.visibilityState === 'visible') {
            setToast('이 창은 브라우저가 닫기를 막았어요 · 홈 버튼으로 앱을 닫아 주세요');
          }
          return;
        }
        try {
          window.history.back();
        } catch {
          /* 기록을 못 다루는 환경 */
        }
        window.setTimeout(step, 150);
      };
      step();
    }, 220);
  };

  useOverlayBack(profileOpen, () => setProfileOpen(false));
  useOverlayBack(formOpen, () => setFormOpen(false));
  useOverlayBack(copySources !== null, () => setCopySources(null));
  useOverlayBack(dashboardOpen, () => setDashboardOpen(false));
  useOverlayBack(shopOpen, () => setShopOpen(false));
  useOverlayBack(exitOpen, () => setExitOpen(false));

  const latestUnseen = unseenNotes[0] ?? null;
  /** 자동 알림(티어 승급·부재중 전화 등)은 '쪼꼬' 로 보여 줍니다(supabase/notes-jjokko.sql). */
  const latestUnseenAuthorName = latestUnseen ? noteAuthorName(latestUnseen, study.members) : '가족';
  const latestUnseenBody = latestUnseen ? noteBody(latestUnseen) : '';

  /** 알림 배너를 누르면: 그 한마디가 붙은 날짜의 알림판으로 가면서 배너를 닫습니다. */
  const openNoteDay = (noteId: string) => {
    const note = study.notes.find((item) => item.id === noteId);
    markNotesSeen();
    if (!note) return;
    const day = noteDate(note);
    setSelectedDate(day);
    setWeekStart(startOfWeek(fromISODate(day)));
  };

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
        body: `${latestUnseenAuthorName}: ${latestUnseenBody}`,
        // 앱을 보고 있을 때 뜨는 알림도 같은 앱 아이콘·상단 바 배지를 씁니다(서비스 워커 알림과 동일).
        icon: `${import.meta.env.BASE_URL}icons/icon-192.png?v=4`,
        badge: `${import.meta.env.BASE_URL}badge-96.png?v=4`,
        tag: `study-note-${latestUnseen.id}`,
      };
      vibrateNoteAlert();

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
  }, [latestUnseen, latestUnseenAuthorName, latestUnseenBody, notifyPermission]);

  /**
   * '🔔 알림 켜기' — 브라우저 알림 권한을 받고, 이 기기를 백그라운드 알림에 등록합니다.
   * 앱을 완전히 닫아 둬도 새 한마디가 폰 알림으로 오게 됩니다.
   */
  const requestNotifyPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await enablePush();
      setNotifyPermission(Notification.permission);
      if (result.ok) {
        notify('알림을 켰어요. 앱을 닫아 둬도 새 한마디가 폰 알림으로 와요.');
      } else if (Notification.permission !== 'granted') {
        notify(result.error ?? '알림을 켜지 못했어요.');
      } else {
        notify(result.error ?? '폰 알림은 아직 준비 중이에요.');
      }
    } catch {
      /* 권한 창을 띄울 수 없는 환경 */
    }
  };

  /** 폰 알림을 눌러 앱이 열리면 그 날짜 알림판으로 이동합니다(이미 열려 있을 때). */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; date?: string } | null;
      if (!data || data.type !== 'study-note-open') return;
      const day = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
      if (day) {
        setSelectedDate(day);
        setWeekStart(startOfWeek(fromISODate(day)));
      }
      markNotesSeen();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [markNotesSeen]);

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
  /** 날짜 요약을 한 사람씩 나눠 셈합니다 — 부모 화면은 아이마다 카드 한 장씩. */
  const dayMemberStats = useMemo(
    () =>
      dayBoardMembers.map((member) => ({
        member,
        summary: summarize(tasksForView(member.id, selectedDate)),
      })),
    [dayBoardMembers, selectedDate, tasksForView],
  );
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

  /** 완료 체크 — 누르는 순간 완료로 기록되고, 그 시각이 카드에 남습니다.
   *  아직 오지 않은 날짜의 공부는 그날이 되기 전까지 완료할 수 없습니다(버튼도 잠겨 있어요).
   *  ⚖️ 받는 XP 는 그 날(항목 날짜)에 했는지로 정해집니다 — 당일 100% · 하루 지남 50% · 이틀 이상 25%. */
  /** ⑤ 완료로 연속 일수가 보너스 기준(3·7·14·30일)에 닿았는지 — 쪼꼬 축하 한마디에 씁니다. */
  const milestoneOnComplete = (task: Task, completedAt: string) => {
    const known = study.db.tasks.some((item) => item.id === task.id);
    const nextTasks = known
      ? study.db.tasks.map((item) =>
          item.id === task.id ? { ...item, status: 'verified' as const, verified_at: completedAt } : item,
        )
      : [...study.db.tasks, { ...task, status: 'verified' as const, verified_at: completedAt }];
    const streak = streakThrough(nextTasks, task.member_id, koreaTodayISO());
    const xp = streakBonusXp(streak, study.appSettings.streakBonuses);
    return xp > 0 ? { streak, xp } : null;
  };

  const handleComplete = async (task: Task) => {
    if (isFutureDate(task.due_date)) {
      notify('아직 날짜가 되지 않았어요 · 그날이 되면 완료할 수 있어요');
      return;
    }
    const completedAt = new Date().toISOString();
    const change = xpChangeForStatus(study.db.tasks, task, 'verified', { completedAt, rules: study.xpRules });
    const milestone = milestoneOnComplete(task, completedAt);
    const result = await setStatus(task.id, 'verified');
    if (result.ok) {
      const time = formatTimeKo(completedAt);
      const parts = [`완료! ${time}`];
      if (change.itemDelta > 0) {
        parts.push(`+${formatXp(change.itemDelta)} XP`);
        if (change.item.burst) parts.push('🔥 버스트 2배');
        else if (change.item.percent < 100) parts.push(change.item.label);
      }
      // ⑤ 연속 달성 보너스는 🐣 쪼꼬 한마디로 따로 알리고, 나머지(100%·연속)만 여기에 적습니다.
      const plainBonus = Math.max(0, Math.round((change.bonusDelta - (milestone?.xp ?? 0)) * 10) / 10);
      if (plainBonus > 0) parts.push(`100% 보너스 +${formatXp(plainBonus)}`);
      if (milestone) parts.push(`🐣 쪼꼬: ${milestone.streak}일 연속 달성! +${formatXp(milestone.xp)} XP`);
      notify(parts.join(' · '));
      return;
    }
    notify(result.error ?? '완료하지 못했어요');
  };

  /** 완료 되돌리기 — 그 항목 XP 와 그날 100%·연속 보너스까지 정확히 회수됩니다. */
  const handleRevert = async (task: Task) => {
    const change = xpChangeForStatus(study.db.tasks, task, 'todo', { rules: study.xpRules });
    const result = await setStatus(task.id, 'todo');
    if (!result.ok) {
      notify(result.error ?? '되돌리지 못했어요');
      return;
    }
    const reclaimed = Math.abs(change.delta);
    if (reclaimed <= 0) {
      notify('할 일로 되돌렸어요');
      return;
    }
    notify(
      `할 일로 되돌렸어요 · ${formatXp(reclaimed)} XP 회수${change.currentSeason ? '' : ' (지난 시즌)'}`,
    );
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
        {exitOpen ? <ExitConfirmDialog onCancel={() => setExitOpen(false)} onConfirm={confirmExit} /> : null}
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
        {/* 🔥 버스트 타임 안내 — 켜져 있는 동안 모든 아이 화면 위에 뜽니다. */}
        {study.burstActive ? (
          <div
            data-testid="burst-banner"
            className="mb-3 flex items-center gap-2 rounded-[18px] bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-2 text-white shadow-lg shadow-orange-500/25"
          >
            <span aria-hidden className="animate-box-idle text-[16px]">
              🔥
            </span>
            <p className="text-[11.5px] font-extrabold leading-tight">
              버스트 타임 진행 중!
              <span className="ml-1 font-bold text-white/80">경험치 2배</span>
            </p>
          </div>
        ) : null}

        {/* ⏱ 돌고 있는 타이머 — 아이 화면에서는 남은 시간만, 조작은 부모만 */}
        {timer.session && timer.session.status !== 'done' ? (
          <div
            data-testid="timer-strip"
            className="mb-3 flex items-center gap-2 rounded-[18px] bg-slate-900 px-3 py-2 text-white shadow-lg"
          >
            <span aria-hidden className="text-[15px]">
              ⏱
            </span>
            <span className="min-w-0 truncate text-[11px] font-extrabold">{timer.session.member_name}</span>
            <span data-testid="timer-strip-clock" className="shrink-0 text-[15px] font-extrabold tabular-nums">
              {timer.clock}
            </span>
            {timer.session.status === 'paused' ? (
              <span className="shrink-0 text-[9px] font-bold text-white/60">일시 멈춤</span>
            ) : null}
            {isParent ? (
              <div className="ml-auto flex shrink-0 gap-1">
                <button
                  type="button"
                  data-testid="timer-strip-toggle"
                  onClick={timer.session?.status === 'paused' ? timer.resume : timer.pause}
                  className="rounded-full bg-white/15 px-2 py-1 text-[9.5px] font-extrabold transition active:scale-95"
                >
                  {timer.session.status === 'paused' ? '▶ 재개' : '⏸ 멈춤'}
                </button>
                <button
                  type="button"
                  onClick={() => setTimerOpen(true)}
                  className="rounded-full bg-white/15 px-2 py-1 text-[9.5px] font-extrabold transition active:scale-95"
                >
                  관리
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {latestUnseen ? (
          <div
            data-testid="family-note-alert"
            onClick={() => openNoteDay(latestUnseen.id)}
            className="mb-3 flex w-full cursor-pointer items-start gap-2 rounded-[22px] bg-gradient-to-r from-indigo-600 to-violet-600 p-3 text-left text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.99]"
          >
            <button
              type="button"
              data-testid="open-note-alert"
              aria-label={`새 한마디: ${latestUnseenAuthorName} — ${latestUnseenBody}. 누르면 그 날 한마디로 이동해요.`}
              onClick={(event) => {
                event.stopPropagation();
                openNoteDay(latestUnseen.id);
              }}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-2xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              <span aria-hidden className="mt-0.5 text-[16px]">
                💬
              </span>
              <span className="min-w-0 flex-1">
                <span
                  data-testid="note-alert-author"
                  className="block text-[10px] font-extrabold tracking-wide text-white/75"
                >
                  새 한마디 · {latestUnseen.author_kind === 'jjokko' ? `${JJOKKO_EMOJI} ` : ''}
                  {latestUnseenAuthorName}
                </span>
                <span className="mt-0.5 block break-words text-[12.5px] font-extrabold leading-snug">
                  {latestUnseenBody}
                </span>
                <span className="mt-1 block text-[9.5px] font-bold text-white/60">
                  {formatNoteTime(latestUnseen.created_at)}
                  <span className="ml-1 text-white/50">· 눌러서 닫기</span>
                </span>
              </span>
            </button>
            <button
              type="button"
              data-testid="dismiss-note-alert"
              aria-label="새 한마디 알림 닫기"
              onClick={(event) => {
                event.stopPropagation();
                markNotesSeen();
              }}
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

        <DayOverview dateIso={selectedDate} summary={daySummary} memberSummaries={dayMemberStats} />

        {/* 📊 엄마·아빠 전용 — 이번 주 간단 요약(누르면 상세 대시보드). 아이 화면에는 없습니다. */}
        {isParent ? <ParentWeekSummary onOpen={() => setDashboardOpen(true)} /> : null}

        {/* ⚙️ 엄마·아빠 전용 도구 — 시간 타이머 · 옵션 · 포인트 상점 */}
        {isParent ? (
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              data-testid="open-timer"
              onClick={() => setTimerOpen(true)}
              className="flex flex-col items-start gap-0.5 rounded-2xl bg-white px-2 py-2 text-left shadow-card ring-1 ring-slate-900/5 transition active:scale-[0.98]"
            >
              <span className="text-[11px] font-extrabold text-slate-800">⏱ 시간 타이머</span>
              <span className="text-[8.5px] font-bold text-slate-400">뽑기 시간 쓰기</span>
            </button>
            <button
              type="button"
              data-testid="open-options"
              onClick={() => setOptionsOpen(true)}
              className="flex flex-col items-start gap-0.5 rounded-2xl bg-white px-2 py-2 text-left shadow-card ring-1 ring-slate-900/5 transition active:scale-[0.98]"
            >
              <span className="text-[11px] font-extrabold text-slate-800">⚙️ 옵션</span>
              <span className="text-[8.5px] font-bold text-slate-400">공부 목록 · 이벤트</span>
            </button>
            <button
              type="button"
              data-testid="open-shop"
              onClick={() => setShopOpen(true)}
              className="flex flex-col items-start gap-0.5 rounded-2xl bg-white px-2 py-2 text-left shadow-card ring-1 ring-slate-900/5 transition active:scale-[0.98]"
            >
              <span className="text-[11px] font-extrabold text-slate-800">🛒 포인트 상점</span>
              <span className="text-[8.5px] font-bold text-slate-400">상품 · 구매 내역</span>
            </button>
          </div>
        ) : null}

        {/* 🛒 아이 화면 — 내 포인트와 상점 */}
        {!isParent ? (
          <button
            type="button"
            data-testid="open-shop-child"
            onClick={() => setShopOpen(true)}
            className="mt-2.5 flex w-full items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2.5 text-left text-white shadow-lg shadow-emerald-500/25 transition active:scale-[0.99]"
          >
            <span aria-hidden className="text-[16px]">🛒</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-extrabold">포인트 상점</span>
              <span className="block text-[9px] font-bold text-white/75">모은 P 로 물건을 사요</span>
            </span>
            <span data-testid="child-points-chip" className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-extrabold tabular-nums">
              {pointsFor(study.db.tasks, currentMember.id)}P
            </span>
          </button>
        ) : null}

        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            data-testid="open-copy-day"
            onClick={openCopyForDay}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-white py-2 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-900/5 transition active:scale-[0.98]"
          >
            <CopyIcon className="h-3.5 w-3.5 text-indigo-500" />
            이 날 공부 복사
          </button>
        </div>

        <FamilyNotesBoard
          notes={notes}
          dateIso={selectedDate}
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

      {isParent && dashboardOpen ? <ParentDashboard onClose={() => setDashboardOpen(false)} /> : null}
      {isParent && optionsOpen ? (
        <OptionsPage onClose={() => setOptionsOpen(false)} onNotify={notify} />
      ) : null}
      {isParent && timerOpen ? <TimerPanel onClose={() => setTimerOpen(false)} onNotify={notify} /> : null}
      {shopOpen ? <ShopPage onClose={() => setShopOpen(false)} onNotify={notify} /> : null}

      {/* 📱 뒤로가기 — 메인 화면에서만 「앱을 종료하시겠습니까?」 */}
      {exitOpen ? <ExitConfirmDialog onCancel={() => setExitOpen(false)} onConfirm={confirmExit} /> : null}

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
