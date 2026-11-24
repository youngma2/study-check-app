#!/usr/bin/env node
/**
 * supabase/schema.sql → public/setup.html
 *
 * 폰에서 SQL 을 복사해 Supabase SQL Editor 에 붙여넣기 쉽도록,
 * 배포 페이지에 'SQL 전체 복사' 버튼이 있는 설정 안내 페이지를 만듭니다.
 * (schema.sql 이 유일한 원본입니다. 이 파일은 빌드할 때마다 새로 생성됩니다.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8').trim();
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
      .card { background: #fff; border-radius: 18px; padding: 16px; box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 8px 24px -16px rgba(15,23,42,.2); }
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
      #msg { min-height: 16px; margin: 0 0 8px; font-size: 11.5px; font-weight: 700; color: #059669; }
      pre {
        margin: 0; padding: 12px; max-height: 46vh; overflow: auto;
        background: #0f172a; color: #e2e8f0; border-radius: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10.5px; line-height: 1.55; white-space: pre; tab-size: 2;
      }
      .links { margin-top: 16px; }
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
      <h1>가족 동기화 설정</h1>
      <p class="sub">Supabase SQL 한 번만 실행하면 폰끼리 실시간으로 이어집니다.</p>

      <section class="card">
        <ol>
          <li>Supabase 대시보드 → 왼쪽 <b>SQL Editor</b> → <b>New query</b></li>
          <li>아래 <b>SQL 전체 복사</b> 누르고 붙여넣기</li>
          <li>오른쪽 아래 <b>Run</b> (또는 Ctrl/⌘ + Enter)</li>
          <li>이 앱을 다시 열면 가족끼리 실시간 동기화가 켜집니다</li>
        </ol>
        <p class="note" style="margin: -6px 0 12px;">
          이 SQL 은 공부 목록 표와 함께 <b>💬 우리 가족 한마디</b> 알림판 표(family_notes)도 만들어 줍니다.
        </p>

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
      const msg = document.getElementById('msg');

      async function copyAll() {
        try {
          await navigator.clipboard.writeText(sqlText);
          msg.textContent = '복사했어요. Supabase SQL Editor 에 붙여넣으세요.';
          return;
        } catch (error) {
          // 클립보드 권한이 없을 때: 전체 선택 후 복사 안내
        }
        const area = document.createElement('textarea');
        area.value = sqlText;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let done = false;
        try { done = document.execCommand('copy'); } catch (error) { done = false; }
        document.body.removeChild(area);
        msg.textContent = done
          ? '복사했어요. Supabase SQL Editor 에 붙여넣으세요.'
          : '자동 복사가 안 됐어요. 아래 SQL 을 길게 눌러 전체 선택 → 복사해 주세요.';
      }

      document.getElementById('copy').addEventListener('click', copyAll);
      document.getElementById('download').addEventListener('click', () => {
        const blob = new Blob([sqlText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'study-check-schema.sql';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
    </script>
  </body>
</html>
`;

writeFileSync(join(root, 'public', 'setup.html'), html);
console.log(`setup.html 생성 (${sql.split('\n').length}줄 SQL)`);
