import type { Task } from './types';

/**
 * ✅ 부모(관리자) 확인이 필요한 항목 표시
 *
 * 옵션 → 공부 목록에서 항목마다 '부모 확인 필요'를 켜 두면(예: 독서록 (아빠 검사)),
 * [기본 목록]으로 그 날에 넣을 때 이 표시가 함께 들어갑니다.
 * 표시는 항목의 note(한 줄 메모)에 작은 JSON 으로 남겨, 표를 새로 만들지 않고도
 * 가족 폰끼리 그대로 따라갑니다. (상점 줄의 JSON 과 섞이지 않게 'shop' 표시가 있으면 건드리지 않습니다)
 */

const KEY = 'needParent';

function parse(note: string | undefined): Record<string, unknown> | null {
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

/** 이 항목이 부모 확인을 기다리는 항목인지 */
export function needParentOf(task: Pick<Task, 'note'>): boolean {
  const parsed = parse(task.note);
  return parsed?.[KEY] === true;
}

/** note 에 '부모 확인 필요' 표시를 넣거나 뺀 값 */
export function noteWithNeedParent(note: string | undefined, needParent: boolean): string | undefined {
  const parsed = parse(note);
  if (!parsed) {
    if (!needParent) return note;
    return JSON.stringify({ [KEY]: true });
  }
  // 상점 상품·포인트 장부 줄은 건드리지 않습니다.
  if (typeof parsed.shop === 'string') return note;
  const next = { ...parsed };
  if (needParent) next[KEY] = true;
  else delete next[KEY];
  if (Object.keys(next).length === 0) return undefined;
  return JSON.stringify(next);
}
