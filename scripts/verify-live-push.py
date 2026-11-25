"""라이브 확인 — 공부 체크 새 배포(PWA + Web Push) 점검.

  · 콘솔 오류/페이지 예외 0
  · 서비스 워커 등록 + 캐시 이름(study-check-shell-v3)
  · 새 번들 로드 여부, 알림(🔔) UI 노출
  · 함수 config 호출(앱이 쓰는 경로와 같은 URL/키) 200

사용법: python3 scripts/verify-live-push.py [url]
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

URL = (sys.argv[1] if len(sys.argv) > 1 else 'https://youngma2.github.io/study-check-app/').rstrip('/') + '/'
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
FN = 'https://trhcatbuoslyjdhezobz.supabase.co/functions/v1/send-note-push'
KEY = 'sb_publishable_fPzIYHLYLbVmsPB6tLaUNw_z6sAnxbj'

env = dict(os.environ)
env['LD_LIBRARY_PATH'] = CHROME_LIBS + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')

report: dict = {'url': URL}

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=CHROME,
        args=['--no-sandbox', '--disable-dev-shm-usage'],
        env=env,
    )
    ctx = browser.new_context(viewport={'width': 430, 'height': 900}, locale='ko-KR', timezone_id='Asia/Seoul')
    page = ctx.new_page()
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on('console', lambda m: console_errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: page_errors.append(str(e)))

    resp = page.goto(URL, wait_until='networkidle', timeout=60000)
    report['http'] = resp.status if resp else None
    page.wait_for_timeout(2500)

    report['title'] = page.title()
    report['js_bundles'] = page.evaluate(
        "() => Array.from(document.querySelectorAll('script')).map(s => s.src).filter(Boolean).map(s => s.split('/').pop())"
    )
    body = page.inner_text('body')
    report['rendered_chars'] = len(body)
    report['has_app_shell'] = any(k in body for k in ('공부', '숙제', '우리 가족'))
    report['has_push_ui'] = ('알림' in body)

    # 서비스 워커 등록 + 캐시 이름
    try:
        page.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.getRegistration()', timeout=20000)
        page.wait_for_timeout(1500)
        report['sw'] = page.evaluate(
            """async () => {
              const reg = await navigator.serviceWorker.getRegistration();
              if (!reg) return {registered: false};
              return {
                registered: true,
                scope: reg.scope,
                active: reg.active ? reg.active.scriptURL.split('/').pop() : null,
                state: reg.active ? reg.active.state : null,
                controlled: !!navigator.serviceWorker.controller,
              };
            }"""
        )
    except Exception as exc:  # noqa: BLE001
        report['sw'] = {'registered': False, 'error': str(exc)[:200]}

    # sw.js 가 실제로 v3 인지 (캐시 우회)
    try:
        report['sw_version'] = page.evaluate(
            """async () => {
              const r = await fetch('./sw.js?cb=' + Date.now(), {cache: 'no-store'});
              const t = await r.text();
              const m = t.match(/study-check-shell-v[0-9]+/);
              return m ? m[0] : null;
            }"""
        )
    except Exception as exc:  # noqa: BLE001
        report['sw_version'] = f'error: {exc}'[:200]

    report['console_errors'] = console_errors
    report['page_errors'] = page_errors

    ctx.close()
    browser.close()

# 앱이 쓰는 경로 그대로 함수 config 호출
try:
    req = urllib.request.Request(
        FN,
        data=json.dumps({'action': 'config'}).encode(),
        headers={'apikey': KEY, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        report['fn_config_status'] = r.status
        report['fn_config_body'] = json.loads(r.read().decode())
except Exception as exc:  # noqa: BLE001
    report['fn_config_status'] = f'error: {exc}'

print(json.dumps(report, ensure_ascii=False, indent=2))
