import { useCallback, useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { vibrateError, vibrateKey } from '../lib/haptics';
import { ChevronLeftIcon, LockIcon } from './icons';

interface ChildPinGateProps {
  familyName: string;
  /** 어느 프로필의 PIN 인지 */
  name: string;
  emoji: string;
  onSubmit: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * 🔐 아이(프로필) 개인 PIN 입력 화면.
 *
 * 처음 열었을 때 **프로필 선택 → 그 프로필을 눌렀을 때만** 이 화면이 뜹니다.
 * PIN 은 가족 설정(family_app_settings JSON)에 솔트+해시로만 저장돼 폰끼리 함께 쓰입니다.
 * 잊어버리면 부모가 프로필 화면에서 초기화할 수 있어요.
 */
export function ChildPinGate({ familyName, name, emoji, onSubmit, onCancel }: ChildPinGateProps) {
  const [digits, setDigits] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSubmit = useCallback(
    async (pin: string) => {
      setPending(true);
      setError(null);
      const result = await onSubmit(pin);
      setPending(false);
      if (!result.ok) {
        vibrateError();
        setError(result.error ?? 'PIN을 확인하지 못했어요.');
        setDigits('');
      }
    },
    [onSubmit],
  );

  const press = useCallback(
    (key: string) => {
      if (pending) return;
      vibrateKey();
      if (key === 'del') {
        setDigits((prev) => prev.slice(0, -1));
        return;
      }
      setDigits((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + key;
        if (next.length === 4) void runSubmit(next);
        return next;
      });
    },
    [pending, runSubmit],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        press('del');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [press, onCancel]);

  return (
    <div
      data-testid="child-pin-gate"
      className="flex min-h-screen flex-col bg-[#f5f6fa] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]"
    >
      <div className="mx-auto w-full max-w-md flex-1">
        <button
          type="button"
          data-testid="child-pin-back"
          onClick={() => {
            vibrateKey();
            onCancel();
          }}
          className="mt-1 flex items-center gap-0.5 rounded-full py-1.5 pl-1 pr-2.5 text-[11.5px] font-bold text-slate-400 transition hover:bg-white hover:text-slate-600 active:scale-95"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          프로필 다시 고르기
        </button>

        <div className="mt-6 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-3xl bg-white text-[28px] shadow-lg ring-1 ring-slate-900/5">
            <span aria-hidden>{emoji}</span>
          </div>
          <p className="mt-3 text-[11px] font-bold text-slate-400">{familyName}</p>
          <h1 className="mt-1 flex items-center gap-1 text-[19px] font-extrabold tracking-tight text-slate-900">
            <LockIcon className="h-4 w-4 text-indigo-500" strokeWidth={2.4} />
            {name} PIN
          </h1>
          <p className="mt-1 text-[11.5px] font-semibold leading-relaxed text-slate-500">
            {name} 프로필은 4자리 PIN으로 잠겨 있어요.
            <br />
            PIN을 잊었다면 부모님께 초기화를 부탁해요.
          </p>
        </div>

        <div className="mt-7 flex items-center justify-center gap-3" aria-live="polite">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={index}
              data-testid={`child-pin-dot-${index}`}
              className={cx(
                'h-3.5 w-3.5 rounded-full transition',
                index < digits.length ? 'scale-110 bg-indigo-600' : 'bg-slate-200',
              )}
            />
          ))}
        </div>

        <p
          data-testid="child-pin-error"
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
              data-testid={`child-pin-key-${key}`}
              onClick={() => press(key)}
              disabled={pending}
              className="h-14 rounded-2xl bg-white text-[20px] font-extrabold text-slate-800 shadow-sm ring-1 ring-slate-900/5 transition active:scale-[0.96] disabled:opacity-50"
            >
              {key}
            </button>
          ))}
          <span aria-hidden className="h-14" />
          <button
            type="button"
            data-testid="child-pin-key-0"
            onClick={() => press('0')}
            disabled={pending}
            className="h-14 rounded-2xl bg-white text-[20px] font-extrabold text-slate-800 shadow-sm ring-1 ring-slate-900/5 transition active:scale-[0.96] disabled:opacity-50"
          >
            0
          </button>
          <button
            type="button"
            data-testid="child-pin-key-del"
            aria-label="지우기"
            onClick={() => press('del')}
            disabled={pending}
            className="h-14 rounded-2xl bg-slate-100 text-[12px] font-extrabold text-slate-500 transition active:scale-[0.96] disabled:opacity-50"
          >
            지우기
          </button>
        </div>

        {pending ? <p className="mt-4 text-center text-[11px] font-bold text-indigo-500">확인 중…</p> : null}
      </div>
    </div>
  );
}
