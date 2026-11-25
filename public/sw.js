/* 공부 체크 — 최소 PWA 서비스 워커
   네트워크 우선(network-first): 새 배포가 있으면 바로 반영되고,
   네트워크가 실패하거나 오프라인일 때만 캐시된 앱 셸을 씁니다.
   🔔 앱을 닫아 둬도 오는 백그라운드 알림(push)도 여기서 받습니다. */
const CACHE_NAME = 'study-check-shell-v4';
const SCOPE = new URL('./', self.location.href);
const SHELL = [
  '',
  'manifest.json?v=3',
  'icons/icon-192.png?v=3',
  'icons/icon-512.png?v=3',
  'icons/icon-maskable-512.png?v=3',
  'icons/apple-touch-icon.png?v=3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL.map((path) => new URL(path, SCOPE).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await cache.match(SCOPE.href);
      if (shell) return shell;
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* 🔔 백그라운드 알림                                                  */
/* ------------------------------------------------------------------ */

function urlBase64ToUint8Array(base64) {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** push 서비스가 보낸 알림을 그대로 폰 알림으로 띄웁니다. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '💬 우리 가족 한마디';
  const options = {
    body: data.body || '',
    icon: new URL('icons/icon-192.png', SCOPE).href,
    badge: new URL('icons/icon-192.png', SCOPE).href,
    tag: data.tag || 'study-note',
    lang: 'ko',
    vibrate: [150, 80, 150],
    data: {
      url: data.url || './',
      date: data.date || '',
      noteId: data.noteId || '',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** 알림을 누르면 그 한마디가 붙은 날짜의 알림판으로 갑니다. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', SCOPE).href;
  const message = {
    type: 'study-note-open',
    date: (event.notification.data && event.notification.data.date) || '',
    noteId: (event.notification.data && event.notification.data.noteId) || '',
  };

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const ours = clients.find((client) => client.url.startsWith(SCOPE.href));
      if (ours) {
        await ours.focus();
        ours.postMessage(message);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* 앱이 페이지에서 받은 설정(공개키·함수 주소·사용자)을 기억해 둡니다.
   구독이 갱신되면(pushsubscriptionchange) 앱을 열지 않아도 다시 등록합니다. */
const IDB_NAME = 'study-check-push';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('config')) request.result.createObjectStore('config');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('config', 'readonly');
      const request = tx.objectStore('config').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('config', 'readwrite');
      tx.objectStore('config').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 저장이 안 되면 다음에 앱을 열 때 다시 받습니다. */
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'study-push-config' && data.config) {
    event.waitUntil(idbSet('config', data.config));
  }
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const config = await idbGet('config');
        if (!config || !config.vapidKey) return;
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidKey),
        });
        const json = subscription.toJSON();
        await fetch(`${config.supabaseUrl}/rest/v1/rpc/study_register_push`, {
          method: 'POST',
          headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_actor_id: config.actorId,
            p_endpoint: json.endpoint,
            p_p256dh: json.keys && json.keys.p256dh,
            p_auth: json.keys && json.keys.auth,
            p_user_agent: self.navigator.userAgent,
          }),
        });
      } catch {
        /* 다음에 앱을 열 때 다시 등록합니다. */
      }
    })(),
  );
});
