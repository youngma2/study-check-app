/**
 * 부모 관리 PIN (4자리) — 앱 쪽 보조 함수.
 *
 * · 진짜 PIN 은 어디에도 적어 두지 않습니다. Supabase `family_secrets` 에 bcrypt 해시로만 저장되고,
 *   앱은 `study_verify_parent_pin` RPC 로 맞는지만 물어봅니다.
 * · 잠금을 푼 PIN 은 sessionStorage 에만 둡니다(탭을 닫거나 '관리 잠금'을 누르면 사라짐).
 *   부모 화면에서 DB 로 보내는 요청에 이 값을 함께 실어, DB 도 PIN 을 확인합니다.
 * · Supabase 없이 이 기기에만 저장하는 데모 모드에서는, 이 기기 안에만 솔트+해시를 두고 확인합니다.
 *   (데모용 PIN 도 코드에 적지 않습니다. 처음 부모 화면을 열 때 정합니다.)
 */

export const PARENT_PIN_SESSION_KEY = 'study-check.parent-pin.v1';
const LOCAL_PIN_KEY = 'study-check.local-pin.v1';

export function isPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/* ---------------------------------------------------------------- */
/* 이번 세션에서 잠금을 푼 PIN                                        */
/* ---------------------------------------------------------------- */

export function readSessionPin(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(PARENT_PIN_SESSION_KEY);
    return value && isPinFormat(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeSessionPin(pin: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PARENT_PIN_SESSION_KEY, pin);
  } catch {
    /* 사생활 보호 모드 등: 이번 화면에서만 기억하고 넘어갑니다. */
  }
}

export function clearSessionPin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PARENT_PIN_SESSION_KEY);
  } catch {
    /* 무시 */
  }
}

/* ---------------------------------------------------------------- */
/* 기기 저장(데모) 모드용 PIN                                          */
/* ---------------------------------------------------------------- */

interface LocalPinRecord {
  salt: string;
  hash: string;
}

function readLocalPin(): LocalPinRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_PIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalPinRecord>;
    if (typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') return null;
    return { salt: parsed.salt, hash: parsed.hash };
  } catch {
    return null;
  }
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** 프로필 PIN 한 개의 저장 모양 — 평문은 두지 않고 솔트+해시만 */
export interface HashedPin {
  salt: string;
  hash: string;
}

/** 4자리 PIN 을 솔트+해시로 바꿉니다(가족 설정 JSON 에 이 모양으로 저장). */
export async function hashPin(pin: string): Promise<HashedPin> {
  const salt = randomHex(16);
  return { salt, hash: await sha256Hex(`${salt}:${pin}`) };
}

/** 저장된 솔트+해시와 입력한 PIN 이 같은지 */
export async function verifyHashedPin(pin: string, record: HashedPin | null | undefined): Promise<boolean> {
  if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  try {
    const hash = await sha256Hex(`${record.salt}:${pin}`);
    return hash === record.hash;
  } catch {
    return false;
  }
}

export function hasLocalPin(): boolean {
  return readLocalPin() !== null;
}

/** 이 기기에만 쓰는 PIN 을 정합니다. (데모 모드) */
export async function setLocalPin(pin: string): Promise<void> {
  const salt = randomHex(16);
  const hash = await sha256Hex(`${salt}:${pin}`);
  window.localStorage.setItem(LOCAL_PIN_KEY, JSON.stringify({ salt, hash } satisfies LocalPinRecord));
}

/** 이 기기에 정해 둔 PIN 과 같은지 확인합니다. (데모 모드) */
export async function verifyLocalPin(pin: string): Promise<boolean> {
  const record = readLocalPin();
  if (!record) return false;
  const hash = await sha256Hex(`${record.salt}:${pin}`);
  return hash === record.hash;
}
