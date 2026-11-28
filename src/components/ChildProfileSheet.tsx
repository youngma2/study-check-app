import { useEffect, useState } from 'react';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { useStudy } from '../lib/study-context';
import { ArrowLeftIcon, CheckIcon, LockIcon } from './icons';
import { CHILD_ICONS } from './ProfileSheet';

/**
 * 🏷 아이 전용 프로필 창 (4차 2·5번)
 *
 * 아이 화면 오른쪽 위 `⋮` → `프로필 관리` 로 열립니다. 여기서 바꾸는 것은 딱 네 가지예요.
 *   · 닉네임   · 학년   · 아이콘   · 아이 개인 PIN(정하기·바꾸기·지우기)
 *
 * 생일·연락처처럼 개인정보가 될 만한 항목은 **일절 받지 않습니다.**
 * (부모 화면에서 열면 가족 설정에 저장돼 모든 폰에, 아이 화면에서 열면 이 폰에만 저장돼요)
 */

interface ChildProfileSheetProps {
  memberId: string;
  onClose: () => void;
  onNotify: (message: string) => void;
}

/** 학년 빠른 선택 — 직접 적어도 됩니다. */
const GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];

export function ChildProfileSheet({ memberId, onClose, onNotify }: ChildProfileSheetProps) {
  const study = useStudy();
  useOverlayBack(true, onClose);

  const member =
    study.members.find((item) => item.id === memberId) ??
    (study.currentMember.id === memberId ? study.currentMember : study.children[0]);
  const viewerIsParent = study.isParent;

  const [name, setName] = useState(member?.name ?? '');
  const [grade, setGrade] = useState(member?.grade ?? '');
  const [emoji, setEmoji] = useState(member?.emoji ?? '🙂');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 🔐 아이 개인 PIN */
  const [pinOpen, setPinOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinNotice, setPinNotice] = useState<string | null>(null);

  const hasPin = member ? study.hasProfilePin(member.id) : false;

  // 다른 폰에서 값이 바뀌면 화면도 따라갑니다(창을 닫았다 열 때 새 값으로).
  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setGrade(member.grade ?? '');
    setEmoji(member.emoji);
  }, [member?.id, member?.name, member?.grade, member?.emoji]);

  if (!member) {
    return (
      <div data-testid="child-profile" className="fixed inset-0 z-[60] grid place-items-center bg-[#f5f6fa] px-6">
        <p className="text-[12px] font-bold text-slate-500">프로필을 불러오지 못했어요.</p>
        <button type="button" onClick={onClose} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-[11.5px] font-extrabold text-white">
          닫기
        </button>
      </div>
    );
  }

  const saveProfile = async () => {
    if (saving) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setError('닉네임을 적어 주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await study.saveChildProfile(member.id, {
      name: cleanName,
      grade: grade.trim(),
      emoji,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? '저장하지 못했어요.');
      return;
    }
    onNotify(
      result.deviceOnly
        ? '이 폰에 저장했어요 · 부모님 폰에도 바꾸려면 부모님께 부탁해 주세요'
        : '프로필을 저장했어요',
    );
    if (!result.deviceOnly) onClose();
  };

  const savePin = async () => {
    if (pinBusy) return;
    if (hasPin && !/^\d{4}$/.test(currentPin)) {
      setPinError('지금 쓰는 아이 PIN 4자리를 넣어 주세요.');
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('새 PIN은 4자리 숫자로 정해 주세요.');
      return;
    }
    if (newPin !== pinAgain) {
      setPinError('두 번 입력한 PIN이 달라요.');
      return;
    }
    setPinBusy(true);
    setPinError(null);
    const result = await study.setChildProfilePin(member.id, newPin, hasPin ? currentPin : undefined);
    setPinBusy(false);
    if (!result.ok) {
      setPinError(result.error ?? 'PIN을 저장하지 못했어요.');
      return;
    }
    setPinOpen(false);
    setCurrentPin('');
    setNewPin('');
    setPinAgain('');
    setPinNotice(
      result.deviceOnly
        ? '이 폰에서 쓸 아이 PIN을 정했어요 (부모님 폰에는 아직 그대로예요)'
        : '아이 PIN을 저장했어요',
    );
    onNotify('아이 PIN을 저장했어요');
  };

  const clearPin = async () => {
    if (pinBusy) return;
    if (hasPin && !/^\d{4}$/.test(currentPin)) {
      setPinError('지금 쓰는 아이 PIN 4자리를 넣어 주세요.');
      return;
    }
    if (!window.confirm('이 프로필의 PIN을 지울까요? 지우면 PIN 없이 들어갑니다.')) return;
    setPinBusy(true);
    setPinError(null);
    const result = await study.resetChildProfilePin(member.id, hasPin ? currentPin : undefined);
    setPinBusy(false);
    if (!result.ok) {
      setPinError(result.error ?? 'PIN을 지우지 못했어요.');
      return;
    }
    setPinOpen(false);
    setCurrentPin('');
    setPinNotice('아이 PIN을 지웠어요 · 이제 PIN 없이 들어갑니다');
    onNotify('아이 PIN을 지웠어요');
  };

  return (
    <div data-testid="child-profile" className="fixed inset-0 z-[60] overflow-y-auto bg-[#f5f6fa]">
      <div className="sticky top-0 z-10 bg-[#f5f6fa]/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-4 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="child-profile-close"
              onClick={onClose}
              aria-label="프로필 관리 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">🏷 프로필 관리</h1>
              <p className="text-[9.5px] font-bold text-slate-400">닉네임 · 학년 · 아이콘 · 아이 PIN</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2.5 px-4 pb-28 pt-1">
        <section className="flex items-center gap-3 rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
          <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-100 text-[28px]">
            {emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p data-testid="child-profile-preview" className="truncate text-[14px] font-extrabold text-slate-900">
              {name.trim() || member.name}
              {grade.trim() ? (
                <span className="ml-1 text-[10px] font-bold text-slate-400">{grade.trim()}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[9.5px] font-bold text-slate-400">
              {viewerIsParent ? '부모 화면 — 바꾸면 가족 폰 모두에 적용돼요' : '내 화면 — 이 폰에 저장돼요'}
            </p>
          </div>
        </section>

        <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
          <p className="text-[12.5px] font-extrabold text-slate-900">닉네임</p>
          <input
            data-testid="child-profile-name"
            value={name}
            maxLength={20}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="닉네임 (예: 예원)"
            className="mt-1.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[12px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
          />

          <p className="mt-2.5 text-[12.5px] font-extrabold text-slate-900">학년</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {GRADES.map((item) => (
              <button
                key={item}
                type="button"
                data-testid={`child-profile-grade-${item}`}
                onClick={() => setGrade(grade === item ? '' : item)}
                aria-pressed={grade === item}
                className={cx(
                  'rounded-full px-2 py-1 text-[10px] font-extrabold ring-1 transition active:scale-95',
                  grade === item
                    ? 'bg-indigo-600 text-white ring-indigo-600'
                    : 'bg-slate-50 text-slate-500 ring-slate-200',
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <input
            data-testid="child-profile-grade"
            value={grade}
            maxLength={10}
            onChange={(event) => setGrade(event.target.value)}
            placeholder="직접 적기 (예: 중1)"
            className="mt-1.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
          />

          <p className="mt-2.5 text-[12.5px] font-extrabold text-slate-900">아이콘</p>
          <div data-testid="child-profile-icons" className="no-scrollbar mt-1.5 flex max-h-[112px] flex-wrap gap-1 overflow-y-auto">
            {CHILD_ICONS.map((item) => (
              <button
                key={item}
                type="button"
                data-testid={`child-profile-emoji-${item}`}
                onClick={() => setEmoji(item)}
                aria-pressed={emoji === item}
                className={cx(
                  'grid h-8 w-8 place-items-center rounded-xl text-[17px] ring-1 transition active:scale-90',
                  emoji === item ? 'bg-indigo-100 ring-indigo-300' : 'bg-slate-50 ring-slate-200',
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {error ? (
            <p data-testid="child-profile-error" className="mt-1.5 text-[10.5px] font-bold text-rose-500">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            data-testid="child-profile-save"
            disabled={saving}
            onClick={() => void saveProfile()}
            className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-2xl bg-indigo-600 py-2.5 text-[12px] font-extrabold text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.98] disabled:opacity-50"
          >
            <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
            {saving ? '저장하는 중…' : '저장'}
          </button>
        </section>

        <section
          data-testid="child-profile-pin"
          className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-extrabold text-slate-900">🔐 아이 개인 PIN</p>
            <span
              data-testid="child-profile-pin-state"
              className={cx(
                'rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ring-1',
                hasPin ? 'bg-emerald-50 text-emerald-600 ring-emerald-200/70' : 'bg-slate-100 text-slate-400 ring-slate-200',
              )}
            >
              {hasPin ? 'PIN 있음' : 'PIN 없음'}
            </span>
          </div>
          <p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-500">
            4자리 숫자로 정해 두면, 앱을 열 때 내 프로필을 고를 때 이 PIN을 물어봐요.
            잊으면 부모님 화면에서 초기화할 수 있어요.
          </p>

          {pinNotice ? (
            <p data-testid="child-profile-pin-notice" className="mt-1.5 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100">
              {pinNotice}
            </p>
          ) : null}

          {pinOpen ? (
            <div className="mt-2 space-y-1.5">
              {hasPin ? (
                <label className="block">
                  <span className="px-1 text-[9.5px] font-extrabold text-slate-400">지금 쓰는 PIN</span>
                  <input
                    data-testid="child-profile-pin-current"
                    value={currentPin}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4자리"
                    className="mt-0.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[12px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300"
                  />
                </label>
              ) : null}
              <div className="flex gap-1.5">
                <label className="min-w-0 flex-1">
                  <span className="px-1 text-[9.5px] font-extrabold text-slate-400">새 PIN</span>
                  <input
                    data-testid="child-profile-pin-new"
                    value={newPin}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4자리"
                    className="mt-0.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[12px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300"
                  />
                </label>
                <label className="min-w-0 flex-1">
                  <span className="px-1 text-[9.5px] font-extrabold text-slate-400">한 번 더</span>
                  <input
                    data-testid="child-profile-pin-again"
                    value={pinAgain}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setPinAgain(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4자리"
                    className="mt-0.5 w-full rounded-xl bg-slate-50 px-3 py-2 text-[12px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300"
                  />
                </label>
              </div>
              {pinError ? (
                <p data-testid="child-profile-pin-error" className="text-[10px] font-bold text-rose-500">
                  {pinError}
                </p>
              ) : null}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-testid="child-profile-pin-save"
                  disabled={pinBusy}
                  onClick={() => void savePin()}
                  className="flex-1 rounded-xl bg-slate-900 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
                >
                  {pinBusy ? '저장하는 중…' : hasPin ? 'PIN 바꾸기' : 'PIN 정하기'}
                </button>
                {hasPin ? (
                  <button
                    type="button"
                    data-testid="child-profile-pin-clear"
                    disabled={pinBusy}
                    onClick={() => void clearPin()}
                    className="rounded-xl bg-rose-50 px-2.5 py-2 text-[10.5px] font-extrabold text-rose-500 ring-1 ring-rose-100 transition active:scale-95 disabled:opacity-50"
                  >
                    PIN 지우기
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setPinOpen(false);
                    setPinError(null);
                    setCurrentPin('');
                    setNewPin('');
                    setPinAgain('');
                  }}
                  className="rounded-xl bg-white px-2.5 py-2 text-[10.5px] font-extrabold text-slate-500 ring-1 ring-slate-200"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="child-profile-pin-open"
              onClick={() => {
                setPinOpen(true);
                setPinError(null);
                setPinNotice(null);
              }}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98]"
            >
              <LockIcon className="h-3 w-3" strokeWidth={2.4} />
              {hasPin ? 'PIN 바꾸기' : 'PIN 정하기'}
            </button>
          )}
        </section>

        <p data-testid="child-profile-privacy" className="px-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · 여기서는 닉네임 · 학년 · 아이콘 · 아이 PIN 만 바꿔요. 생일·연락처 같은 개인정보는 받지 않아요.
          <br />
          · PIN 은 평문이 아니라 솔트+해시로만 저장돼요.
          <br />
          · 아이 화면에서 바꾼 값은 이 폰에만, 부모 화면에서 바꾼 값은 가족 폰 모두에 적용돼요.
        </p>
      </div>
    </div>
  );
}
