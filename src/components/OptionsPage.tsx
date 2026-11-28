import { useEffect, useMemo, useState } from 'react';
import {
  ROUTINE_PRESETS,
  boxMinutePool,
  burstOnDate,
  nextStreakBonus,
  reachedStreakBonus,
  withRoutine,
  type AppSettings,
  type BoxReward,
  type RoutineKey,
} from '../lib/app-settings';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { addDays, fromISODate, koreaTodayISO, toISODate, WEEKDAY_LABELS } from '../lib/date';
import { defaultItemsForDay } from '../lib/defaults';
import { isXpHiddenTask } from '../lib/season';
import { formatXp } from '../lib/season';
import { useStudy } from '../lib/study-context';
import { SUBJECTS, subjectMeta } from '../lib/theme';
import type { Task, TaskPreset } from '../lib/types';
import { ArrowLeftIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';

/**
 * ⚙️ 옵션 — 부모 관리(PIN) 안에서만 열리는 페이지
 *
 * ① 📚 공부 목록: 아이별·요일별 기본 숙제 목록. 저장된 목록이 없으면 **지난 기록(DB)** 에서
 *    같은 요일의 최근 하루를 그대로 불러와 보여 줍니다(수정·삭제하면 그때 저장).
 *    프리셋(학기중·방학·시험기간)은 확인 팝업을 거쳐 바꿉니다.
 *    [기본 목록] · [어제 것 가져오기] 도구도 이 안으로 옮겼습니다(메인 화면 정리).
 * ② 🔥 이벤트·보너스: 버스트 타임(수동/자동·중복), 연속 달성 보너스 XP, 뽑기 상자 보상 목록(분·P).
 *
 * 여기서 정한 목록은 [기본 목록] 버튼이 그대로 씁니다.
 */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function dayLabel(weekday: number): string {
  return `${WEEKDAY_LABELS[weekday]}요일`;
}

/** 지난 기록에서 그 아이·그 요일의 가장 최근 하루 항목 (DB 불러오기) */
function itemsFromHistory(tasks: Task[], memberId: string, weekday: number): TaskPreset[] {
  const today = koreaTodayISO();
  const mine = tasks.filter(
    (task) =>
      task.member_id === memberId &&
      !isXpHiddenTask(task) &&
      task.due_date <= today &&
      fromISODate(task.due_date).getDay() === weekday,
  );
  if (mine.length === 0) return [];
  const latest = mine.map((task) => task.due_date).sort()[mine.length - 1];
  const seen = new Set<string>();
  const items: TaskPreset[] = [];
  for (const task of mine.filter((item) => item.due_date === latest)) {
    const key = `${task.title}::${task.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title: task.title, subject: task.subject });
  }
  return items;
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
  const [memberId, setMemberId] = useState<string>(study.children[0]?.id ?? '');
  const [weekday, setWeekday] = useState<number>(new Date().getDay());
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('etc');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [bonusDraft, setBonusDraft] = useState(settings.streakBonuses);
  /** ④ 프리셋 전환 확인 팝업 */
  const [presetConfirm, setPresetConfirm] = useState<RoutineKey | null>(null);
  /** ⑨ 기본 목록 도구가 다룰 날짜 */
  const [toolDate, setToolDate] = useState<string>(koreaTodayISO());
  const [filling, setFilling] = useState(false);
  /** ⑤ 뽑기 상자 보상 목록 편집본 */
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
  const presetKey: RoutineKey = settings.activePreset;
  const presetMeta = ROUTINE_PRESETS.find((preset) => preset.key === presetKey) ?? ROUTINE_PRESETS[0];

  const savedItems: TaskPreset[] = useMemo(
    () => (member ? settings.presets[presetKey]?.routines[member.id]?.[String(weekday)] ?? [] : []),
    [settings.presets, presetKey, member, weekday],
  );
  /** 저장된 목록이 없으면 지난 기록(DB)에서 불러와 보여 줍니다. */
  const historyItems: TaskPreset[] = useMemo(
    () => (member && savedItems.length === 0 ? itemsFromHistory(study.db.tasks, member.id, weekday) : []),
    [study.db.tasks, member, weekday, savedItems.length],
  );
  const items = savedItems.length > 0 ? savedItems : historyItems;
  const fromHistory = savedItems.length === 0 && historyItems.length > 0;

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

  const saveItems = async (nextItems: TaskPreset[], message: string) => {
    if (!member) return;
    const next = withRoutine(study.appSettings, member.id, weekday, nextItems);
    if (await save({ presets: next.presets })) onNotify(message);
  };

  const addItem = async () => {
    const text = title.trim();
    if (!text) {
      onNotify('무엇을 공부하는지 적어 주세요');
      return;
    }
    if (editingIndex !== null) {
      const next = items.map((item, index) =>
        index === editingIndex ? { title: text, subject } : item,
      );
      setEditingIndex(null);
      setTitle('');
      await saveItems(next, '기본 목록을 고쳤어요');
      return;
    }
    await saveItems([...items, { title: text, subject }], '기본 목록에 추가했어요');
    setTitle('');
  };

  const startEdit = (index: number) => {
    const item = items[index];
    if (!item) return;
    setEditingIndex(index);
    setTitle(item.title);
    setSubject(item.subject);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setTitle('');
    setSubject('etc');
  };

  /** ④ 프리셋 확인 팝업에서 [적용] 을 눌렀을 때 */
  const applyPreset = async (key: RoutineKey) => {
    setPresetConfirm(null);
    const meta = ROUTINE_PRESETS.find((preset) => preset.key === key);
    if (await save({ activePreset: key })) {
      onNotify(`${meta?.label ?? key} 프리셋으로 바꿨어요 · 기본 목록에 바로 적용돼요`);
    }
  };

  /* ---------------- ⑨ 기본 목록 도구 (옵션 안으로 이동) ---------------- */

  const fillDefaults = async () => {
    if (filling) return;
    if (fromISODate(toolDate).getDay() === 0) {
      onNotify('쉬는 날(일요일)에는 기본 목록을 넣지 않아요');
      return;
    }
    setFilling(true);
    let added = 0;
    let failed = 0;
    let firstError: string | undefined;
    try {
      for (const child of study.children) {
        const routines = settings.presets[settings.activePreset]?.routines[child.id] ?? {};
        for (const item of defaultItemsForDay(study.db.tasks, child, toolDate, routines)) {
          const result = await study.addTask({
            member_id: child.id,
            title: item.title,
            subject: item.subject,
            due_date: toolDate,
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
      onNotify(failed > 0 ? `기본 목록 ${added}개를 넣었어요 · ${failed}개는 못 넣었어요` : `기본 목록 ${added}개를 넣었어요`);
      return;
    }
    onNotify(failed > 0 ? firstError ?? '기본 목록을 넣지 못했어요' : '기본 목록이 이미 다 들어 있어요');
  };

  const copyYesterday = async () => {
    const yesterday = toISODate(addDays(fromISODate(toolDate), -1));
    const sources = study.children.flatMap((child) =>
      study
        .tasksFor(child.id, yesterday)
        .filter((task) => !isXpHiddenTask(task)),
    );
    if (sources.length === 0) {
      onNotify('어제는 복사할 공부가 없었어요');
      return;
    }
    const result = await study.copyTasks(
      sources.map((task) => task.id),
      [toolDate],
    );
    if (!result.ok) {
      onNotify(result.error ?? '복사하지 못했어요');
      return;
    }
    const parts = [`어제 공부 ${result.created}개를 ${toolDate.slice(5).replace('-', '/')}로 가져왔어요`];
    if (result.skipped > 0) parts.push(`이미 있어서 ${result.skipped}개는 건너뛰었어요`);
    onNotify(parts.join(' · '));
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
    await saveBoxRewards(next, `뽑기 보상에 ${value}${boxKind === 'points' ? 'P' : '분'}을 추가했어요`);
    setBoxValue('10');
  };

  const updateBoxReward = (id: string, patch: Partial<BoxReward>) => {
    setBoxDraft((prev) => prev.map((reward) => (reward.id === id ? { ...reward, ...patch } : reward)));
  };

  const saveBonuses = async () => {
    if (await save({ streakBonuses: bonusDraft })) onNotify('연속 달성 보너스를 저장했어요');
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
              <p className="text-[10px] font-extrabold tracking-wide text-slate-400">프리셋 (원터치 전환)</p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {ROUTINE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    data-testid={`preset-${preset.key}`}
                    onClick={() => {
                      if (preset.key === presetKey) return;
                      setPresetConfirm(preset.key);
                    }}
                    aria-pressed={preset.key === presetKey}
                    className={cx(
                      'flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[10.5px] font-extrabold ring-1 transition active:scale-95',
                      preset.key === presetKey
                        ? 'bg-indigo-600 text-white ring-indigo-600 shadow-lg shadow-indigo-500/25'
                        : 'bg-slate-50 text-slate-600 ring-slate-200',
                    )}
                  >
                    <span className="text-[15px] leading-none" aria-hidden>
                      {preset.emoji}
                    </span>
                    {preset.label}
                    {preset.key === presetKey ? <span className="text-[8px] font-bold">사용 중</span> : null}
                  </button>
                ))}
              </div>
              <p data-testid="active-preset" className="mt-2 text-[9.5px] font-bold leading-relaxed text-slate-400">
                지금 <b className="font-extrabold text-indigo-600">{presetMeta.label}</b> 목록을 고치고 있어요.
                프리셋을 바꾸면 아이별·요일별 기본 일정이 한 번에 바뀌고, [기본 목록]에 바로 쓰여요.
              </p>
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <div className="flex gap-1.5">
                {study.children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    data-testid={`option-child-${child.id}`}
                    onClick={() => setMemberId(child.id)}
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
                {DAY_ORDER.map((day) => (
                  <button
                    key={day}
                    type="button"
                    data-testid={`option-day-${day}`}
                    onClick={() => {
                      setWeekday(day);
                      cancelEdit();
                    }}
                    className={cx(
                      'shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ring-1 transition',
                      day === weekday
                        ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                        : 'bg-white text-slate-500 ring-slate-200',
                    )}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                ))}
              </div>

              <p className="mt-2 text-[10px] font-extrabold text-slate-500">
                {member?.name} · {dayLabel(weekday)}
                <span className="ml-1 font-bold text-slate-400">기본 {items.length}개</span>
                {fromHistory ? (
                  <span
                    data-testid="routine-from-db"
                    className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70"
                  >
                    기존 기록에서 불러옴
                  </span>
                ) : null}
              </p>

              {items.length === 0 ? (
                <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-center text-[10.5px] font-semibold text-slate-400">
                  이 요일에는 정해 둔 기본 목록이 없어요.
                  <br />
                  아래에서 추가하면 [기본 목록] 버튼이 이걸 넣어 줘요.
                </p>
              ) : (
                <ul data-testid="routine-list" className="mt-1.5 space-y-1">
                  {items.map((item, index) => {
                    const meta = subjectMeta(item.subject);
                    return (
                      <li
                        key={`${item.title}-${index}`}
                        data-testid={`routine-item-${index}`}
                        className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5"
                      >
                        <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold', meta.tile)}>
                          {meta.short}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-slate-700">{item.title}</span>
                        <button
                          type="button"
                          data-testid={`routine-edit-${index}`}
                          onClick={() => startEdit(index)}
                          aria-label={`${item.title} 수정`}
                          className="grid h-6 w-6 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200 transition active:scale-90"
                        >
                          <PencilIcon className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          data-testid={`routine-delete-${index}`}
                          onClick={() => void saveItems(items.filter((_, i) => i !== index), '기본 목록에서 지웠어요')}
                          aria-label={`${item.title} 삭제`}
                          className="grid h-6 w-6 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90"
                        >
                          <TrashIcon className="h-3 w-3" />
                        </button>
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
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    data-testid="routine-add"
                    disabled={busy}
                    onClick={() => void addItem()}
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-indigo-600 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                    {editingIndex !== null ? '수정 저장' : '목록에 추가'}
                  </button>
                  {editingIndex !== null ? (
                    <button
                      type="button"
                      data-testid="routine-cancel"
                      onClick={cancelEdit}
                      className="rounded-xl bg-white px-3 py-2 text-[11px] font-extrabold text-slate-500 ring-1 ring-slate-200"
                    >
                      취소
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {/* ⑨ 기본 목록 도구 — 메인 화면에서 이리로 옮겼어요 */}
            <section
              data-testid="default-tools"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12px] font-extrabold text-slate-900">📋 기본 목록 도구</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                고른 날짜에 아이들 기본 목록을 한 번에 넣거나, 어제 공부를 그대로 가져옵니다.
              </p>
              <label className="mt-2 flex items-center gap-1.5">
                <span className="shrink-0 text-[10px] font-extrabold text-slate-500">날짜</span>
                <input
                  data-testid="default-date"
                  type="date"
                  value={toolDate}
                  onChange={(event) => setToolDate(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2 py-2 text-[11.5px] font-extrabold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-indigo-300"
                />
              </label>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  data-testid="fill-defaults"
                  disabled={filling}
                  onClick={() => void fillDefaults()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-indigo-50 py-2.5 text-[11px] font-extrabold text-indigo-700 ring-1 ring-indigo-200 transition active:scale-[0.98] disabled:opacity-60"
                >
                  <span aria-hidden>📋</span>
                  {filling ? '넣는 중…' : '기본 목록 넣기'}
                </button>
                <button
                  type="button"
                  data-testid="copy-yesterday"
                  onClick={() => void copyYesterday()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-slate-50 py-2.5 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-200 transition active:scale-[0.98]"
                >
                  <span aria-hidden>↩️</span>
                  어제 것 가져오기
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-extrabold text-slate-900">🔥 버스트 타임 (경험치 2배)</p>
                  <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                    켜져 있는 동안 완료·검증하는 공부는 경험치가 2배로 들어가요. 끈 뒤에도 그때 받은 2배는
                    그대로 남습니다.
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
                  onChange={(event) => void save({ burstAuto: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-extrabold text-slate-700">자동 설정 — 월말에 알아서 켜기</span>
                  <span className="mt-0.5 block text-[9.5px] font-semibold text-slate-500">
                    월말까지 남은 일수가 아래 값보다 적으면 그날부터 2배가 됩니다.
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

            {/* ⑤ 뽑기 상자 보상 목록 (분·포인트) */}
            <section
              data-testid="box-rewards"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12.5px] font-extrabold text-slate-900">🎁 시간 상자 보상 목록</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                큰 티어로 올라가 상자를 열 때 나오는 보상이에요. 게임 시간(분) 또는 화폐 포인트(P)로
                간단히 넣고 뺄 수 있어요. 포인트는 아래 🛒 상점에서 씁니다.
              </p>

              <ul className="mt-2 space-y-1">
                {boxDraft.map((reward) => (
                  <li
                    key={reward.id}
                    data-testid={`box-reward-${reward.id}`}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5"
                  >
                    <select
                      value={reward.kind}
                      onChange={(event) => {
                        const next = event.target.value === 'points' ? 'points' : 'minutes';
                        updateBoxReward(reward.id, { kind: next });
                        void saveBoxRewards(
                          boxDraft.map((item) => (item.id === reward.id ? { ...item, kind: next } : item)),
                          '상자 보상을 바꿨어요',
                        );
                      }}
                      className="shrink-0 rounded-lg bg-white px-1.5 py-1 text-[10px] font-extrabold text-slate-600 ring-1 ring-slate-200"
                    >
                      <option value="minutes">분</option>
                      <option value="points">P</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={reward.value}
                      onChange={(event) => updateBoxReward(reward.id, { value: Number(event.target.value) })}
                      onBlur={() => void saveBoxRewards(boxDraft, '상자 보상을 저장했어요')}
                      className="min-w-0 flex-1 rounded-lg bg-white px-1.5 py-1 text-right text-[11px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200"
                    />
                    <span className="shrink-0 text-[9.5px] font-bold text-slate-400">
                      {reward.kind === 'points' ? 'P' : '분'}
                    </span>
                    <button
                      type="button"
                      data-testid={`box-reward-delete-${reward.id}`}
                      disabled={boxDraft.length <= 1}
                      title={boxDraft.length <= 1 ? '보상은 하나 이상 남겨 두세요' : undefined}
                      onClick={() =>
                        void saveBoxRewards(
                          boxDraft.filter((item) => item.id !== reward.id),
                          '상자 보상을 뺐어요',
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
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[12.5px] font-extrabold text-slate-900">⑤ 연속 달성 보너스 XP</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                일요일·공휴일처럼 원래 할 일이 없는 날은 끊기지 않고, 하루 할 일을 모두 채운 평일
                일수를 셉니다. 그 날수를 채운 날에 아래 XP 가 한 번 더 붙고, 🐣 쪼꼬가 축하 한마디를
                남겨요.
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
          <br />· 기본 목록은 아이별·요일별로 저장되고, 저장한 것이 없으면 지난 기록에서 그대로 불러옵니다.
        </p>
      </div>

      {/* ④ 프리셋 전환 확인 팝업 */}
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
