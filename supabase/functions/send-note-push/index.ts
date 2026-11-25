/**
 * 🔔 send-note-push — 새 한마디를 가족 폰의 OS 알림으로 보내는 Edge Function
 *
 * 부르는 곳
 *   1) DB 트리거(public.study_push_note_alert) — family_notes INSERT 직후
 *        body: { note_id } , header: x-study-hook: <push_config.hook_secret>
 *   2) 앱의 '알림 켜기' — VAPID 공개키를 받아 갈 때
 *        body: { action: 'config' }  → { ok, publicKey }
 *
 * 하는 일
 *   · 한 번도 안 보낸 한마디인지 DB 에서 원자적으로 표시(push_sent_at)해 두 번 울리지 않게 합니다.
 *   · 같은 가족의 구독 중 '글쓴이 기기'는 빼고, RFC 8291 암호문 + VAPID 서명으로 push 서비스를 부릅니다.
 *   · 404/410(없어진 기기), 401/403(키가 바뀐 구독)은 구독 표에서 지웁니다.
 *
 * 필요한 환경변수(자동으로 들어 있습니다)
 *   SUPABASE_URL, SUPABASE_SECRET_KEYS(또는 SUPABASE_SERVICE_ROLE_KEY)
 * 따로 넣을 비밀값은 없습니다. VAPID 키는 이 함수가 처음 불릴 때 만들어 push_config 에 저장합니다.
 */

import { encryptPayload, generateVapidKeys, vapidAuthHeader, type VapidKeys } from './webpush.ts';

const PROJECT_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');

/** service_role 권한 키 — 새 API 키(JSON)와 옛 키 이름을 모두 받습니다. */
function serviceKey(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      const value = parsed.default ?? Object.values(parsed)[0];
      if (value) return value;
    } catch {
      /* 아래 옛 이름으로 넘어갑니다. */
    }
  }
  // 옛 이름(2026년 말까지 제공)도 함께 받습니다.
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const SERVICE_KEY = serviceKey();

/** VAPID sub — 연락 가능한 주소(mailto/http). iOS 는 형식을 까다롭게 봅니다. */
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://youngma2.github.io/study-check-app/';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-study-hook',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* ------------------------------------------------------------------ */
/* PostgREST (service_role — RLS 를 지나갑니다)                          */
/* ------------------------------------------------------------------ */

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
    body: init.body as BodyInit | undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status} ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : null;
}

async function configValue(key: string): Promise<string | null> {
  const rows = await rest<Array<{ value: string }>>(
    `push_config?key=eq.${encodeURIComponent(key)}&select=value`,
  );
  return rows?.[0]?.value ?? null;
}

/** VAPID 키를 읽고, 없으면 만들어 저장합니다(동시 호출이 겹쳐도 한 쌍만 남습니다). */
async function ensureVapidKeys(): Promise<VapidKeys> {
  const publicKey = await configValue('vapid_public_key');
  const privateJwkRaw = await configValue('vapid_private_jwk');
  if (publicKey && privateJwkRaw) {
    return { publicKey, privateJwk: JSON.parse(privateJwkRaw) as JsonWebKey };
  }

  const generated = await generateVapidKeys();
  await rest('push_config?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([
      { key: 'vapid_public_key', value: generated.publicKey },
      { key: 'vapid_private_jwk', value: JSON.stringify(generated.privateJwk) },
    ]),
  });

  // 먼저 저장된 쪽이 이깁니다(경쟁 상태에서도 모두 같은 키를 씁니다).
  const storedPublic = await configValue('vapid_public_key');
  const storedPrivate = await configValue('vapid_private_jwk');
  if (storedPublic && storedPrivate) {
    return { publicKey: storedPublic, privateJwk: JSON.parse(storedPrivate) as JsonWebKey };
  }
  return generated;
}

/* ------------------------------------------------------------------ */
/* 알림 보내기                                                          */
/* ------------------------------------------------------------------ */

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  member_id: string;
}

interface NoteRow {
  id: string;
  family_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

/** 한마디가 붙는 날짜(앱의 알림판과 같은 규칙: id 에 박힌 날짜 → 없으면 한국 날짜). */
export function noteDate(note: Pick<NoteRow, 'id' | 'created_at'>): string {
  const fromId = /^n_(\d{4}-\d{2}-\d{2})_/.exec(note.id);
  if (fromId) return fromId[1];
  const created = new Date(note.created_at);
  if (Number.isNaN(created.getTime())) return '';
  // 한국 시간(KST, UTC+9) 기준 날짜 — Intl 없이 계산해 런타임 ICU 에 기대지 않습니다.
  return new Date(created.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function sendToSubscription(
  sub: SubscriptionRow,
  payload: unknown,
  keys: VapidKeys,
): Promise<number> {
  const body = await encryptPayload(
    new TextEncoder().encode(JSON.stringify(payload)),
    sub.p256dh,
    sub.auth,
  );
  const authorization = await vapidAuthHeader(sub.endpoint, keys, SUBJECT);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    // Uint8Array 를 그대로 본문으로 보냅니다(TS 의 BodyInit 검사만 통과시키는 캐스팅).
    body: body as unknown as BodyInit,
  });
  // 응답 본문을 읽어 두어야 연결이 정리됩니다.
  await res.text().catch(() => '');
  return res.status;
}

async function dropSubscription(endpoint: string): Promise<void> {
  await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* 본체                                                               */
/* ------------------------------------------------------------------ */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const action = String(body.action ?? url.searchParams.get('action') ?? 'note');

  try {
    if (!PROJECT_URL || !SERVICE_KEY) {
      return json({ ok: false, error: 'SUPABASE_URL / 서버 키가 없습니다.' }, 500);
    }

    if (action === 'config' || action === 'init') {
      const keys = await ensureVapidKeys();
      return json({ ok: true, publicKey: keys.publicKey });
    }

    if (action === 'health') {
      const [subs, config] = await Promise.all([
        rest<Array<{ endpoint: string }>>('push_subscriptions?select=endpoint'),
        rest<Array<{ key: string }>>('push_config?select=key'),
      ]);
      return json({
        ok: true,
        subscriptions: subs?.length ?? 0,
        configKeys: (config ?? []).map((row) => row.key),
        serviceKeyPresent: Boolean(SERVICE_KEY),
      });
    }

    const noteId = String(body.note_id ?? url.searchParams.get('note_id') ?? '');
    if (!noteId) return json({ ok: false, error: 'note_id 가 필요합니다.' }, 400);

    const expectedHook = await configValue('hook_secret');
    const hook = req.headers.get('x-study-hook') ?? url.searchParams.get('hook') ?? '';
    if (!expectedHook || hook !== expectedHook) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }

    // 한마디 하나에 한 번만: 아직 안 보낸 글이면 지금 보낸다고 먼저 표시합니다.
    const claimed = await rest<NoteRow[]>(
      `family_notes?id=eq.${encodeURIComponent(noteId)}&push_sent_at=is.null&select=id,family_id,author_id,content,created_at`,
      { method: 'PATCH', body: JSON.stringify({ push_sent_at: new Date().toISOString() }) },
    );
    if (!claimed || claimed.length === 0) return json({ ok: true, skipped: 'already-sent' });
    const note = claimed[0];

    // 너무 옛 글(트리거 재시도 등)은 울리지 않습니다.
    const age = Date.now() - Date.parse(note.created_at);
    if (Number.isFinite(age) && age > 15 * 60_000) return json({ ok: true, skipped: 'stale' });

    const [subs, authors, keys] = await Promise.all([
      rest<SubscriptionRow[]>(
        `push_subscriptions?family_id=eq.${encodeURIComponent(note.family_id)}&select=endpoint,p256dh,auth,member_id`,
      ),
      rest<Array<{ id: string; name: string }>>(
        `family_members?id=eq.${encodeURIComponent(note.author_id)}&select=id,name`,
      ),
      ensureVapidKeys(),
    ]);

    const targets = (subs ?? []).filter((sub) => sub.member_id !== note.author_id);
    if (targets.length === 0) return json({ ok: true, sent: 0, note: note.id });

    const authorName = authors?.[0]?.name ?? '가족';
    const date = noteDate(note);
    const payload = {
      title: '💬 우리 가족 한마디',
      body: `${authorName}: ${shorten(note.content, 160)}`,
      tag: `study-note-${note.id}`,
      noteId: note.id,
      date,
      // 누르면 그 날짜의 알림판으로 바로 열립니다(앱의 deepLinkDate 가 받는 형식).
      url: `./#date=${date}&note=${encodeURIComponent(note.id)}`,
    };

    const results = await Promise.allSettled(
      targets.map(async (sub) => {
        const status = await sendToSubscription(sub, payload, keys);
        if ([401, 403, 404, 410].includes(status)) {
          await dropSubscription(sub.endpoint);
        }
        return { status };
      }),
    );

    let sent = 0;
    let dropped = 0;
    const statuses: number[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        statuses.push(result.value.status);
        if (result.value.status >= 200 && result.value.status < 300) sent += 1;
        if ([401, 403, 404, 410].includes(result.value.status)) dropped += 1;
      } else {
        statuses.push(0);
      }
    }

    return json({ ok: true, note: note.id, targets: targets.length, sent, dropped, statuses });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
