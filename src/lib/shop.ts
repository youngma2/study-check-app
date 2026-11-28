import type { Member, Task } from './types';

/**
 * 🛒 포인트 상점 · 화폐 포인트(P) 장부
 *
 * 화폐 포인트(P)는 경험치(XP)와 별개입니다. 뽑기 상자에서 나오거나 부모가 지급하고,
 * 상점에서 물건을 사면 빠집니다.
 *
 * ── 왜 '항목(tasks)' 표에 두나요? ──────────────────────────────────────────
 * 가족 폰끼리 함께 보고 **아이도 쓸 수 있어야** 하는데, 지금 DB 에서 아이가 쓸 수 있는
 * 곳은 숙제 항목과 한마디뿐입니다. 가족 설정(`family_app_settings`)은 부모 + PIN 이 있어야
 * 쓰이고, 그 표를 아직 만들지 않은 가정도 많습니다. 그래서 상점 상품과 포인트 장부를
 * 숙제 항목과 같은 표에 '상점 줄'로 남깁니다.
 *
 *   · 상품   — id `sp_…`, subject `shop`, title = 상품 이름, note = {shop:'product', emoji, desc, price}
 *   · 포인트 — id `pt_…`, subject `shop`, note = {shop:'point', kind:'earn'|'spend'|'grant', p, label}
 *              구매한 줄은 status `todo`(사용 대기) → 부모가 [사용 완료] 를 누르면 `verified`.
 *              사용 완료된 구매는 보유 상품 목록에서 빠지고 '구매·사용 내역' 에만 남습니다(중복 사용 금지).
 *
 * 이런 줄은 날짜를 `2000-01-01` 로 두어 달력·통계·기본 목록 어디에도 끼어들지 않게 하고,
 * 화면 목록에서는 isShopTask 로 걸러 냅니다. (지우기는 부모만 — 아이는 장부를 고칠 수 없습니다)
 */

/** 상점 줄을 알아보는 표시 — subject 로도, id 앞자리로도 알아봅니다. */
export const SHOP_SUBJECT = 'shop';
/** 상점 줄이 쓰는 날짜 — 어떤 날짜 화면에도 나타나지 않게 아주 과거로 둡니다. */
export const SHOP_DATE = '2000-01-01';

export function isShopTask(task: Pick<Task, 'id' | 'subject'>): boolean {
  return task.subject === SHOP_SUBJECT || task.id.startsWith('sp_') || task.id.startsWith('pt_');
}

export interface ShopProduct {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** 필요한 포인트(P) */
  price: number;
  created_at: string;
}

export type PointKind = 'earn' | 'spend' | 'grant';

export interface PointEntry {
  id: string;
  member_id: string;
  /** +면 쌓임, -면 씀 */
  delta: number;
  kind: PointKind;
  label: string;
  created_at: string;
  /** 구매 줄을 부모가 [사용 완료] 로 처리했는지 (status verified) */
  delivered: boolean;
  task: Task;
}

interface ProductNote {
  shop: 'product';
  emoji?: string;
  desc?: string;
  price?: number;
}

interface PointNote {
  shop: 'point';
  kind?: PointKind;
  p?: number;
  label?: string;
  /** 구매한 상품 id */
  product?: string;
}

function parseNote(note: string | undefined): Record<string, unknown> | null {
  if (!note) return null;
  const text = note.trim();
  if (!text.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const SHOP_EMOJIS = ['🎁', '🍦', '🍗', '🎮', '📱', '🎬', '🎨', '⚽', '📚', '🧸', '🍿', '💰'] as const;

/** 상품 등록·수정에 쓰는 항목 입력값 (숙제 항목과 같은 모양으로 저장합니다) */
export function productTaskInput(
  product: Pick<ShopProduct, 'id' | 'name' | 'emoji' | 'desc' | 'price'>,
  ownerId: string,
): { id: string; member_id: string; title: string; subject: string; due_date: string; note: string } {
  const note: ProductNote = {
    shop: 'product',
    emoji: product.emoji,
    desc: product.desc,
    price: product.price,
  };
  return {
    id: product.id,
    member_id: ownerId,
    title: product.name,
    subject: SHOP_SUBJECT,
    due_date: SHOP_DATE,
    note: JSON.stringify(note),
  };
}

export function productOf(task: Task): ShopProduct | null {
  if (!isShopTask(task)) return null;
  const note = parseNote(task.note) as ProductNote | null;
  if (!note || note.shop !== 'product') return null;
  return {
    id: task.id,
    name: task.title,
    emoji: typeof note.emoji === 'string' && note.emoji ? note.emoji : '🎁',
    desc: typeof note.desc === 'string' ? note.desc : '',
    price: typeof note.price === 'number' && Number.isFinite(note.price) ? Math.max(1, Math.round(note.price)) : 1,
    created_at: task.created_at,
  };
}

/** 가족이 등록해 둔 상품 목록 (만든 순서) */
export function productsOf(tasks: Task[]): ShopProduct[] {
  return tasks
    .filter((task) => task.id.startsWith('sp_'))
    .map(productOf)
    .filter((product): product is ShopProduct => product !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function pointEntryOf(task: Task): PointEntry | null {
  if (!isShopTask(task)) return null;
  const note = parseNote(task.note) as PointNote | null;
  if (!note || note.shop !== 'point') return null;
  const p = typeof note.p === 'number' && Number.isFinite(note.p) ? Math.round(note.p) : 0;
  if (!p) return null;
  const kind: PointKind = note.kind === 'spend' || note.kind === 'grant' ? note.kind : 'earn';
  return {
    id: task.id,
    member_id: task.member_id,
    delta: kind === 'spend' ? -Math.abs(p) : Math.abs(p),
    kind,
    label: typeof note.label === 'string' && note.label.trim() ? note.label.trim() : kind === 'spend' ? '상점 구매' : '포인트',
    created_at: task.created_at,
    delivered: task.status === 'verified',
    task,
  };
}

/** 한 아이의 포인트 장부 (최근 것이 먼저) */
export function pointEntriesFor(tasks: Task[], memberId: string): PointEntry[] {
  return tasks
    .filter((task) => task.member_id === memberId && task.id.startsWith('pt_'))
    .map(pointEntryOf)
    .filter((entry): entry is PointEntry => entry !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 지금 쓸 수 있는 포인트(P) — 쌓인 것에서 쓴 것(지급 대기 포함)을 뺍니다. */
export function pointsFor(tasks: Task[], memberId: string): number {
  return pointEntriesFor(tasks, memberId).reduce((sum, entry) => sum + entry.delta, 0);
}

/** 구매 줄 만들기 — 아이도 자기 몫으로 만들 수 있습니다(포인트는 바로 차감됩니다). */
export function purchaseTaskInput(
  product: ShopProduct,
  memberId: string,
  now: Date = new Date(),
): { id: string; member_id: string; title: string; subject: string; due_date: string; note: string } {
  const id = `pt_buy_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const note: PointNote = {
    shop: 'point',
    kind: 'spend',
    p: product.price,
    label: product.name,
    product: product.id,
  };
  return {
    id,
    member_id: memberId,
    title: `🛒 ${product.emoji} ${product.name}`.trim(),
    subject: SHOP_SUBJECT,
    due_date: SHOP_DATE,
    note: JSON.stringify(note),
  };
}

/** 부모가 포인트를 지급(+)/차감(-)할 때 */
export function grantTaskInput(
  memberId: string,
  points: number,
  label: string,
  now: Date = new Date(),
): { id: string; member_id: string; title: string; subject: string; due_date: string; note: string } {
  const p = Math.max(1, Math.round(Math.abs(points)));
  const id = `pt_grant_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const note: PointNote = {
    shop: 'point',
    kind: points < 0 ? 'spend' : 'grant',
    p,
    label: label.trim() || (points < 0 ? '부모 차감' : '부모 지급'),
  };
  return {
    id,
    member_id: memberId,
    title: `${points < 0 ? '➖' : '➕'} ${p}P`,
    subject: SHOP_SUBJECT,
    due_date: SHOP_DATE,
    note: JSON.stringify(note),
  };
}

/** 뽑기 상자에서 P 가 나왔을 때 쌓는 줄 — 상자 id 로 만들어 여러 폰에서 겹쳐도 한 줄만 남습니다. */
export function prizeTaskInput(
  memberId: string,
  points: number,
  label: string,
  eventId: string,
): { id: string; member_id: string; title: string; subject: string; due_date: string; note: string } {
  const note: PointNote = { shop: 'point', kind: 'earn', p: Math.max(1, Math.round(points)), label };
  return {
    id: `pt_prize_${eventId}`,
    member_id: memberId,
    title: `🎁 ${Math.max(1, Math.round(points))}P`,
    subject: SHOP_SUBJECT,
    due_date: SHOP_DATE,
    note: JSON.stringify(note),
  };
}

/** 뽑기 상자 id 앞자리 — 포인트 보상으로 이미 정산된 상자를 알아냅니다. */
export const PRIZE_TASK_PREFIX = 'pt_prize_';

/** 포인트 보상으로 정산된 상자 id 들 (그 상자의 box_minutes 는 게임 시간에서 빼야 합니다) */
export function pointPrizeEventIds(tasks: Task[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.id.startsWith(PRIZE_TASK_PREFIX)) ids.add(task.id.slice(PRIZE_TASK_PREFIX.length));
  }
  return ids;
}

/** 이미 열어서 포인트로 정산된 상자인지 — 그 때의 P 값을 돌려줍니다. */
export function boxPointPrize(tasks: Task[], eventId: string): number | null {
  const task = tasks.find((item) => item.id === `${PRIZE_TASK_PREFIX}${eventId}`);
  if (!task) return null;
  const entry = pointEntryOf(task);
  return entry ? Math.abs(entry.delta) : null;
}

/** 장부 한 줄의 설명 — '사용 대기' 구매인지, 쌓인 포인트인지 (4차 4·11번) */
export function pointEntryKindLabel(entry: PointEntry): string {
  if (entry.kind === 'spend') return entry.delivered ? '구매 · 사용 완료' : '구매 · 사용 대기';
  return entry.kind === 'grant' ? '부모 지급' : '포인트 적립';
}

/** 그 아이가 아직 쓰지 않은(사용 가능한) 구매 목록 — 사용 완료된 것은 빠집니다. */
export function availablePurchasesFor(tasks: Task[], memberId: string): PointEntry[] {
  return pointEntriesFor(tasks, memberId).filter(
    (entry) => entry.kind === 'spend' && entry.delta < 0 && entry.task.title.startsWith('🛒') && !entry.delivered,
  );
}

/** 장부에 남길 사람 이름 (없으면 '가족') */
export function memberNameOf(members: Member[], memberId: string): string {
  return members.find((member) => member.id === memberId)?.name ?? '가족';
}
