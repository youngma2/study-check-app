import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BURST_PERCENT_OPTIONS,
  TIER_DIFFICULTY_OPTIONS,
  addCustomPreset,
  boxMinutePool,
  burstFactorLabel,
  burstOnDate,
  copyRoutineItemToPreset,
  itemsForDay,
  itemsForMember,
  mergeRoutineItems,
  nextStreakBonus,
  presetMetas,
  reachedStreakBonus,
  removeCustomPreset,
  renameCustomPreset,
  saveLocalAppSettings,
  withRoutineItems,
  type AppSettings,
  type BoxReward,
  type RoutineItem,
  type RoutineKey,
} from '../lib/app-settings';
import { backupFileName, buildBackup, downloadJson, parseBackup, type BackupFile } from '../lib/backup';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { fromISODate, koreaISODateOf, koreaTodayISO, WEEKDAY_LABELS } from '../lib/date';
import { defaultItemsForDay } from '../lib/defaults';
import { computePastSeason, formatXp, isXpHiddenTask, recentSeasons, TIERS, tierThreshold } from '../lib/season';
import { saveLocalNotes } from '../lib/notes';
import { generateRecoveryCode } from '../lib/pin';
import { saveLocalTierEvents } from '../lib/rewards';
import { saveLocalDB } from '../lib/store';
import { useStudy } from '../lib/study-context';
import { SUBJECTS, subjectMeta } from '../lib/theme';
import type { Task } from '../lib/types';
import { ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon } from './icons';

/**
 * ⚙️ 옵션 — 부모 관리(PIN) 안에서만 열리는 페이지
 *
 * ④ 📚 공부 목록: 프리셋(학기중·방학·시험기간)마다 아이별 기본 항목 목록을 따로 보고 고칩니다.
 *    · 학기중만 지난 기록(DB)으로 기본이 채워지고, 방학·시험기간은 비어 있어 직접 채웁니다.
 * ⑤ 항목마다 적용 요일(월~일) 체크박스·순서(↑↓)·'부모 확인 필요'를 정합니다.
 * ⑥ 예전 [📋 기본 목록 도구] 는 없앴습니다.
 * ⑦ 🎁 뽑기 상자: 보상 목록(수정 잠금·삭제 후 다시 추가) + 상자 개수(1~5).
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

  const [tab, setTab] = useState<'routines' | 'events' | 'system'>('routines');
  /** ④ 지금 '보고 고치는' 프리셋 — 실제 적용(activePreset)은 [이 프리셋 적용] 으로 따로 합니다. */
  const [presetView, setPresetView] = useState<RoutineKey>(settings.activePreset);
  const [memberId, setMemberId] = useState<string>(study.children[0]?.id ?? '');
  const [dayFilter, setDayFilter] = useState<number | 'all'>(new Date().getDay());
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('etc');
  const [needParent, setNeedParent] = useState(false);
  const [draftDays, setDraftDays] = useState<number[]>(DAY_ORDER);
  /** 6번 — 목록 각 줄에서 바로 고치는 중인 항목 */
  const [inlineEdit, setInlineEdit] = useState<{ id: string; title: string } | null>(null);
  /** 8번 — '다른 프리셋에 넣기' 선택기를 연 항목 */
  const [copyMenuFor, setCopyMenuFor] = useState<string | null>(null);
  /** 7번 — + 프리셋 추가 입력 */
  const [newPresetOpen, setNewPresetOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  /** 지금 보고 있는(부모가 만든) 프리셋 이름 고치기 */
  const [presetNameDraft, setPresetNameDraft] = useState('');
  /** 저장되었습니다 팝업 */
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bonusDraft, setBonusDraft] = useState(settings.streakBonuses);
  const [presetConfirm, setPresetConfirm] = useState<RoutineKey | null>(null);
  const [filling, setFilling] = useState(false);
  /** ⑦ 뽑기(선물) 상자 보상 목록 편집본 */
  const [boxDraft, setBoxDraft] = useState<BoxReward[]>(settings.boxRewards);
  const [boxKind, setBoxKind] = useState<'minutes' | 'points'>('minutes');
  const [boxValue, setBoxValue] = useState('10');
  /** 4차 1번 — 비상 복구 질문·답·6자리 코드 */
  const [recoveryQuestion, setRecoveryQuestion] = useState(
    study.appSettings.parentRecovery?.question ?? '어릴 적 별명은?',
  );
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [recoveryCode, setRecoveryCode] = useState(() => generateRecoveryCode());
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState<string | null>(null);
  /** 4차 1번 — 부모 PIN 바꾸기 */
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  /** 4차 7번 — 백업·복원 */
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    setBonusDraft(study.appSettings.streakBonuses);
  }, [study.appSettings.streakBonuses]);

  useEffect(() => {
    setBoxDraft(study.appSettings.boxRewards);
  }, [study.appSettings.boxRewards]);

  const member = study.children.find((item) => item.id === memberId) ?? study.children[0];
  const presetList = useMemo(() => presetMetas(settings), [settings]);
  const activeMeta = presetList.find((preset) => preset.key === settings.activePreset) ?? presetList[0];
  const viewMeta = presetList.find((preset) => preset.key === presetView) ?? presetList[0];

  // 보는 프리셋이 사라졌으면(다른 폰에서 지웠으면) 지금 쓰는 프리셋으로 돌아갑니다.
  useEffect(() => {
    if (!presetList.some((preset) => preset.key === presetView)) setPresetView(settings.activePreset);
    setPresetNameDraft(viewMeta?.label ?? '');
  }, [presetList, presetView, settings.activePreset, viewMeta?.label]);

  /** "저장되었습니다" 팝업 — 앞의 타이머가 뒤의 팝업을 지우지 않게 하나만 돕니다. */
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);
  const showSaved = (message = '저장되었습니다') => {
    setFlash(message);
    onNotify(message);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, 1600);
  };

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
    setTitle('');
    setSubject('etc');
    setNeedParent(false);
    setDraftDays(dayFilter === 'all' ? DAY_ORDER : [dayFilter]);
  };

  useEffect(() => {
    setDraftDays(dayFilter === 'all' ? DAY_ORDER : [dayFilter]);
  }, [dayFilter]);

  /** 맨 아래 영역은 **추가 전용** — 새 항목만 바로 등록합니다. */
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
    const item: RoutineItem = {
      id: `ri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      title: text,
      subject,
      days: [...draftDays].sort((a, b) => a - b),
      order: items.length,
      ...(needParent ? { needParent: true } : {}),
    };
    const next = withRoutineItems(study.appSettings, member?.id ?? '', [...items, item], presetView);
    if (await save({ presets: next.presets })) {
      resetDraft();
      showSaved('저장되었습니다');
    }
  };

  /** 6번 — 줄에서 바로 제목을 고치고 오른쪽 [확인] 을 누르면 즉시 저장 */
  const saveInlineTitle = async (item: RoutineItem) => {
    const text = (inlineEdit?.id === item.id ? inlineEdit.title : '').trim();
    if (!text) {
      onNotify('제목을 적어 주세요');
      return;
    }
    const next = items.map((entry) => (entry.id === item.id ? { ...entry, title: text } : entry));
    const result = withRoutineItems(study.appSettings, member?.id ?? '', next, presetView);
    if (await save({ presets: result.presets })) {
      setInlineEdit(null);
      showSaved('저장되었습니다');
    }
  };

  /** 8번 — 과목을 드롭다운으로 바로 고치면 즉시 저장 */
  const changeItemSubject = async (item: RoutineItem, nextSubject: string) => {
    if (nextSubject === item.subject) return;
    const next = items.map((entry) => (entry.id === item.id ? { ...entry, subject: nextSubject } : entry));
    const result = withRoutineItems(study.appSettings, member?.id ?? '', next, presetView);
    if (await save({ presets: result.presets })) showSaved('저장되었습니다');
  };

  /** 8번 — 이 항목을 다른 프리셋에 바로 넣기(복사) */
  const copyItemTo = async (item: RoutineItem, targetKey: string) => {
    setCopyMenuFor(null);
    const next = copyRoutineItemToPreset(study.appSettings, item, member?.id ?? '', targetKey);
    const label = presetList.find((preset) => preset.key === targetKey)?.label ?? targetKey;
    if (await save({ presets: next.presets })) showSaved(`'${item.title}' 을(를) ${label} 프리셋에 넣었습니다`);
  };

  /** 7번 — + 프리셋 추가 */
  const addPreset = async () => {
    const name = newPresetName.trim();
    if (!name) {
      onNotify('프리셋 이름을 적어 주세요');
      return;
    }
    const created = addCustomPreset(study.appSettings, name);
    if (await save({ presets: created.settings.presets })) {
      setPresetView(created.key);
      setNewPresetName('');
      setNewPresetOpen(false);
      showSaved(`'${name}' 프리셋을 만들었습니다`);
    }
  };

  /** 7번 — 부모가 만든 프리셋 이름 바꾸기 */
  const renamePresetNow = async () => {
    const name = presetNameDraft.trim();
    if (!name) {
      onNotify('프리셋 이름을 적어 주세요');
      return;
    }
    const next = renameCustomPreset(study.appSettings, presetView, name);
    if (await save({ presets: next.presets })) showSaved('저장되었습니다');
  };

  /** 7번 — 부모가 만든 프리셋 지우기 */
  const deletePresetNow = async () => {
    if (!window.confirm(`'${viewMeta.label}' 프리셋을 지울까요? 안에 넣어 둔 목록도 함께 사라져요.`)) return;
    const next = removeCustomPreset(study.appSettings, presetView);
    if (await save({ presets: next.presets, activePreset: next.activePreset })) {
      setPresetView(next.activePreset);
      showSaved('프리셋을 지웠습니다');
    }
  };

  /** 6번 — 맨 아래 [이 프리셋 저장] : 지금 보이는 목록을 그대로 저장합니다. */
  const saveCurrentPreset = async () => {
    if (!member) return;
    const next = withRoutineItems(study.appSettings, member.id, items, presetView);
    if (await save({ presets: next.presets })) showSaved('저장되었습니다');
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
    const meta = presetList.find((preset) => preset.key === key);
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
          ? `🔥 버스트 타임(수동) 시작! 지금부터 완료하는 경험치는 ${burstFactorLabel(settings.burstPercent)}예요`
          : '수동 버스트 타임을 껐어요 · 그동안 받은 배수 경험치는 그대로 남아요',
      );
    }
  };

  const setBoxCount = async (count: number) => {
    if (await save({ boxCount: count })) onNotify(`뽑기 상자를 ${count}개 보여 줄게요`);
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
    await saveBoxRewards(next, `뽑기 상자 보상에 ${value}${boxKind === 'points' ? 'P' : '분'}을 추가했어요`);
    setBoxValue('10');
  };

  const saveBonuses = async () => {
    // 입력한 일수·XP 를 그대로 보내고, 저장된 뒤의 값으로 확인합니다.
    const draft = bonusDraft.map((bonus) => ({ day: bonus.day, xp: Math.max(0, Math.round(bonus.xp)) }));
    if (await save({ streakBonuses: draft })) showSaved('저장되었습니다');
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


  /* ---------------- 🔐 부모 PIN · 비상 복구 (4차 1번) ---------------- */

  const saveRecovery = async () => {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    setRecoverySaved(null);
    const result = await study.saveParentRecovery({
      question: recoveryQuestion,
      answer: recoveryAnswer,
      code: recoveryCode,
    });
    setRecoveryBusy(false);
    if (!result.ok) {
      setRecoveryError(result.error ?? '저장하지 못했어요');
      return;
    }
    setRecoverySaved(
      result.localOnly
        ? `이 폰에만 저장했어요 · 복구 코드 6자리는 ${recoveryCode} 예요`
        : `저장했어요 · 복구 코드 6자리는 ${recoveryCode} 예요 (따로 적어 두세요)`,
    );
    setRecoveryAnswer('');
    onNotify('비상 복구 질문·코드를 저장했어요');
  };

  const changePin = async () => {
    if (pinBusy) return;
    setPinBusy(true);
    setPinError(null);
    const result = await study.changeParentPin(pinCurrent, pinNew);
    setPinBusy(false);
    if (!result.ok) {
      setPinError(result.error ?? 'PIN을 바꾸지 못했어요');
      return;
    }
    setPinCurrent('');
    setPinNew('');
    onNotify('부모 관리 PIN을 바꿨어요');
  };

  /* ---------------- 💾 데이터 백업·복원 (4차 7번) ---------------- */

  const makeBackup = () => {
    const data = buildBackup({
      db: study.db,
      appSettings: study.appSettings,
      rewardSettings: study.rewardSettings,
      notes: study.notes,
      tierEvents: study.tierEvents,
    });
    downloadJson(backupFileName(), data);
    setBackupNote(
      `백업 파일을 내려받았어요 · 공부 ${study.db.tasks.length}개 · 한마디 ${study.notes.length}개 · 설정 포함`,
    );
  };

  const pickBackup = async (file: File) => {
    setRestoreError(null);
    setBackupNote(null);
    const text = await file.text();
    const parsed = parseBackup(text);
    if (!parsed) {
      setRestoreError('이 파일은 공부 체크 백업 파일이 아니에요 (.json 확인)');
      return;
    }
    setRestoreTarget(parsed);
  };

  const applyRestore = async () => {
    if (!restoreTarget || restoreBusy) return;
    setRestoreBusy(true);
    setRestoreError(null);
    if (study.storageKind === 'local') {
      if (restoreTarget.db) saveLocalDB(restoreTarget.db);
      if (restoreTarget.appSettings) saveLocalAppSettings(restoreTarget.appSettings);
      if (restoreTarget.notes) saveLocalNotes(restoreTarget.notes);
      if (restoreTarget.tierEvents) saveLocalTierEvents(restoreTarget.tierEvents);
      setRestoreBusy(false);
      setRestoreTarget(null);
      onNotify('백업 파일로 되돌렸어요 · 화면을 새로 고칩니다');
      window.setTimeout(() => window.location.reload(), 800);
      return;
    }
    const result = await study.saveAppSettings(restoreTarget.appSettings ?? {});
    setRestoreBusy(false);
    if (!result.ok) {
      setRestoreError(result.error ?? '복원하지 못했어요');
      return;
    }
    setRestoreTarget(null);
    onNotify('옵션(설정)을 백업 파일로 되돌렸어요 · 공부 기록은 가족 DB가 원본이라 그대로예요');
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
            <button
              type="button"
              data-testid="option-tab-system"
              onClick={() => setTab('system')}
              className={cx(
                'flex-1 rounded-full px-2.5 py-1.5 text-[10.5px] font-extrabold transition',
                tab === 'system' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              🔐 설정·백업
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
                {presetList.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    data-testid={`preset-${preset.key}`}
                    onClick={() => {
                      setPresetView(preset.key);
                      setCopyMenuFor(null);
                      setInlineEdit(null);
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

              {/* 7번 — + 프리셋 추가 (기본 3개 외에 이름을 정해 원하는 만큼) */}
              {newPresetOpen ? (
                <div className="mt-1.5 flex gap-1">
                  <input
                    data-testid="preset-new-name"
                    value={newPresetName}
                    maxLength={20}
                    autoFocus
                    onChange={(event) => setNewPresetName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void addPreset();
                      if (event.key === 'Escape') setNewPresetOpen(false);
                    }}
                    placeholder="새 프리셋 이름 (예: 주말, 시험 2주 전)"
                    className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
                  />
                  <button
                    type="button"
                    data-testid="preset-new-save"
                    disabled={busy}
                    onClick={() => void addPreset()}
                    className="shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-[10.5px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    data-testid="preset-new-cancel"
                    onClick={() => setNewPresetOpen(false)}
                    className="shrink-0 rounded-xl bg-white px-2.5 py-2 text-[10.5px] font-extrabold text-slate-500 ring-1 ring-slate-200"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="preset-new"
                  onClick={() => {
                    setNewPresetName('');
                    setNewPresetOpen(true);
                  }}
                  className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 py-1.5 text-[10.5px] font-extrabold text-indigo-600 transition active:scale-[0.99]"
                >
                  <PlusIcon className="h-3 w-3" strokeWidth={2.6} />
                  프리셋 추가
                </button>
              )}

              {/* 7번 — 부모가 만든 프리셋은 이름 바꾸기·지우기가 됩니다. */}
              {viewMeta.custom ? (
                <div data-testid="preset-manage" className="mt-1.5 flex gap-1">
                  <input
                    data-testid="preset-rename"
                    value={presetNameDraft}
                    maxLength={20}
                    onChange={(event) => setPresetNameDraft(event.target.value)}
                    className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2.5 py-1.5 text-[10.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 focus:ring-indigo-300"
                  />
                  <button
                    type="button"
                    data-testid="preset-rename-save"
                    onClick={() => void renamePresetNow()}
                    className="shrink-0 rounded-xl bg-slate-900 px-2.5 py-1.5 text-[10px] font-extrabold text-white transition active:scale-95"
                  >
                    이름 저장
                  </button>
                  <button
                    type="button"
                    data-testid="preset-delete"
                    onClick={() => void deletePresetNow()}
                    className="shrink-0 rounded-xl bg-rose-50 px-2.5 py-1.5 text-[10px] font-extrabold text-rose-500 ring-1 ring-rose-100 transition active:scale-95"
                  >
                    삭제
                  </button>
                </div>
              ) : null}

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
                학기중은 지난 기록으로 기본이 채워져 있고, 나머지(방학·시험기간·내가 만든 것)는 비어 있어요 — 직접 채워 주세요.
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
                          {inlineEdit?.id === item.id ? (
                            /* 6번 — 줄에서 바로 고치고 오른쪽 [확인] 으로 즉시 저장 */
                            <>
                              <input
                                data-testid={`routine-inline-${item.id}`}
                                value={inlineEdit.title}
                                autoFocus
                                maxLength={60}
                                onChange={(event) =>
                                  setInlineEdit((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') void saveInlineTitle(item);
                                  if (event.key === 'Escape') setInlineEdit(null);
                                }}
                                className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-indigo-300"
                              />
                              <button
                                type="button"
                                data-testid={`routine-inline-save-${item.id}`}
                                onClick={() => void saveInlineTitle(item)}
                                className="shrink-0 rounded-full bg-emerald-600 px-2 py-1 text-[9px] font-extrabold text-white transition active:scale-95"
                              >
                                확인
                              </button>
                              <button
                                type="button"
                                data-testid={`routine-inline-cancel-${item.id}`}
                                onClick={() => setInlineEdit(null)}
                                aria-label="수정 취소"
                                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200 active:scale-90"
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                data-testid={`routine-title-${item.id}`}
                                onClick={() => setInlineEdit({ id: item.id, title: item.title })}
                                title="눌러서 바로 고치기"
                                className="min-w-0 flex-1 truncate rounded-lg py-0.5 text-left text-[11.5px] font-bold text-slate-700 transition active:scale-[0.99]"
                              >
                                {item.title}
                                {item.needParent ? (
                                  <span
                                    data-testid={`routine-need-${item.id}`}
                                    className="ml-1 rounded-full bg-amber-50 px-1 py-0.5 text-[8px] font-extrabold text-amber-700 ring-1 ring-amber-200/80"
                                  >
                                    부모 확인
                                  </span>
                                ) : null}
                              </button>
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
                                data-testid={`routine-delete-${item.id}`}
                                onClick={() => void saveItems(items.filter((entry) => entry.id !== item.id), '기본 목록에서 지웠어요')}
                                aria-label={`${item.title} 삭제`}
                                className="grid h-5 w-5 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90"
                              >
                                <TrashIcon className="h-2.5 w-2.5" />
                              </button>
                            </>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-0.5 pl-5">
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

                          {/* 8번 — 과목을 드롭다운으로 바로 고치기 */}
                          <select
                            data-testid={`routine-subject-${item.id}`}
                            value={item.subject}
                            onChange={(event) => void changeItemSubject(item, event.target.value)}
                            aria-label={`${item.title} 과목`}
                            className="ml-0.5 rounded-md bg-white px-1 py-0.5 text-[8.5px] font-extrabold text-slate-500 ring-1 ring-slate-200"
                          >
                            {SUBJECTS.map((entry) => (
                              <option key={entry.key} value={entry.key}>
                                {entry.label}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            data-testid={`routine-need-${item.id}-toggle`}
                            onClick={() => toggleNeedParent(item)}
                            aria-pressed={item.needParent === true}
                            className={cx(
                              'rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold ring-1 transition active:scale-95',
                              item.needParent
                                ? 'bg-amber-100 text-amber-700 ring-amber-200'
                                : 'bg-white text-slate-400 ring-slate-200',
                            )}
                          >
                            부모 확인 {item.needParent ? '켬' : '끔'}
                          </button>

                          {/* 8번 — 이 항목을 다른 프리셋에 바로 넣기 */}
                          <button
                            type="button"
                            data-testid={`routine-copy-${item.id}`}
                            onClick={() => setCopyMenuFor(copyMenuFor === item.id ? null : item.id)}
                            aria-expanded={copyMenuFor === item.id}
                            className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[8.5px] font-extrabold text-indigo-600 ring-1 ring-indigo-200 transition active:scale-95"
                          >
                            📥 다른 프리셋
                          </button>
                        </div>

                        {copyMenuFor === item.id ? (
                          <div
                            data-testid={`routine-copy-menu-${item.id}`}
                            className="mt-1 flex flex-wrap gap-1 rounded-lg bg-indigo-50/70 px-1.5 py-1"
                          >
                            <span className="text-[8.5px] font-extrabold text-indigo-400">넣을 프리셋</span>
                            {presetList
                              .filter((preset) => preset.key !== presetView)
                              .map((preset) => (
                                <button
                                  key={preset.key}
                                  type="button"
                                  data-testid={`routine-copy-to-${item.id}-${preset.key}`}
                                  onClick={() => void copyItemTo(item, preset.key)}
                                  className="rounded-full bg-white px-1.5 py-0.5 text-[8.5px] font-extrabold text-indigo-700 ring-1 ring-indigo-200 transition active:scale-95"
                                >
                                  {preset.emoji} {preset.label}
                                </button>
                              ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 6번 — 맨 아래 영역은 **추가 전용** (+ 추가) — 수정은 위 목록 줄에서 바로 */}
              <div className="mt-2 rounded-2xl bg-indigo-50/70 p-2 ring-1 ring-indigo-100">
                <p className="text-[9px] font-extrabold text-indigo-400">새 항목 추가 (수정은 위 목록 줄을 눌러서)</p>
                <div className="mt-1 flex gap-1.5">
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
                    추가
                  </button>
                  <button
                    type="button"
                    data-testid="preset-save"
                    disabled={busy}
                    onClick={() => void saveCurrentPreset()}
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-slate-900 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                    이 프리셋 저장
                  </button>
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
        ) : tab === 'events' ? (
          <>
            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-extrabold text-slate-900">
                    🔥 버스트 타임 (경험치 {burstFactorLabel(study.appSettings.burstPercent)})
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                    켠 날부터 완료·검증하는 공부는 경험치가 {burstFactorLabel(study.appSettings.burstPercent)}로 들어가요.
                    지난 날짜 기록에는 소급하지 않아요.
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

              {/* 9번 — 버스트 타임 경험치 배수 (+25% · +50% · +75% · +100%) */}
              <p className="mt-2 text-[10px] font-extrabold text-slate-500">경험치 배수</p>
              <div className="mt-1 flex gap-1">
                {BURST_PERCENT_OPTIONS.map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    data-testid={`burst-percent-${percent}`}
                    onClick={() => void save({ burstPercent: percent })}
                    aria-pressed={study.appSettings.burstPercent === percent}
                    className={cx(
                      'flex-1 rounded-xl py-1.5 text-[10px] font-extrabold ring-1 transition active:scale-95',
                      study.appSettings.burstPercent === percent
                        ? 'bg-orange-500 text-white ring-orange-500'
                        : 'bg-slate-50 text-slate-600 ring-slate-200',
                    )}
                  >
                    +{percent}%
                    <span className="mt-0.5 block text-[8px] font-bold opacity-70">
                      {burstFactorLabel(percent)}
                    </span>
                  </button>
                ))}
              </div>
              <p data-testid="burst-percent-now" className="mt-1 text-[9px] font-semibold text-slate-400">
                지금 배수 <b className="font-extrabold text-orange-600">{burstFactorLabel(study.appSettings.burstPercent)}</b> ·
                배너·배지에도 같은 배수가 표시돼요.
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
                    켠 날({study.appSettings.burstAutoFrom ?? today})부터, 월말까지 남은 일수가 아래 값보다 적으면{' '}
                    {burstFactorLabel(study.appSettings.burstPercent)}예요.
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
                      ? `둘 다 켜진 날은 ${burstFactorLabel(study.appSettings.burstPercent * 2)}로 들어가요.`
                      : `둘 다 켜져도 ${burstFactorLabel(study.appSettings.burstPercent)} 한 번만 들어가요.`}
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
                  ? `🔥 오늘은 버스트 타임 — 지금 완료하면 경험치 ${burstFactorLabel(study.appSettings.burstPercent)}예요`
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
                뽑기 상자·결산 기록에는 소급하지 않아요.
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

            {/* ⑦ 🎁 뽑기 상자 보상 목록 (분·포인트) + 상자 개수 */}
            <section
              data-testid="box-rewards"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12.5px] font-extrabold text-slate-900">🎁 뽑기 상자 보상 목록</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                큰 티어로 올라가 뽑기 상자를 열 때 나오는 보상이에요. 이미 넣어 둔 보상은 그 자리에서 고치지
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
                          '뽑기 상자 보상을 뺐어요',
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

              <p className="mt-2.5 text-[10px] font-extrabold tracking-wide text-slate-400">뽑기 상자 개수</p>
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
              <p data-testid="streak-saved" className="mt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
                저장된 값 ·{' '}
                {study.appSettings.streakBonuses.length === 0
                  ? '보너스 없음'
                  : study.appSettings.streakBonuses
                      .map((bonus) => `${bonus.day}일 +${formatXp(bonus.xp)} XP`)
                      .join(' · ')}
              </p>

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
        ) : (
          <>
            {/* 4차 1번 — 부모 PIN · 비상 복구 */}
            <section
              data-testid="pin-recovery-section"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12.5px] font-extrabold text-slate-900">🔐 부모 PIN · 비상 복구</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                PIN 을 잊어버려도 열 수 있게 <b className="font-extrabold text-slate-700">비상 복구 질문</b>과
                <b className="font-extrabold text-slate-700"> 1회용 6자리 코드</b>를 함께 저장해 두세요.
                PIN 입력 화면의 `비밀번호 찾기` 에서 코드나 답을 넣으면 새 PIN 으로 바뀝니다.
                (답·코드는 솔트+해시로만 저장 — 평문 없음)
              </p>

              {study.parentPinRecoveryMode ? (
                <p
                  data-testid="pin-recovery-mode-note"
                  className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[10px] font-bold leading-relaxed text-amber-800 ring-1 ring-amber-200/70"
                >
                  지금은 복구 PIN 으로 이 폰에서만 열린 상태예요. 가족 DB에 저장하려면 Supabase에서 부모 PIN 을
                  한 번 다시 정해 주세요.
                </p>
              ) : null}

              <label className="mt-2 block">
                <span className="px-1 text-[9.5px] font-extrabold text-slate-400">비상 복구 질문</span>
                <input
                  data-testid="recovery-question"
                  value={recoveryQuestion}
                  maxLength={60}
                  onChange={(event) => setRecoveryQuestion(event.target.value)}
                  placeholder="예: 어릴 적 별명은?"
                  className="mt-0.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
                />
              </label>
              <label className="mt-1.5 block">
                <span className="px-1 text-[9.5px] font-extrabold text-slate-400">질문의 답</span>
                <input
                  data-testid="recovery-answer"
                  value={recoveryAnswer}
                  maxLength={40}
                  onChange={(event) => setRecoveryAnswer(event.target.value)}
                  placeholder="답 (대소문자 구분 없이 확인해요)"
                  className="mt-0.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
                />
              </label>
              <div className="mt-1.5 flex items-end gap-1.5">
                <label className="min-w-0 flex-1">
                  <span className="px-1 text-[9.5px] font-extrabold text-slate-400">1회용 복구 코드 6자리</span>
                  <input
                    data-testid="recovery-code"
                    value={recoveryCode}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="mt-0.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[13px] font-extrabold tabular-nums tracking-[0.2em] text-slate-800 outline-none ring-1 ring-slate-200 focus:ring-indigo-300"
                  />
                </label>
                <button
                  type="button"
                  data-testid="recovery-new-code"
                  onClick={() => setRecoveryCode(generateRecoveryCode())}
                  className="shrink-0 rounded-xl bg-white px-2.5 py-2 text-[10.5px] font-extrabold text-slate-600 ring-1 ring-slate-200 transition active:scale-95"
                >
                  새 코드
                </button>
              </div>

              {recoveryError ? (
                <p data-testid="recovery-error" className="mt-1.5 text-[10.5px] font-bold text-rose-500">
                  {recoveryError}
                </p>
              ) : null}
              {recoverySaved ? (
                <p
                  data-testid="recovery-saved"
                  className="mt-1.5 rounded-xl bg-emerald-50 px-2.5 py-2 text-[10px] font-bold leading-relaxed text-emerald-700 ring-1 ring-emerald-100"
                >
                  {recoverySaved}
                </p>
              ) : null}
              <p data-testid="recovery-status" className="mt-1.5 text-[9.5px] font-bold text-slate-400">
                {study.parentRecovery
                  ? `등록된 복구 질문 · ${study.parentRecovery.question} (${koreaISODateOf(study.parentRecovery.updated_at) ?? study.parentRecovery.updated_at.slice(0, 10)} 저장)`
                  : '아직 비상 복구가 등록되지 않았어요'}
              </p>

              <button
                type="button"
                data-testid="recovery-save"
                disabled={recoveryBusy}
                onClick={() => void saveRecovery()}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 py-2.5 text-[11.5px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
              >
                <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                {recoveryBusy ? '저장하는 중…' : '비상 복구 저장'}
              </button>

              <div className="mt-3 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-extrabold text-slate-600">부모 관리 PIN 바꾸기</p>
                <div className="mt-1 flex gap-1.5">
                  <input
                    data-testid="pin-current"
                    value={pinCurrent}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setPinCurrent(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="지금 PIN"
                    className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-[11.5px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300"
                  />
                  <input
                    data-testid="pin-new"
                    value={pinNew}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setPinNew(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="새 PIN"
                    className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-[11.5px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300"
                  />
                  <button
                    type="button"
                    data-testid="pin-change-save"
                    disabled={pinBusy}
                    onClick={() => void changePin()}
                    className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10.5px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
                  >
                    바꾸기
                  </button>
                </div>
                {pinError ? (
                  <p data-testid="pin-change-error" className="mt-1 text-[10px] font-bold text-rose-500">
                    {pinError}
                  </p>
                ) : null}
              </div>
            </section>

            {/* 4차 7번 — 데이터 백업·복원 */}
            <section
              data-testid="backup-section"
              className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
            >
              <p className="text-[12.5px] font-extrabold text-slate-900">💾 데이터 백업·복원</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                공부 기록 · 구성원 · 한마디 · 옵션 · 뽑기 기록을 파일(.json) 하나로 내려받습니다.
                {study.storageKind === 'local'
                  ? ' 복원하면 이 폰의 기록이 그대로 되돌아가요.'
                  : ' 가족 DB가 원본이라, 복원은 이 폰의 옵션(설정)만 되돌려요.'}
              </p>

              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  data-testid="backup-save"
                  onClick={makeBackup}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-indigo-600 py-2.5 text-[11px] font-extrabold text-white transition active:scale-[0.98]"
                >
                  ⬇️ 폰에 백업 저장(.json)
                </button>
                <button
                  type="button"
                  data-testid="backup-restore-pick"
                  onClick={() => backupFileRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2.5 text-[11px] font-extrabold text-slate-700 ring-1 ring-slate-200 transition active:scale-[0.98]"
                >
                  ⬆️ 백업 파일로 복원
                </button>
              </div>
              <input
                ref={backupFileRef}
                data-testid="backup-file"
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void pickBackup(file);
                }}
              />

              {backupNote ? (
                <p data-testid="backup-note" className="mt-1.5 text-[10px] font-bold leading-relaxed text-emerald-700">
                  {backupNote}
                </p>
              ) : null}
              {restoreError ? (
                <p data-testid="restore-error" className="mt-1.5 text-[10px] font-bold text-rose-500">
                  {restoreError}
                </p>
              ) : null}
              <p className="mt-1.5 text-[9px] font-semibold leading-relaxed text-slate-400">
                · 추후 `.apk` + 구글 로그인을 붙이면 구글 드라이브 백업 / 폰 로컬 저장 중에서 직접 고를 수 있게 됩니다(노션 `🔮 추후 계획`).
              </p>
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[10px] font-extrabold tracking-wide text-slate-400">저장 위치</p>
              <p
                data-testid="settings-sync-note-system"
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

      {/* "저장되었습니다" 팝업 — 6·10번처럼 저장 버튼을 눌렀을 때 확실히 보여 줍니다 */}
      {flash ? (
        <div
          data-testid="saved-popup"
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center px-6"
        >
          <span className="animate-toast-in inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3.5 py-2 text-[11.5px] font-extrabold text-white shadow-lg shadow-emerald-500/30">
            <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
            {flash}
          </span>
        </div>
      ) : null}

      {/* 4차 7번 — 복원 확인 팝업 */}
      {restoreTarget ? (
        <div
          data-testid="restore-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="백업 파일로 복원"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 px-6 backdrop-blur-sm"
        >
          <div className="w-full max-w-[320px] rounded-[26px] bg-white p-5 text-center shadow-2xl">
            <p className="text-[26px] leading-none" aria-hidden>
              💾
            </p>
            <h2 className="mt-2 text-[15px] font-extrabold tracking-tight text-slate-900">이 백업으로 복원할까요?</h2>
            <p data-testid="restore-counts" className="mt-1 text-[10.5px] font-semibold leading-relaxed text-slate-500">
              {restoreTarget.exported_at.slice(0, 10)} 백업 · 공부 {restoreTarget.db?.tasks.length ?? 0}개 · 한마디{' '}
              {restoreTarget.notes?.length ?? 0}개
              <br />
              {study.storageKind === 'local'
                ? '이 폰의 공부 기록·옵션이 백업 파일 것으로 바뀝니다.'
                : '가족 DB의 공부 기록은 그대로 두고, 이 폰의 옵션만 되돌립니다.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="restore-cancel"
                onClick={() => setRestoreTarget(null)}
                className="flex-1 rounded-2xl bg-slate-100 py-2.5 text-[12px] font-extrabold text-slate-600 transition active:scale-[0.98]"
              >
                취소
              </button>
              <button
                type="button"
                data-testid="restore-apply"
                disabled={restoreBusy}
                onClick={() => void applyRestore()}
                className="flex-1 rounded-2xl bg-slate-900 py-2.5 text-[12px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
              >
                {restoreBusy ? '복원하는 중…' : '복원'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
              {presetList.find((preset) => preset.key === presetConfirm)?.emoji ?? '📚'}
            </p>
            <h2 className="mt-2 text-[15px] font-extrabold tracking-tight text-slate-900">
              {presetList.find((preset) => preset.key === presetConfirm)?.label ?? ''} 프리셋을 적용할까요?
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
