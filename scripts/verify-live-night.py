"""①~⑤ 라이브 확인 — 실제 GitHub Pages + 실제 Supabase (읽기 전용).

    python3 scripts/verify-live-night.py

· 서비스 워커가 `study-check-shell-v10` 인지, 새 번들이 서빙되는지 봅니다.
· 아이 화면에서: 부모 도구(옵션·타이머)가 없고, 뒤로가기가 종료 확인을 띄우며, JS/콘솔 오류가 없는지.
· 실제 가족 DB 는 **읽기만** 합니다(tasks · family_tier_events 행 수 전/후 동일).
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import urllib.request
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

URL = 'https://youngma2.github.io/study-check-app/'
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
KST = timezone(timedelta(hours=9))
DOWNLOADS = pathlib.Path('/workspace/downloads')

failures: list[str] = []
checks = 0


def check(name: str, cond: bool, extra: str = '') -> None:
    global checks
    checks += 1
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
    if not cond:
        failures.append(name)


def env_pair() -> tuple[str, str]:
    values: dict[str, str] = {}
    for line in (pathlib.Path(__file__).resolve().parent.parent / '.env.local').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values['VITE_SUPABASE_URL'], values['VITE_SUPABASE_ANON_KEY']


def rest_count(path: str) -> int:
    base, key = env_pair()
    request = urllib.request.Request(
        f'{base}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        content_range = response.headers.get('content-range') or ''
    match = re.search(r'/(\d+)$', content_range)
    return int(match.group(1)) if match else -1


def fetch(path: str) -> str:
    with urllib.request.urlopen(f'{URL}{path}', timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


def main() -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    sw = fetch('sw.js?live=1')
    check('라이브 서비스 워커 캐시 v10', 'study-check-shell-v10' in sw)
    index = fetch('index.html?live=1')
    bundles = re.findall(r'assets/[\w.-]+\.js', index)
    check('라이브 index 가 번들을 가리킨다', bool(bundles), ' '.join(bundles))
    codes = ''.join(fetch(path + '?live=1') for path in bundles)
    check(
        '라이브 번들에 ①~⑤ 코드',
        all(marker in codes for marker in ['timer-ended', 'options-page', 'burst-banner', 'study_set_app_settings', '앱을 종료']),
    )
    setup = fetch('setup.html?live=1')
    check('setup.html 에 가족 설정 SQL', 'study_set_app_settings' in setup and 'family_app_settings' in setup)

    tasks_before = rest_count('tasks?select=id')
    tier_before = rest_count('family_tier_events?select=id')

    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )
        context = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append('console: ' + message.text) if message.type == 'error' else None)
        page.on('response', lambda response: errors.append(f'http {response.status}: {response.url}') if response.status >= 400 else None)
        page.goto(URL + '#as=mem_child2', wait_until='load')
        page.wait_for_selector('[data-testid="open-profile"]', timeout=30000)
        page.wait_for_timeout(4000)  # 클라우드 동기화·설정 읽기까지 기다립니다.

        check('라이브 아이 화면이 열린다', page.locator('[data-testid="open-profile"]').count() == 1)
        check('아이 화면: 옵션·타이머 버튼 없음', page.locator('[data-testid="open-options"]').count() == 0 and page.locator('[data-testid="open-timer"]').count() == 0)
        check('가족 동기화 상태 정상(준비 중/오류 배너 없음)', page.locator('[data-testid="setup-banner"]').count() == 0)
        check('버스트 타임 꺼짐(배너 없음)', page.locator('[data-testid="burst-banner"]').count() == 0)

        page.evaluate('history.back()')
        page.wait_for_selector('[data-testid="exit-modal"]', timeout=8000)
        check('라이브에서도 뒤로가기 → 종료 확인', '앱을 종료하시겠습니까?' in page.inner_text('[data-testid="exit-modal"]'))
        page.click('[data-testid="exit-cancel"]')
        page.wait_for_timeout(300)
        check('라이브 [취소] → 앱에 머문다', page.locator('[data-testid="exit-modal"]').count() == 0 and page.locator('[data-testid="open-profile"]').count() == 1)

        page.screenshot(path=str(DOWNLOADS / 'study-night-live-child.png'))
        browser.close()

    check('JS/콘솔 오류 0', not errors, ' / '.join(errors[:3]))

    tasks_after = rest_count('tasks?select=id')
    tier_after = rest_count('family_tier_events?select=id')
    check('DB 무변경(tasks)', tasks_before == tasks_after, f'{tasks_before} → {tasks_after}')
    check('DB 무변경(family_tier_events)', tier_before == tier_after, f'{tier_before} → {tier_after}')

    print()
    print(f'=== 실패 {len(failures)} / 검사 {checks} ===')
    for name in failures:
        print(' ·', name)
    return 0 if not failures else 1


if __name__ == '__main__':
    raise SystemExit(main())
