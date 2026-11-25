/**
 * 알림을 눌러 앱을 열 때의 '그 날짜' 딥링크.
 *
 * 서비스 워커는 `#date=2026-11-25&note=n_...` 로 앱을 엽니다.
 * 예전/다른 형식(`#d=`, `?note_date=`)이 섞여도 같은 날짜로 열리게 함께 받습니다.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function deepLinkDate(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  hash: string = typeof window === 'undefined' ? '' : window.location.hash,
): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, ''));
  const fromSearch = new URLSearchParams(search.replace(/^\?/, ''));
  const candidates = [
    fromHash.get('date'),
    fromHash.get('d'),
    fromSearch.get('note_date'),
    fromSearch.get('date'),
  ];
  for (const value of candidates) {
    if (value && ISO_DATE.test(value)) return value;
  }
  return null;
}

/** 알림 payload·서비스 워커가 함께 쓰는 URL. */
export function noteDeepLink(dateIso: string, noteId = ''): string {
  const params = new URLSearchParams();
  if (ISO_DATE.test(dateIso)) params.set('date', dateIso);
  if (noteId) params.set('note', noteId);
  const query = params.toString();
  return query ? `./#${query}` : './';
}
