import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { formatShortDate, toISODate } from '../lib/date';
import {
  vibrateRewardOpening,
  vibrateRewardPeek,
  vibrateRewardPick,
  vibrateRewardWin,
} from '../lib/haptics';
import {
  isRewardSoundOn,
  playBoxFanfare,
  playBoxPeek,
  playBoxShake,
  playBoxTap,
  playBoxTense,
  playSoundToggle,
  setRewardSoundOn,
  unlockRewardAudio,
} from '../lib/reward-sound';
import { DEFAULT_BOX_REWARDS, boxRewardFor, type BoxReward } from '../lib/app-settings';
import type { TierEvent } from '../lib/rewards';
import { boxPointPrize } from '../lib/shop';
import { useStudy } from '../lib/study-context';
import { DIVISIONS } from '../lib/season';
import { TIER_LABEL } from './TierBadge';
import { XIcon } from './icons';

/**
 * 🎁 3택1 뽑기 상자 팝업.
 *
 * 상자가 열리면 화면 가운데에 창이 하나 뜨고, 상자 3개 중 하나를 고릅니다.
 * · 고를 때: 톡(진동 15) + 나무 두드리는 소리
 * · 여는 동안: 상자가 흔들리고 틱틱·두근두근 소리와 진동
 * · 당첨: 팡파레 + 짜릿한 진동 + 반짝이·폭죽, 그리고 나머지 두 상자도 살짝 열려
 *   "다른 상자엔 +5분, +20분이 있었어요!" 를 보여 줍니다.
 *
 * 실제 저장되는 값(box_minutes)은 승급할 때 이미 정해져 있어서,
 * 어느 상자를 골라도 그 값이 당첨이 됩니다(서버·기기 모두 같은 값 — 새로고침해도 그대로).
 */

/** 당첨 값 외에 나머지 상자에 보여 줄 보상 — 보상 목록에서 서로 다른 것 count 개 */
function pickOtherRewards(rewards: BoxReward[], won: BoxReward, count: number): BoxReward[] {
  const list = rewards.length > 0 ? rewards : DEFAULT_BOX_REWARDS;
  const pool = [...list];
  const picked: BoxReward[] = [];
  let guard = 0;
  while (picked.length < count && guard < 40) {
    guard += 1;
    if (pool.length === 0) pool.push(...list);
    const index = Math.floor(Math.random() * pool.length);
    const [item] = pool.splice(index, 1);
    // 같은 분·P 값이 이미 보여 준 것과 같으면 건너뜁니다(다른 값도 섞어 보여 줍니다).
    if (item.kind === won.kind && item.value === won.value) continue;
    picked.push(item);
  }
  while (picked.length < count) picked.push(won);
  return picked;
}

function rewardLabel(reward: BoxReward): string {
  return `+${reward.value}${reward.kind === 'points' ? 'P' : '분'}`;
}

interface RewardGiftModalProps {
  event: TierEvent;
  memberName: string;
  onClose: () => void;
  /** 화면 위 짧은 안내(토스트) */
  onNotify?: (message: string) => void;
}

type Stage = 'choose' | 'opening' | 'revealed';

export function RewardGiftModal({ event, memberName, onClose, onNotify }: RewardGiftModalProps) {
  const study = useStudy();
  const [stage, setStage] = useState<Stage>('choose');
  const [picked, setPicked] = useState<number | null>(null);
  const [others, setOthers] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState<boolean>(() => isRewardSoundOn());
  const [markingUsed, setMarkingUsed] = useState(false);
  const [used, setUsed] = useState<boolean>(Boolean(event.used_at));
  const timers = useRef<number[]>([]);
  const alive = useRef(true);

  /** 이 상자의 보상 — 분 또는 화폐 포인트(P).
   *  이미 연 상자는 그때 정산된 값을 그대로 보여 줍니다(보상 목록을 고쳐도 과거 상자는 안 바뀜). */
  const frozenPoints = event.opened_at ? boxPointPrize(study.db.tasks, event.id) : null;
  const won: { kind: 'minutes' | 'points'; value: number } =
    frozenPoints !== null
      ? { kind: 'points', value: frozenPoints }
      : event.opened_at
        ? { kind: 'minutes', value: event.box_minutes ?? 0 }
        : boxRewardFor(study.appSettings.boxRewards, event.id, event.box_minutes);
  const wonReward: BoxReward = { id: 'won', kind: won.kind, value: won.value };
  /** ⑦ 옵션에서 고른 뽑기 상자 개수 (1~5) — 비어 있는 상자는 보상 목록에서 무작위로 채웁니다. */
  const boxCount = Math.max(1, Math.min(5, Math.round(study.appSettings.boxCount || 3)));
  const isPoints = won.kind === 'points';
  const unit = isPoints ? 'P' : '분';
  const tierLabel = `${TIER_LABEL[event.tier]}${
    event.division >= 1 && event.division <= 3 ? ` ${DIVISIONS[event.division]}` : ''
  }`;
  const dateLabel = formatShortDate(toISODate(new Date(event.created_at))).replace(/\s*\(.\)$/, '');
  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  // 📱 뒤로가기 → 상자 창만 닫기(여는 중에는 닫지 않음)
  useOverlayBack(true, () => {
    if (stage === 'opening') return;
    onClose();
  });

  useEffect(() => {
    alive.current = true;
    // 뒤로 가기·다른 창이 떠도 안전하게: 이 창이 열려 있는 동안은 배경 스크롤을 잠급니다.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stage !== 'opening') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      alive.current = false;
      clearTimers();
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
    // stage 는 ESC 만 막는 데 쓰므로 의존성에서 빼도 됩니다(열릴 때 한 번 등록).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  const choose = (index: number) => {
    if (stage !== 'choose') return;
    unlockRewardAudio();
    vibrateRewardPick();
    playBoxTap();

    setPicked(index);
    setStage('opening');
    setError(null);

    const otherList = pickOtherRewards(study.appSettings.boxRewards, wonReward, boxCount - 1).map(rewardLabel);
    setOthers(otherList);

    // 두근두근 — 흔들림·심장 소리·짧은 진동
    later(100, () => {
      if (!alive.current) return;
      vibrateRewardOpening();
      playBoxShake();
    });
    later(620, () => {
      if (!alive.current) return;
      playBoxTense();
    });

    // 저장은 연출과 동시에 시작하고, 결과가 오면 그 값을 당첨으로 확정합니다.
    void study.openReward(event.id).then((result) => {
      if (!alive.current) return;
      if (!result.ok) {
        clearTimers();
        setStage('choose');
        setPicked(null);
        setOthers(null);
        setError(result.error ?? '상자를 열지 못했어요');
        return;
      }
      later(1000, () => {
        if (!alive.current) return;
        setStage('revealed');
        vibrateRewardWin();
        playBoxFanfare();
      });
      later(1700, () => {
        if (!alive.current) return;
        vibrateRewardPeek();
        playBoxPeek();
      });
    });
  };

  const toggleSound = () => {
    const next = !soundOn;
    setRewardSoundOn(next);
    setSoundOn(next);
    unlockRewardAudio();
    playSoundToggle(next);
    onNotify?.(next ? '효과음 켜짐' : '효과음 꺼짐');
  };

  const markUsed = async () => {
    if (markingUsed || used) return;
    setMarkingUsed(true);
    const result = await study.useReward(event.id);
    setMarkingUsed(false);
    if (!result.ok) {
      onNotify?.(result.error ?? '적립 완료로 바꾸지 못했어요');
      return;
    }
    setUsed(true);
    if (soundOn) playBoxPeek();
    onNotify?.('적립 완료로 기록했어요');
  };

  const othersText =
    others && picked !== null
      ? `다른 상자엔 ${others.join(', ')}가 있었어요!`
      : '';

  return (
    <div
      data-testid="reward-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${memberName} 뽑기 상자`}
    >
      <button
        type="button"
        aria-label="닫기"
        onClick={() => {
          if (stage === 'opening') return;
          onClose();
        }}
        className="absolute inset-0 animate-fade-in cursor-default bg-slate-900/55 backdrop-blur-sm"
      />

      <div
        className={cx(
          'relative w-full max-w-[360px] overflow-hidden rounded-[28px] bg-gradient-to-b from-white via-white to-violet-50/70 px-4 pb-4 pt-3 shadow-2xl ring-1 ring-slate-900/10',
          stage === 'revealed' ? 'animate-gift-pop' : 'animate-gift-in',
        )}
      >
        {/* 반짝이·폭죽 — 열린 뒤에만 */}
        {stage === 'revealed' ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {Array.from({ length: 14 }, (_, index) => (
              <span
                key={index}
                className="animate-confetti absolute top-0 block h-1.5 w-1.5 rounded-sm"
                style={{
                  left: `${6 + index * 6.6}%`,
                  backgroundColor: ['#f59e0b', '#8b5cf6', '#ec4899', '#10b981', '#3b82f6', '#ef4444'][index % 6],
                  animationDelay: `${(index % 7) * 90}ms`,
                  animationDuration: `${1100 + (index % 5) * 180}ms`,
                }}
              />
            ))}
            <span className="animate-sparkle absolute left-1/2 top-6 -translate-x-1/2 text-[18px]">✨</span>
            <span className="animate-sparkle absolute left-6 top-16 text-[14px] [animation-delay:150ms]">✨</span>
            <span className="animate-sparkle absolute right-7 top-12 text-[15px] [animation-delay:260ms]">✨</span>
          </div>
        ) : null}

        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-wide text-violet-400">
              🎁 {memberName} · {dateLabel} {tierLabel} 승급
            </p>
            <h2 className="mt-0.5 text-[16px] font-extrabold tracking-tight text-slate-900">
              {stage === 'choose'
                ? `뽑기 상자 ${boxCount}개 중 하나를 골라!`
                : stage === 'opening'
                  ? '두근두근…'
                  : '짜잔!'}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="reward-mute"
              onClick={toggleSound}
              aria-label={soundOn ? '효과음 끄기' : '효과음 켜기'}
              aria-pressed={soundOn}
              className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-[12px] text-slate-500 transition active:scale-90"
            >
              {soundOn ? '🔊' : '🔇'}
            </button>
            <button
              type="button"
              data-testid="reward-modal-close"
              onClick={() => {
                if (stage === 'opening') return;
                onClose();
              }}
              disabled={stage === 'opening'}
              aria-label="뽑기 상자 창 닫기"
              className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-500 transition active:scale-90 disabled:opacity-40"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${boxCount}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: boxCount }, (_, index) => {
            const isPicked = picked === index;
            const isOpen = stage === 'revealed';
            const otherIndex = picked === null ? 0 : index < picked ? index : index - 1;
            const otherValue = others ? others[otherIndex] : '';
            return (
              <button
                key={index}
                type="button"
                data-testid={`reward-gift-${index}`}
                onClick={() => choose(index)}
                disabled={stage !== 'choose'}
                aria-label={
                  isPicked && isOpen ? `고른 상자 — ${rewardLabel(wonReward)}` : `뽑기 상자 ${index + 1} 고르기`
                }
                className={cx(
                  'relative flex aspect-[4/5] flex-col items-center justify-center rounded-2xl text-center ring-1 transition',
                  isPicked && isOpen
                    ? 'bg-gradient-to-b from-amber-50 to-white ring-2 ring-amber-300 shadow-[0_0_22px_rgba(245,158,11,0.35)]'
                    : 'bg-gradient-to-b from-violet-50 to-white ring-violet-200/80',
                  stage === 'choose' ? 'active:scale-95 hover:ring-violet-300' : '',
                  isPicked && stage === 'opening' ? 'animate-box-shake ring-2 ring-violet-400' : '',
                )}
              >
                {isOpen && isPicked ? (
                  <span className="animate-reward-pop px-1">
                    <span
                      data-testid="reward-win-minutes"
                      className="block text-[22px] font-extrabold leading-none text-amber-600"
                    >
                      +{wonReward.value}{unit}
                    </span>
                    <span className="mt-1 block text-[9.5px] font-extrabold text-amber-500">
                      {isPoints ? '화폐 포인트' : '게임 시간'}
                    </span>
                  </span>
                ) : isOpen ? (
                  <span className="animate-peek px-1 opacity-80">
                    <span className="block text-[15px] font-extrabold leading-none text-slate-500">{otherValue}</span>
                    <span className="mt-1 block text-[8px] font-bold text-slate-400">다른 상자</span>
                  </span>
                ) : (
                  <>
                    <span
                      aria-hidden
                      className={cx(
                        'text-[30px] leading-none',
                        isPicked && stage === 'opening' ? 'animate-box-shake' : 'animate-box-idle',
                      )}
                    >
                      🎁
                    </span>
                    <span className="mt-1 block text-[9.5px] font-extrabold text-violet-500">
                      {isPicked && stage === 'opening' ? '여는 중…' : `${index + 1}번`}
                    </span>
                  </>
                )}
                {isPicked && stage === 'opening' ? (
                  <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="animate-sparkle absolute text-[14px]">✨</span>
                    <span className="animate-sparkle absolute text-[11px] [animation-delay:120ms]">✨</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-3 min-h-[52px] text-center">
          {stage === 'choose' ? (
            <p className="text-[11px] font-bold leading-relaxed text-slate-500">
              마음에 드는 상자를 눌러 봐.<br />
              <span className="text-[10px] font-semibold text-slate-400">
                {(study.appSettings.boxRewards.length > 0 ? study.appSettings.boxRewards : DEFAULT_BOX_REWARDS)
                  .map(rewardLabel)
                  .join(' · ')}{' '}
                중에서 나와요
              </span>
            </p>
          ) : null}

          {stage === 'opening' ? (
            <p data-testid="reward-opening" className="text-[11.5px] font-extrabold text-violet-500">
              어떤 상자가 나를 기다릴까…
            </p>
          ) : null}

          {stage === 'revealed' ? (
            <div data-testid="reward-result" className="space-y-1.5">
              <p className="text-[13px] font-extrabold text-slate-900">
                {memberName}, <span className="text-amber-600">+{wonReward.value}{unit}{isPoints ? '' : ' 게임 시간'}</span> 획득!
              </p>
              <p data-testid="reward-others" className="text-[10.5px] font-bold text-slate-500">
                {othersText}
              </p>
              {used ? (
                <p className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[9.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70">
                  적립 완료
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p data-testid="reward-modal-error" className="text-[10.5px] font-bold text-rose-500">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-1 flex gap-2">
          {stage === 'revealed' && study.isParent && !used && !isPoints ? (
            <button
              type="button"
              data-testid="reward-modal-use"
              onClick={markUsed}
              disabled={markingUsed}
              className="flex-1 rounded-2xl bg-slate-900 py-2.5 text-[11.5px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              적립 완료
            </button>
          ) : null}
          <button
            type="button"
            data-testid="reward-modal-done"
            onClick={onClose}
            disabled={stage === 'opening'}
            className="flex-1 rounded-2xl bg-violet-600 py-2.5 text-[11.5px] font-extrabold text-white shadow-lg shadow-violet-500/25 transition active:scale-[0.98] disabled:opacity-40"
          >
            {stage === 'revealed' ? '확인' : '닫기'}
          </button>
        </div>
      </div>
    </div>
  );
}
