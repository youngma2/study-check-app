"""라이브 검증 — 💬 우리 가족 한마디가 날짜마다 따로 보이는지 · 알림 배너 닫기.

실제 사이트 + 실제 Supabase DB, 390×844 헤드리스 Chrome. 읽기만 합니다(가족 데이터를 바꾸지 않습니다).

    python3 scripts/verify-live-note-dates.py
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

BASE = 'https://youngma2.github.io/study-check-app/'
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
SHOTS = pathlib.Path('/workspace/downloads')

ENV = {}
for line in pathlib.Path('/workspace/study-check-app/.env.local').read_text().splitlines():
    if '=' in line and not line.strip().startswith('#'):
        key, value = line.split('=', 1)
        ENV[key.strip()] = value.strip()
SUPA = ENV['VITE_SUPABASE_URL'].rstrip('/')
KEY = ENV['VITE_SUPABASE_ANON_KEY']

KST = ZoneInfo('Asia/Seoul')
failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
    if not cond:
        failures.append(name)


def api(path: str) -> list:
    request = urllib.request.Request(f'{SUPA}/rest/v1/{path}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def http_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


def note_date(note: dict) -> str:
    """앱과 같은 규칙: id 의 n_YYYY-MM-DD_ → 없으면 작성일(한국 날짜)."""
    match = re.match(r'^n_(\d{4}-\d{2}-\d{2})_', note['id'])
    if match:
        return match.group(1)
    created = datetime.fromisoformat(note['created_at'].replace('Z', '+00:00'))
    return created.astimezone(KST).date().isoformat()


def goto_day(page, target: date) -> None:
    page.get_by_role('button', name='오늘', exact=True).click()
    page.wait_for_timeout(250)
    page.get_by_role('button', name=re.compile(f'{target.month}월 {target.day}일')).first.click()
    page.wait_for_timeout(500)


def main() -> int:
    today = datetime.now(KST).date()
    tomorrow = today + timedelta(days=1)

    # ---- 0. 새 빌드가 라이브에 올라갔는지 ----
    index = http_text(BASE + f'?v={os.urandom(4).hex()}')
    bundle = re.search(r'assets/index-[^\"]+\.js', index)
    check('메인 페이지 HTTP 200 · 번들 링크', bundle is not None, bundle.group(0) if bundle else 'none')
    if bundle:
        js = http_text('https://youngma2.github.io/study-check-app/' + bundle.group(0))
        check('라이브 번들: 날짜별 빈 안내 문구', '이 날 남긴 한마디가 아직 없어요' in js)
        check('라이브 번들: 배너 닫기 안내', '눌러서 닫기' in js)
        check('라이브 번들: 날짜 id 접두어(n_YYYY-MM-DD_)', 'n_${' in js or 'noteDate' in js)

    # ---- 1. DB 기준값 (그 날짜에 붙는 한마디) ----
    notes = api('family_notes?select=id,author_id,content,created_at&order=created_at.desc&limit=50')
    by_date: dict[str, list[dict]] = {}
    for note in notes:
        by_date.setdefault(note_date(note), []).append(note)
    today_notes = by_date.get(today.isoformat(), [])
    tomorrow_notes = by_date.get(tomorrow.isoformat(), [])
    print(f'    DB 한마디 {len(notes)}건 · {today}: {len(today_notes)}건 · {tomorrow}: {len(tomorrow_notes)}건')
    check('DB: 오늘 날짜 한마디가 있다', len(today_notes) >= 1, str([n['content'] for n in today_notes])[:80])
    check('DB: 내일 날짜 한마디는 아직 없다', len(tomorrow_notes) == 0, str([n['content'] for n in tomorrow_notes])[:80])

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME, args=['--no-sandbox'], env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS}
        )
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul', device_scale_factor=2
        )
        page = ctx.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        page.goto(f'{BASE}?v={os.urandom(4).hex()}#as=mem_child1')
        page.wait_for_selector('[data-testid="open-profile"]', timeout=45000)
        page.wait_for_selector('[data-testid="family-notes"]', timeout=45000)
        # 알림판이 서버에서 한마디를 받아 올 때까지
        page.wait_for_selector('[data-testid="family-note"]', timeout=45000)
        page.wait_for_timeout(800)

        # ---- 2. 오늘(11/24) 알림판 ----
        today_chip = page.inner_text('[data-testid="notes-date"]')
        check(
            '오늘 알림판: 머리에 오늘 날짜',
            f'{today.month}/{today.day}' in today_chip,
            today_chip,
        )
        board_today = page.inner_text('[data-testid="family-notes"]')
        shown = [n['content'] for n in today_notes if n['content'] in board_today]
        check('오늘 알림판: DB 의 오늘 한마디가 보인다', len(shown) == len(today_notes), f'{len(shown)}/{len(today_notes)}')
        page.screenshot(path=str(SHOTS / 'study_live_notes_today.png'))

        # 배너(다른 사람이 남긴 새 글) — 배너 본문을 누르면 그 날 알림판으로 가며 닫힌다
        if page.locator('[data-testid="family-note-alert"]').count() == 1:
            alert = page.inner_text('[data-testid="family-note-alert"]')
            check('새 글 배너: 눌러서 닫기 안내', '눌러서 닫기' in alert, alert.replace('\n', ' / ')[:90])

        # ---- 3. 내일(11/25) 알림판은 따로 —— 비어 있다 ----
        goto_day(page, tomorrow)
        tomorrow_chip = page.inner_text('[data-testid="notes-date"]')
        check('내일 알림판: 머리에 내일 날짜', f'{tomorrow.month}/{tomorrow.day}' in tomorrow_chip, tomorrow_chip)
        check('내일 알림판: 따로 비어 있다', page.locator('[data-testid="notes-empty"]').count() == 1)
        board_tomorrow = page.inner_text('[data-testid="family-notes"]')
        leaked = [n['content'] for n in today_notes if n['content'] in board_tomorrow]
        check('내일 알림판: 오늘 한마디가 새어 나오지 않는다', not leaked, str(leaked)[:80])
        page.screenshot(path=str(SHOTS / 'study_live_notes_tomorrow.png'))

        # ---- 4. 배너를 누르면 그 날(오늘) 알림판으로 ----
        if page.locator('[data-testid="family-note-alert"]').count() == 1:
            page.click('[data-testid="open-note-alert"]')
            page.wait_for_timeout(600)
            check('배너 누르기: 닫힌다', page.locator('[data-testid="family-note-alert"]').count() == 0)
            tapped_chip = page.inner_text('[data-testid="notes-date"]')
            check('배너 누르기: 그 글이 붙은 날(오늘)로 이동', f'{today.month}/{today.day}' in tapped_chip, tapped_chip)
            check(
                '배너 누르기: 그 날 알림판에 글이 보인다',
                any(n['content'] in page.inner_text('[data-testid="family-notes"]') for n in today_notes),
            )
        else:
            print('    (안 본 새 글이 없어 배너 점검은 건너뜁니다)')

        # ---- 5. 다시 오늘로 돌아오면 그대로 ----
        goto_day(page, tomorrow)
        goto_day(page, today)
        check(
            '오늘로 돌아오면 오늘 한마디 그대로',
            all(n['content'] in page.inner_text('[data-testid="family-notes"]') for n in today_notes),
        )

        check('JS 오류 없음', not errors, ' / '.join(errors[:3]))
        browser.close()

    print(f'\n=== 실패 {len(failures)} ===')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
