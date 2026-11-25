#!/usr/bin/env node
/**
 * Web Push 암호화 자체 검사 — 실제 브라우저가 하는 일을 Node 로 흉내 냅니다.
 *
 *   1) '폰'이 구독 키(p256dh·auth)를 만든다 (브라우저가 하는 것과 같은 P-256 ECDH)
 *   2) Edge Function 코드(webpush.ts)로 본문을 암호화한다
 *   3) 폰 입장에서 RFC 8291/8188 대로 복호화해 원문과 같은지 본다
 *   4) VAPID JWT 를 공개키로 검증한다 (헤더·aud·exp·sub)
 *
 * 실행: node scripts/test-webpush.mjs   (또는 npm run test:push)
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const tsEntry = join(root, 'supabase/functions/send-note-push/webpush.ts');

// 1) TypeScript 를 그대로 Node 가 읽을 수 있게 임시 폴더로 컴파일합니다.
const outDir = mkdtempSync(join(tmpdir(), 'webpush-test-'));
execFileSync(
  join(root, 'node_modules/.bin/tsc'),
  [tsEntry, '--outDir', outDir, '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'bundler', '--lib', 'es2022,dom', '--skipLibCheck'],
  { stdio: 'inherit' },
);
writeFileSync(join(outDir, 'package.json'), '{"type":"module"}');
const lib = await import(pathToFileURL(join(outDir, 'webpush.js')).href);
const { b64urlEncode, b64urlDecode, encryptPayload, generateVapidKeys, vapidAuthHeader } = lib;

const encoder = new TextEncoder();
let failed = 0;
function check(name, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failed += 1;
}

/* ------------------------------------------------------------------ */
/* 폰(브라우저) 쪽 흉내                                                */
/* ------------------------------------------------------------------ */

async function makeBrowserSubscription() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { keys, uaPublic, authSecret, p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(authSecret) };
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function hkdf(ikm, salt, info, length) {
  const prk = await hmac(salt, ikm);
  const blocks = [];
  let block = new Uint8Array(0);
  let size = 0;
  for (let counter = 1; size < length; counter += 1) {
    block = await hmac(prk, concat(block, info, new Uint8Array([counter])));
    blocks.push(block);
    size += block.length;
  }
  return concat(...blocks).slice(0, length);
}

/** 브라우저가 push 본문을 받았을 때 하는 복호화 (RFC 8291 · aes128gcm) */
async function decryptAsBrowser(body, subscription) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);

  if (asPublic.length !== 65 || asPublic[0] !== 0x04) throw new Error('서버 공개키 형식 오류');

  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, subscription.keys.privateKey, 256),
  );

  const ikm = await hkdf(
    ecdhSecret,
    subscription.authSecret,
    concat(encoder.encode('WebPush: info'), new Uint8Array([0]), subscription.uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(ikm, salt, concat(encoder.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(ikm, salt, concat(encoder.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext));

  // 레코드 구분자(0x02) 떼기
  const end = plain.length;
  const delimiter = plain[end - 1];
  return { rs, data: plain.slice(0, end - 1), delimiter };
}

/* ------------------------------------------------------------------ */
/* 1. 본문 암호화 라운드트립                                           */
/* ------------------------------------------------------------------ */

{
  const sub = await makeBrowserSubscription();
  const message = JSON.stringify({
    title: '💬 우리 가족 한마디',
    body: '아빠: 토요일 10시에 독서록 검사할게요. 책 3권 읽고 오기!',
    tag: 'study-note-n_2026-11-25_abc123',
    date: '2026-11-25',
  });
  const body = await encryptPayload(encoder.encode(message), sub.p256dh, sub.auth);
  const { rs, data, delimiter } = await decryptAsBrowser(body, sub);
  check('본문 라운드트립(한국어 JSON)', new TextDecoder().decode(data) === message, `${body.length}바이트`);
  check('레코드 크기 4096', rs === 4096, `rs=${rs}`);
  check('마지막 레코드 표시 0x02', delimiter === 2, `0x0${delimiter.toString(16)}`);
  check('헤더 keyid = 서버 공개키(65B)', body[20] === 65);
}

/* ------------------------------------------------------------------ */
/* 2. 매번 다른 salt·키 → 같은 본문도 다른 암호문                      */
/* ------------------------------------------------------------------ */

{
  const sub = await makeBrowserSubscription();
  const text = encoder.encode('같은 글');
  const a = await encryptPayload(text, sub.p256dh, sub.auth);
  const b = await encryptPayload(text, sub.p256dh, sub.auth);
  check('암호문은 매번 달라진다(일회용 키)', Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0);

  const opened = await decryptAsBrowser(b, sub);
  check('두 번째 암호문도 복호화', new TextDecoder().decode(opened.data) === '같은 글');
}

/* ------------------------------------------------------------------ */
/* 3. 다른 기기(다른 auth)로는 복호화되지 않는다                       */
/* ------------------------------------------------------------------ */

{
  const sub = await makeBrowserSubscription();
  const other = await makeBrowserSubscription();
  const body = await encryptPayload(encoder.encode('비밀'), sub.p256dh, sub.auth);
  let opened = false;
  try {
    const wrong = { ...other, uaPublic: other.uaPublic };
    await decryptAsBrowser(body, wrong);
    opened = true;
  } catch {
    opened = false;
  }
  check('다른 기기 키로는 열리지 않는다', opened === false);
}

/* ------------------------------------------------------------------ */
/* 4. 긴 본문(한글 300자)도 한 레코드에 들어간다                       */
/* ------------------------------------------------------------------ */

{
  const sub = await makeBrowserSubscription();
  const long = '가'.repeat(300);
  const body = await encryptPayload(encoder.encode(long), sub.p256dh, sub.auth);
  const { data } = await decryptAsBrowser(body, sub);
  check('한글 300자(900바이트) 라운드트립', new TextDecoder().decode(data) === long, `${body.length}바이트`);
  check('최대 페이로드(4096) 이하', body.length < 4096);
}

/* ------------------------------------------------------------------ */
/* 5. VAPID JWT                                                        */
/* ------------------------------------------------------------------ */

{
  const keys = await generateVapidKeys();
  const endpoint = 'https://fcm.googleapis.com/wp/dGVzdC1lbmRwb2ludA';
  const header = await vapidAuthHeader(endpoint, keys, 'https://youngma2.github.io/study-check-app/');
  check('vapid 헤더 형식', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(header), header.slice(0, 40) + '…');

  const token = header.slice('vapid t='.length, header.indexOf(', k='));
  const k = header.slice(header.indexOf(', k=') + 4);
  check('k 는 공개키와 같다', k === keys.publicKey);

  const [h, c, s] = token.split('.');
  const headerJson = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
  check('JWT 헤더 alg ES256', headerJson.alg === 'ES256' && headerJson.typ === 'JWT');

  const rawPublic = b64urlDecode(keys.publicKey);
  const publicKey = await crypto.subtle.importKey('raw', rawPublic, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    b64urlDecode(s),
    encoder.encode(`${h}.${c}`),
  );
  check('JWT 서명 검증(공개키로)', valid === true);
  check('aud = push 서비스 origin', claims.aud === 'https://fcm.googleapis.com', claims.aud);
  check('sub 는 https 주소', /^https:\/\//.test(claims.sub), claims.sub);
  const hours = (claims.exp - Math.floor(Date.now() / 1000)) / 3600;
  check('exp 24시간 이내(Apple 제한)', hours > 0 && hours <= 24, `${hours.toFixed(1)}시간`);

  // 서명이 1비트만 달라져도 검증에 실패해야 합니다.
  const broken = b64urlDecode(s);
  broken[broken.length - 1] ^= 0x01;
  const stillValid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    broken,
    encoder.encode(`${h}.${c}`),
  );
  check('변조된 서명은 거부', stillValid === false);
}

rmSync(outDir, { recursive: true, force: true });
console.log(failed === 0 ? '\n전부 통과 ✨' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
