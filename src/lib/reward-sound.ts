/**
 * 🎁 뽑기 상자 효과음 — 외부 mp3 없이 Web Audio 로 그 자리에서 만듭니다.
 *
 * · 소리는 항상 '사용자가 방금 누른' 동작 안에서 시작합니다
 *   (브라우저 자동재생 정책: 제스처 밖에서 만든 AudioContext 는 쉬어 있을 수 있어요).
 * · 음소거는 이 기기에 기억해 두고, 소리가 안 되는 브라우저(iOS 저전력 모드 등)에서는
 *   조용히 넘어갑니다 — 화면 연출과 진동은 그대로 동작합니다.
 */

const SOUND_KEY = 'study-check.reward-sound.v1';

let soundKey = SOUND_KEY;
let audio: AudioContext | null = null;
let muted = false;
let loaded = false;

/**
 * 효과음 설정을 저장할 키를 바꿉니다.
 * 체험 페이지(demo.html)는 이 기기의 실제 앱 설정과 섞이지 않도록 자기 키를 씁니다.
 */
export function setRewardSoundStorageKey(key: string): void {
  soundKey = key;
  loaded = false;
  muted = false;
}

function loadPreference(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    muted = window.localStorage.getItem(soundKey) === 'off';
  } catch {
    muted = false;
  }
}

export function isRewardSoundOn(): boolean {
  loadPreference();
  return !muted;
}

export function setRewardSoundOn(on: boolean): void {
  loadPreference();
  muted = !on;
  if (!on) stopAll();
  try {
    window.localStorage.setItem(soundKey, on ? 'on' : 'off');
  } catch {
    /* 기억하지 못해도 이번 화면에서는 그대로 */
  }
}

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

/** 누른 그 순간에 한 번 불러 주세요 — 이후 소리가 바로 납니다. */
export function unlockRewardAudio(): void {
  const ctx = context();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* 소리가 안 되어도 괜찮아요 */
  }
}

type Wave = OscillatorType;

interface Note {
  /** Hz */
  frequency: number;
  /** 시작(초, 지금부터) */
  at: number;
  /** 길이(초) */
  length: number;
  /** 0~1 */
  volume: number;
  type?: Wave;
  /** 끝으로 갈수록 음을 올리거나 내리기 */
  glideTo?: number;
}

let live: OscillatorNode[] = [];

function play(notes: Note[]): void {
  loadPreference();
  if (muted) return;
  const ctx = context();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime + 0.01;
    for (const note of notes) {
      const start = now + note.at;
      const end = start + note.length;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.frequency, start);
      if (note.glideTo) osc.frequency.exponentialRampToValueAtTime(note.glideTo, end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(note.volume, 0.0002), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
      live.push(osc);
    }
  } catch {
    /* 소리는 실패해도 연출은 그대로 */
  }
}

function stopAll(): void {
  for (const osc of live) {
    try {
      osc.stop();
    } catch {
      /* 이미 끝난 소리 */
    }
  }
  live = [];
}

/** 상자를 콕 눌렀을 때 — 나무를 톡 두드리는 짧은 소리. */
export function playBoxTap(): void {
  play([
    { frequency: 660, at: 0, length: 0.07, volume: 0.06, type: 'triangle' },
    { frequency: 990, at: 0.02, length: 0.05, volume: 0.03, type: 'sine' },
  ]);
}

/** 두근두근 — 상자가 흔들리는 동안 틱틱, 낮은 심장 박동이 번갈아. */
export function playBoxShake(): void {
  const notes: Note[] = [];
  const ticks = 9;
  for (let index = 0; index < ticks; index += 1) {
    const at = index * 0.11;
    notes.push({ frequency: index % 2 === 0 ? 1244 : 932, at, length: 0.045, volume: 0.05, type: 'square' });
  }
  // 낮은 두근 — 0.33초마다 한 번씩
  for (let index = 0; index < 3; index += 1) {
    const at = 0.1 + index * 0.33;
    notes.push({ frequency: 110, at, length: 0.16, volume: 0.13, type: 'sine', glideTo: 70 });
  }
  play(notes);
}

/** 뽑기 직전 마지막 숨고르기 — 살짝 올라가는 긴장. */
export function playBoxTense(): void {
  play([
    { frequency: 392, at: 0, length: 0.5, volume: 0.05, type: 'triangle', glideTo: 784 },
    { frequency: 196, at: 0, length: 0.5, volume: 0.04, type: 'sine' },
  ]);
}

/** 짜잔 — 경쾌한 팡파레(도-미-솔-도), 밝은 화음으로. */
export function playBoxFanfare(): void {
  const melody = [523.25, 659.25, 783.99, 1046.5];
  const notes: Note[] = melody.map((frequency, index) => ({
    frequency,
    at: index * 0.11,
    length: index === melody.length - 1 ? 0.55 : 0.16,
    volume: 0.09,
    type: 'triangle',
  }));
  // 화음 받침
  notes.push({ frequency: 261.63, at: 0.33, length: 0.5, volume: 0.05, type: 'sine' });
  notes.push({ frequency: 392, at: 0.33, length: 0.5, volume: 0.04, type: 'sine' });
  // 반짝이는 높은 소리
  notes.push({ frequency: 1567.98, at: 0.44, length: 0.3, volume: 0.03, type: 'sine' });
  notes.push({ frequency: 2093, at: 0.52, length: 0.25, volume: 0.02, type: 'sine' });
  play(notes);
}

/** 나머지 상자가 살짝 열릴 때 — 작은 딸랑. */
export function playBoxPeek(): void {
  play([
    { frequency: 880, at: 0, length: 0.09, volume: 0.03, type: 'sine' },
    { frequency: 1174.66, at: 0.08, length: 0.1, volume: 0.025, type: 'sine' },
  ]);
}

/** 효과음 끄기/켜기 버튼을 눌렀을 때 — 켜면 짧은 확인음. */
export function playSoundToggle(on: boolean): void {
  if (!on) return;
  play([{ frequency: 1046.5, at: 0, length: 0.1, volume: 0.04, type: 'triangle' }]);
}
