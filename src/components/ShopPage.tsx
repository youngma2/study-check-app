import { useMemo, useState } from 'react';
import { useOverlayBack } from '../lib/back-guard';
import { cx } from '../lib/cx';
import { formatNoteTime } from '../lib/notes';
import {
  SHOP_EMOJIS,
  grantTaskInput,
  pointEntriesFor,
  pointEntryKindLabel,
  pointsFor,
  productTaskInput,
  productsOf,
  purchaseTaskInput,
  type PointEntry,
  type ShopProduct,
} from '../lib/shop';
import { useStudy } from '../lib/study-context';
import { ArrowLeftIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';

/**
 * 🛒 포인트 상점
 *
 * · 아이 화면: 내 포인트(P) 잔액을 보고, 상품(아이콘·이름·설명·필요 P)을 골라 삽니다.
 *   사면 포인트가 바로 빠지고 부모님께 '지급 대기' 로 올라갑니다.
 * · 부모 화면: 상품을 등록·수정·삭제하고, 아이 구매 내역을 보며 [지급 완료] 를 누릅니다.
 *   포인트를 직접 지급/차감할 수도 있습니다.
 *
 * 상품과 포인트 장부는 가족 모두가 함께 보는 '상점 줄'로 저장됩니다(lib/shop.ts 참고).
 */

interface ShopPageProps {
  onClose: () => void;
  onNotify: (message: string) => void;
}

function emptyDraft() {
  return { id: '', emoji: SHOP_EMOJIS[0] as string, name: '', desc: '', price: '100' };
}

export function ShopPage({ onClose, onNotify }: ShopPageProps) {
  const study = useStudy();
  useOverlayBack(true, onClose);

  const products = useMemo(() => productsOf(study.db.tasks), [study.db.tasks]);
  const [tab, setTab] = useState<'shop' | 'manage' | 'orders'>(study.isParent ? 'manage' : 'shop');
  const [childId, setChildId] = useState<string>(
    study.isParent ? study.children[0]?.id ?? '' : study.currentMember.id,
  );
  const [draft, setDraft] = useState(emptyDraft());
  const [buying, setBuying] = useState<ShopProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantPoints, setGrantPoints] = useState('50');
  const [grantLabel, setGrantLabel] = useState('');

  const child = study.children.find((member) => member.id === childId) ?? study.children[0];
  const viewer = study.isParent ? child : study.currentMember;
  const balance = viewer ? pointsFor(study.db.tasks, viewer.id) : 0;
  const entries: PointEntry[] = viewer ? pointEntriesFor(study.db.tasks, viewer.id) : [];
  const orders = entries.filter((entry) => entry.kind === 'spend');

  const purchase = async () => {
    if (!buying || !viewer) return;
    if (balance < buying.price) {
      onNotify(`포인트가 ${buying.price - balance}P 모자라요`);
      setBuying(null);
      return;
    }
    setBusy(true);
    const result = await study.addTask(purchaseTaskInput(buying, viewer.id));
    setBusy(false);
    setBuying(null);
    if (!result.ok) {
      onNotify(result.error ?? '구매하지 못했어요');
      return;
    }
    onNotify(`${buying.name} 구매 완료 · 부모님께 지급 요청했어요`);
  };

  const saveProduct = async () => {
    const name = draft.name.trim();
    const price = Math.round(Number(draft.price));
    if (!name) {
      onNotify('상품 이름을 적어 주세요');
      return;
    }
    if (!Number.isFinite(price) || price < 1 || price > 100000) {
      onNotify('필요 포인트는 1 이상으로 적어 주세요');
      return;
    }
    setBusy(true);
    const id = draft.id || `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const input = productTaskInput(
      { id, name, emoji: draft.emoji, desc: draft.desc.trim(), price },
      study.currentMember.id,
    );
    const result = draft.id
      ? await study.editTask(draft.id, { title: name, note: input.note })
      : await study.addTask(input);
    setBusy(false);
    if (!result.ok) {
      onNotify(result.error ?? '상품을 저장하지 못했어요');
      return;
    }
    onNotify(draft.id ? '상품을 고쳤어요' : `${draft.emoji} ${name} 상품을 등록했어요`);
    setDraft(emptyDraft());
  };

  const removeProduct = async (product: ShopProduct) => {
    if (!window.confirm(`'${product.name}' 상품을 지울까요?`)) return;
    const result = await study.removeTask(product.id);
    onNotify(result.ok ? '상품을 지웠어요' : result.error ?? '지우지 못했어요');
  };

  const deliver = async (entry: PointEntry) => {
    const result = await study.setStatus(entry.id, 'verified');
    onNotify(result.ok ? '지급 완료로 표시했어요' : result.error ?? '바꾸지 못했어요');
  };

  const cancelOrder = async (entry: PointEntry) => {
    if (!window.confirm('이 구매를 취소할까요? 포인트가 다시 돌아갑니다.')) return;
    const result = await study.removeTask(entry.id);
    onNotify(result.ok ? '구매를 취소했어요 · 포인트를 돌려줬어요' : result.error ?? '취소하지 못했어요');
  };

  const grant = async () => {
    if (!viewer) return;
    const value = Math.round(Number(grantPoints));
    if (!Number.isFinite(value) || value === 0) {
      onNotify('지급할 포인트를 적어 주세요');
      return;
    }
    const result = await study.addTask(grantTaskInput(viewer.id, value, grantLabel));
    if (!result.ok) {
      onNotify(result.error ?? '포인트를 바꾸지 못했어요');
      return;
    }
    onNotify(`${viewer.name}에게 ${value > 0 ? '+' : ''}${value}P 했어요`);
    setGrantLabel('');
  };

  return (
    <div data-testid="shop-page" className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f6fa]">
      <div className="sticky top-0 z-10 bg-[#f5f6fa]/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-4 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="shop-close"
              onClick={onClose}
              aria-label="상점 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-card ring-1 ring-slate-900/5 transition active:scale-90"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900">🛒 포인트 상점</h1>
              <p className="text-[9.5px] font-bold text-slate-400">모은 P 로 사고, 부모님이 지급 완료</p>
            </div>
          </div>

          {study.isParent ? (
            <div className="mt-2 flex rounded-full bg-slate-200/70 p-0.5">
              <button
                type="button"
                data-testid="shop-tab-manage"
                onClick={() => setTab('manage')}
                className={cx(
                  'flex-1 rounded-full px-2.5 py-1.5 text-[10.5px] font-extrabold transition',
                  tab === 'manage' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
              >
                🧺 상품 관리
              </button>
              <button
                type="button"
                data-testid="shop-tab-orders"
                onClick={() => setTab('orders')}
                className={cx(
                  'flex-1 rounded-full px-2.5 py-1.5 text-[10.5px] font-extrabold transition',
                  tab === 'orders' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
              >
                📦 구매 내역
              </button>
              <button
                type="button"
                data-testid="shop-tab-shop"
                onClick={() => setTab('shop')}
                className={cx(
                  'flex-1 rounded-full px-2.5 py-1.5 text-[10.5px] font-extrabold transition',
                  tab === 'shop' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
              >
                🛒 상점 보기
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2.5 px-4 pb-28 pt-1">
        {/* 아이 선택 (부모 화면) */}
        {study.isParent ? (
          <section className="rounded-[22px] bg-white p-2.5 shadow-card ring-1 ring-slate-900/5">
            <div className="flex gap-1.5">
              {study.children.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  data-testid={`shop-child-${member.id}`}
                  onClick={() => setChildId(member.id)}
                  className={cx(
                    'flex-1 rounded-2xl px-1 py-1.5 text-[10.5px] font-extrabold ring-1 transition active:scale-95',
                    member.id === viewer?.id
                      ? 'bg-slate-900 text-white ring-slate-900'
                      : 'bg-slate-50 text-slate-600 ring-slate-200',
                  )}
                >
                  {member.emoji} {member.name}
                  <span
                    className={cx(
                      'mt-0.5 block text-[9px] font-bold',
                      member.id === viewer?.id ? 'text-white/70' : 'text-slate-400',
                    )}
                  >
                    {pointsFor(study.db.tasks, member.id)}P
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* 잔액 */}
        <section
          data-testid="shop-balance"
          className="rounded-[24px] bg-gradient-to-r from-emerald-500 to-teal-500 p-3.5 text-white shadow-lg shadow-emerald-500/25"
        >
          <p className="text-[10px] font-extrabold text-white/75">
            {viewer?.name ?? '아이'} · 모은 포인트
          </p>
          <p className="mt-0.5 text-[26px] font-extrabold leading-none tabular-nums">{balance}P</p>
          <p className="mt-1 text-[9.5px] font-bold text-white/70">
            뽑기 상자에서 나온 포인트와 부모님 지급이 여기에 쌓여요.
          </p>
        </section>

        {tab === 'shop' ? (
          <section data-testid="shop-products" className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-extrabold text-slate-900">🧺 상품</p>
              <span className="text-[9px] font-bold text-slate-400">{products.length}개</span>
            </div>
            {products.length === 0 ? (
              <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10.5px] font-semibold text-slate-400">
                아직 등록된 상품이 없어요.
                {study.isParent ? <><br />[상품 관리] 에서 아이콘·이름·필요 P 로 등록해 주세요.</> : null}
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {products.map((product) => {
                  const affordable = balance >= product.price;
                  return (
                    <li
                      key={product.id}
                      data-testid={`shop-product-${product.id}`}
                      className="flex items-center gap-2 rounded-2xl bg-slate-50 px-2.5 py-2"
                    >
                      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[18px] ring-1 ring-slate-200">
                        {product.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-extrabold text-slate-800">{product.name}</span>
                        {product.desc ? (
                          <span className="mt-0.5 block truncate text-[9.5px] font-semibold text-slate-400">{product.desc}</span>
                        ) : null}
                        <span className="mt-0.5 block text-[10px] font-extrabold text-emerald-600">{product.price}P</span>
                      </span>
                      <button
                        type="button"
                        data-testid={`shop-buy-${product.id}`}
                        disabled={!affordable || busy}
                        onClick={() => setBuying(product)}
                        className={cx(
                          'shrink-0 rounded-xl px-2.5 py-2 text-[10.5px] font-extrabold transition active:scale-95',
                          affordable
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                            : 'bg-slate-200 text-slate-400',
                        )}
                      >
                        {affordable ? '구매' : `${product.price - balance}P 부족`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {tab === 'manage' ? (
          <>
            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[12.5px] font-extrabold text-slate-900">
                {draft.id ? '✏️ 상품 수정' : '🧺 상품 등록'}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                아이콘 · 상품명 · 간단 설명 · 필요 포인트(P) 만 있으면 돼요.
              </p>

              <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto pb-0.5">
                {SHOP_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    data-testid={`shop-emoji-${emoji}`}
                    onClick={() => setDraft((prev) => ({ ...prev, emoji }))}
                    aria-pressed={draft.emoji === emoji}
                    className={cx(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[16px] ring-1 transition active:scale-90',
                      draft.emoji === emoji ? 'bg-indigo-50 ring-indigo-300' : 'bg-slate-50 ring-slate-200',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <input
                data-testid="shop-product-name"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="상품 이름 (예: 간식 쿠폰)"
                className="mt-2 w-full rounded-xl bg-slate-50 px-2.5 py-2 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
              />
              <input
                data-testid="shop-product-desc"
                value={draft.desc}
                onChange={(event) => setDraft((prev) => ({ ...prev, desc: event.target.value }))}
                placeholder="간단 설명 (예: 편의점에서 하나)"
                className="mt-1.5 w-full rounded-xl bg-slate-50 px-2.5 py-2 text-[11.5px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-indigo-300"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  data-testid="shop-product-price"
                  type="number"
                  min={1}
                  value={draft.price}
                  onChange={(event) => setDraft((prev) => ({ ...prev, price: event.target.value }))}
                  className="w-24 rounded-xl bg-slate-50 px-2 py-2 text-right text-[12px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200"
                />
                <span className="text-[10px] font-extrabold text-slate-400">P</span>
                <button
                  type="button"
                  data-testid="shop-product-save"
                  disabled={busy}
                  onClick={() => void saveProduct()}
                  className="ml-auto flex flex-1 items-center justify-center gap-1 rounded-xl bg-indigo-600 py-2 text-[11px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-50"
                >
                  <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                  {draft.id ? '수정 저장' : '상품 등록'}
                </button>
                {draft.id ? (
                  <button
                    type="button"
                    onClick={() => setDraft(emptyDraft())}
                    className="rounded-xl bg-white px-2.5 py-2 text-[11px] font-extrabold text-slate-500 ring-1 ring-slate-200"
                  >
                    취소
                  </button>
                ) : null}
              </div>
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[12.5px] font-extrabold text-slate-900">🧺 등록된 상품</p>
              {products.length === 0 ? (
                <p className="mt-1.5 text-[10.5px] font-semibold text-slate-400">아직 없어요.</p>
              ) : (
                <ul data-testid="shop-manage-list" className="mt-1.5 space-y-1">
                  {products.map((product) => (
                    <li key={product.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5">
                      <span aria-hidden className="text-[14px]">{product.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-extrabold text-slate-700">{product.name}</span>
                        <span className="block text-[9px] font-semibold text-slate-400">
                          {product.price}P{product.desc ? ` · ${product.desc}` : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        data-testid={`shop-product-edit-${product.id}`}
                        onClick={() =>
                          setDraft({
                            id: product.id,
                            emoji: product.emoji,
                            name: product.name,
                            desc: product.desc,
                            price: String(product.price),
                          })
                        }
                        aria-label={`${product.name} 수정`}
                        className="grid h-6 w-6 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200 transition active:scale-90"
                      >
                        <PencilIcon className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        data-testid={`shop-product-delete-${product.id}`}
                        onClick={() => void removeProduct(product)}
                        aria-label={`${product.name} 삭제`}
                        className="grid h-6 w-6 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
              <p className="text-[12.5px] font-extrabold text-slate-900">💰 포인트 지급·차감</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                {viewer?.name ?? '아이'}에게 바로 포인트를 넣거나 뺍니다(뽑기 상자 말고도).
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  data-testid="shop-grant-points"
                  type="number"
                  value={grantPoints}
                  onChange={(event) => setGrantPoints(event.target.value)}
                  className="w-20 shrink-0 rounded-xl bg-slate-50 px-2 py-2 text-right text-[12px] font-extrabold tabular-nums text-slate-800 outline-none ring-1 ring-slate-200"
                />
                <span className="shrink-0 text-[10px] font-extrabold text-slate-400">P</span>
                <input
                  data-testid="shop-grant-label"
                  value={grantLabel}
                  onChange={(event) => setGrantLabel(event.target.value)}
                  placeholder="사유 (선택)"
                  className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2 py-2 text-[11px] font-bold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300"
                />
                <button
                  type="button"
                  data-testid="shop-grant-save"
                  onClick={() => void grant()}
                  className="shrink-0 rounded-xl bg-emerald-600 px-2.5 py-2 text-[10.5px] font-extrabold text-white transition active:scale-95"
                >
                  지급
                </button>
              </div>
            </section>
          </>
        ) : null}

        {tab === 'orders' ? (
          <section data-testid="shop-orders" className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-extrabold text-slate-900">📦 {viewer?.name ?? '아이'} 구매 내역</p>
              <span className="text-[9px] font-bold text-slate-400">{orders.length}건</span>
            </div>
            {orders.length === 0 ? (
              <p className="mt-1.5 rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10.5px] font-semibold text-slate-400">
                아직 산 것이 없어요.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {orders.map((entry) => (
                  <li
                    key={entry.id}
                    data-testid={`shop-order-${entry.id}`}
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
                    {!entry.delivered ? (
                      <button
                        type="button"
                        data-testid={`shop-deliver-${entry.id}`}
                        onClick={() => void deliver(entry)}
                        className="shrink-0 rounded-full bg-slate-900 px-2 py-1 text-[9px] font-extrabold text-white transition active:scale-95"
                      >
                        지급 완료
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid={`shop-cancel-${entry.id}`}
                      onClick={() => void cancelOrder(entry)}
                      aria-label="구매 취소"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-rose-400 ring-1 ring-rose-100 transition active:scale-90"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <p className="px-1 pt-1 text-[9px] font-semibold leading-relaxed text-slate-400">
          · 포인트(P)는 경험치(XP)와 따로 셉니다. 뽑기 상자에서 분 대신 P 가 나올 수 있어요.
          <br />· 사면 포인트가 바로 빠지고 부모님 화면에 [지급 대기] 로 올라갑니다.
          <br />· 상품 등록·수정·삭제와 지급 완료·취소는 부모님만 할 수 있어요.
        </p>
      </div>

      {/* 구매 확인 */}
      {buying ? (
        <div
          data-testid="shop-buy-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="구매 확인"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 px-6 backdrop-blur-sm"
        >
          <div className="w-full max-w-[300px] rounded-[26px] bg-white p-5 text-center shadow-2xl">
            <p className="text-[30px] leading-none" aria-hidden>
              {buying.emoji}
            </p>
            <h2 className="mt-2 text-[15px] font-extrabold tracking-tight text-slate-900">{buying.name}</h2>
            <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-slate-500">
              {buying.desc || '이 상품을 살까요?'}
            </p>
            <p className="mt-2 text-[12px] font-extrabold text-emerald-600">
              {buying.price}P · 남는 포인트 {balance - buying.price}P
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="shop-buy-cancel"
                onClick={() => setBuying(null)}
                className="flex-1 rounded-2xl bg-slate-100 py-2.5 text-[12px] font-extrabold text-slate-600 transition active:scale-[0.98]"
              >
                취소
              </button>
              <button
                type="button"
                data-testid="shop-buy-ok"
                disabled={busy}
                onClick={() => void purchase()}
                className="flex flex-1 items-center justify-center gap-1 rounded-2xl bg-emerald-600 py-2.5 text-[12px] font-extrabold text-white shadow-lg shadow-emerald-500/25 transition active:scale-[0.98] disabled:opacity-50"
              >
                <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                구매
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
