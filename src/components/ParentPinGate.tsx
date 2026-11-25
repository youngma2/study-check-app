import { useCallback, useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { vibrateError, vibrateKey } from '../lib/haptics';
import { memberTheme } from '../lib/theme';
import type { Member } from '../lib/types';
import { LockIcon, ChevronLeftIcon } from './icons';

interface ParentPinGateProps {
  familyName: string;
  /** 'unlock': 이미 PIN 이 있는 경우 / 'setup': 이 기기(데모)에서 처음 정하는 경우 */
  mode: 'unlock' | 'setup';
  /** 어느 부모 화면을 열려고 하는지 (예: '아빠') — 안내 문구에 씁니다. */
  targetName?: string;
  children: Member[];
  onSubmit: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  onSwitchChild: (memberId: string) => void;
  /** 아이 화면에서 '부모 관리로 돌아가기' 로 열렸을 때 — 취소하면 그 아이 화면으로 돌아갑니다. */
  onCancel?: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * 부모 관리 PIN 잠금 화면.
 * 아이 화면에서는 보이지 않고, 부모 시점(#as=mem_dad 등)으로 열면 가장 먼저 이 화면이 나옵니다.
 */
export function ParentPinGate({ familyName, mode, targetName, children, onSubmit, onSwitchChild, onCancel }: ParentPinGateProps) {
  const [digits, setDigits] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');

  const submitting = pending;
  const targetLength = 4;
  const stepTitle =
    mode === 'setup'
      ? step === 'enter'
        ? '부모 관리 PIN 정하기'
        : '한 번 더 입력해 주세요'
      : '부모 관리 PIN';
  const stepHint =
    mode === 'setup'
      ? step === 'enter'
        ? '이 기기에서 쓸 4자리 숫자를 정해 주세요.'
        : '방금 정한 4자리 숫자를 다시 입력해 주세요.'
      : `${targetName ?? '부모'} 화면은 부모님만 들어갈 수 있어요. 4자리 PIN을 입력해 주세요.`;

  const runSubmit = useCallback(
    async (pin: string) => {
      setPending(true);
      setError(null);

      if (mode === 'setup' && step === 'enter') {
        setFirstPin(pin);
        setStep('confirm');
        setDigits('');
        setPending(false);
        return;
      }

      if (mode === 'setup' && step === 'confirm') {
        if (pin !== firstPin) {
          vibrateError();
          setError('두 번 입력한 PIN이 달라요. 처음부터 다시 해 주세요.');
          setStep('enter');
          setFirstPin(null);
          setDigits('');
          setPending(false);
          return;
        }
      }

      const result = await onSubmit(pin);
      setPending(false);
      if (!result.ok) {
        vibrateError();
        setError(result.error ?? 'PIN을 확인하지 못했어요.');
        setDigits('');
      }
    },
    [mode, step, firstPin, onSubmit],
  );

  const press = useCallback(
    (key: string) => {
      if (submitting) return;
      vibrateKey();
      if (key === 'del') {
        setDigits((prev) => prev.slice(0, -1));
        return;
      }
      setDigits((prev) => {
        if (prev.length >= targetLength) return prev;
        const next = prev + key;
        if (next.length === targetLength) void runSubmit(next);
        return next;
      });
    },
    [runSubmit, submitting],
  );

  // 키보드로도 입력 (PC에서 확인할 때)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        press('del');
      } else if (event.key === 'Escape' && onCancel) {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [press, onCancel]);

  return (
    <div
      data-testid="parent-pin-gate"
      className="flex min-h-screen flex-col bg-[#f5f6fa] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]"
    >
      <div className="mx-auto w-full max-w-md flex-1">
        {onCancel ? (
          <button
            type="button"
            data-testid="cancel-parent-gate"
            onClick={() => {
              vibrateKey();
              onCancel();
            }}
            className="mt-1 flex items-center gap-0.5 rounded-full py-1.5 pl-1 pr-2.5 text-[11.5px] font-bold text-slate-400 transition hover:bg-white hover:text-slate-600 active:scale-95"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            아이 화면으로
          </button>
        ) : null}

        <div className="mt-6 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25">
            <LockIcon className="h-7 w-7" strokeWidth={2.2} />
          </div>
          <p className="mt-3 text-[11px] font-bold text-slate-400">{familyName}</p>
          <h1 className="mt-1 text-[19px] font-extrabold tracking-tight text-slate-900">{stepTitle}</h1>
          <p className="mt-1 text-[11.5px] font-semibold leading-relaxed text-slate-500">{stepHint}</p>
        </div>

        <div className="mt-7 flex items-center justify-center gap-3" aria-live="polite">
          {Array.from({ length: targetLength }, (_, index) => (
            <span
              key={index}
              data-testid={`pin-dot-${index}`}
              className={cx(
                'h-3.5 w-3.5 rounded-full transition',
                index < digits.length ? 'scale-110 bg-indigo-600' : 'bg-slate-200',
              )}
            />
          ))}
        </div>

        <p
          data-testid="pin-error"
          className={cx(
            'mx-auto mt-3 min-h-[34px] max-w-[320px] text-center text-[11px] font-bold leading-relaxed',
            error ? 'text-rose-500' : 'text-transparent',
          )}
        >
          {error ?? ' '}
        </p>

        <div className="mx-auto mt-2 grid max-w-[300px] grid-cols-3 gap-2.5">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`pin-key-${key}`}
              onClick={() => press(key)}
              disabled={submitting}
              className="h-14 rounded-2xl bg-white text-[20px] font-extrabold text-slate-800 shadow-sm ring-1 ring-slate-900/5 transition active:scale-[0.96] disabled:opacity-50"
            >
              {key}
            </button>
          ))}
          <span aria-hidden className="h-14" />
          <button
            type="button"
            data-testid="pin-key-0"
            onClick={() => press('0')}
            disabled={submitting}
            className="h-14 rounded-2xl bg-white text-[20px] font-extrabold text-slate-800 shadow-sm ring-1 ring-slate-900/5 transition active:scale-[0.96] disabled:opacity-50"
          >
            0
          </button>
          <button
            type="button"
            data-testid="pin-key-del"
            aria-label="지우기"
            onClick={() => press('del')}
            disabled={submitting}
            className="h-14 rounded-2xl bg-slate-100 text-[12px] font-extrabold text-slate-500 transition active:scale-[0.96] disabled:opacity-50"
          >
            지우기
          </button>
        </div>

        {submitting ? (
          <p className="mt-4 text-center text-[11px] font-bold text-indigo-500">확인 중…</p>
        ) : null}

        {children.length > 0 ? (
          <div className="mt-8 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-900/5">
            <p className="px-1 text-[10px] font-extrabold tracking-wide text-slate-400">아이로 보기</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {children.map((member) => {
                const theme = memberTheme(member.color);
                return (
                  <button
                    key={member.id}
                    type="button"
                    data-testid={`gate-switch-${member.id}`}
                    onClick={() => {
                      setDigits('');
                      setError(null);
                      onSwitchChild(member.id);
                    }}
                    className={cx(
                      'flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[12px] font-extrabold text-slate-700 ring-1 transition active:scale-95',
                      theme.ring,
                    )}
                  >
                    <span aria-hidden>{member.emoji}</span>
                    {member.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
