import { useState } from 'react';
import { cx } from '../lib/cx';
import { memberTheme } from '../lib/theme';
import type { Member } from '../lib/types';
import { CHILD_ICONS } from './ProfileSheet';
import { LockIcon, PlusIcon, XIcon } from './icons';

interface ProfilePickerProps {
  familyName: string;
  members: Member[];
  /** 그 프로필에 PIN 이 걸려 있는지 */
  hasPin: (memberId: string) => boolean;
  /** 프로필을 골랐을 때 (부모면 PIN 화면, 아이도 PIN 이 있으면 PIN 화면으로 이어집니다) */
  onPick: (memberId: string) => void;
  /** 이 기기(데모)에는 아직 부모 PIN 이 없음 — 새 프로필 만들 때 부모 PIN 칸을 숨깁니다. */
  parentPinSetupRequired: boolean;
  onCreate: (input: {
    name: string;
    emoji: string;
    role: 'child' | 'parent';
    pin: string;
    parentPin: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** 저장 중(두 번 눌림 방지) */
  busy?: boolean;
}

const ROLE_EMOJI = ['🧑', '👩', '👨', '🙂'];

/**
 * 🚪 앱을 열면 가장 먼저 나오는 **프로필 선택 화면** (3번 · 12번)
 *
 * · 앱을 열자마자 PIN 화면이 뜨지 않고, 4개(가족이 늘면 그 이상) 프로필 중 내 것을 누릅니다.
 * · 부모 프로필은 누르면 PIN 화면, 아이 프로필도 개인 PIN 을 정해 두었으면 PIN 화면이 뜹니다.
 * · `+ 새 프로필 만들기` 로 이름·아이콘·역할(아이/부모)·PIN 을 정해 새 프로필을 추가합니다.
 *   (가족 설정 JSON 에 저장 — 추가 SQL 없음. 저장은 부모 PIN 을 확인한 뒤에만 됩니다)
 */
export function ProfilePicker({
  familyName,
  members,
  hasPin,
  onPick,
  parentPinSetupRequired,
  onCreate,
  busy = false,
}: ProfilePickerProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🙂');
  const [role, setRole] = useState<'child' | 'parent'>('child');
  const [pin, setPin] = useState('');
  const [parentPin, setParentPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ordered = [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'parent' ? -1 : 1;
    return 0;
  });

  const resetForm = () => {
    setName('');
    setEmoji('🙂');
    setRole('child');
    setPin('');
    setParentPin('');
    setError(null);
  };

  const submit = async () => {
    if (saving || busy) return;
    if (!name.trim()) {
      setError('이름(닉네임)을 적어 주세요.');
      return;
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      setError('PIN은 4자리 숫자로 정해 주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onCreate({ name: name.trim(), emoji, role, pin, parentPin });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? '프로필을 만들지 못했어요.');
      return;
    }
    resetForm();
    setFormOpen(false);
  };

  return (
    <div
      data-testid="profile-picker"
      className="flex min-h-screen flex-col bg-[#f5f6fa] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]"
    >
      <div className="mx-auto w-full max-w-md flex-1">
        <div className="mt-3 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 text-[26px] shadow-lg shadow-indigo-500/25">
            <span aria-hidden>📚</span>
          </div>
          <p className="mt-3 text-[11px] font-bold text-slate-400">{familyName}</p>
          <h1 className="mt-1 text-[19px] font-extrabold tracking-tight text-slate-900">누구세요?</h1>
          <p className="mt-1 text-[11.5px] font-semibold leading-relaxed text-slate-500">
            내 프로필을 누르면 시작해요.
            {parentPinSetupRequired ? '' : ' 부모·아이 PIN 이 걸린 프로필은 PIN을 먼저 물어봐요.'}
          </p>
        </div>

        <div data-testid="profile-grid" className="mt-5 grid grid-cols-2 gap-2">
          {ordered.map((member) => {
            const theme = memberTheme(member.color);
            const locked = member.role === 'parent' || hasPin(member.id);
            return (
              <button
                key={member.id}
                type="button"
                data-testid={`pick-${member.id}`}
                onClick={() => onPick(member.id)}
                className="flex flex-col items-center gap-1 rounded-[22px] bg-white px-2 py-3 text-center shadow-card ring-1 ring-slate-900/5 transition active:scale-[0.98]"
              >
                <span className={cx('grid h-14 w-14 place-items-center rounded-2xl text-[28px]', theme.soft)} aria-hidden>
                  {member.emoji}
                </span>
                <span className="mt-0.5 max-w-full truncate text-[13px] font-extrabold text-slate-900">
                  {member.name}
                </span>
                <span className="text-[9px] font-bold text-slate-400">
                  {member.role === 'parent' ? '부모' : '아이'}
                </span>
                <span
                  className={cx(
                    'mt-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold ring-1',
                    locked
                      ? 'bg-amber-50 text-amber-600 ring-amber-200/70'
                      : 'bg-emerald-50 text-emerald-600 ring-emerald-200/70',
                  )}
                >
                  {locked ? (
                    <>
                      <LockIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
                      PIN
                    </>
                  ) : (
                    '바로 입장'
                  )}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            data-testid="profile-create-open"
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
            className="flex flex-col items-center justify-center gap-1 rounded-[22px] border-2 border-dashed border-slate-300 bg-white/60 px-2 py-3 text-center transition active:scale-[0.98]"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <PlusIcon className="h-6 w-6" strokeWidth={2.6} />
            </span>
            <span className="mt-0.5 text-[12px] font-extrabold text-slate-600">+ 새 프로필 만들기</span>
            <span className="text-[9px] font-bold text-slate-400">이름 · 아이콘 · PIN</span>
          </button>
        </div>

        <p className="mt-4 px-1 text-center text-[9.5px] font-semibold leading-relaxed text-slate-400">
          새 프로필은 부모 PIN 을 확인한 뒤에 저장돼요. 만든 프로필은 가족 폰이 함께 써요.
        </p>
      </div>

      {formOpen ? (
        <div
          data-testid="profile-create"
          role="dialog"
          aria-modal="true"
          aria-label="새 프로필 만들기"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 px-3 pb-3 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-[380px] rounded-[26px] bg-white p-3.5 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13.5px] font-extrabold text-slate-900">+ 새 프로필 만들기</p>
              <button
                type="button"
                data-testid="profile-create-close"
                aria-label="닫기"
                onClick={() => setFormOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-500 transition active:scale-90"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <label className="mt-2 block">
              <span className="text-[9.5px] font-extrabold text-slate-400">이름(닉네임)</span>
              <input
                data-testid="profile-name"
                value={name}
                maxLength={20}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 막내"
                className="mt-0.5 w-full rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
              />
            </label>

            <div className="mt-2">
              <span className="text-[9.5px] font-extrabold text-slate-400">역할</span>
              <div className="mt-0.5 flex gap-1.5">
                {(['child', 'parent'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`profile-role-${value}`}
                    onClick={() => setRole(value)}
                    aria-pressed={role === value}
                    className={cx(
                      'flex-1 rounded-xl py-1.5 text-[11px] font-extrabold ring-1 transition active:scale-95',
                      role === value
                        ? 'bg-indigo-600 text-white ring-indigo-600'
                        : 'bg-slate-50 text-slate-600 ring-slate-200',
                    )}
                  >
                    {value === 'child' ? '아이' : '부모'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2">
              <span className="text-[9.5px] font-extrabold text-slate-400">아이콘</span>
              <div className="no-scrollbar mt-0.5 flex max-h-[86px] flex-wrap gap-1 overflow-y-auto">
                {[...ROLE_EMOJI, ...CHILD_ICONS].map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-testid={`profile-icon-${item}`}
                    onClick={() => setEmoji(item)}
                    aria-pressed={emoji === item}
                    className={cx(
                      'grid h-7 w-7 place-items-center rounded-lg text-[15px] ring-1 transition active:scale-90',
                      emoji === item ? 'bg-indigo-100 ring-indigo-300' : 'bg-white ring-slate-200',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 flex gap-1.5">
              <label className="min-w-0 flex-1">
                <span className="text-[9.5px] font-extrabold text-slate-400">내 PIN (4자리 · 선택)</span>
                <input
                  data-testid="profile-pin"
                  value={pin}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="비우면 PIN 없이 입장"
                  className="mt-0.5 w-full rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] font-bold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
                />
              </label>
              {parentPinSetupRequired ? null : (
                <label className="w-[110px] shrink-0">
                  <span className="text-[9.5px] font-extrabold text-rose-400">부모 PIN</span>
                  <input
                    data-testid="profile-parent-pin"
                    value={parentPin}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setParentPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="필수"
                    className="mt-0.5 w-full rounded-xl bg-rose-50/60 px-2.5 py-2 text-[12px] font-bold tabular-nums text-slate-800 outline-none ring-1 ring-rose-100 placeholder:text-rose-300 focus:ring-rose-300"
                  />
                </label>
              )}
            </div>

            {error ? (
              <p data-testid="profile-create-error" className="mt-1.5 px-1 text-[10.5px] font-bold text-rose-500">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              data-testid="profile-create-save"
              disabled={saving || busy}
              onClick={() => void submit()}
              className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-xl bg-indigo-600 py-2.5 text-[12px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
              {saving ? '만드는 중…' : '프로필 만들기'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
