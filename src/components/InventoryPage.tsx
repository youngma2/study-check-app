import { useMemo, useState } from 'react';
import { usedBonusMinutes } from '../lib/app-settings';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { formatNoteTime } from '../lib/notes';
import { unusedBonusMinutes } from '../lib/report';
import { boxPointPrize, pointEntriesFor, pointEntryKindLabel, pointPrizeEventIds, pointsFor } from '../lib/shop';
import { useStudy } from '../lib/study-context';
import { ArrowLeftIcon, CheckIcon, TrashIcon } from './icons';

/**
 * 🎒 인벤토리(보관함)
 *
 * 아이별로 모은 것들을 한곳에 모아 보여 줍니다.
 * · 모은/적립한 포인트(P) · 뽑은 포인트(P) · 뽑은 시간(분) · 상점에서 산 상품
 * · 다 쓴 상품·보상은 [사용 완료] 로 표시하고, 부모는 [정리] 로 목록에서 지울 수 있어요.
 *
 * 상품·포인트는 상점 장부(lib/shop.ts)의 '상점 줄', 시간·선물 상자는 티어 승급 기록(lib/rewards.ts)을
 * 그대로 읽습니다 — 새 표를 만들지 않습니다.
 */

interface InventoryPageProps {
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function InventoryPage({ onClose, onNotify }: InventoryPageProps) {
  const study = useStudy();
  useOverlayBack(true, onClose);

  const [childId, setChildId] = useState<string>(
    study.isParent ? study.children[0]?.id ?? '' : study.currentMember.id,
  );
  const [busy, setBusy] = useState(false);

  const child = study.children.find((member) => member.id === childId) ?? study.children[0];
  const viewer = study.isParent ? child : study.currentMember;
  const memberId = viewer?.id ?? study.currentMember.id;

  const entries = useMemo(() => pointEntriesFor(study.db.tasks, memberId), [study.db.tasks, memberId]);
  const balance = pointsFor(study.db.tasks, memberId);
  const earned = entries.filter((entry) => entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0);
  const spent = entries.filter((entry) => entry.delta < 0).reduce((sum, entry) => sum - entry.delta, 0);
  const prizePoints = entries
    .filter((entry) => entry.id.startsWith('pt_prize_'))
    .reduce((sum, entry) => sum + entry.delta, 0);

  const boxes = useMemo(
    () =>
      study
        .tierEventsFor(memberId)
        .filter((event) => event.opened_at && event.box_minutes !== null)
        .slice()
        .reverse(),
    [study, memberId],
  );
  const pointPrizes = pointPrizeEventIds(study.db.tasks);
  const receivedMinutes = boxes
    .filter((event) => !pointPrizes.has(event.id))
    .reduce((sum, event) => sum + (event.box_minutes ?? 0), 0);
  const usedMinutes = usedBonusMinutes(study.appSettings, memberId);
  const remainingMinutes = Math.max(
    0,
    unusedBonusMinutes(study.tierEvents, memberId, pointPrizes) - usedMinutes,
  );

  /** 상점에서 산 상품 — 구매 줄(제목이 🛒 로 시작)만 */
  const purchases = entries.filter((entry) => entry.delta < 0 && entry.task.title.startsWith('🛒'));

  const markUsed = async (entryId: string) => {
    if (busy) return;
    setBusy(true);
    const result = await study.setStatus(entryId, 'verified');
    setBusy(false);
    if (!result.ok) {
      onNotify(result.error ?? '사용 완료로 바꾸지 못했어요');
      return;
    }
    onNotify('사용 완료로 표시했어요');
  };

  const cleanupPurchase = async (entryId: string, label: string) => {
    if (!window.confirm(`'${label}' 을(를) 보관함에서 정리할까요? (산 기록은 지워집니다)`)) return;
    const result = await study.removeTask(entryId);
    onNotify(result.ok ? '보관함에서 정리했어요' : result.error ?? '정리하지 못했어요');
  };

  const markBoxUsed = async (eventId: string) => {
    if (busy) return;
    setBusy(true);
    const result = await study.useReward(eventId);
    setBusy(false);
    onNotify(result.ok ? '사용 완료로 기록했어요' : result.error ?? '바꾸지 못했어요');
  };

  return (
    <div data-testid="inventory-page" className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f6fa]">
      <div className="sticky top-0 z-10 bg-[#f5f6fa]/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-4 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="inventory-close"
              onClick={onClose}
              aria-label="보관함 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">🎒 보관함</h1>
              <p className="text-[9.5px] font-bold text-slate-400">모은 P · 뽑은 시간 · 산 상품을 한곳에</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2.5 px-4 pb-28 pt-1">
        {study.isParent ? (
          <section className="rounded-[22px] bg-white p-2.5 shadow-card ring-1 ring-slate-900/5">
            <div className="flex gap-1.5">
              {study.children.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  data-testid={`inventory-child-${member.id}`}
                  onClick={() => setChildId(member.id)}
                  className={cx(
                    'flex-1 rounded-2xl px-1 py-1.5 text-[10.5px] font-extrabold ring-1 transition active:scale-95',
                    member.id === memberId
                      ? 'bg-slate-900 text-white ring-slate-900'
                      : 'bg-slate-50 text-slate-600 ring-slate-200',
                  )}
                >
                  {member.emoji} {member.name}
                  <span className={cx('mt-0.5 block text-[9px] font-bold', member.id === memberId ? 'text-white/70' : 'text-slate-400')}>
                    {pointsFor(study.db.tasks, member.id)}P
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section
          data-testid="inventory-summary"
          className="rounded-[24px] bg-gradient-to-r from-indigo-600 to-violet-600 p-3.5 text-white shadow-lg shadow-indigo-500/25"
        >
          <p className="text-[10px] font-extrabold text-white/75">{viewer?.name ?? '아이'} 보관함</p>
          <p data-testid="inv-balance" className="mt-0.5 text-[26px] font-extrabold leading-none tabular-nums">
            {balance}P
          </p>
          <p className="mt-1 text-[9.5px] font-bold text-white/70">지금 쓸 수 있는 포인트</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded-xl bg-white/15 px-2 py-1.5">
              <p className="text-[8.5px] font-bold text-white/70">모은/적립 P</p>
              <p data-testid="inv-earned" className="text-[12.5px] font-extrabold tabular-nums">
                {earned}P
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-1.5">
              <p className="text-[8.5px] font-bold text-white/70">쓴 P</p>
              <p data-testid="inv-spent" className="text-[12.5px] font-extrabold tabular-nums">
                {spent}P
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-1.5">
              <p className="text-[8.5px] font-bold text-white/70">뽑은 P</p>
              <p data-testid="inv-prize-points" className="text-[12.5px] font-extrabold tabular-nums">
                {prizePoints}P
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-1.5">
              <p className="text-[8.5px] font-bold text-white/70">뽑은 시간</p>
              <p data-testid="inv-prize-minutes" className="text-[12.5px] font-extrabold tabular-nums">
                {receivedMinutes}분
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-1.5">
              <p className="text-[8.5px] font-bold text-white/70">쓴 시간</p>
              <p data-testid="inv-used-minutes" className="text-[12.5px] font-extrabold tabular-nums">
                {usedMinutes}분
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-1.5">
              <p className="text-[8.5px] font-bold text-white/70">남은 시간</p>
              <p data-testid="inv-remaining-minutes" className="text-[12.5px] font-extrabold tabular-nums">
                {remainingMinutes}분
              </p>
            </div>
          </div>
        </section>

        <section
          data-testid="inv-products"
          className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-slate-900">🛍 상점에서 산 상품</p>
            <span className="text-[9px] font-bold text-slate-400">{purchases.length}개</span>
          </div>
          {purchases.length === 0 ? (
            <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-center text-[10px] font-semibold text-slate-400">
              아직 산 상품이 없어요.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {purchases.map((entry) => (
                <li
                  key={entry.id}
                  data-testid={`inv-product-${entry.id}`}
                  className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cx(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px]',
                      entry.delivered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                    )}
                  >
                    {entry.delivered ? '✅' : '🕒'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-extrabold text-slate-700">{entry.label}</span>
                    <span className="mt-0.5 block text-[9px] font-semibold text-slate-400">
                      {formatNoteTime(entry.created_at)} · {Math.abs(entry.delta)}P · {pointEntryKindLabel(entry)}
                    </span>
                  </span>
                  {entry.delivered ? (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70">
                      {study.isParent ? '적립 완료' : '정리 완료'}
                    </span>
                  ) : study.isParent ? (
                    <button
                      type="button"
                      data-testid={`inv-product-use-${entry.id}`}
                      disabled={busy}
                      onClick={() => void markUsed(entry.id)}
                      className="shrink-0 rounded-full bg-slate-900 px-2 py-1 text-[8.5px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
                    >
                      사용 완료
                    </button>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber-700 ring-1 ring-amber-200/70">
                      지급 대기
                    </span>
                  )}
                  {study.isParent ? (
                    <button
                      type="button"
                      data-testid={`inv-product-delete-${entry.id}`}
                      onClick={() => void cleanupPurchase(entry.id, entry.label)}
                      aria-label={`${entry.label} 정리`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          data-testid="inv-boxes"
          className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-slate-900">🎁 선물 상자에서 뽑은 것</p>
            <span className="text-[9px] font-bold text-slate-400">{boxes.length}개</span>
          </div>
          {boxes.length === 0 ? (
            <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-center text-[10px] font-semibold text-slate-400">
              아직 연 선물 상자가 없어요.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {boxes.map((event) => {
                const frozen = boxPointPrize(study.db.tasks, event.id);
                const isPoints = frozen !== null;
                const value = isPoints ? frozen : event.box_minutes ?? 0;
                return (
                  <li
                    key={event.id}
                    data-testid={`inv-box-${event.id}`}
                    className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5"
                  >
                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-violet-100 text-[11px]">
                      🎁
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-extrabold text-slate-700">
                        +{value}
                        {isPoints ? 'P' : '분'}
                        <span className="ml-1 text-[9px] font-bold text-slate-400">{isPoints ? '화폐 포인트' : '게임 시간'}</span>
                      </span>
                      <span className="mt-0.5 block text-[9px] font-semibold text-slate-400">
                        {formatNoteTime(event.opened_at ?? event.created_at)} · {event.season}
                      </span>
                    </span>
                    {isPoints ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70">
                        {study.isParent ? '적립 완료' : '정리 완료'}
                      </span>
                    ) : event.used_at ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-600 ring-1 ring-emerald-200/70">
                        {study.isParent ? '적립 완료' : '정리 완료'}
                      </span>
                    ) : study.isParent ? (
                      <button
                        type="button"
                        data-testid={`inv-box-use-${event.id}`}
                        disabled={busy}
                        onClick={() => void markBoxUsed(event.id)}
                        className="shrink-0 rounded-full bg-slate-900 px-2 py-1 text-[8.5px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
                      >
                        사용 완료
                      </button>
                    ) : (
                      <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber-700 ring-1 ring-amber-200/70">
                        정리 완료
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
          <p className="text-[12px] font-extrabold text-slate-900">💰 포인트 기록</p>
          {entries.length === 0 ? (
            <p className="mt-1.5 text-[10px] font-semibold text-slate-400">아직 포인트 기록이 없어요.</p>
          ) : (
            <ul className="mt-1.5 space-y-0.5">
              {entries.slice(0, 20).map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 text-[9.5px] font-bold text-slate-500">
                  <span className="w-10 shrink-0 tabular-nums text-slate-400">{formatNoteTime(entry.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className={cx('shrink-0 tabular-nums', entry.delta > 0 ? 'text-emerald-600' : 'text-rose-500')}>
                    {entry.delta > 0 ? '+' : ''}
                    {entry.delta}P
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-1 pt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · 사용 완료·정리는 부모님만 할 수 있어요. 아이는 보관함에서 모은 것만 봐요.
          <br />· 상품을 정리하면 그 구매 기록이 지워집니다(포인트는 환불되지 않아요).
        </p>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-10 flex justify-center px-6">
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/90 px-3 py-1.5 text-[9.5px] font-bold text-white">
          <CheckIcon className="h-3 w-3" /> 다 쓴 것은 [사용 완료] → [정리]
        </span>
      </div>
    </div>
  );
}
