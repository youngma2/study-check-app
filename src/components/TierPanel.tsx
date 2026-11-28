import { useState } from 'react';
import { boxRewardFor, reachedStreakBonus, nextStreakBonus } from '../lib/app-settings';
import { boxPointPrize } from '../lib/shop';
import { cx } from '../lib/cx';
import { formatShortDate, toISODate } from '../lib/date';
import type { TierEvent } from '../lib/rewards';
import { DIVISIONS, formatXp, levelForXp } from '../lib/season';
import { useStudy } from '../lib/study-context';
import type { Member } from '../lib/types';
import { RewardGiftModal } from './RewardGiftModal';
import { TIER_LABEL, TierEmblem } from './TierBadge';

/**
 * 🏆 아이 카드 안의 시즌 스트립 — 지금 티어·XP 게이지·🔥 연속 100%·🎁 뽑기 상자.
 * 티어가 오르면 여기 배지와 이름 옆 아이콘이 저절로 바뀝니다.
 */
export function TierPanel({ member }: { member: Member }) {
  const study = useStudy();
  const stats = study.seasonStatsFor(member.id);
  const lastSeason = study.lastSeasonFor(member.id);
  /** 🎁 3택1 팝업 — 지금 열고 있는 상자 */
  const [gift, setGift] = useState<TierEvent | null>(null);

  if (member.role !== 'child' || !stats) return null;

  const { level, xp } = stats;
  const span = level.nextXp === null ? 1 : Math.max(level.nextXp - level.minXp, 1);
  const ratio = level.nextXp === null ? 1 : Math.min(1, Math.max(0, (xp - level.minXp) / span));
  const remaining = level.nextXp === null ? 0 : Math.max(level.nextXp - xp, 0);
  const boxes = study
    .tierEventsFor(member.id)
    .filter((event) => event.season === stats.season && event.box_minutes !== null)
    .reverse();
  const unopened = boxes.filter((box) => !box.opened_at).length;
  /** ⑤ 연속 달성 — 지금까지 채운 기준·다음 기준 */
  const streakReached = reachedStreakBonus(stats.streak, study.appSettings.streakBonuses);
  const streakNext = nextStreakBonus(stats.streak, study.appSettings.streakBonuses);

  return (
    <div
      data-testid={`tier-panel-${member.id}`}
      className="mt-2 rounded-2xl bg-gradient-to-br from-slate-50 to-white p-2.5 ring-1 ring-slate-900/5"
    >
      <div className="flex items-center gap-2">
        <TierEmblem tier={level.key} division={level.division} size="md" label={member.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span data-testid={`tier-title-${member.id}`} className="text-[12.5px] font-extrabold leading-none text-slate-900">
              {level.title}
            </span>
            <span data-testid={`tier-xp-${member.id}`} className="text-[10px] font-extrabold text-slate-400">
              {formatXp(xp)} XP
            </span>
            {stats.streak > 0 ? (
              <span
                data-testid={`streak-${member.id}`}
                className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-orange-600 ring-1 ring-orange-200/70"
              >
                🔥 달성률 100% {stats.streak}일차
              </span>
            ) : null}
            {lastSeason ? (
              <span
                data-testid={`last-season-${member.id}`}
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-500"
                title={`${lastSeason.season} 최고 기록 ${formatXp(lastSeason.xp)} XP`}
              >
                지난달 {lastSeason.level.title}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/90">
              <span
                data-testid={`tier-gauge-${member.id}`}
                className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-[width] duration-500"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="shrink-0 text-[9px] font-bold tabular-nums text-slate-400">
              {level.nextXp === null
                ? '최고 티어'
                : `${levelForXp(level.nextXp, study.appSettings.tierDifficulty).title}까지 ${formatXp(remaining)} XP`}
            </span>
          </div>

          {/* ⚖️ 완료 시점별 XP — 아이가 카드에서 바로 비율을 봅니다. */}
          <div data-testid={`xp-rule-${member.id}`} className="mt-1 space-y-0.5 text-[9px] font-bold leading-none text-slate-400">
            <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <span className="font-extrabold">⚖️ 완료 XP</span>
              <span className="text-indigo-500">당일 100%</span>
              <span className="text-slate-300">·</span>
              <span className="text-amber-600">하루 지남 50%</span>
              <span className="text-slate-300">·</span>
              <span className="text-rose-500">2일+ 25%</span>
              {stats.lateVerified > 0 ? (
                <span className="ml-auto shrink-0 rounded-full bg-amber-50 px-1 py-0.5 text-[8.5px] font-extrabold text-amber-700 ring-1 ring-amber-200/80">
                  이번 달 지연 {stats.lateVerified}개
                </span>
              ) : null}
            </p>
            <p>↺ 되돌리면 그 XP 와 그날 100% 보너스까지 회수</p>
          </div>

          {/* ⑤ 연속 달성 보너스 — 🐣 쪼꼬가 축하 한마디를 남깁니다. */}
          {streakReached ? (
            <div
              data-testid={`streak-congrats-${member.id}`}
              className="mt-1.5 rounded-xl bg-orange-50 px-2 py-1.5 text-[9.5px] font-extrabold leading-relaxed text-orange-700 ring-1 ring-orange-200/80"
            >
              🐣 쪼꼬: {member.name}, <b className="font-extrabold">{streakReached.day}일 연속</b> 100% 달성!
              보너스 +{formatXp(streakReached.xp)} XP 🎉
            </div>
          ) : streakNext ? (
            <p data-testid={`streak-next-${member.id}`} className="mt-1 text-[9px] font-bold text-slate-400">
              🎁 {streakNext.day}일 연속까지 {streakNext.day - stats.streak}일 · 보너스 +
              {formatXp(streakNext.xp)} XP
            </p>
          ) : null}
        </div>
      </div>

      {boxes.length > 0 ? (
        <div className="mt-2 border-t border-slate-900/5 pt-2">
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[9.5px] font-extrabold tracking-wide text-slate-400">🎁 뽑기 상자</p>
            <p className="text-[9px] font-bold text-slate-400">
              {unopened > 0 ? `${unopened}개 남음 · 눌러서 열기` : '큰 티어 승급마다 1개'}
            </p>
          </div>
          <div className="no-scrollbar mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {boxes.map((box) => (
              <RewardBox key={box.id} event={box} onOpenGift={() => setGift(box)} />
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 border-t border-slate-900/5 pt-2 text-[9.5px] font-bold text-slate-400">
          🎁 큰 티어(실버·골드·플래티넘·다이아·마스터)로 올라가면 뽑기 상자가 열려요
        </p>
      )}

      {gift ? <RewardGiftModal event={gift} memberName={member.name} onClose={() => setGift(null)} /> : null}
    </div>
  );
}

/**
 * 상단에 늘 보이는 한 줄 시즌 바 — 아이 화면에서 자기 티어·XP·연속 100%·남은 상자를 바로 봅니다.
 */
export function SeasonBar({ memberId }: { memberId: string }) {
  const study = useStudy();
  /** 🎁 위쪽 배지를 눌러도 3택1 팝업이 바로 열립니다 */
  const [gift, setGift] = useState<TierEvent | null>(null);
  const stats = study.seasonStatsFor(memberId);
  if (!stats) return null;

  const { level, xp } = stats;
  const span = level.nextXp === null ? 1 : Math.max(level.nextXp - level.minXp, 1);
  const ratio = level.nextXp === null ? 1 : Math.min(1, Math.max(0, (xp - level.minXp) / span));
  const unopenedEvents = study
    .tierEventsFor(memberId)
    .filter((event) => event.season === stats.season && event.box_minutes !== null && !event.opened_at);
  const unopened = unopenedEvents.length;

  return (
    <div data-testid="season-bar" className="mx-auto flex w-full max-w-md items-center gap-1.5 px-4 pb-2">
      <TierEmblem tier={level.key} division={level.division} size="sm" />
      <span data-testid="season-bar-title" className="shrink-0 text-[11px] font-extrabold leading-none text-slate-800">
        {level.title}
      </span>
      <span className="shrink-0 text-[9.5px] font-bold leading-none text-slate-400">{formatXp(xp)} XP</span>
      <span className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-slate-200/90">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-[width] duration-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      {stats.streak > 0 ? (
        <span
          data-testid="season-bar-streak"
          title={`달성률 100% ${stats.streak}일차 (주말·공휴일 제외)`}
          className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-orange-600 ring-1 ring-orange-200/70"
        >
          🔥 {stats.streak}일차
        </span>
      ) : null}
      {unopened > 0 ? (
        <button
          type="button"
          data-testid="season-bar-box"
          onClick={() => setGift(unopenedEvents[0])}
          title="뽑기 상자가 기다려요 — 눌러서 열기"
          className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-violet-600 ring-1 ring-violet-200/70 transition active:scale-90"
        >
          🎁 {unopened}
        </button>
      ) : null}

      {gift ? (
        <RewardGiftModal
          event={gift}
          memberName={study.members.find((member) => member.id === memberId)?.name ?? ''}
          onClose={() => setGift(null)}
        />
      ) : null}
    </div>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatShortDate(toISODate(date)).replace(/\s*\(.\)$/, '');
}

/** 한 칸 = 승급 한 번. 큰 티어 승급이면 🎁 3택1 팝업이 열립니다. */
function RewardBox({ event, onOpenGift }: { event: TierEvent; onOpenGift: () => void }) {
  const study = useStudy();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prize = (() => {
    if (event.opened_at) {
      const frozen = boxPointPrize(study.db.tasks, event.id);
      if (frozen !== null) return { kind: 'points' as const, value: frozen };
      return { kind: 'minutes' as const, value: event.box_minutes ?? 0 };
    }
    return boxRewardFor(study.appSettings.boxRewards, event.id, event.box_minutes);
  })();
  const unit = prize.kind === 'points' ? 'P' : '분';
  const opened = event.opened_at !== null;
  const tierLabel = `${TIER_LABEL[event.tier]}${event.division >= 1 && event.division <= 3 ? ` ${DIVISIONS[event.division]}` : ''}`;

  const markUsed = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await study.useReward(event.id);
    setBusy(false);
    if (!result.ok) setError(result.error ?? '사용 완료로 바꾸지 못했어요');
  };

  return (
    <div
      data-testid={`reward-box-${event.id}`}
      className={cx(
        'relative w-[100px] shrink-0 overflow-hidden rounded-xl px-2 py-1.5 text-center ring-1 transition',
        opened
          ? 'bg-gradient-to-b from-amber-50 to-white ring-amber-200/80'
          : 'bg-gradient-to-b from-violet-50 to-white ring-violet-200/70',
      )}
    >
      <p className="truncate text-[8.5px] font-extrabold text-slate-400">
        {shortDate(event.created_at)} · {tierLabel}
      </p>

      {opened ? (
        <div className="animate-reward-pop">
          <p className="mt-0.5 text-[15px] font-extrabold leading-none text-amber-600">
            +{prize.value}
            {unit}
          </p>
          <p className="mt-0.5 text-[8.5px] font-bold text-amber-500/90">
            {prize.kind === 'points' ? '화폐 포인트' : '게임 시간'}
          </p>
          {prize.kind === 'points' ? (
            <p className="mt-1 rounded-full bg-emerald-50 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70">
              {study.isParent ? '적립 완료' : '정리 완료'}
            </p>
          ) : event.used_at ? (
            <p className="mt-1 rounded-full bg-emerald-50 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70">
              {study.isParent ? '적립 완료' : '정리 완료'}
            </p>
          ) : study.isParent ? (
            <button
              type="button"
              data-testid={`reward-use-${event.id}`}
              onClick={markUsed}
              disabled={busy}
              className="mt-1 w-full rounded-full bg-slate-900 py-0.5 text-[8.5px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
            >
              사용 완료
            </button>
          ) : (
            <p className="mt-1 rounded-full bg-amber-100 py-0.5 text-[8.5px] font-extrabold text-amber-700">정리 완료</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-testid={`reward-open-${event.id}`}
          onClick={onOpenGift}
          className="mt-0.5 flex w-full flex-col items-center"
          aria-label={`${tierLabel} 승급 뽑기 상자 열기 — 상자 3개 중 고르기`}
        >
          <span className="animate-box-idle text-[22px] leading-none" aria-hidden>
            🎁
          </span>
          <span className="mt-0.5 text-[8.5px] font-extrabold text-violet-500">눌러서 열기</span>
        </button>
      )}

      {error ? <p className="mt-0.5 text-[8px] font-bold leading-tight text-rose-500">{error}</p> : null}
    </div>
  );
}
