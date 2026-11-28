import { useEffect, useMemo, useState } from 'react';
import {
  ROUTINE_PRESETS,
  TIER_DIFFICULTY_OPTIONS,
  boxMinutePool,
  burstOnDate,
  itemsForDay,
  itemsForMember,
  mergeRoutineItems,
  nextStreakBonus,
  reachedStreakBonus,
  withRoutineItems,
  type AppSettings,
  type BoxReward,
  type RoutineItem,
  type RoutineKey,
} from '../lib/app-settings';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { fromISODate, koreaTodayISO, WEEKDAY_LABELS } from '../lib/date';
import { defaultItemsForDay } from '../lib/defaults';
import { computePastSeason, formatXp, isXpHiddenTask, recentSeasons, TIERS, tierThreshold } from '../lib/season';
import { useStudy } from '../lib/study-context';
import { SUBJECTS, subjectMeta } from '../lib/theme';
import type { Task } from '../lib/types';
import { ArrowLeftIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';

/**
 * ⚙️ 옵션 — 부모 관리(PIN) 안에서만 열리는 페이지
 *
 * ④ 📚 공부 목록: 프리셋(학기중·방학·시험기간)마다 아이별 기본 항목 목록을 따로 보고 고칩니다.
 *    · 학기중만 지난 기록(DB)으로 기본이 채워지고, 방학·시험기간은 비어 있어 직접 채웁니다.
 * ⑤ 항목마다 적용 요일(월~일) 체크박스·순서(↑↓)·'부모 확인 필요'를 정합니다.
 * ⑥ 예전 [📋 기본 목록 도구] 는 없앴습니다.
 * ⑦ 🎁 선물 상자: 보상 목록(수정 잠금·삭제 후 다시 추가) + 상자 개수(1~5).
 * ⑪ 티어 난이도(%) 버튼 — 지난 기록·승급 기록에는 소급하지 않습니다.
 */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function itemsFromHistory(tasks: Task[], memberId: string, weekday: number): RoutineItem[] {
  const today = koreaTodayISO();
  const mine = tasks.filter(
    (task) =>
      task.member_id === memberId &&
      !isXpHiddenTask(task) &&
      task.due_date <= today &&
      new Date(`${task.due_date}T00:00:00+09:00`).getDay() === weekday,
  );
  if (mine.length === 0) return [];
  const latest = mine.map((task) => task.due_date).sort()[mine.length - 1];
  const seen = new Set<string>();
  const items: RoutineItem[] = [];
  for (const task of mine.filter((item) => item.due_date === latest)) {
    const key = `${task.title}::${task.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `hi_${task.id}`,
      title: task.title,
      subject: task.subject,
      days: [weekday],
      order: items.length,
    });
  }
  return items;
}

/** 학기중 기본 목록 — 요일별 지난 기록을 하나로 합칩니다(적용 요일은 기록에서). */
function semesterFromHistory(tasks: Task[], memberId: string): RoutineItem[] {
  let merged: RoutineItem[] = [];
  for (const weekday of DAY_ORDER) {
    const list = itemsFromHistory(tasks, memberId, weekday);
    if (list.length > 0) merged = mergeRoutineItems(merged, list);
  }
  return merged;
}

interface OptionsPageProps {
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function OptionsPage({ onClose, onNotify }: OptionsPageProps) {
  const study = useStudy();
  const settings = study.appSettings;
  useOverlayBack(true, onClose);

  const [tab, setTab] = useState<'routines' | 'events'>('routines');
  /** ④ 지금 '보고 고치는' 프리셋 — 실제 적용(activePreset)은 [이 프리셋 적용] 으로 따로 합니다. */
  const [presetView, setPresetView] = useState<RoutineKey>(settings.activePreset);
  const [memberId, setMemberId] = useState<string>(study.children[0]?.id ?? '');
  const [dayFilter, setDayFilter] = useState<number | 'all'>(new Date().getDay());
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('etc');
  const [needParent, setNeedParent] = useState(false);
  const [draftDays, setDraftDays] = useState<number[]>(DAY_ORDER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bonusDraft, setBonusDraft] = useState(settings.streakBonuses);
  const [presetConfirm, setPresetConfirm] = useState<RoutineKey | null>(null);
  const [filling, setFilling] = useState(false);
  /** ⑦ 뽑기(선물) 상자 보상 목록 편집본 */
  const [boxDraft, setBoxDraft] = useState<BoxReward[]>(settings.boxRewards);
  const [boxKind, setBoxKind] = useState<'minutes' | 'points'>('minutes');
  const [boxValue, setBoxValue] = useState('10');

  useEffect(() => {
    setBonusDraft(study.appSettings.streakBonuses);
  }, [study.appSettings.streakBonuses]);

  useEffect(() => {
    setBoxDraft(study.appSettings.boxRewards);
  }, [study.appSettings.boxRewards]);

  const member = study.children.find((item) => item.id === memberId) ?? study.children[0];
  const activeMeta = ROUTINE_PRESETS.find((preset) => preset.key === settings.activePreset) ?? ROUTINE_PRESETS[0];
  const viewMeta = ROUTINE_PRESETS.find((preset) => preset.key === presetView) ?? ROUTINE_PRESETS[0];

  const savedItems = useMemo(
    () => (member ? itemsForMember(settings, member.id, presetView) : []),
    [settings, member, presetView],
  );
  const historyItems = useMemo(
    () => (member && presetView === 'semester' ? semesterFromHistory(study.db.tasks, member.id) : []),
    [study.db.tasks, member, presetView],
  );
  const fromHistory = savedItems.length === 0 && historyItems.length > 0;
  const items = savedItems.length > 0 ? savedItems : historyItems;

  const visibleItems = useMemo(
    () => items.filter((item) => dayFilter === 'all' || item.days.includes(dayFilter)),
    [items, dayFilter],
  );

  const save = async (patch: Partial<AppSettings>): Promise<boolean> => {
    setBusy(true);
    const result = await study.saveAppSettings(patch);
    setBusy(false);
    if (!result.ok) {
      onNotify(result.error ?? '저장하지 못했어요');
      return false;
    }
    if (result.localOnly) onNotify('이 폰에만 저장했어요 · 가족 폰까지 쓰려면 SQL 한 번이 필요해요');
    return true;
  };

  const saveItems = async (nextItems: RoutineItem[], message: string) => {
    if (!member) return;
    const next = withRoutineItems(study.appSettings, member.id, nextItems, presetView);
    if (await save({ presets: next.presets })) onNotify(message);
  };

  const resetDraft = () => {
    setEditingId(null);
    setTitle('');
    setSubject('etc');
    setNeedParent(false);
    setDraftDays(dayFilter === 'all' ? DAY_ORDER : [dayFilter]);
  };

  useEffect(() => {
    setDraftDays(dayFilter === 'all' ? DAY_ORDER : [dayFilter]);
  }, [dayFilter]);

  const addItem = async () => {
    const text = title.trim();
    if (!text) {
      onNotify('무엇을 공부하는지 적어 주세요');
      return;
    }
    if (draftDays.length === 0) {
      onNotify('적용할 요일을 하나 이상 골라 주세요');
      return;
    }
    if (editingId) {
      const next = items.map((item) =>
        item.id === editingId
          ? { ...item, title: text, subject, days: draftDays, ...(needParent ? { needParent: true } : { needParent: undefined }) }
          : item,
      );
      await saveItems(next, '기본 목록을 고쳤어요');
      resetDraft();
      return;
    }
    const item: RoutineItem = {
      id: `ri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      title: text,
      subject,
      days: [...draftDays].sort((a, b) => a - b),
      order: items.length,
      ...(needParent ? { needParent: true } : {}),
    };
    await saveItems([...items, item], '기본 목록에 추가했어요');
    resetDraft();
  };

  const startEdit = (item: RoutineItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setSubject(item.subject);
    setNeedParent(item.needParent === true);
    setDraftDays(item.days.length > 0 ? item.days : DAY_ORDER);
  };

  const toggleItemDay = (item: RoutineItem, day: number) => {
    const days = item.days.includes(day) ? item.days.filter((value) => value !== day) : [...item.days, day];
    void saveItems(
      items.map((entry) =>
        entry.id === item.id ? { ...entry, days: days.sort((a, b) => a - b) } : entry,
      ),
      `${item.title} · 적용 요일을 바꿨어요`,
    );
  };

  const toggleNeedParent = (item: RoutineItem) => {
    void saveItems(
      items.map((entry) =>
        entry.id === item.id ? { ...entry, needParent: entry.needParent ? undefined : true } : entry,
      ),
      item.needParent ? '부모 확인을 끄지 않았어요' : `${item.title} · 부모 확인 항목으로 바꿨어요`,
    );
  };

  const moveItem = (item: RoutineItem, delta: number) => {
    const sorted = [...items].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((entry) => entry.id === item.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    void saveItems(next, '순서를 바꿨어요');
  };

  /** ④ 프리셋 확인 팝업에서 [적용] 을 눌렀을 때 */
  const applyPreset = async (key: RoutineKey) => {
    setPresetConfirm(null);
    const meta = ROUTINE_PRESETS.find((preset) => preset.key === key);
    if (await save({ activePreset: key })) {
      onNotify(`${meta?.label ?? key} 프리셋을 적용했어요 · 이제 이 목록으로 채워요`);
    }
  };

  /** 📋 보고 있는 프리셋을 오늘 날짜에 넣습니다 (방학·시험기간은 비어 있으면 넣지 않음). */
  const fillToday = async () => {
    if (filling) return;
    const date = koreaTodayISO();
    setFilling(true);
    let added = 0;
    let failed = 0;
    let firstError: string | undefined;
    try {
      for (const child of study.children) {
        const routine = itemsForDay(settings, child.id, fromISODate(date).getDay(), presetView);
        for (const item of defaultItemsForDay(
          study.db.tasks,
          child,
          date,
          routine,
          presetView === 'semester',
        )) {
          const result = await study.addTask({
            member_id: child.id,
            title: item.title,
            subject: item.subject,
            due_date: date,
            note: item.needParent ? JSON.stringify({ needParent: true }) : undefined,
          });
          if (result.ok) added += 1;
          else {
            failed += 1;
            firstError = firstError ?? result.error;
          }
        }
      }
    } finally {
      setFilling(false);
    }
    if (added > 0) {
      onNotify(failed > 0 ? `오늘 기본 목록 ${added}개를 넣었어요 · ${failed}개는 못 넣었어요` : `오늘 기본 목록 ${added}개를 넣었어요`);
      return;
    }
    onNotify(
      failed > 0
        ? firstError ?? '기본 목록을 넣지 못했어요'
        : presetView === 'semester'
          ? '오늘 기본 목록이 이미 다 들어 있어요'
          : '이 프리셋은 아직 비어 있어요 · 항목을 먼저 추가해 주세요',
    );
  };

  /* ---------------- 🔥 버스트 타임 (수동/자동/중복) ---------------- */

  const toggleBurst = async () => {
    const on = !settings.burst;
    const now = new Date();
    const windows = on
      ? [...settings.burstWindows, { from: now.toISOString(), to: null }].slice(-30)
      : settings.burstWindows.map((window) =>
          window.to === null ? { ...window, to: now.toISOString() } : window,
        );
    if (await save({ burst: on, burstWindows: windows })) {
      onNotify(
        on
          ? '🔥 버스트 타임(수동) 시작! 지금부터 완료하는 공부는 경험치 2배예요'
          : '수동 버스트 타임을 껐어요 · 그동안 받은 2배 경험치는 그대로 남아요',
      );
    }
  };

  const setBoxCount = async (count: number) => {
    if (await save({ boxCount: count })) onNotify(`선물 상자를 ${count}개 보여 줄게요`);
  };

  const saveBoxRewards = async (next: BoxReward[], message: string) => {
    if (next.length === 0) {
      onNotify('보상은 하나 이상 남겨 주세요');
      return;
    }
    if (!(await save({ boxRewards: next }))) return;
    // 분 보상 값은 서버(가족 보상 설정)의 상자 후보와도 맞춰 둡니다.
    const pool = boxMinutePool(next);
    const result = await study.saveRewardSettings({ pool });
    if (!result.ok) {
      onNotify('보상 목록은 저장했어요 · 상자 시간 후보는 이 폰에만 적용돼요');
      return;
    }
    onNotify(message);
  };

  const addBoxReward = async () => {
    const value = Math.round(Number(boxValue));
    if (!Number.isFinite(value) || value < 1 || value > 500) {
      onNotify('1 이상 500 이하로 입력해 주세요');
      return;
    }
    const next: BoxReward[] = [
      ...boxDraft,
      { id: `bx_${boxKind}_${Date.now().toString(36)}`, kind: boxKind, value },
    ];
    setBoxDraft(next);
    await saveBoxRewards(next, `선물 상자 보상에 ${value}${boxKind === 'points' ? 'P' : '분'}을 추가했어요`);
    setBoxValue('10');
  };

  const saveBonuses = async () => {
    if (await save({ streakBonuses: bonusDraft })) onNotify('연속 달성 보너스를 저장했어요');
  };

  /** ⑪ 난이도 — 바꾸기 전에 지난 12개월 결산을 지금 기준으로 고정해 둡니다(소급 금지). */
  const changeDifficulty = async (value: number) => {
    if (value === settings.tierDifficulty) return;
    const today = koreaTodayISO();
    const settlements = { ...settings.settlements };
    for (const child of study.children) {
      const frozenMonths = { ...(settlements[child.id] ?? {}) };
      for (const season of recentSeasons(today, 12)) {
        if (frozenMonths[season]) continue;
        const past = computePastSeason(study.db.tasks, child.id, season, {
          ...study.xpRules,
          tierDifficulty: settings.tierDifficulty,
        });
        if (past.xp <= 0) continue;
        frozenMonths[season] = {
          season,
          xp: past.xp,
          title: past.level.title,
          tier: past.level.key,
          division: past.level.division,
          level: past.level.index,
          frozen_at: new Date().toISOString(),
        };
      }
      settlements[child.id] = frozenMonths;
    }
    if (await save({ tierDifficulty: value, settlements })) {
      onNotify(`티어 난이도를 ${value === 0 ? '기본(0%)' : `${value > 0 ? '+' : ''}${value}%`}로 바꿨어요 · 지난 기록은 그대로예요`);
    }
  };

  const today = koreaTodayISO();
  const todayBurst = burstOnDate(today, settings);

  return (
    <div data-testid="options-page" className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f6fa]">
      <div className="sticky top-0 z-10 bg-[#f5f6fa]/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-4 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="options-close"
              onClick={onClose}
              aria-label="옵션 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">⚙️ 옵션</h1>
              <p className="text-[9.5px] font-bold text-slate-400">엄마·아빠만 열 수 있어요</p>
            </div>
          </div>

          <div className="mt-2 flex rounded-full bg-slate-200/70 p-0.5">
            <button
              type="button"
              data-testid="option-tab-routines"
              onClick={() => setTab('routines')}
              className={cx(
                'flex-1 rounded-full px-2.5 py-1.5 text-[10.5px] font-extrabold transition',
                tab === 'routines' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              📚 공부 목록
            </button>
            <button
              type="button"
              data-testid="option-tab-events"
              onClick={() => setTab('events')}
              className={cx(
                'flex-1 rounded-full px-2.5 py-1.5 text-[10.5px] font-extrabold transition',
                tab === 'events' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              🔥 이벤트·보너스
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2.5 px-4 pb-28 pt-1">
        {tab === 'routines' ? (
          <>
            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[10px] font-extrabold tracking-wide text-slate-400">프리셋 — 눌러서 보고 고치기</p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {ROUTINE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    data-testid={`preset-${preset.key}`}
                    onClick={() => {
                      setPresetView(preset.key);
                      resetDraft();
                    }}
                    aria-pressed={preset.key === presetView}
                    className={cx(
                      'flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[10.5px] font-extrabold ring-1 transition active:scale-95',
                      preset.key === presetView
                        ? 'bg-indigo-600 text-white ring-indigo-600 shadow-lg shadow-indigo-500/25'
                        : 'bg-slate-50 text-slate-600 ring-slate-200',
                    )}
                  >
                    <span className="text-[15px] leading-none" aria-hidden>
                      {preset.emoji}
                    </span>
                    {preset.label}
                    {preset.key === settings.activePreset ? (
                      <span className={cx('text-[8px] font-bold', preset.key === presetView ? 'text-white/80' : 'text-indigo-500')}>
                        사용 중
                      </span>
                    ) : (
                      <span className="text-[8px] font-bold opacity-60">보기</span>
                    )}
                  </button>
                ))}
              </div>
              <p data-testid="active-preset" className="mt-2 text-[9.5px] font-bold leading-relaxed text-slate-400">
                지금 <b className="font-extrabold text-indigo-600">{viewMeta.label}</b> 목록을 고치고 있어요.
                실제로 쓰는 목록은 <b className="font-extrabold text-slate-600">{activeMeta.label}</b> 이에요.
                {presetView !== settings.activePreset ? (
                  <button
                    type="button"
                    data-testid="preset-activate"
                    onClick={() => setPresetConfirm(presetView)}
                    className="ml-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[9px] font-extrabold text-white active:scale-95"
                  >
                    이 프리셋 적용
                  </button>
                ) : null}
              </p>
              <p className="mt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
                학기중은 지난 기록으로 기본이 채워져 있고, 방학·시험기간은 비어 있어요 — 직접 채워 주세요.
              </p>
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <div className="flex gap-1.5">
                {study.children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    data-testid={`option-child-${child.id}`}
                    onClick={() => {
                      setMemberId(child.id);
                      resetDraft();
                    }}
                    className={cx(
                      'flex-1 rounded-2xl py-1.5 text-[11px] font-extrabold ring-1 transition active:scale-95',
                      child.id === member?.id
                        ? 'bg-slate-900 text-white ring-slate-900'
                        : 'bg-slate-50 text-slate-600 ring-slate-200',
                    )}
                  >
                    {child.emoji} {child.name}
                  </button>
                ))}
              </div>

              <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  data-testid="option-day-all"
                  onClick={() => setDayFilter('all')}
                  className={cx(
                    'shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ring-1 transition',
                    dayFilter === 'all'
                      ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                      : 'bg-white text-slate-500 ring-slate-200',
                  )}
                >
                  전체
                </button>
                {DAY_ORDER.map((day) => (
                  <button
                    key={day}
                    type="button"
                    data-testid={`option-day-${day}`}
                    onClick={() => setDayFilter(day)}
                    className={cx(
                      'shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ring-1 transition',
                      day === dayFilter
                        ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                        : 'bg-white text-slate-500 ring-slate-200',
                    )}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                ))}
              </div>

              <p className="mt-2 text-[10px] font-extrabold text-slate-500">
                {member?.name} · {viewMeta.label} · {dayFilter === 'all' ? '전체' : `${WEEKDAY_LABELS[dayFilter]}요일`}
                <span className="ml-1 font-bold text-slate-400">기본 {visibleItems.length}개</span>
                {fromHistory ? (
                  <span
                    data-testid="routine-from-db"
                    className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70"
                  >
                    기존 기록에서 불러옴
                  </span>
                ) : null}
              </p>

              {visibleItems.length === 0 ? (
                <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-center text-[10.5px] font-semibold text-slate-400">
                  이 {dayFilter === 'all' ? '프리셋' : '요일'}에는 정해 둔 기본 목록이 없어요.
                  <br />
                  아래에서 추가하면 그 요일에 자동으로 들어가요.
                </p>
              ) : (
                <ul data-testid="routine-list" className="mt-1.5 space-y-1">
                  {visibleItems.map((item) => {
                    const meta = subjectMeta(item.subject);
                    const order = items.findIndex((entry) => entry.id === item.id) + 1;
                    return (
                      <li
                        key={item.id}
                        data-testid={`routine-item-${item.id}`}
                        className="rounded-xl bg-slate-50 px-2 py-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 shrink-0 text-center text-[9px] font-extrabold tabular-nums text-slate-400">
                            {order}
                          </span>
                          <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold', meta.tile)}>
                            {meta.short}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-slate-700">
                            {item.title}
                            {item.needParent ? (
                              <span
                                data-testid={`routine-need-${item.id}`}
                                className="ml-1 rounded-full bg-amber-50 px-1 py-0.5 text-[8px] font-extrabold text-amber-700 ring-1 ring-amber-200/80"
                              >
                                부모 확인
                              </span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => moveItem(item, -1)}
                            aria-label={`${item.title} 위로`}
                            className="grid h-5 w-5 place-items-center rounded-full bg-white text-[9px] font-extrabold text-slate-400 ring-1 ring-slate-200 active:scale-90"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveItem(item, 1)}
                            aria-label={`${item.title} 아래로`}
                            className="grid h-5 w-5 place-items-center rounded-full bg-white text-[9px] font-extrabold text-slate-400 ring-1 ring-slate-200 active:scale-90"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            data-testid={`routine-edit-${item.id}`}
                            onClick={() => startEdit(item)}
                            aria-label={`${item.title} 수정`}
                            className="grid h-5 w-5 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200 transition active:scale-90"
                          >
                            <PencilIcon className="h-2.5 w-2.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`routine-delete-${item.id}`}
                            onClick={() => void saveItems(items.filter((entry) => entry.id !== item.id), '기본 목록에서 지웠어요')}
                            aria-label={`${item.title} 삭제`}
                            className="grid h-5 w-5 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90"
                          >
                            <TrashIcon className="h-2.5 w-2.5" />
                          </button>
                        </div>

                        <div className="mt-1 flex items-center gap-0.5 pl-5">
                          {DAY_ORDER.map((day) => {
                            const on = item.days.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                data-testid={`routine-day-${item.id}-${day}`}
                                onClick={() => toggleItemDay(item, day)}
                                aria-pressed={on}
                                aria-label={`${item.title} ${WEEKDAY_LABELS[day]}요일 ${on ? '끄기' : '켜기'}`}
                                className={cx(
                                  'h-5 w-5 rounded-md text-[9px] font-extrabold ring-1 transition active:scale-90',
                                  on
                                    ? 'bg-indigo-600 text-white ring-indigo-600'
                                    : 'bg-white text-slate-300 ring-slate-200',
                                )}
                              >
                                {WEEKDAY_LABELS[day]}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            data-testid={`routine-need-${item.id}-toggle`}
                            onClick={() => toggleNeedParent(item)}
                            aria-pressed={item.needParent === true}
                            className={cx(
                              'ml-auto rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold ring-1 transition active:scale-95',
                              item.needParent
                                ? 'bg-amber-100 text-amber-700 ring-amber-200'
                                : 'bg-white text-slate-400 ring-slate-200',
                            )}
                          >
                            부모 확인 {item.needParent ? '켬' : '끔'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-2 rounded-2xl bg-indigo-50/70 p-2 ring-1 ring-indigo-100">
                <div className="flex gap-1.5">
                  <input
                    data-testid="routine-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void addItem();
                    }}
                    placeholder="예: 수학 문제집 2장"
                    className="min-w-0 flex-1 rounded-xl border-0 bg-white px-2.5 py-2 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
                  />
                  <select
                    data-testid="routine-subject"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    className="shrink-0 rounded-xl bg-white px-1.5 py-2 text-[10.5px] font-extrabold text-slate-600 ring-1 ring-slate-200"
                  >
                    {SUBJECTS.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-1.5 flex items-center gap-1">
                  <span className="shrink-0 text-[9px] font-extrabold text-slate-500">요일</span>
                  {DAY_ORDER.map((day) => {
                    const on = draftDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        data-testid={`routine-draft-day-${day}`}
                        onClick={() =>
                          setDraftDays((prev) =>
                            prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day],
                          )
                        }
                        aria-pressed={on}
                        className={cx(
                          'h-6 w-6 rounded-lg text-[9.5px] font-extrabold ring-1 transition active:scale-90',
                          on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-300 ring-slate-200',
                        )}
                      >
                        {WEEKDAY_LABELS[day]}
                      </button>
                    );
                  })}
                  <label className="ml-auto flex shrink-0 items-center gap-1 text-[9px] font-extrabold text-amber-700">
                    <input
                      data-testid="routine-need-parent"
                      type="checkbox"
                      checked={needParent}
                      onChange={(event) => setNeedParent(event.target.checked)}
                      className="h-3.5 w-3.5 accent-amber-500"
                    />
                    부모 확인
                  </label>
                </div>

                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    data-testid="routine-add"
                    disabled={busy}
                    onClick={() => void addItem()}
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-indigo-600 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                    {editingId ? '수정 저장' : '목록에 추가'}
                  </button>
                  {editingId ? (
                    <button
                      type="button"
                      data-testid="routine-cancel"
                      onClick={resetDraft}
                      className="rounded-xl bg-white px-3 py-2 text-[11px] font-extrabold text-slate-500 ring-1 ring-slate-200"
                    >
                      취소
                    </button>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                data-testid="fill-defaults"
                disabled={filling}
                onClick={() => void fillToday()}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 py-2.5 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                📋 오늘({today.slice(5).replace('-', '/')})에 이 프리셋 넣기
                {filling ? ' …' : ''}
              </button>
            </section>
          </>
        ) : (
          <>
            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-extrabold text-slate-900">🔥 버스트 타임 (경험치 2배)</p>
                  <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                    켠 날부터 완료·검증하는 공부는 경험치가 2배로 들어가요. 지난 날짜 기록에는 소급하지 않아요.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="burst-toggle"
                  onClick={() => void toggleBurst()}
                  aria-pressed={study.appSettings.burst}
                  className={cx(
                    'relative h-7 w-12 shrink-0 rounded-full transition',
                    study.appSettings.burst ? 'bg-orange-500' : 'bg-slate-300',
                  )}
                >
                  <span
                    className={cx(
                      'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all',
                      study.appSettings.burst ? 'left-[22px]' : 'left-0.5',
                    )}
                  />
                  <span className="sr-only">{study.appSettings.burst ? '수동 버스트 타임 끄기' : '수동 버스트 타임 켜기'}</span>
                </button>
              </div>

              <p className="mt-1.5 text-[10px] font-extrabold text-slate-500">수동 설정</p>
              <p
                data-testid="burst-status"
                className={cx(
                  'mt-1 rounded-xl px-2.5 py-1.5 text-[10.5px] font-extrabold',
                  study.appSettings.burst ? 'bg-orange-50 text-orange-700' : 'bg-slate-50 text-slate-400',
                )}
              >
                {study.appSettings.burst
                  ? '🔥 수동으로 켜져 있어요 — 아이 화면 위쪽에 안내 배너가 떠요'
                  : '수동은 꺼져 있어요'}
              </p>

              <label className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 px-2 py-1.5">
                <input
                  data-testid="burst-auto"
                  type="checkbox"
                  checked={study.appSettings.burstAuto}
                  onChange={(event) =>
                    void save({
                      burstAuto: event.target.checked,
                      // 켠 날부터만 적용 — 지난 날짜 달력에 🔥 가 소급되지 않게.
                      burstAutoFrom: event.target.checked ? koreaTodayISO() : study.appSettings.burstAutoFrom,
                    })
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-extrabold text-slate-700">자동 설정 — 월말에 알아서 켜기</span>
                  <span className="mt-0.5 block text-[9.5px] font-semibold text-slate-500">
                    켠 날({study.appSettings.burstAutoFrom ?? today})부터, 월말까지 남은 일수가 아래 값보다 적으면 2배예요.
                  </span>
                </span>
                <input
                  data-testid="burst-auto-days"
                  type="number"
                  min={1}
                  max={28}
                  value={study.appSettings.burstAutoDays}
                  onChange={(event) => {
                    const value = Math.round(Number(event.target.value));
                    if (!Number.isFinite(value)) return;
                    void save({ burstAutoDays: Math.max(1, Math.min(28, value)) });
                  }}
                  className="w-14 shrink-0 rounded-lg bg-white px-1.5 py-1 text-right text-[11px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200"
                />
                <span className="shrink-0 self-center text-[9.5px] font-bold text-slate-400">일 전</span>
              </label>

              <label className="mt-1.5 flex items-start gap-2 rounded-xl bg-slate-50 px-2 py-1.5">
                <input
                  data-testid="burst-overlap"
                  type="checkbox"
                  checked={study.appSettings.burstOverlap}
                  onChange={(event) => void save({ burstOverlap: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-extrabold text-slate-700">수동·자동 중복 적용</span>
                  <span className="mt-0.5 block text-[9.5px] font-semibold text-slate-500">
                    {study.appSettings.burstOverlap
                      ? '둘 다 켜진 날은 4배로 들어가요.'
                      : '둘 다 켜져도 최대 2배까지만 들어가요.'}
                  </span>
                </span>
              </label>

              <p
                data-testid="burst-today"
                className={cx(
                  'mt-2 rounded-xl px-2.5 py-1.5 text-[10.5px] font-extrabold',
                  todayBurst ? 'bg-orange-50 text-orange-700' : 'bg-slate-50 text-slate-400',
                )}
              >
                {todayBurst
                  ? '🔥 오늘은 버스트 타임 — 지금 완료하면 경험치 2배예요'
                  : '오늘은 버스트 타임이 아니에요 (경험치 1배)'}
              </p>
            </section>

            {/* ⑪ 티어 난이도 */}
            <section
              data-testid="tier-difficulty"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12.5px] font-extrabold text-slate-900">🏆 티어 난이도</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                기본(0%) 기준으로 브론즈 0~199 · 실버 200~449 · 골드 450~799 · 플래티넘 800~1,199 ·
                다이아 1,200~1,599 · 마스터 1,600+ XP 예요. 버튼을 누르면 바로 바뀌고, 모아 둔 XP·지난 승급·
                선물 상자·결산 기록에는 소급하지 않아요.
              </p>
              <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto pb-0.5">
                {TIER_DIFFICULTY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`difficulty-${value}`}
                    onClick={() => void changeDifficulty(value)}
                    aria-pressed={value === settings.tierDifficulty}
                    className={cx(
                      'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold ring-1 transition active:scale-95',
                      value === settings.tierDifficulty
                        ? 'bg-indigo-600 text-white ring-indigo-600'
                        : 'bg-slate-50 text-slate-600 ring-slate-200',
                    )}
                  >
                    {value === 0 ? '기본(0%)' : `${value > 0 ? '+' : ''}${value}%`}
                  </button>
                ))}
              </div>
              <div data-testid="tier-table" className="mt-2 grid grid-cols-2 gap-1">
                {TIERS.map((tier) => {
                  const min = tierThreshold(tier.min, settings.tierDifficulty);
                  const max = tier.max === null ? null : tierThreshold(tier.max + 1, settings.tierDifficulty) - 1;
                  return (
                    <div key={tier.key} className="rounded-xl bg-slate-50 px-2 py-1 text-[9.5px] font-bold text-slate-600">
                      <span className="font-extrabold text-slate-800">
                        {tier.emoji} {tier.label}
                      </span>{' '}
                      <span className="tabular-nums text-slate-400">
                        {max === null ? `${min}+` : `${min}~${max}`}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[9px] font-semibold text-slate-400">
                지금 설정 {settings.tierDifficulty === 0 ? '기본(0%)' : `${settings.tierDifficulty > 0 ? '+' : ''}${settings.tierDifficulty}%`} ·
                마스터 {tierThreshold(1600, settings.tierDifficulty)}+ XP
              </p>
            </section>

            {/* ⑦ 🎁 선물 상자 보상 목록 (분·포인트) + 상자 개수 */}
            <section
              data-testid="box-rewards"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12.5px] font-extrabold text-slate-900">🎁 선물 상자 보상 목록</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                큰 티어로 올라가 선물 상자를 열 때 나오는 보상이에요. 이미 넣어 둔 보상은 그 자리에서 고치지
                않고(잠금), 지우고 새로 넣어 주세요. 포인트는 🛒 상점에서 씁니다.
              </p>

              <ul className="mt-2 space-y-1">
                {boxDraft.map((reward) => (
                  <li
                    key={reward.id}
                    data-testid={`box-reward-${reward.id}`}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5"
                  >
                    <span className="shrink-0 rounded-lg bg-white px-1.5 py-1 text-[10px] font-extrabold text-slate-500 ring-1 ring-slate-200">
                      {reward.kind === 'points' ? 'P' : '분'}
                    </span>
                    <span
                      data-testid={`box-reward-locked-${reward.id}`}
                      className="min-w-0 flex-1 text-right text-[11.5px] font-extrabold tabular-nums text-slate-700"
                    >
                      {reward.value}
                    </span>
                    <span className="shrink-0 text-[9.5px] font-bold text-slate-400">
                      {reward.kind === 'points' ? 'P' : '분'}
                    </span>
                    <span className="shrink-0 text-[8.5px] font-bold text-slate-300">🔒</span>
                    <button
                      type="button"
                      data-testid={`box-reward-delete-${reward.id}`}
                      disabled={boxDraft.length <= 1}
                      title={boxDraft.length <= 1 ? '보상은 하나 이상 남겨 두세요' : undefined}
                      onClick={() =>
                        void saveBoxRewards(
                          boxDraft.filter((item) => item.id !== reward.id),
                          '선물 상자 보상을 뺐어요',
                        )
                      }
                      aria-label={`${reward.value}${reward.kind === 'points' ? 'P' : '분'} 삭제`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90 disabled:opacity-30"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-1.5 flex gap-1.5 rounded-xl bg-violet-50/70 p-2 ring-1 ring-violet-100">
                <select
                  data-testid="box-reward-kind"
                  value={boxKind}
                  onChange={(event) => setBoxKind(event.target.value === 'points' ? 'points' : 'minutes')}
                  className="shrink-0 rounded-lg bg-white px-1.5 py-1 text-[10px] font-extrabold text-slate-600 ring-1 ring-slate-200"
                >
                  <option value="minutes">분</option>
                  <option value="points">P</option>
                </select>
                <input
                  data-testid="box-reward-value"
                  type="number"
                  min={1}
                  max={500}
                  value={boxValue}
                  onChange={(event) => setBoxValue(event.target.value)}
                  className="w-16 min-w-0 rounded-lg bg-white px-1.5 py-1 text-right text-[11px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200"
                />
                <button
                  type="button"
                  data-testid="box-reward-add"
                  disabled={busy}
                  onClick={() => void addBoxReward()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-violet-600 py-1.5 text-[10.5px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
                >
                  <PlusIcon className="h-3 w-3" strokeWidth={2.6} />
                  보상 추가
                </button>
              </div>

              <p className="mt-2.5 text-[10px] font-extrabold tracking-wide text-slate-400">선물 상자 개수</p>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((count) => (
                  <button
                    key={count}
                    type="button"
                    data-testid={`box-count-${count}`}
                    onClick={() => void setBoxCount(count)}
                    aria-pressed={count === settings.boxCount}
                    className={cx(
                      'flex-1 rounded-xl py-1.5 text-[10.5px] font-extrabold ring-1 transition active:scale-95',
                      count === settings.boxCount
                        ? 'bg-violet-600 text-white ring-violet-600'
                        : 'bg-slate-50 text-slate-500 ring-slate-200',
                    )}
                  >
                    {count}개
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[9px] font-semibold text-slate-400">
                상자를 열면 보상 목록에서 {settings.boxCount}개가 무작위로 채워져요(1~5개).
              </p>
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[12.5px] font-extrabold text-slate-900">⑤ 연속 달성 보너스 XP</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                일요일·공휴일처럼 원래 할 일이 없는 날은 끊기지 않고, 그 날 실제로 체크한 항목이 모두
                끝난 평일 일수를 셉니다. 그 날수를 채운 날에 아래 XP 가 한 번 더 붙고, 🐣 쪼꼬가 축하
                한마디를 남겨요.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {bonusDraft.map((bonus, index) => (
                  <label
                    key={bonus.day}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5 ring-1 ring-slate-100"
                  >
                    <span className="shrink-0 text-[10.5px] font-extrabold text-slate-600">{bonus.day}일</span>
                    <input
                      data-testid={`streak-input-${bonus.day}`}
                      type="number"
                      min={0}
                      max={10000}
                      step={10}
                      value={bonus.xp}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setBonusDraft((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, xp: Number.isFinite(value) ? Math.max(0, value) : 0 } : item,
                          ),
                        );
                      }}
                      className="min-w-0 flex-1 rounded-lg bg-white px-1.5 py-1 text-right text-[11px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200"
                    />
                    <span className="shrink-0 text-[9.5px] font-bold text-slate-400">XP</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                data-testid="streak-save"
                disabled={busy}
                onClick={() => void saveBonuses()}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
              >
                <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                보너스 XP 저장
              </button>

              <div className="mt-2 space-y-1">
                {study.children.map((child) => {
                  const streak = study.seasonStatsFor(child.id)?.streak ?? 0;
                  const reached = reachedStreakBonus(streak, study.appSettings.streakBonuses);
                  const next = nextStreakBonus(streak, study.appSettings.streakBonuses);
                  return (
                    <div
                      key={child.id}
                      data-testid={`streak-info-${child.id}`}
                      className="flex items-center justify-between gap-2 rounded-xl bg-orange-50/70 px-2 py-1.5 text-[10px] font-bold text-orange-700 ring-1 ring-orange-100"
                    >
                      <span>
                        {child.emoji} {child.name} · 🔥 {streak}일째
                      </span>
                      <span className="shrink-0 text-[9.5px]">
                        {next
                          ? `다음 ${next.day}일 +${formatXp(next.xp)} XP`
                          : reached
                            ? `최고 ${reached.day}일 달성`
                            : '아직 없음'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[10px] font-extrabold tracking-wide text-slate-400">저장 위치</p>
              <p
                data-testid="settings-sync-note"
                className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-500"
              >
                {study.settingsSync === 'cloud'
                  ? '가족 DB에 저장돼요 — 아빠·엄마 폰과 아이 폰이 같은 설정을 써요.'
                  : '지금은 이 폰에만 저장돼요. 가족 폰이 함께 쓰려면 Supabase에서 안내된 SQL을 한 번 실행해 주세요.'}
              </p>
            </section>
          </>
        )}

        <p className="px-1 pt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · 옵션은 부모 관리 PIN을 푼 뒤에만 열려요. 아이 화면에서는 열 수 없습니다.
          <br />· 기본 목록은 프리셋·아이별로 저장되고, 항목마다 적용 요일·순서를 정할 수 있어요.
          <br />· '부모 확인' 항목은 아이가 확인 요청만 하고, 부모님이 확인해야 완료·XP 로 들어가요.
        </p>
      </div>

      {/* ④ 프리셋 적용 확인 팝업 */}
      {presetConfirm ? (
        <div
          data-testid="preset-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="프리셋 적용 확인"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 px-6 backdrop-blur-sm"
        >
          <div className="w-full max-w-[300px] rounded-[26px] bg-white p-5 text-center shadow-2xl">
            <p className="text-[24px] leading-none" aria-hidden>
              {ROUTINE_PRESETS.find((preset) => preset.key === presetConfirm)?.emoji ?? '📚'}
            </p>
            <h2 className="mt-2 text-[15px] font-extrabold tracking-tight text-slate-900">
              {ROUTINE_PRESETS.find((preset) => preset.key === presetConfirm)?.label ?? ''} 프리셋을 적용할까요?
            </h2>
            <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-slate-500">
              아이별·요일별 기본 목록이 이 프리셋 것으로 바뀌어요.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="preset-cancel"
                onClick={() => setPresetConfirm(null)}
                className="flex-1 rounded-2xl bg-slate-100 py-2.5 text-[12px] font-extrabold text-slate-600 transition active:scale-[0.98]"
              >
                취소
              </button>
              <button
                type="button"
                data-testid="preset-apply"
                onClick={() => void applyPreset(presetConfirm)}
                className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-[12px] font-extrabold text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.98]"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
