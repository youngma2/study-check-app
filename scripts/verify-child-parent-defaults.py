"""아이 화면 → PIN 으로 부모 복귀 · 부모 화면 '기본 목록' 1탭 채우기 검증.

데모(기기 저장) 빌드(dist-demo)를 미리보기 서버로 띄워 390×844 헤드리스 Chrome 으로 검사합니다.
    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-child-parent-defaults.py

데모 PIN 은 코드에 적지 않고, 이 기기에서 처음 정하는 값(1111)을 씁니다.
"""
from __future__ import annotations

import os
import pathlib
import re
import socket
import subprocess
import sys
import time
from datetime import date, timedelta

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4177
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

DEMO_PIN = '1111'

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        failures.append(name)


def wait_for_port(port: int, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.5)
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(0.3)
    return False


def start_server():
    env = os.environ.copy()
    env['PATH'] = NODE_BIN + os.pathsep + env.get('PATH', '')
    proc = subprocess.Popen(
        ['npx', 'vite', 'preview', '--outDir', 'dist-demo', '--port', str(PORT)],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )
    if not wait_for_port(PORT):
        proc.kill()
        raise RuntimeError('preview 서버가 뜨지 않았습니다.')
    return proc


def type_pin(page, pin: str) -> None:
    for digit in pin:
        page.click(f'[data-testid="pin-key-{digit}"]')


def goto_day(page, target: date) -> None:
    """'오늘' 로 돌아간 뒤 원하는 날짜가 있는 주까지 이동하고 그 날짜를 고릅니다."""
    page.get_by_role('button', name='오늘', exact=True).click()
    page.wait_for_timeout(200)
    today = date.today()
    current_week = today - timedelta(days=today.weekday())
    target_week = target - timedelta(days=target.weekday())
    delta = (target_week - current_week).days // 7
    for _ in range(abs(delta)):
        page.get_by_role('button', name=('다음 주' if delta > 0 else '이전 주')).click()
        page.wait_for_timeout(120)
    label = f'{target.month}월 {target.day}일'
    page.get_by_role('button', name=re.compile(label)).first.click()
    page.wait_for_timeout(300)


def open_profile(page) -> None:
    page.click('[data-testid="open-profile"]')
    page.wait_for_selector('[role="dialog"]')


def main() -> int:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    sunday = week_start + timedelta(days=6)
    next_monday = week_start + timedelta(days=7)
    xmas = date(today.year if (today.month, today.day) <= (12, 25) else today.year + 1, 12, 25)

    server = start_server()
    try:
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

            # ---------------------------------------------------------------
            # A. 아이 화면 — 조용한 '부모 관리로 돌아가기 (PIN 필요)' 버튼
            # ---------------------------------------------------------------
            page.goto(BASE + '#as=mem_child2')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('아이 시점: PIN 잠금 화면이 없다', page.locator('[data-testid="parent-pin-gate"]').count() == 0)
            check('아이 시점: 기본 목록 버튼이 없다', page.locator('[data-testid="fill-defaults"]').count() == 0)

            open_profile(page)
            sheet = page.locator('[role="dialog"]').inner_text()
            check('아이 프로필: 부모 복귀 버튼이 있다', page.locator('[data-testid="request-parent-pin"]').count() == 1)
            check('아이 프로필: 버튼 문구가 분명하다', '부모 관리로 돌아가기 (PIN 필요)' in sheet)
            check('아이 프로필: 아빠·엄마 전환 항목 없음', '아빠' not in sheet and '엄마' not in sheet)
            check('아이 프로필: 부모 관리 잠금 버튼 없음', page.locator('[data-testid="lock-parent"]').count() == 0)

            # ---------------------------------------------------------------
            # B. 버튼 → PIN 화면 → 취소하면 그대로 아이 화면 (잠금 안 풀림)
            # ---------------------------------------------------------------
            page.click('[data-testid="request-parent-pin"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            check('복귀 버튼: PIN 화면이 먼저 나온다', '부모 관리 PIN' in page.inner_text('[data-testid="parent-pin-gate"]'))
            check('복귀 버튼: 아직 아이 목록도 보이지 않는다', page.locator('[data-testid="task-card"]').count() == 0)
            check('복귀 버튼: 취소(아이 화면으로) 버튼이 있다', page.locator('[data-testid="cancel-parent-gate"]').count() == 1)

            page.click('[data-testid="cancel-parent-gate"]')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('취소: 아이 화면으로 돌아온다', '둘째' in page.inner_text('header'))
            check('취소: 부모 화면은 열리지 않았다', page.locator('[data-testid="delete-task"]').count() == 0)
            check('취소: 기본 목록 버튼도 그대로 숨김', page.locator('[data-testid="fill-defaults"]').count() == 0)

            # 취소만으로는 잠금이 풀리지 않았다 — 다시 누르면 여전히 PIN 화면부터
            open_profile(page)
            page.click('[data-testid="request-parent-pin"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            check(
                '취소 뒤에도 잠금 유지: 다시 PIN 화면부터',
                'PIN 정하기' in page.inner_text('[data-testid="parent-pin-gate"]'),
            )

            # ---------------------------------------------------------------
            # C. 올바른 PIN 이면 부모 화면으로
            # ---------------------------------------------------------------
            type_pin(page, DEMO_PIN)
            type_pin(page, DEMO_PIN)
            page.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            check('PIN 통과: 부모(아빠) 화면으로 바뀐다', '아빠' in page.inner_text('header'))
            check('PIN 통과: 부모 전용 기능이 보인다', page.locator('[data-testid="delete-task"]').count() > 0)
            check('부모 시점: 기본 목록 버튼이 위쪽에 있다', page.locator('[data-testid="fill-defaults"]').count() == 1)

            # ---------------------------------------------------------------
            # D. 기본 목록 — 쉬는 날(일요일·공휴일)에는 넣지 않는다
            # ---------------------------------------------------------------
            goto_day(page, sunday)
            before = page.locator('[data-testid="task-card"]').count()
            page.click('[data-testid="fill-defaults"]')
            page.wait_for_selector('text=쉬는 날에는 기본 목록을 넣지 않아요', timeout=5000)
            check('기본 목록: 일요일은 안내만 하고 넣지 않는다', page.locator('[data-testid="task-card"]').count() == before)
            page.wait_for_timeout(2800)

            goto_day(page, xmas)
            page.click('[data-testid="fill-defaults"]')
            page.wait_for_selector('text=쉬는 날에는 기본 목록을 넣지 않아요', timeout=5000)
            check('기본 목록: 공휴일도 안내만 하고 넣지 않는다', page.locator('[data-testid="task-card"]').count() == 0, str(xmas))
            page.wait_for_timeout(2800)

            # ---------------------------------------------------------------
            # E. 기본 목록 — 비어 있는 다음 주 월요일에 같은 요일 패턴으로 채운다
            # ---------------------------------------------------------------
            goto_day(page, next_monday)
            check('기본 목록: 빈 날은 0개에서 시작', page.locator('[data-testid="task-card"]').count() == 0, str(next_monday))

            page.click('[data-testid="fill-defaults"]')
            page.wait_for_selector('text=기본 목록 7개를 추가했어요', timeout=8000)
            added = page.locator('[data-testid="task-card"]').count()
            check('기본 목록: 한 번 눌러 7개(첫째 3 · 둘째 4)가 들어간다', added == 7, f'{added}개')
            check('기본 목록: 들어간 항목은 할 일 상태', page.locator('[data-testid="complete-task"]').count() == 7)
            check('기본 목록: 금요일(월·수·금 패턴)에 하던 항목을 가져온다', '신문 쓰기' in page.inner_text('main'))
            page.wait_for_timeout(2800)

            page.click('[data-testid="fill-defaults"]')
            page.wait_for_selector('text=기본 목록이 이미 다 들어 있어요', timeout=5000)
            check('기본 목록: 두 번 눌러도 중복으로 늘지 않는다', page.locator('[data-testid="task-card"]').count() == 7)
            page.wait_for_timeout(2800)

            # ---------------------------------------------------------------
            # F. 부모 → 아이로 본 뒤에도 복귀는 PIN 부터 (세션이 풀려 있어도)
            # ---------------------------------------------------------------
            open_profile(page)
            page.locator('[role="dialog"]').get_by_role('button', name=re.compile('첫째')).first.click()
            page.wait_for_timeout(400)
            check('부모가 아이 시점으로 바꾸면 아이 화면', '첫째' in page.inner_text('header'))
            check('아이 시점으로 바꾸면 기본 목록 버튼은 숨김', page.locator('[data-testid="fill-defaults"]').count() == 0)

            open_profile(page)
            page.click('[data-testid="request-parent-pin"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            check(
                '아이 화면 복귀: 잠금이 풀려 있어도 PIN 을 다시 묻는다',
                '부모 관리 PIN' in page.inner_text('[data-testid="parent-pin-gate"]'),
            )
            page.click('[data-testid="cancel-parent-gate"]')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('아이 화면 복귀 취소: 보던 아이로 돌아온다', '첫째' in page.inner_text('header'))

            open_profile(page)
            page.click('[data-testid="request-parent-pin"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            type_pin(page, '9999')
            page.wait_for_timeout(500)
            check('틀린 PIN 은 거부된다', '맞지 않아요' in page.inner_text('[data-testid="pin-error"]'))
            check('틀린 PIN 뒤에도 부모 화면은 잠김', page.locator('[data-testid="task-card"]').count() == 0)
            type_pin(page, DEMO_PIN)
            page.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            check('맞는 PIN 으로 부모 화면 복귀', '아빠' in page.inner_text('header'))

            check('JS 오류 없음', not errors, ' / '.join(errors[:3]))

            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()

    print(f"\n=== 실패 {len(failures)} ===")
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
