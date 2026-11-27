import { useEffect, useRef } from 'react';

/**
 * 📱 안드로이드 뒤로가기 — 화면에 떠 있는 창(탭·모달)을 먼저 닫습니다.
 *
 * 앱 화면(App.tsx)이 뒤로가기를 가로채는데, 그때 "무엇을 먼저 닫을지"를 여기서 정합니다.
 * 창들은 열려 있는 동안 스스로를 이 목록에 올리고, 뒤로가기가 오면 가장 위의 창 하나만 닫힙니다.
 * (뽑기 팝업·프로필·추가 시트·대시보드·옵션·타이머 창이 모두 이 목록을 씁니다)
 */

interface OverlayEntry {
  id: string;
  close: () => void;
}

const stack: OverlayEntry[] = [];
let sequence = 0;

function pushOverlay(close: () => void): () => void {
  sequence += 1;
  const entry: OverlayEntry = { id: `overlay-${sequence}`, close };
  stack.push(entry);
  return () => {
    const index = stack.findIndex((item) => item.id === entry.id);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** 가장 위에 열린 창 하나를 닫습니다. 닫을 창이 없으면 false. */
export function closeTopOverlay(): boolean {
  const entry = stack[stack.length - 1];
  if (!entry) return false;
  stack.pop();
  entry.close();
  return true;
}

export function hasOverlay(): boolean {
  return stack.length > 0;
}

/** 창이 열려 있는 동안 뒤로가기 → 그 창 닫기 로 연결합니다. */
export function useOverlayBack(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    return pushOverlay(() => closeRef.current());
  }, [open]);
}
