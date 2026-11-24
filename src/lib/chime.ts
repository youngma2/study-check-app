/**
 * 새 한마디가 올라왔을 때 울리는 아주 작은 알림음.
 * 소리는 '있으면 좋은' 것이라, 브라우저가 막으면(자동재생 정책) 조용히 넘어갑니다.
 */

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audio) {
    try {
      audio = new Ctor();
    } catch {
      return null;
    }
  }
  return audio;
}

export function playNoteChime(): void {
  const ctx = context();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    // 딩-동, 두 음만 아주 여리게 (알림판 소리라 놀라지 않게)
    [880, 1174.66].forEach((frequency, index) => {
      const start = now + index * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  } catch {
    /* 소리는 실패해도 화면 알림은 그대로 */
  }
}
