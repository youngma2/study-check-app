import { supabasePublicConfig, type SupabaseStorageAdapter } from './supabase';

/**
 * 🔔 백그라운드 알림(Web Push) — 앱을 완전히 닫아 둬도 폰 알림이 오게 합니다.
 *
 * 동작
 *   · 알림 권한을 받고, 서비스 워커에서 구독(pushManager.subscribe)을 만듭니다.
 *   · 구독 주소·공개키를 Supabase(study_register_push)에 올립니다.
 *     → 새 한마디가 올라오면 DB 트리거가 Edge Function 을 불러 이 기기로 push 를 보냅니다.
 *   · 이미 알림을 허용해 둔 기기는 앱을 열 때마다 조용히 다시 맞춰 둡니다
 *     (구독이 바뀌었거나 오래돼 끊겼을 때 스스로 회복).
 */

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';
export type PushResult = { ok: boolean; error?: string };

export function pushPermissionState(): PushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PushPermission;
}

/** iOS 16.4+ 는 '홈 화면에 추가'한 뒤에만 pushManager 가 생깁니다. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: ArrayBuffer | null | undefined): string | null {
  if (!bytes) return null;
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    // 아직 등록 중이면 조금 기다립니다(첫 방문 직후).
    return await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise((resolve) => window.setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return null;
  }
}

async function getOrCreateSubscription(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription | null> {
  let subscription = await registration.pushManager.getSubscription();

  // 예전에 다른 키로 구독했으면(키를 새로 만든 경우) 버리고 다시 만듭니다.
  if (subscription) {
    const currentKey = toBase64Url(subscription.options?.applicationServerKey ?? null);
    if (currentKey && currentKey !== publicKey) {
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // TS 의 BufferSource 엄격 검사만 통과시키는 캐스팅(실제로는 Uint8Array 그대로).
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
  }
  return subscription;
}

/** 서비스 워커에 '구독이 갱신되면 스스로 다시 등록하라'고 알려 줄 값을 넘깁니다. */
async function shareConfigWithWorker(
  registration: ServiceWorkerRegistration,
  publicKey: string,
  actorId: string,
): Promise<void> {
  const config = supabasePublicConfig();
  const worker = registration.active ?? navigator.serviceWorker.controller;
  if (!config || !worker) return;
  worker.postMessage({
    type: 'study-push-config',
    config: { vapidKey: publicKey, supabaseUrl: config.url, anonKey: config.anonKey, actorId },
  });
}

/** 지금 기기를 알림 대상으로 등록(또는 갱신)합니다. */
async function ensureSubscription(
  cloud: SupabaseStorageAdapter,
  actorId: string,
): Promise<PushResult> {
  const registration = await readyRegistration();
  if (!registration) {
    return { ok: false, error: '앱 준비가 아직 안 끝났어요. 잠시 뒤 다시 시도해 주세요.' };
  }

  const publicKey = await cloud.ensurePushPublicKey();
  if (!publicKey) {
    // 설정 전(함수 배포 전) — 앱 안 알림은 그대로 동작합니다.
    return { ok: false, error: '폰 알림은 아직 준비 중이에요(앱 안 알림은 켜 두었어요).' };
  }

  const subscription = await getOrCreateSubscription(registration, publicKey);
  const json = subscription?.toJSON();
  const keys = json?.keys;
  if (!json?.endpoint || !keys?.p256dh || !keys?.auth) {
    return { ok: false, error: '알림 등록 정보를 읽지 못했어요.' };
  }

  await cloud.registerPushDevice(actorId, json.endpoint, keys.p256dh, keys.auth, navigator.userAgent);
  await shareConfigWithWorker(registration, publicKey, actorId);
  return { ok: true };
}

/** '알림 켜기' 버튼 — 권한을 묻고, 이 기기를 가족 알림에 등록합니다. */
export async function enablePushNotifications(
  cloud: SupabaseStorageAdapter | null,
  actorId: string,
): Promise<PushResult> {
  if (!pushSupported()) {
    return {
      ok: false,
      error: '이 브라우저는 백그라운드 알림을 못 써요. (아이폰은 홈 화면에 추가한 뒤 열어 주세요)',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  if (permission !== 'granted') {
    return { ok: false, error: '알림 권한을 허용해야 폰 알림이 와요.' };
  }
  if (!cloud) {
    return { ok: false, error: '가족 동기화가 연결된 뒤에 알림을 켤 수 있어요.' };
  }

  try {
    return await ensureSubscription(cloud, actorId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '알림을 켜지 못했어요.',
    };
  }
}

/**
 * 앱을 열 때마다 조용히 다시 맞춥니다.
 * (이미 권한을 허용해 둔 기기는 버튼 없이도 백그라운드 알림이 켜집니다)
 */
export async function syncPushRegistration(
  cloud: SupabaseStorageAdapter | null,
  actorId: string,
): Promise<void> {
  try {
    if (!cloud || !pushSupported() || Notification.permission !== 'granted') return;
    await ensureSubscription(cloud, actorId);
  } catch {
    /* 알림은 '되면 좋은' 기능이라 실패해도 조용히 넘어갑니다. */
  }
}

/** 이 기기가 실제로 push 구독을 갖고 있는지(설정 화면 표시용). */
export async function hasPushSubscription(): Promise<boolean> {
  const registration = await readyRegistration();
  if (!registration) return false;
  try {
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}
