import { useCallback, useEffect, useRef, useState } from 'react';
import { RewardGiftModal } from './RewardGiftModal';
import { DemoStudyProvider } from '../lib/demo-context';
import { koreaTodayISO } from '../lib/date';
import type { TierEvent } from '../lib/rewards';
import { DEFAULT_REWARD_POOL, pickRewardMinutes, seasonOf } from '../lib/season';
import type { ActionResult } from '../lib/study-context';

/**
 * 🧪 체험용 데모 페이지 (demo.html)
 *
 * 영민님이 폰에서 3택1 뽑기 상자를 직접 눌러 보는 화면입니다.
 * 실제 앱의 RewardGiftModal 을 **그대로** 띄우되,
 * · Supabase RPC(study_open_reward 등)·실제 가족 DB 로 가는 요청은 **한 번도 보내지 않고**
 * · localStorage 같은 기기 저장도 쓰지 않습니다(뽑은 기록은 화면에만).
 */

/** 공개 시드와 같은 이름 — 실제 아이 이름은 넣지 않습니다. */
const MEMBER_NAME = '둘째';
const MEMBER_ID = 'mem_child2';
/** 큰 티어 중 하나로 승급한 순간을 흉내 냅니다(골드 III). */
const RANK = 3;

interface DrawRecord {
  id: string;
  minutes: number;
  at: string;
}

function makeEvent(round: number): TierEvent {
  return {
    id: `demo_box_${round}_${Date.now()}`,
    family_id: 'fam_demo',
    member_id: MEMBER_ID,
    season: seasonOf(koreaTodayISO()),
    tier: 'gold',
    tier_rank: RANK,
    level: 6,
    division: 3,
    box_minutes: pickRewardMinutes(DEFAULT_REWARD_POOL, RANK),
    created_at: new Date().toISOString(),
    opened_at: null,
    used_at: null,
    used_by: null,
  };
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds(),
  ).padStart(2, '0')}`;
}

export function DemoGiftPage() {
  const eventRef = useRef<TierEvent | null>(null);
  const roundRef = useRef(0);
  const autoOpened = useRef(false);

  const [event, setEventState] = useState<TierEvent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [draws, setDraws] = useState<DrawRecord[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const setEvent = useCallback((next: TierEvent | null) => {
    eventRef.current = next;
    setEventState(next);
  }, []);

  const notify = useCallback((message: string) => {
    // 팝업이 실제 앱과 같은 문구를 쓰므로, 체험 페이지에서는 '저장 안 됨'을 분명히 해 둡니다.
    const text = message.startsWith('적립 완료로 기록')
      ? '적립 완료로 표시했어요 (체험용 · 저장 안 됨)'
      : message;
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  /** 상자 새로 차리기 — 누를 때마다 새 뽑기(다른 시간이 나올 수 있어요). */
  const openBox = useCallback(() => {
    roundRef.current += 1;
    setEvent(makeEvent(roundRef.current));
    setRound(roundRef.current);
    setModalOpen(true);
  }, [setEvent]);

  // 접속하자마자 한 번 자동으로 열립니다(폰에서 바로 눌러 볼 수 있게).
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    const timer = window.setTimeout(openBox, 450);
    return () => window.clearTimeout(timer);
  }, [openBox]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const handleOpenReward = useCallback(
    async (eventId: string): Promise<ActionResult> => {
      const current = eventRef.current;
      if (!current || current.id !== eventId) return { ok: true };
      const at = new Date().toISOString();
      const minutes = current.box_minutes ?? 0;
      setEvent({ ...current, opened_at: at });
      setDraws((list) => [{ id: eventId, minutes, at }, ...list].slice(0, 5));
      return { ok: true };
    },
    [setEvent],
  );

  const handleUseReward = useCallback(
    async (eventId: string): Promise<ActionResult> => {
      const current = eventRef.current;
      if (current && current.id === eventId) {
        setEvent({ ...current, used_at: new Date().toISOString(), used_by: 'mem_demo' });
      }
      return { ok: true };
    },
    [setEvent],
  );

  return (
    <div data-testid="demo-page" className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-amber-50/50 px-4 pb-10 pt-[66px]">
      {/* 🧪 체험 모드 배너 — 팝업이 열려 있어도 가려지지 않게 맨 위에 고정합니다. */}
      <div className="fixed inset-x-0 top-0 z-[65] px-4 pt-2">
        <div
          data-testid="demo-banner"
          role="status"
          className="mx-auto max-w-[420px] rounded-2xl bg-amber-400 px-3 py-2 text-center text-[11.5px] font-extrabold leading-snug text-amber-950 shadow-sm ring-1 ring-amber-500/30"
        >
          🧪 체험용 데모 모드 · 실제 가족 기록에는 저장되지 않습니다
        </div>
      </div>

      <div className="mx-auto w-full max-w-[420px]">
        <header className="rounded-[26px] bg-white p-4 shadow-card ring-1 ring-slate-900/5">
          <p className="text-[10px] font-extrabold tracking-wide text-violet-400">🎁 3택1 뽑기 상자</p>
          <h1 className="mt-1 text-[19px] font-extrabold leading-tight tracking-tight text-slate-900">
            상자 3개 중 하나를 골라 봐!
          </h1>
          <p className="mt-2 text-[12px] font-semibold leading-relaxed text-slate-500">
            큰 티어(실버·골드…)로 승급할 때 나오는 상자예요. 진동 · 효과음(🔊/🔇) · 폭죽 · 나머지 두 상자
            공개까지 <span className="font-extrabold text-slate-700">실제 앱과 똑같이</span> 움직입니다.
          </p>

          <button
            type="button"
            data-testid="demo-open"
            onClick={openBox}
            className="mt-3.5 w-full rounded-2xl bg-violet-600 py-3.5 text-[14px] font-extrabold text-white shadow-lg shadow-violet-500/30 transition active:scale-[0.98]"
          >
            🎁 {round === 0 ? '뽑기 상자 열어보기' : '다시 뽑아보기'}
          </button>
          <p className="mt-2 text-center text-[10.5px] font-bold text-slate-400">
            {round === 0
              ? '잠시 뒤 자동으로 한 번 열려요'
              : `지금까지 ${round}번 열어봤어요 · 몇 번이든 다시 해볼 수 있어요`}
          </p>
        </header>

        {draws.length > 0 ? (
          <section
            data-testid="demo-history"
            className="mt-3 rounded-[24px] bg-white p-4 shadow-card ring-1 ring-slate-900/5"
          >
            <p className="text-[10px] font-extrabold tracking-wide text-slate-400">
              이번 체험에서 뽑은 기록 · 화면에만 남아요
            </p>
            <ul className="mt-2 space-y-1.5">
              {draws.map((draw) => (
                <li
                  key={draw.id}
                  data-testid="demo-history-row"
                  className="flex items-center justify-between rounded-xl bg-amber-50/70 px-3 py-2 ring-1 ring-amber-200/60"
                >
                  <span className="text-[12.5px] font-extrabold text-amber-700">+{draw.minutes}분</span>
                  <span className="text-[10.5px] font-bold text-slate-400">{timeLabel(draw.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-3 rounded-[24px] bg-white p-4 shadow-card ring-1 ring-slate-900/5">
          <p className="text-[10px] font-extrabold tracking-wide text-slate-400">이렇게 움직여요</p>
          <ul className="mt-2 space-y-1.5 text-[11.5px] font-semibold leading-relaxed text-slate-600">
            <li>· 상자를 누르면 톡 — 진동 15 · 나무 두드리는 소리</li>
            <li>· 여는 동안 상자가 흔들리고 두근두근 소리·진동</li>
            <li>· 당첨: 팡파레 · 짜릿한 진동 · 폭죽 + 나머지 두 상자도 살짝 열림</li>
            <li>· 오른쪽 위 🔊/🔇 로 효과음을 끄고 켤 수 있어요</li>
            <li>· 부모 화면처럼 ‘적립 완료’ 버튼도 눌러볼 수 있어요(저장 안 됨)</li>
          </ul>
          <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[10.5px] font-bold text-slate-500">
            나올 수 있는 시간: {DEFAULT_REWARD_POOL.map((value) => `+${value}분`).join(' · ')}
          </p>
        </section>

        <a
          href={import.meta.env.BASE_URL}
          className="mt-4 block rounded-2xl bg-slate-900 py-3 text-center text-[12px] font-extrabold text-white transition active:scale-[0.99]"
        >
          공부 체크 앱 열기 →
        </a>
        <p className="mt-3 text-center text-[10px] font-semibold leading-relaxed text-slate-400">
          이 페이지는 체험용입니다. 여기서 눌러도 우리 가족 공부 기록·뽑기 기록은 하나도 바뀌지 않아요.
        </p>
      </div>

      {toast ? (
        <div
          data-testid="demo-toast"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-6"
        >
          <span className="animate-toast-in rounded-full bg-slate-900/90 px-3.5 py-1.5 text-[11px] font-extrabold text-white shadow-lg">
            {toast}
          </span>
        </div>
      ) : null}

      {modalOpen && event ? (
        <DemoStudyProvider openReward={handleOpenReward} useReward={handleUseReward}>
          <RewardGiftModal
            event={event}
            memberName={MEMBER_NAME}
            onClose={() => setModalOpen(false)}
            onNotify={notify}
          />
        </DemoStudyProvider>
      ) : null}
    </div>
  );
}
