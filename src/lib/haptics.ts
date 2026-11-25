/**
 * 손끝에 오는 아주 짧은 진동.
 * 안드로이드 크롬은 되지만 iOS 사파리에는 navigator.vibrate 가 없어서,
 * 없는 기기나 권한이 막힌 브라우저에서도 조용히 넘어가도록 감싸 둡니다.
 */

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 진동이 막힌 브라우저 — 소리·화면은 그대로 동작해야 합니다. */
  }
}

/** PIN 키패드 숫자·지우기·취소 버튼을 눌렀을 때의 톡. */
export function vibrateKey(): void {
  vibrate(15);
}

/** PIN 이 틀렸을 때의 짧은 세 번(틀렸다는 걸 손으로도 알 수 있게). */
export function vibrateError(): void {
  vibrate([30, 50, 30]);
}
