"""부모 관리 PIN · 완료 체크(시각) · 공부 복사 · 공휴일 표시 UI 검증.

데모(기기 저장) 빌드(dist-demo)를 미리보기 서버로 띄워 390×844 헤드리스 Chrome 으로 검사합니다.
    python3 scripts/verify-parent-pin.py
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

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4176
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

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


def type_pin(page, pin: str, prefix: str = '') -> None:
    for digit in pin:
        page.click(f'[data-testid="{prefix}pin-key-{digit}"]')


def main() -> int:
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')

            # ---------------------------------------------------------------
            # A. 아이 화면 — 부모 전환 메뉴가 보이지 않는다
            # ---------------------------------------------------------------
            page = ctx.new_page()
            errors: list[str] = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE + '#as=mem_child2')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('아이 시점: PIN 잠금 화면이 없다', page.locator('[data-testid="parent-pin-gate"]').count() == 0)
            check('아이 시점: 이름이 둘째', '둘째' in page.inner_text('header'))

            page.click('[data-testid="open-profile"]')
            page.wait_for_selector('[data-testid="lock-parent"]', state='detached')
            sheet = page.locator('[role="dialog"]').inner_text()
            check('아이 프로필: 아이 목록만 보인다', '아이' in sheet and '첫째' in sheet)
            check('아이 프로필: 부모(아빠·엄마)는 PIN 잠금으로만 보인다', 'PIN' in sheet and 'PIN을 입력하면 열려요' in sheet)
            check('아이 프로필: 부모용 항목(확인·수정·삭제) 없음', '확인 · 수정 · 삭제 가능' not in sheet)
            page.locator('[role="dialog"] button[aria-label="닫기"]').click()
            page.wait_for_selector('[role="dialog"]', state='detached')

            # 완료 체크 → 바로 완료 + 시각
            first_card = page.locator('[data-testid="task-card"]').first
            first_card.locator('[data-testid="complete-task"]').click()
            page.wait_for_selector('[data-testid="completed-at"]')
            stamp = page.locator('[data-testid="completed-at"]').first.inner_text()
            check('아이: 완료를 누르면 바로 완료 시각이 남는다', bool(re.search(r'(오전|오후) \d{1,2}:\d{2} 완료', stamp)), stamp)
            badge = first_card.inner_text()
            check('아이: 카드가 완료 상태', '완료' in badge)
            check('아이: 삭제 버튼 없음', page.locator('[data-testid="delete-task"]').count() == 0)
            check('아이: 되돌리기 버튼 없음', page.locator('[data-testid="revert-task"]').count() == 0)

            # 공부 복사 (이 날 → 내일)
            today = date.today()
            tomorrow = today + timedelta(days=1)
            today_cards = page.locator('[data-testid="task-card"]').count()
            page.click('[data-testid="open-copy-day"]')
            page.wait_for_selector('[data-testid="copy-submit"]')
            page.click(f'[data-testid="copy-quick-내일"]')
            page.click('[data-testid="copy-submit"]')
            page.wait_for_selector('text=복사했어요', timeout=8000)
            check('복사: 완료 토스트', '복사' in page.inner_text('body'))
            page.get_by_role('button', name=re.compile(f'{tomorrow.month}월 {tomorrow.day}일')).first.click()
            page.wait_for_timeout(300)
            tomorrow_cards = page.locator('[data-testid="task-card"]').count()
            check('복사: 내일로 항목이 생김', tomorrow_cards == today_cards, f'{today_cards} → {tomorrow_cards}')
            check(
                '복사: 복사된 항목은 할 일(아직 날짜 전이라 완료는 잠김)',
                page.locator('[data-testid="complete-task"]').count() + page.locator('[data-testid="complete-locked"]').count()
                == tomorrow_cards,
            )
            page.close()

            # ---------------------------------------------------------------
            # B. 부모 화면 — PIN 잠금
            # ---------------------------------------------------------------
            parent = ctx.new_page()
            parent.on('pageerror', lambda error: errors.append(str(error)))
            parent.goto(BASE + '#as=mem_dad')
            parent.wait_for_selector('[data-testid="parent-pin-gate"]')
            gate_text = parent.inner_text('[data-testid="parent-pin-gate"]')
            check('부모 시점: PIN 잠금 화면이 먼저 나온다', '부모 관리 PIN' in gate_text)
            check('부모 시점: 잠금 전에는 숙제 목록이 안 보인다', parent.locator('[data-testid="task-card"]').count() == 0)
            check('부모 잠금: 아이로 보기 버튼 있음', parent.locator('[data-testid="gate-switch-mem_child2"]').count() == 1)

            # 이 기기(데모)에서는 처음 PIN 을 정한다 — 두 번 입력이 다르면 오류
            type_pin(parent, '1111')
            type_pin(parent, '2222')
            parent.wait_for_timeout(400)
            check('PIN 정하기: 두 번 입력이 다르면 오류', '달라요' in parent.inner_text('[data-testid="pin-error"]'))
            type_pin(parent, '1111')
            type_pin(parent, '1111')
            parent.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            check('PIN 정하기: 부모 화면이 열린다', '아빠' in parent.inner_text('header'))

            # 관리 잠금 → 다시 잠기고, 이번엔 PIN 확인 모드
            parent.click('[data-testid="open-profile"]')
            parent.wait_for_selector('[data-testid="lock-parent"]')
            profile_text = parent.locator('[role="dialog"]').inner_text()
            check('부모 프로필: 부모·아이 목록 모두 보인다', '아빠' in profile_text and '첫째' in profile_text)
            parent.click('[data-testid="lock-parent"]')
            parent.wait_for_selector('[data-testid="parent-pin-gate"]')
            check('관리 잠금: 다시 잠긴다', parent.locator('[data-testid="task-card"]').count() == 0)

            type_pin(parent, '2222')
            parent.wait_for_timeout(500)
            check('틀린 PIN 은 거부된다', '맞지 않아요' in parent.inner_text('[data-testid="pin-error"]'))
            check('틀린 PIN 뒤에도 잠금 유지', parent.locator('[data-testid="task-card"]').count() == 0)

            type_pin(parent, '1111')
            parent.wait_for_selector('[data-testid="task-card"]', timeout=8000)
            check('맞는 PIN 으로 부모 화면 열림', '아빠' in parent.inner_text('header'))

            # 부모: 삭제·되돌리기 (PIN 잠금이 풀린 상태)
            before = parent.locator('[data-testid="task-card"]').count()
            parent.once('dialog', lambda dialog: dialog.accept())
            parent.locator('[data-testid="delete-task"]').first.click()
            parent.wait_for_timeout(600)
            after = parent.locator('[data-testid="task-card"]').count()
            check('부모: 삭제된다', after == before - 1, f'{before} → {after}')

            card = parent.locator('[data-testid="task-card"]').first
            card.locator('[data-testid="complete-task"]').click()
            parent.wait_for_timeout(500)
            check('부모: 완료 체크 + 시각', parent.locator('[data-testid="completed-at"]').count() >= 1)
            parent.locator('[data-testid="revert-task"]').first.click()
            parent.wait_for_timeout(500)
            check('부모: 되돌리기로 할 일로 돌아간다', '할 일' in parent.locator('[data-testid="task-card"]').first.inner_text())

            # ---------------------------------------------------------------
            # C. 공휴일 빨간색 (2026-12-25 성탄절)
            # ---------------------------------------------------------------
            for _ in range(4):
                parent.get_by_role('button', name='다음 주').click()
                parent.wait_for_timeout(150)
            xmas_week = parent.inner_text('[data-testid="week-holidays"]')
            check('공휴일: 12/25 성탄절이 이번 주 목록에 나온다', '성탄절' in xmas_week, xmas_week)
            check('공휴일: 날짜에 빨간 점', parent.locator('[data-testid="holiday-dot-2026-12-25"]').count() == 1)
            xmas_btn = parent.get_by_role('button', name=re.compile('12월 25일'))
            check('공휴일: 날짜 숫자가 빨간색', 'rose-600' in (xmas_btn.locator('span').nth(2).get_attribute('class') or ''))
            xmas_btn.click()
            parent.wait_for_timeout(300)
            check('공휴일: 날짜 제목 옆에 공휴일 배지', parent.locator('[data-testid="day-holiday"]').inner_text() == '성탄절')

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
