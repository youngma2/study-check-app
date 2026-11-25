#!/usr/bin/env node
/**
 * supabase/schema.sql → public/setup.html
 *
 * 폰에서 SQL 을 복사해 Supabase SQL Editor 에 붙여넣기 쉽도록,
 * 배포 페이지에 'SQL 전체 복사' 버튼이 있는 설정 안내 페이지를 만듭니다.
 * 🔔 백그라운드 알림 함수(send-note-push) 코드도 여기서 한 번에 복사할 수 있습니다.
 * (schema.sql 과 functions/ 가 유일한 원본입니다. 이 파일은 빌드할 때마다 새로 생성됩니다.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8').trim();

/* 🔔 함수는 대시보드에 '한 파일'로 붙여넣을 수 있게 webpush.ts 를 index.ts 안으로 합칩니다. */
const fnDir = join(root, 'supabase', 'functions', 'send-note-push');
const fnIndex = readFileSync(join(fnDir, 'index.ts'), 'utf8');
const fnLib = readFileSync(join(fnDir, 'webpush.ts'), 'utf8');
const stripExports = (code) =>
  code.replace(/^export\s+(async function|function|const|let|type|interface|class)\b/gm, '$1');
const fnCode = fnIndex
  .replace(
    /^import\s*\{[\s\S]*?\}\s*from\s*'\.\/webpush\.ts';\s*$/m,
    `/* ------------------------------------------------------------------ */\n/* webpush.ts (같은 폴더의 암호화 코드 — 한 파일로 붙여넣을 수 있게 합쳤습니다) */\n/* ------------------------------------------------------------------ */\n\n${stripExports(fnLib).trim()}\n`,
  )
  .trim();

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>공부 체크 · 가족 동기화 설정</title>
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 20px 16px calc(28px + env(safe-area-inset-bottom));
        background: #f5f6fa; color: #0f172a;
        font-family: Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif;
        -webkit-text-size-adjust: 100%;
      }
      main { max-width: 640px; margin: 0 auto; }
      h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: -0.02em; }
      .sub { margin: 0 0 16px; font-size: 12px; color: #64748b; font-weight: 600; }
      .card { background: #fff; border-radius: 18px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 8px 24px -16px rgba(15,23,42,.2); }
      .card h2 { font-size: 14px; margin: 0 0 2px; letter-spacing: -0.01em; }
      .card .hint { margin: 0 0 10px; font-size: 11px; color: #64748b; font-weight: 600; }
      ol { margin: 0 0 14px; padding-left: 18px; font-size: 12.5px; line-height: 1.75; color: #334155; font-weight: 600; }
      ol b { color: #4f46e5; }
      a { color: #4f46e5; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; }
      button {
        font: inherit; font-weight: 800; font-size: 12.5px; border: 0; border-radius: 12px;
        padding: 11px 14px; background: #4f46e5; color: #fff; cursor: pointer;
      }
      button.ghost { background: #eef2ff; color: #4338ca; }
      button:active { transform: scale(.98); }
      #msg, #fn-msg { min-height: 16px; margin: 0 0 8px; font-size: 11.5px; font-weight: 700; color: #059669; }
      pre {
        margin: 0; padding: 12px; max-height: 46vh; overflow: auto;
        background: #0f172a; color: #e2e8f0; border-radius: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10.5px; line-height: 1.55; white-space: pre; tab-size: 2;
      }
      .tip { margin: 10px 0 0; font-size: 10.5px; line-height: 1.6; color: #64748b; font-weight: 600; }
      .tip code { background: #f1f5f9; border-radius: 5px; padding: 1px 5px; font-size: 10px; }
      .links { margin-top: 6px; }
      .links h2 { font-size: 12px; margin: 0 0 8px; color: #64748b; letter-spacing: .02em; }
      .links a {
        display: flex; justify-content: space-between; gap: 8px; text-decoration: none;
        background: #fff; border-radius: 12px; padding: 11px 13px; margin-bottom: 6px;
        font-size: 12.5px; font-weight: 800; color: #1e293b; box-shadow: 0 1px 2px rgba(15,23,42,.05);
      }
      .links a span:last-child { color: #94a3b8; font-weight: 700; font-size: 11px; }
      .note { margin: 14px 0 0; font-size: 10.5px; line-height: 1.6; color: #94a3b8; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>가족 동기화 · 알림 설정</h1>
      <p class="sub">Supabase 에서 두 번만 붙여넣으면 폰끼리 이어지고, 앱을 닫아도 알림이 옵니다.</p>

      <section class="card">
        <h2>1. 표 만들기 (SQL 한 번)</h2>
        <p class="hint">공부 목록 · 💬 우리 가족 한마디 · 🔔 알림 구독 표가 한 번에 만들어집니다.</p>
        <ol>
          <li>Supabase 대시보드 → 왼쪽 <b>SQL Editor</b> → <b>New query</b></li>
          <li>아래 <b>SQL 전체 복사</b> 누르고 붙여넣기</li>
          <li>오른쪽 아래 <b>Run</b> (또는 Ctrl/⌘ + Enter)</li>
          <li>이 앱을 다시 열면 가족끼리 실시간 동기화가 켜집니다</li>
        </ol>

        <div class="actions">
          <button id="copy" type="button">SQL 전체 복사</button>
          <button id="download" class="ghost" type="button">.sql 파일로 저장</button>
        </div>
        <p id="msg" role="status"></p>

        <pre><code id="sql">${escapeHtml(sql)}</code></pre>

        <p class="note">
          여러 번 실행해도 이미 있는 가족·숙제는 그대로 둡니다. 다시 실행할 때 새로운 항목만 추가됩니다.
        </p>
      </section>

      <section class="card">
        <h2>2. 🔔 알림 함수 올리기 (한 번)</h2>
        <p class="hint">
          새 한마디가 올라오면 가족 폰으로 알림을 보내는 작은 서버 함수입니다.
          무료 쿼터(월 50만 회)로 충분하고, 카드 등록도 필요 없습니다.
        </p>
        <ol>
          <li>Supabase 대시보드 → 왼쪽 <b>Edge Functions</b> → <b>Deploy a new function</b></li>
          <li><b>Via Editor</b> 선택 → 이름을 <b>send-note-push</b> 로 입력</li>
          <li>편집기의 기본 코드를 모두 지우고, 아래 <b>함수 코드 복사</b> 를 붙여넣기</li>
          <li><b>Deploy</b> 누르기 (Verify JWT 설정은 <b>기본값 그대로</b> 두세요)</li>
        </ol>

        <div class="actions">
          <button id="copy-fn" type="button">함수 코드 복사</button>
          <button id="download-fn" class="ghost" type="button">.ts 파일로 저장</button>
        </div>
        <p id="fn-msg" role="status"></p>

        <pre><code id="fn">${escapeHtml(fnCode)}</code></pre>

        <p class="tip">
          비밀값(VAPID 키)은 넣지 않아도 됩니다. 함수가 처음 불릴 때 스스로 만들어
          <code>push_config</code> 에 저장합니다.<br />
          잘 올라갔는지 보려면 주소 끝에 <code>/functions/v1/send-note-push?action=health</code> 를 붙여 열어 보세요.<br />
          마지막으로 각자 폰에서 앱을 열고 <b>💬 우리 가족 한마디</b> 의 <b>🔔 알림 켜기</b> 를 한 번 누르면 끝입니다.<br />
          알림이 오지 않으면: 함수 설정에서 <b>Verify JWT</b> 를 꺼 보세요(비밀값 확인은 함수가 직접 합니다) —
          그리고 SQL Editor 에서 <code>select * from net._http_response order by created desc limit 5;</code> 로 마지막 호출 결과를 볼 수 있어요.
        </p>
      </section>

      <section class="links">
        <h2>가족 링크 (로그인 없이 바로 열려요)</h2>
        <a href="./#as=mem_dad">👨🏻 아빠 화면 <span>#as=mem_dad</span></a>
        <a href="./#as=mem_mom">👩🏻 엄마 화면 <span>#as=mem_mom</span></a>
        <a href="./#as=mem_child1">🌸 첫째 화면 <span>#as=mem_child1</span></a>
        <a href="./#as=mem_child2">⚡ 둘째 화면 <span>#as=mem_child2</span></a>
      </section>
    </main>

    <script>
      const sqlText = document.getElementById('sql').textContent;
      const fnText = document.getElementById('fn').textContent;

      async function copyText(text, okMessage, msgId) {
        const msg = document.getElementById(msgId);
        try {
          await navigator.clipboard.writeText(text);
          msg.textContent = okMessage;
          return;
        } catch (error) {
          // 클립보드 권한이 없을 때: 전체 선택 후 복사 안내
        }
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let done = false;
        try { done = document.execCommand('copy'); } catch (error) { done = false; }
        document.body.removeChild(area);
        msg.textContent = done
          ? okMessage
          : '자동 복사가 안 됐어요. 아래 코드를 길게 눌러 전체 선택 → 복사해 주세요.';
      }

      function saveText(text, filename) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      document.getElementById('copy').addEventListener('click', () =>
        copyText(sqlText, '복사했어요. Supabase SQL Editor 에 붙여넣으세요.', 'msg'),
      );
      document.getElementById('download').addEventListener('click', () =>
        saveText(sqlText, 'study-check-schema.sql'),
      );
      document.getElementById('copy-fn').addEventListener('click', () =>
        copyText(fnText, '복사했어요. Edge Functions 편집기에 붙여넣으세요.', 'fn-msg'),
      );
      document.getElementById('download-fn').addEventListener('click', () =>
        saveText(fnText, 'send-note-push.ts'),
      );
    </script>
  </body>
</html>
`;

writeFileSync(join(root, 'public', 'setup.html'), html);
console.log(
  `setup.html 생성 (SQL ${sql.split('\n').length}줄 · 함수 ${fnCode.split('\n').length}줄)`,
);
