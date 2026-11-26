"""라이브 검증 — 🐣 쪼꼬가 올린 자동 알림(티어 승급·부재중 전화)이 '아빠' 가 아니라 '쪼꼬' 로 보이는지.

실제 사이트 + 실제 Supabase DB, 390×844 헤드리스 Chrome. 읽기만 합니다(가족 데이터를 바꾸지 않습니다).

    python3 scripts/verify-live-jjokko.py
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import urllib.request
from datetime import datetime
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
    request = urllib.request.Request(
        f'{SUPA}/rest/v1/{path}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def http_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


def note_date(note: dict) -> str:
    match = re.match(r'^n_(\d{4}-\d{2}-\d{2})_', note['id'])
    if match:
        return match.group(1)
    created = datetime.fromisoformat(note['created_at'].replace('Z', '+00:00'))
    return created.astimezone(KST).date().isoformat()


def goto_day(page, year: int, month: int, day: int) -> None:
    page.get_by_role('button', name='오늘', exact=True).click()
    page.wait_for_timeout(250)
    if (year, month, day) != (datetime.now(KST).year, datetime.now(KST).month, datetime.now(KST).day):
        page.get_by_role('button', name=re.compile(f'{month}월 {day}일')).first.click()
        page.wait_for_timeout(600)


def main() -> int:
    # ---- 0. 새 빌드가 라이브에 올라갔는지 ----
    index = http_text(BASE + f'?v={os.urandom(4).hex()}')
    bundle = re.search(r'assets/index-[^\"]+\.js', index)
    check('라이브: 메인 페이지 HTTP 200 · 번들 링크', bundle is not None, bundle.group(0) if bundle else 'none')
    if bundle:
        js = http_text(BASE + bundle.group(0))
        chunks = re.findall(r'assets/[^"]+\.js', index)
        all_js = js + ''.join(http_text(BASE + c) for c in chunks if c != bundle.group(0))
        check('라이브 번들: author_kind 표시 코드', 'jjokko' in js)
        check('라이브 번들: 쪼꼬 이름·자동 알림 배지', '자동 알림' in all_js and '쪼꼬' in all_js, ','.join(chunks))
    sw = http_text(BASE + 'sw.js')
    check('라이브: 서비스 워커 캐시 v8', 'study-check-shell-v8' in sw, re.search(r'study-check-shell-v\d+', sw).group(0))

    # ---- 1. DB 기준값 ----
    notes = api('family_notes?select=id,author_id,author_kind,content,created_at&order=created_at.desc&limit=60')
    jjokko = [n for n in notes if n.get('author_kind') == 'jjokko']
    members = {m['id']: m['name'] for m in api('family_members?select=id,name')}
    print(f"    DB 한마디 {len(notes)}건 · 쪼꼬 글 {len(jjokko)}건")
    check('DB: 티어 승급 글 4건이 쪼꼬 글', sum(1 for n in jjokko if '_tier_' in n['id']) >= 4)
    check(
        'DB: 부재중 전화 글도 쪼꼬 글',
        any('부재중' in n['content'] for n in jjokko),
        str([n['content'] for n in jjokko if '부재중' in n['content']])[:60],
    )
    check(
        'DB: 쪼꼬 글 본문에는 "🐣 쪼꼬:" 접두사가 남아 있지 않다',
        not any(n['content'].lstrip().startswith('🐣') for n in jjokko),
        str([n['content'][:20] for n in jjokko if n['content'].lstrip().startswith('🐣')])[:80],
    )

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

        page.goto(f'{BASE}?v={os.urandom(4).hex()}#as=mem_child2')
        page.wait_for_selector('[data-testid="family-notes"]', timeout=45000)
        page.wait_for_selector('[data-testid="family-note"]', timeout=45000)
        page.wait_for_timeout(900)

        # ---- 2. 오늘(2026-11-26) 알림판: 티어 승급·부재중 전화가 '쪼꼬' 로 ----
        today = datetime.now(KST).date()
        goto_day(page, today.year, today.month, today.day)
        today_notes = [n for n in notes if note_date(n) == today.isoformat()]
        today_jjokko = [n for n in today_notes if n.get('author_kind') == 'jjokko']
        rows = page.locator('[data-testid="family-note"]')
        jjokko_rows = page.locator('[data-testid="family-note"][data-author-kind="jjokko"]')
        page.wait_for_timeout(400)
        if page.locator('button:has-text("더 보기")').count() > 0:
            page.locator('button:has-text("더 보기")').click()
            page.wait_for_timeout(300)
        rows = page.locator('[data-testid="family-note"]')
        jjokko_rows = page.locator('[data-testid="family-note"][data-author-kind="jjokko"]')
        print(f'    화면 행 {rows.count()}개 · 쪼꼬 행 {jjokko_rows.count()}개 (DB 오늘 쪼꼬 {len(today_jjokko)}건)')
        check('오늘 알림판: 쪼꼬 행 수가 DB 와 같다', jjokko_rows.count() == len(today_jjokko), f'{jjokko_rows.count()}/{len(today_jjokko)}')

        jjokko_authors = [jjokko_rows.nth(i).locator('[data-testid="note-author"]').inner_text() for i in range(jjokko_rows.count())]
        check('오늘 알림판: 쪼꼬 글 작성자가 "쪼꼬"', all(name.strip() == '쪼꼬' for name in jjokko_authors), str(jjokko_authors))
        jjokko_text = page.inner_text('[data-testid="family-notes"]')
        check(
            '오늘 알림판: 쪼꼬 글에 "아빠" 표시가 없다',
            all(f'아빠\n{n["content"]}' not in jjokko_text for n in today_jjokko),
        )
        check(
            '오늘 알림판: 티어 승급 문구가 그대로 보인다',
            all(n['content'][:20] in jjokko_text for n in today_jjokko),
            str([n['content'][:18] for n in today_jjokko])[:90],
        )
        check('오늘 알림판: "자동 알림" 배지', jjokko_rows.nth(0).inner_text().find('자동 알림') >= 0)
        check('오늘 알림판: 쪼꼬 아바타(🐣)', '🐣' in jjokko_rows.nth(0).inner_text())
        page.screenshot(path=str(SHOTS / 'study_jjokko_today.png'))

        # 가족이 직접 쓴 글은 그대로 이름(아빠)으로
        member_rows = page.locator('[data-testid="family-note"][data-author-kind="member"]')
        parent_note = next((n for n in today_notes if n.get('author_kind') != 'jjokko' and n['author_id'] == 'mem_dad'), None)
        if parent_note:
            names = [member_rows.nth(i).locator('[data-testid="note-author"]').inner_text() for i in range(member_rows.count())]
            check('오늘 알림판: 가족이 쓴 글은 그대로 "아빠"', '아빠' in names, str(names))
            check('오늘 알림판: 가족 글 본문 그대로', parent_note['content'] in page.inner_text('[data-testid="family-notes"]'))

        # ---- 3. 어제(11/25) 알림판: 지난 티어 승급 글도 쪼꼬 ----
        yesterday = today.fromordinal(today.toordinal() - 1)
        goto_day(page, yesterday.year, yesterday.month, yesterday.day)
        page.wait_for_timeout(600)
        if page.locator('button:has-text("더 보기")').count() > 0:
            page.locator('button:has-text("더 보기")').click()
            page.wait_for_timeout(300)
        y_jjokko_db = [n for n in notes if note_date(n) == yesterday.isoformat() and n.get('author_kind') == 'jjokko']
        y_rows = page.locator('[data-testid="family-note"][data-author-kind="jjokko"]')
        print(f'    어제 쪼꼬 행 {y_rows.count()}개 (DB {len(y_jjokko_db)}건)')
        check('어제 알림판: 쪼꼬 행 수가 DB 와 같다', y_rows.count() == len(y_jjokko_db), f'{y_rows.count()}/{len(y_jjokko_db)}')
        if y_rows.count():
            check('어제 알림판: 작성자 "쪼꼬"', y_rows.nth(0).locator('[data-testid="note-author"]').inner_text().strip() == '쪼꼬')
        page.screenshot(path=str(SHOTS / 'study_jjokko_yesterday.png'))

        # ---- 4. 새 글 배너도 쪼꼬 이름으로 ----
        #   (지금 DB 의 가장 새 글은 가족이 쓴 글이라, 알림판 서버 응답만 검증용 한마디로 바꿔 끼워
        #    실제 앱 화면에서 쪼꼬 배너가 어떻게 그려지는지 봅니다. DB 는 건드리지 않습니다.)
        ctx2 = browser.new_context(
            viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul', device_scale_factor=2
        )
        ctx2.add_init_script(
            "try { localStorage.setItem('study-check.notes-seen.v1', '2000-01-01T00:00:00.000Z'); } catch (e) {}"
        )
        fixture = [
            {
                'id': 'n_2099-01-01_verify_jjokko',
                'family_id': 'fam_our_home',
                'author_id': 'mem_dad',
                'author_kind': 'jjokko',
                'content': '🎉 검증용 [실버 III] 티어로 승급했어요!',
                'created_at': '2099-01-01T00:00:00+00:00',
                'push_sent_at': None,
            }
        ]
        ctx2.route(
            '**/rest/v1/family_notes**',
            lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(fixture)),
        )
        page2 = ctx2.new_page()
        errors2: list[str] = []
        page2.on('pageerror', lambda error: errors2.append(str(error)))
        page2.goto(f'{BASE}?v={os.urandom(4).hex()}#as=mem_child2')
        page2.wait_for_selector('[data-testid="family-note-alert"]', timeout=45000)
        banner = page2.inner_text('[data-testid="family-note-alert"]')
        check('배너: 작성자가 "🐣 쪼꼬"', '쪼꼬' in banner and '아빠' not in banner, banner.replace('\n', ' / ')[:90])
        check('배너: 본문에 접두사가 겹치지 않는다', '쪼꼬:' not in banner)
        check('배너: 자동 알림 한마디도 본문 그대로', '검증용 [실버 III] 티어로 승급했어요' in banner)
        page2.screenshot(path=str(SHOTS / 'study_jjokko_banner.png'))
        ctx2.close()

        check('JS 오류 없음', not errors and not errors2, ' / '.join((errors + errors2)[:3]))
        browser.close()

    print(f'\n=== 실패 {len(failures)} ===')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
