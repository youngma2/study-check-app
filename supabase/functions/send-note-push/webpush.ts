/**
 * Web Push 암호화 — 외부 라이브러리 없이 WebCrypto 만으로.
 *
 * · 본문: RFC 8291 (Message Encryption for Web Push) + RFC 8188 (aes128gcm)
 * · 서명: RFC 8292 (VAPID, ES256)
 *
 * Deno(Edge Function)·Node(테스트)·브라우저 어디서나 같은 코드로 돌아갑니다.
 * (crypto.subtle / TextEncoder / btoa / atob 만 씁니다)
 */

const encoder = new TextEncoder();

export type VapidKeys = {
  /** base64url 로 인코딩한 비압축 공개키(65바이트, 0x04 로 시작) */
  publicKey: string;
  /** P-256 개인키 JWK (x, y, d) */
  privateJwk: JsonWebKey;
};

/* ------------------------------------------------------------------ */
/* base64url                                                          */
/* ------------------------------------------------------------------ */

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/').trim();
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ */
/* 작은 도우미                                                         */
/* ------------------------------------------------------------------ */

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

/** TS 의 BufferSource 검사만 통과시키는 얇은 캐스팅(런타임 동작 없음). */
function view(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', view(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, view(data)));
}

/** HKDF(Extract + Expand) — RFC 5869 */
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const blocks: Uint8Array[] = [];
  let block: Uint8Array = new Uint8Array(0);
  let size = 0;
  for (let counter = 1; size < length; counter += 1) {
    block = await hmacSha256(prk, concatBytes(block, info, new Uint8Array([counter])));
    blocks.push(block);
    size += block.length;
  }
  return concatBytes(...blocks).slice(0, length);
}

/* ------------------------------------------------------------------ */
/* 본문 암호화 (RFC 8291 · aes128gcm)                                   */
/* ------------------------------------------------------------------ */

const RECORD_SIZE = 4096;
const INFO_PREFIX = encoder.encode('WebPush: info');
const CEK_INFO = encoder.encode('Content-Encoding: aes128gcm');
const NONCE_INFO = encoder.encode('Content-Encoding: nonce');

/**
 * 구독(p256dh·auth) 하나에 보낼 암호문을 만듭니다.
 * 돌려주는 바이트가 그대로 push 서비스로 가는 본문입니다.
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dhBase64: string,
  authBase64: string,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dhBase64); // 기기 공개키 65바이트
  const authSecret = b64urlDecode(authBase64); // 인증 비밀값 16바이트
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('구독 공개키(p256dh) 형식이 올바르지 않습니다.');
  }

  // 서버(보내는 쪽)의 일회용 ECDH 키
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    view(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(
    ecdhSecret,
    authSecret,
    concatBytes(INFO_PREFIX, new Uint8Array([0]), uaPublic, asPublic),
    32,
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, concatBytes(CEK_INFO, new Uint8Array([0])), 16);
  const nonce = await hkdf(ikm, salt, concatBytes(NONCE_INFO, new Uint8Array([0])), 12);

  // 마지막 레코드 표시(0x02)를 본문 끝에 붙입니다.
  const plaintext = concatBytes(payload, new Uint8Array([0x02]));
  const key = await crypto.subtle.importKey('raw', view(cek), 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: view(nonce), tagLength: 128 }, key, view(plaintext)),
  );

  // aes128gcm 헤더: salt(16) | rs(4) | idlen(1) | keyid(=as_public)
  return concatBytes(salt, uint32(RECORD_SIZE), new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/* ------------------------------------------------------------------ */
/* VAPID (RFC 8292)                                                    */
/* ------------------------------------------------------------------ */

/**
 * push 서비스에 붙일 Authorization 헤더 값.
 * `vapid t=<ES256 JWT>, k=<공개키>`
 */
export async function vapidAuthHeader(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(nowMs / 1000) + 12 * 60 * 60, // Apple 은 24시간 이내만 받습니다.
    sub: subject,
  };

  const signingInput = `${b64urlEncode(encoder.encode(JSON.stringify(header)))}.${b64urlEncode(
    encoder.encode(JSON.stringify(claims)),
  )}`;

  const { kty, crv, x, y, d } = keys.privateJwk;
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty, crv, x, y, d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(signingInput)),
  );

  return `vapid t=${signingInput}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

/* ------------------------------------------------------------------ */
/* 키 만들기                                                            */
/* ------------------------------------------------------------------ */

/** VAPID 키 한 쌍(서명용 P-256). 처음 한 번만 만들어 DB 에 저장합니다. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: b64urlEncode(raw),
    privateJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
  };
}
