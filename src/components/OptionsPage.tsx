import { useEffect, useMemo, useState } from 'react';
import { ROUTINE_PRESETS, nextStreakBonus, reachedStreakBonus, withRoutine, type AppSettings, type RoutineKey } from '../lib/app-settings';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { WEEKDAY_LABELS } from '../lib/date';
import { formatXp } from '../lib/season';
import { useStudy } from '../lib/study-context';
import { SUBJECTS, subjectMeta } from '../lib/theme';
import type { TaskPreset } from '../lib/types';
import { ArrowLeftIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';

/**
 * ⚙️ 옵션 — 부모 관리(PIN) 안에서만 열리는 페이지
 *
 * ① 📚 공부 목록: 아이별·요일별 기본 숙제 목록을 직접 추가·수정·삭제하고,
 *    학기중 · 방학 · 시험기간 프리셋을 원터치로 바꿉니다.
 * ② 🔥 이벤트·보너스: 버스트 타임(경험치 2배) ON/OFF, 연속 달성 보너스 XP 조정.
 *
 * 여기서 정한 목록은 메인 화면의 [기본 목록] 버튼이 그대로 씁니다.
 */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function dayLabel(weekday: number): string {
  return `${WEEKDAY_LABELS[weekday]}요일`;
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

  useEffect(() => {
    setBonusDraft(study.appSettings.streakBonuses);
  }, [study.appSettings.streakBonuses]);

  const member = study.children.find((item) => item.id === memberId) ?? study.children[0];
  const presetKey: RoutineKey = settings.activePreset;
  const presetMeta = ROUTINE_PRESETS.find((preset) => preset.key === presetKey) ?? ROUTINE_PRESETS[0];
  const items: TaskPreset[] = useMemo(
    () => (member ? settings.presets[presetKey]?.routines[member.id]?.[String(weekday)] ?? [] : []),
    [settings.presets, presetKey, member, weekday],
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

  const saveItems = async (nextItems: TaskPreset[], message: string) => {
    if (!member) return;
    const next = withRoutine(study.appSettings, member.id, weekday, nextItems);
    if (await save({ presets: next.presets })) onNotify(message);
  };

  const applyPreset = async (key: RoutineKey) => {
    if (key === settings.activePreset) return;
    const meta = ROUTINE_PRESETS.find((preset) => preset.key === key);
    if (await save({ activePreset: key })) {
      onNotify(`${meta?.label ?? key} 프리셋으로 바꿨어요 · 기본 목록에 바로 적용돼요`);
    }
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

  const toggleBurst = async () => {
    const on = !study.appSettings.burst;
    const now = new Date();
    const windows = on
      ? [...study.appSettings.burstWindows, { from: now.toISOString(), to: null }].slice(-30)
      : study.appSettings.burstWindows.map((window) =>
          window.to === null ? { ...window, to: now.toISOString() } : window,
        );
    if (await save({ burst: on, burstWindows: windows })) {
      onNotify(
        on
          ? '🔥 버스트 타임 시작! 지금부터 완료하는 공부는 경험치 2배예요'
          : '버스트 타임을 껐어요 · 그동안 받은 2배 경험치는 그대로 남아요',
      );
    }
  };

  const saveBonuses = async () => {
    if (await save({ streakBonuses: bonusDraft })) onNotify('연속 달성 보너스를 저장했어요');
  };

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
                    onClick={() => void applyPreset(preset.key)}
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
                프리셋을 바꾸면 아이별·요일별 기본 일정이 한 번에 바뀌고, 메인 화면 [기본 목록]에 바로
                쓰여요.
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
                  <span className="sr-only">{study.appSettings.burst ? '버스트 타임 끄기' : '버스트 타임 켜기'}</span>
                </button>
              </div>
              <p
                data-testid="burst-status"
                className={cx(
                  'mt-2 rounded-xl px-2.5 py-1.5 text-[10.5px] font-extrabold',
                  study.appSettings.burst ? 'bg-orange-50 text-orange-700' : 'bg-slate-50 text-slate-400',
                )}
              >
                {study.appSettings.burst
                  ? '🔥 진행 중 — 아이 화면 위쪽에 안내 배너가 떠요'
                  : '지금은 꺼져 있어요 (경험치 1배)'}
              </p>
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
          <br />· 여기서 정한 기본 목록은 메인 화면 [기본 목록] 버튼이 그 날짜 요일에 맞춰 넣어 줘요.
        </p>
      </div>
    </div>
  );
}
