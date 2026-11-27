/**
 * 손끝에 오는 아주 짧은 진동.
 * 안드로이드 크롬은 되지만 iOS 사파리에는 navigator.vibrate 가 없어서,
 * 없는 기기나 권한이 막힌 브라우저에서도 조용히 넘어가도록 감싸 둡니다.
 */

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // 사용자가 화면을 한 번도 누르지 않은 상태(새로고침 직후 알림 등)에서는 브라우저가
  // 진동을 막고 콘솔에 경고를 남깁니다. 그런 경우는 조용히 건너뜁니다.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
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

/* ------------------------------------------------------------------ */
/* 🎁 뽑기 상자                                                        */
/* ------------------------------------------------------------------ */

/** 상자를 손끝으로 골랐을 때 — 톡. */
export function vibrateRewardPick(): void {
  vibrate(15);
}

/** 개봉 직전 두근두근 — 짧게 몰아치는 박자. */
export function vibrateRewardOpening(): void {
  vibrate([20, 40, 20, 40, 50]);
}

/** 당첨 — 손이 짜릿한 세 번. */
export function vibrateRewardWin(): void {
  vibrate([40, 30, 80]);
}

/** 안 고른 상자를 살짝 보여 줄 때의 아주 작은 톡. */
export function vibrateRewardPeek(): void {
  vibrate(10);
}

/* ------------------------------------------------------------------ */
/* ⏱ 타이머                                                            */
/* ------------------------------------------------------------------ */

/** 시간이 다 됐을 때 — 길게 세 번. */
export function vibrateTimerEnd(): void {
  vibrate([300, 120, 300, 120, 500]);
}

/** 일시 멈춤·재개를 눌렀을 때의 톡. */
export function vibrateTimerToggle(): void {
  vibrate(20);
}

/** 새 한마디 알림이 올 때의 짧은 진동(사용자가 이미 화면을 만진 뒤에만). */
export function vibrateNoteAlert(): void {
  vibrate([150, 80, 150]);
}
