"""라이브 검증 — 실제 사이트 + 실제 Supabase DB 에서 미래 날짜 잠금 · 학년 표시.

    python3 scripts/verify-live-lock-grade.py

읽기만 합니다(완료를 누르지 않습니다). 잠긴 버튼을 눌러도 DB 가 바뀌지 않는지만 봅니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
BASE = 'https://youngma2.github.io/study-check-app/'
TODAY = '2026-11-24'
TOMORROW = '2026-11-25'


def env_value(key: str) -> str:
    for line in (ROOT / '.env.local').read_text().splitlines():
        if line.startswith(key + '='):
            return line.split('=', 1)[1].strip()
    raise RuntimeError(f'{key} 없음')


SUPABASE_URL = env_value('VITE_SUPABASE_URL')
SUPABASE_KEY = env_value('VITE_SUPABASE_ANON_KEY')

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        failures.append(name)


def rest(path: str):
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/{path}',
        headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode())


def verified_count(iso: str, member: str | None = None) -> int:
    query = f'tasks?select=id&due_date=eq.{iso}&status=eq.verified'
    if member:
        query += f'&member_id=eq.{member}'
    return len(rest(query))


def tasks_count(iso: str, member: str) -> int:
    return len(rest(f'tasks?select=id&due_date=eq.{iso}&member_id=eq.{member}'))


def grade_text(page, member: str) -> str:
    node = page.locator(f'[data-testid="member-grade-{member}"]')
    return node.first.inner_text() if node.count() > 0 else ''


def open_day(page, month: int, day: int) -> None:
    page.get_by_role('button', name=re.compile(f'{month}월 {day}일')).first.click()
    page.wait_for_timeout(500)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        page = ctx.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        before_tomorrow = verified_count(TOMORROW)

        page.goto(BASE + '#as=mem_child2')
        page.wait_for_selector('[data-testid="task-card"]', timeout=30000)
        page.wait_for_timeout(2500)  # Supabase 에서 목록을 받아 올 때까지

        check('라이브: 둘째 학년이 초4 로 보인다', grade_text(page, 'mem_child2') == '초4', grade_text(page, 'mem_child2'))
        check('라이브: 오늘은 잠긴 버튼이 없다', page.locator('[data-testid="complete-locked"]').count() == 0)
        check('라이브: 오늘은 완료 버튼이 있다', page.locator('[data-testid="complete-task"]').count() > 0)

        open_day(page, 11, 25)
        cards = page.locator('[data-testid="task-card"]').count()
        locked = page.locator('[data-testid="complete-locked"]').count()
        db_tomorrow = tasks_count(TOMORROW, 'mem_child2')
        check('라이브: 내일(11/25) 카드가 있다', cards > 0, f'{cards}개')
        check(
            '라이브: 화면 카드 = DB - (아이 화면에서 숨는 📞 통화 항목)',
            cards <= db_tomorrow and cards >= db_tomorrow - 3,
            f'화면 {cards} · DB {db_tomorrow}',
        )
        check('라이브: 내일은 전부 잠김', cards > 0 and locked == cards, f'카드 {cards} · 잠김 {locked}')
        check('라이브: 내일 완료 버튼 0개', page.locator('[data-testid="complete-task"]').count() == 0)
        first = page.locator('[data-testid="complete-locked"]').first
        check('라이브: 잠긴 버튼 disabled', first.is_disabled())

        page.evaluate(
            """() => document.querySelectorAll('[data-testid="complete-locked"]').forEach((btn) => btn.click());"""
        )
        page.wait_for_timeout(1200)
        check('라이브: 눌러도 화면에 완료가 생기지 않는다', page.locator('[data-testid="completed-at"]').count() == 0)
        check('라이브: 눌러도 DB 완료가 늘지 않는다', verified_count(TOMORROW) == before_tomorrow == 0, f'{verified_count(TOMORROW)}')

        # 다음 주(12/1)도 잠김
        page.get_by_role('button', name='다음 주').click()
        page.wait_for_timeout(500)
        open_day(page, 12, 1)
        nxt = page.locator('[data-testid="task-card"]').count()
        check(
            '라이브: 다음 주(12/1)도 전부 잠김',
            nxt > 0 and page.locator('[data-testid="complete-locked"]').count() == nxt
            and page.locator('[data-testid="complete-task"]').count() == 0,
            f'카드 {nxt}',
        )

        # 첫째 화면 (중1) — 해시만 바꾸면 다시 안 읽히므로 새로고침
        page.goto(BASE + '#as=mem_child1')
        page.reload()
        page.wait_for_selector('[data-testid="member-grade-mem_child1"]', timeout=30000)
        page.wait_for_timeout(2000)
        check('라이브: 첫째 학년이 중1 로 보인다', grade_text(page, 'mem_child1') == '중1', grade_text(page, 'mem_child1'))
        page.get_by_role('button', name='다음 주').click()
        page.wait_for_timeout(400)
        open_day(page, 12, 1)
        nxt1 = page.locator('[data-testid="task-card"]').count()
        check(
            '라이브: 첫째 화면도 다음 주(12/1) 전부 잠김',
            nxt1 > 0 and page.locator('[data-testid="complete-locked"]').count() == nxt1
            and page.locator('[data-testid="complete-task"]').count() == 0,
            f'카드 {nxt1}',
        )

        check('라이브: JS 오류 없음', not errors, ' / '.join(errors[:3]))
        browser.close()

    print(f"\n=== 실패 {len(failures)} ===")
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
