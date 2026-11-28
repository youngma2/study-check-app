"""①~⑨ 일괄 수정 — 통합 검증 (데모 빌드 + 라이브 읽기).

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-batch.py

· 데모(기기 저장) 빌드를 미리보기 서버로 띄워 390×844 헤드리스 Chrome 으로 검사합니다.
· ① 시간만 차감 + 사용 로그 · ② 종료 확인 [종료] 동작 · ③ 공부 목록 DB 불러오기
  ④ 프리셋 확인 팝업 · ⑤ 상자 보상 목록(분·P) · ⑥ 100% 축하 한마디 · ⑦ 포인트 상점
  ⑧ 버스트 타임 수동/자동/중복 + 🔥 배지 · ⑨ 기본 목록 버튼 옮김
· 라이브(GitHub Pages + 실제 Supabase)는 **읽기만** — 화면 오류 0, 서비스워커 v11,
  확인 전/후 tasks·family_notes·family_tier_events 행 수 그대로(DB 무변경)인지 봅니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import socket
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4191
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
LIVE = 'https://youngma2.github.io/study-check-app/'
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date().isoformat()
SHOTS = ROOT / 'scripts' / 'shots-batch'

failures: list[str] = []
checks = 0


START = time.time()


def check(name: str, cond: bool, extra: str = '') -> None:
    global checks
    checks += 1
    stamp = f'[{time.time() - START:5.1f}s]'
    print(f"{stamp} {'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
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
        ['npx', 'vite', 'preview', '--outDir', 'dist-demo', '--port', str(PORT), '--strictPort'],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not wait_for_port(PORT):
        proc.terminate()
        raise SystemExit('미리보기 서버가 뜨지 않았습니다.')
    return proc


def env_pair() -> tuple[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values['VITE_SUPABASE_URL'], values['VITE_SUPABASE_ANON_KEY']


def rest_count(table: str) -> int:
    base, key = env_pair()
    request = urllib.request.Request(
        f'{base}/rest/v1/{table}?select=id',
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Prefer': 'count=exact',
            'Range': '0-0',
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        content_range = response.headers.get('Content-Range') or '*/0'
    return int(content_range.split('/')[-1])


def text_of(page, testid: str) -> str:
    locator = page.get_by_test_id(testid)
    return locator.first.inner_text() if locator.count() > 0 else ''


def toast_text(page) -> str:
    locator = page.locator('div.animate-toast-in')
    return locator.first.inner_text() if locator.count() > 0 else ''


def enter_pin(page, pin: str = '1234') -> None:
    for _ in range(3):
        if page.get_by_test_id('parent-pin-gate').count() == 0:
            return
        for key in pin:
            page.get_by_test_id(f'pin-key-{key}').click()
            page.wait_for_timeout(120)
        page.wait_for_timeout(900)


def main() -> None:
    SHOTS.mkdir(exist_ok=True)
    server = start_server()
    console_errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            context = browser.new_context(
                viewport={'width': 390, 'height': 844},
                device_scale_factor=2,
                timezone_id='Asia/Seoul',
                locale='ko-KR',
            )
            page = context.new_page()
            page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: console_errors.append(str(error)))

            # ---------------------------------------------------------------- 세팅
            page.goto(f'{BASE}index.html#as=mem_dad')
            page.wait_for_timeout(1200)
            enter_pin(page)
            page.wait_for_timeout(800)

            # ---------------------------------------------------------------- ⑨ 메인 정리
            check('⑨ 메인: [기본 목록] 버튼이 메인에서 사라짐', page.get_by_test_id('fill-defaults').count() == 0)
            check('⑨ 메인: [어제 것 가져오기] 버튼이 메인에서 사라짐', page.get_by_test_id('copy-yesterday').count() == 0)
            check('⑨ 메인: [이 날 공부 복사] 는 그대로 있음', page.get_by_test_id('open-copy-day').count() == 1)
            check('⑦ 메인: 부모 도구에 [포인트 상점] 버튼', page.get_by_test_id('open-shop').count() == 1)
            check('메인 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            page.screenshot(path=str(SHOTS / '01-main-dad.png'))

            # ---------------------------------------------------------------- ③④⑨ 옵션: 공부 목록
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(700)
            check('옵션 페이지가 열림', page.get_by_test_id('options-page').count() == 1)
            check('③ 공부 목록: 기존 기록에서 불러옴 배지', page.get_by_test_id('routine-from-db').count() == 1)
            items = page.locator('[data-testid^="routine-item-"]').count()
            check('③ 공부 목록: DB 목록이 비어 있지 않음', items >= 3, f'{items}개')
            check('⑨ 옵션 안에 기본 목록 도구', page.get_by_test_id('default-tools').count() == 1)
            check('⑨ 옵션 안에 [기본 목록 넣기]', page.get_by_test_id('fill-defaults').count() == 1)
            check('⑨ 옵션 안에 [어제 것 가져오기]', page.get_by_test_id('copy-yesterday').count() == 1)
            date_value = page.get_by_test_id('default-date').input_value()
            check('⑨ 도구 날짜 기본값이 오늘', date_value == TODAY, date_value)
            page.screenshot(path=str(SHOTS / '02-options-routines.png'))

            # ③ 수정·삭제가 저장되는지 (첫 항목 삭제 → 개수 -1, 배지 사라짐)
            page.get_by_test_id('routine-delete-0').click()
            page.wait_for_timeout(900)
            after_delete = page.locator('[data-testid^="routine-item-"]').count()
            check('③ 목록 삭제가 저장됨', after_delete == items - 1, f'{items} → {after_delete}')
            check('③ 저장 뒤에는 DB 배지가 사라짐', page.get_by_test_id('routine-from-db').count() == 0)

            # ④ 프리셋 확인 팝업
            page.get_by_test_id('preset-vacation').click()
            page.wait_for_timeout(400)
            check('④ 프리셋 확인 팝업이 뜸', page.get_by_test_id('preset-confirm').count() == 1)
            check('④ [취소] 전에는 프리셋이 그대로', '학기중' in text_of(page, 'active-preset'))
            page.get_by_test_id('preset-cancel').click()
            page.wait_for_timeout(300)
            check('④ [취소] 로 팝업이 닫힘', page.get_by_test_id('preset-confirm').count() == 0)
            check('④ 취소 뒤에도 프리셋 그대로', '학기중' in text_of(page, 'active-preset'))
            page.get_by_test_id('preset-vacation').click()
            page.wait_for_timeout(300)
            page.get_by_test_id('preset-apply').click()
            page.wait_for_timeout(900)
            check('④ [적용] 으로 프리셋이 바뀜', '방학' in text_of(page, 'active-preset'), text_of(page, 'active-preset'))
            # 다시 학기중으로
            page.get_by_test_id('preset-semester').click()
            page.wait_for_timeout(300)
            page.get_by_test_id('preset-apply').click()
            page.wait_for_timeout(900)
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------------- ⑧ 버스트 타임 (이벤트 탭)
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(500)
            page.get_by_test_id('option-tab-events').click()
            page.wait_for_timeout(400)
            check('⑧ 자동 설정 체크박스가 있음', page.get_by_test_id('burst-auto').count() == 1)
            days_value = page.get_by_test_id('burst-auto-days').input_value()
            check('⑧ 자동 설정 기본값 7일', days_value == '7', days_value)
            check('⑧ 중복 적용 체크박스가 있음', page.get_by_test_id('burst-overlap').count() == 1)

            # 수동 ON → 배너
            page.get_by_test_id('burst-toggle').click()
            page.wait_for_timeout(900)
            check('⑧ 수동 켜면 상태 문구가 진행 중', '진행' in text_of(page, 'burst-status') or '켜져' in text_of(page, 'burst-status'))
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(400)
            check('⑧ 수동 켜면 메인에 버스트 배너', page.get_by_test_id('burst-banner').count() == 1)
            check('⑧ 달력에 🔥 배지(오늘)', page.get_by_test_id(f'burst-badge-{TODAY}').count() == 1)
            check('⑧ 날짜 요약에 🔥 표시', page.get_by_test_id('day-burst').count() == 1)
            page.screenshot(path=str(SHOTS / '03-burst-on.png'))
            # 수동 OFF, 자동 ON(28일 전부터 → 오늘 포함)
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('option-tab-events').click()
            page.wait_for_timeout(300)
            page.get_by_test_id('burst-toggle').click()
            page.wait_for_timeout(800)
            page.get_by_test_id('burst-auto').check()
            page.wait_for_timeout(600)
            page.get_by_test_id('burst-auto-days').fill('28')
            page.get_by_test_id('burst-auto-days').blur()
            page.wait_for_timeout(900)
            check('⑧ 자동 설정이면 오늘 🔥 표시', '🔥' in text_of(page, 'burst-today'), text_of(page, 'burst-today'))
            page.get_by_test_id('burst-overlap').check()
            page.wait_for_timeout(800)
            check('⑧ 중복 적용 문구가 4배로 바뀜', '4배' in page.get_by_test_id('burst-overlap').locator('xpath=ancestor::label').inner_text())
            page.screenshot(path=str(SHOTS / '04-options-events.png'))

            # ---------------------------------------------------------------- ⑤ 상자 보상 목록
            check('⑤ 상자 보상 목록이 있음', page.get_by_test_id('box-rewards').count() == 1)
            check('⑤ 기본 보상 4개(분)', page.locator('[data-testid^="box-reward-bx_"]').count() == 4)
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------------- 상자 열기(분) → ① 시간 차감
            opened = page.locator('[data-testid^="reward-open-"]')
            check('열지 않은 뽑기 상자가 있음', opened.count() > 0, f'{opened.count()}개')
            opened.first.click()
            page.wait_for_timeout(500)
            check('뽑기 팝업이 뜸', page.get_by_test_id('reward-modal').count() == 1)
            page.get_by_test_id('reward-gift-0').click()
            page.wait_for_timeout(1900)
            win_text = text_of(page, 'reward-win-minutes')
            check('상자 당첨 값이 보임(분)', '분' in win_text, win_text)
            page.get_by_test_id('reward-modal-done').click()
            page.wait_for_timeout(500)

            page.get_by_test_id('open-timer').click()
            page.wait_for_timeout(600)
            remaining_text = text_of(page, 'timer-remaining')
            match = re.search(r'([0-9]+)분', remaining_text)
            remaining = int(match.group(1)) if match else 0
            check('① 뽑기 시간이 남아 있음', remaining > 0, f'{remaining}분')
            check('① [시간만 차감] 칸이 따로 있음', page.get_by_test_id('direct-deduct').count() == 1)
            page.get_by_test_id('direct-minutes').fill('2')
            page.get_by_test_id('direct-reason').select_option(label='영상 시청')
            page.get_by_test_id('direct-deduct-button').click()
            page.wait_for_timeout(1200)
            log_text = text_of(page, 'time-usage-log')
            check('① 시간 사용 로그에 직접 차감이 남음', '영상 시청' in log_text and '2분' in log_text, log_text.split('\n')[1] if '\n' in log_text else log_text)
            check('① 직접 차감 뒤 남은 시간이 줄어듦', f'{remaining - 2}분' in text_of(page, 'timer-remaining'), text_of(page, 'timer-remaining'))
            page.screenshot(path=str(SHOTS / '05-timer.png'))
            page.get_by_test_id('timer-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------------- ⑤ 보상을 P 로 바꾸고 상자 열기
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('option-tab-events').click()
            page.wait_for_timeout(300)
            for _ in range(6):
                if page.locator('[data-testid^="box-reward-delete-bx_"]:not([disabled])').count() == 0:
                    break
                page.locator('[data-testid^="box-reward-delete-bx_"]:not([disabled])').first.click()
                page.wait_for_timeout(600)
            check('⑤ 보상은 하나 이상 남겨 둠(마지막 삭제 버튼 잠금)', page.locator('[data-testid^="box-reward-bx_"]').count() == 1)
            row = page.locator('[data-testid^="box-reward-bx_"]').first
            row.locator('select').select_option('points')
            page.wait_for_timeout(800)
            row.locator('input').fill('100')
            row.locator('input').blur()
            page.wait_for_timeout(900)
            check('⑤ 분 보상을 P 보상으로 바꿈', 'P' in row.inner_text(), row.inner_text().replace('\n', ' '))
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(400)

            opened = page.locator('[data-testid^="reward-open-"]')
            check('⑤ P 보상으로 바꾼 뒤 상자가 남아 있음', opened.count() > 0, f'{opened.count()}개')
            opened.first.click()
            page.wait_for_timeout(500)
            page.get_by_test_id('reward-gift-1').click()
            page.wait_for_timeout(1900)
            win_text = text_of(page, 'reward-win-minutes')
            check('⑤ P 보상이 당첨으로 보임', win_text.endswith('P'), win_text)
            page.get_by_test_id('reward-modal-done').click()
            page.wait_for_timeout(900)
            page.get_by_test_id('open-shop').click()
            page.wait_for_timeout(600)
            balance_text = text_of(page, 'shop-balance')
            check('⑤ 당첨된 P 가 아이 잔액에 쌓임', '100P' in balance_text, balance_text.replace('\n', ' '))
            page.screenshot(path=str(SHOTS / '06-shop-manage.png'))

            # ---------------------------------------------------------------- ⑦ 상품 등록
            page.get_by_test_id('shop-product-name').fill('간식 쿠폰')
            page.get_by_test_id('shop-product-desc').fill('편의점에서 하나')
            page.get_by_test_id('shop-product-price').fill('50')
            page.get_by_test_id('shop-emoji-🍦').click()
            page.get_by_test_id('shop-product-save').click()
            page.wait_for_timeout(1000)
            check('⑦ 상품이 등록됨', '간식 쿠폰' in page.get_by_test_id('shop-manage-list').inner_text())
            page.get_by_test_id('shop-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------------- ⑥ 아이 화면: 100% 축하 한마디
            child = context.new_page()
            child.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            child.on('pageerror', lambda error: console_errors.append(str(error)))
            child.goto(f'{BASE}index.html#as=mem_child1')
            child.wait_for_timeout(1500)
            check('아이 화면에는 포인트 상점 카드', child.get_by_test_id('open-shop-child').count() == 1)
            completes = child.locator('[data-testid="complete-task"]')
            print(f'    남은 완료 버튼 {completes.count()}개', flush=True)
            for _ in range(completes.count()):
                child.locator('[data-testid="complete-task"]').first.click()
                child.wait_for_timeout(700)
            child.wait_for_timeout(1200)
            alert = child.get_by_test_id('family-note-alert')
            alert_text = alert.first.inner_text() if alert.count() else ''
            check('⑥ 100% 달성 시 쪼꼬 축하 한마디', '100%' in alert_text and '쪼꼬' in alert_text, alert_text.replace('\n', ' ')[:80])
            child.screenshot(path=str(SHOTS / '07-child-congrats.png'))

            # ---------------------------------------------------------------- ⑦ 아이 화면 구매
            child.get_by_test_id('open-shop-child').click()
            child.wait_for_timeout(700)
            check('⑦ 아이 잔액이 보임', '100P' in text_of(child, 'shop-balance'), text_of(child, 'shop-balance').replace('\n', ' '))
            buy = child.locator('[data-testid^="shop-buy-"]')
            check('⑦ 상품 구매 버튼 있음', buy.count() > 0)
            buy.first.click()
            child.wait_for_timeout(400)
            check('⑦ 구매 확인 팝업', child.get_by_test_id('shop-buy-confirm').count() == 1)
            child.get_by_test_id('shop-buy-ok').click()
            child.wait_for_timeout(1200)
            check('⑦ 구매하면 포인트가 바로 차감', '50P' in text_of(child, 'shop-balance'), text_of(child, 'shop-balance').replace('\n', ' '))
            child.screenshot(path=str(SHOTS / '08-child-shop.png'))
            child.get_by_test_id('shop-close').click()
            child.wait_for_timeout(300)
            child.close()

            # ---------------------------------------------------------------- ⑦ 부모: 구매 내역 · 지급 완료
            page.reload()
            page.wait_for_timeout(1500)
            enter_pin(page)
            page.get_by_test_id('open-shop').click()
            page.wait_for_timeout(600)
            page.get_by_test_id('shop-tab-orders').click()
            page.wait_for_timeout(400)
            orders_text = text_of(page, 'shop-orders')
            check('⑦ 부모 화면에 구매 내역이 보임', '간식 쿠폰' in orders_text, orders_text.replace('\n', ' ')[:80])
            deliver = page.locator('[data-testid^="shop-deliver-"]')
            check('⑦ 지급 완료 버튼 있음', deliver.count() == 1)
            deliver.first.click()
            page.wait_for_timeout(900)
            check('⑦ 지급 완료로 바뀜', '지급 완료' in text_of(page, 'shop-orders'))
            page.screenshot(path=str(SHOTS / '09-shop-orders.png'))

            # 포인트 지급
            page.get_by_test_id('shop-tab-manage').click()
            page.wait_for_timeout(300)
            page.get_by_test_id('shop-grant-points').fill('30')
            page.get_by_test_id('shop-grant-label').fill('시험 격려')
            page.get_by_test_id('shop-grant-save').click()
            page.wait_for_timeout(1000)
            page.get_by_test_id('shop-tab-shop').click()
            page.wait_for_timeout(300)
            check('⑦ 부모 지급 후 잔액 80P', '80P' in text_of(page, 'shop-balance'), text_of(page, 'shop-balance').replace('\n', ' '))
            page.get_by_test_id('shop-close').click()
            page.wait_for_timeout(300)

            # ---------------------------------------------------------------- ② 종료 확인 [종료]
            # ②-a 브라우저가 window.close() 를 막는 경우(일반 탭) — 이전 화면으로 나가야 합니다.
            exit_page = context.new_page()
            exit_page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            exit_page.goto(f'{BASE}demo.html')
            exit_page.wait_for_timeout(600)
            exit_page.goto(f'{BASE}index.html#as=mem_dad')
            exit_page.wait_for_timeout(1500)
            exit_page.evaluate('window.history.back()')
            exit_page.wait_for_timeout(900)
            check('② 뒤로가기 → 종료 확인 모달', exit_page.get_by_test_id('exit-modal').count() == 1)
            exit_page.screenshot(path=str(SHOTS / '10-exit-modal.png'))
            exit_page.evaluate("() => { window.close = () => { throw new Error('blocked'); }; }")
            exit_page.get_by_test_id('exit-confirm-ok').click()
            left = True
            try:
                exit_page.wait_for_url(re.compile(r'demo\.html'), timeout=6000)
            except Exception:
                left = False
            check('② [종료] (창 닫기 막힌 경우) → 이전 화면으로 나감', left, exit_page.url)
            exit_page.close()

            # ②-b 창 닫기가 허용되는 경우(스크립트로 연 창 = 설치형 앱과 같은 조건) — 실제로 닫혀야 합니다.
            opener = context.new_page()
            opener.goto(f'{BASE}demo.html')
            opener.wait_for_timeout(500)
            with context.expect_page() as popup_info:
                opener.evaluate(f"window.open('{BASE}index.html#as=mem_dad', '_blank')")
            close_page = popup_info.value
            close_page.wait_for_timeout(1800)
            close_page.evaluate('window.history.back()')
            close_page.wait_for_timeout(900)
            check('② 새 창(설치형 앱과 같은 조건)에서도 종료 확인 모달', close_page.get_by_test_id('exit-modal').count() == 1)
            close_page.get_by_test_id('exit-confirm-ok').click()
            try:
                close_page.wait_for_timeout(1500)
            except Exception:
                pass  # 창이 바로 닫히면 기다릴 페이지가 없습니다 — 닫힌 것이 정답입니다.
            check('② [종료] (창 닫기 허용) → 창이 닫힘', close_page.is_closed())
            opener.close()

            # ---------------------------------------------------------------- 오류/넓이
            ignorable = ('favicon', 'Manifest', 'Download the React DevTools')
            real_errors = [error for error in console_errors if not any(token in error for token in ignorable)]
            check('콘솔 오류 0', len(real_errors) == 0, ' | '.join(real_errors[:3]))
            browser.close()
    finally:
        server.terminate()

    # ---------------------------------------------------------------- 라이브(읽기만)
    if os.environ.get('SKIP_LIVE') == '1':
        print(f'\n{checks - len(failures)}/{checks} 통과 (라이브 검사 생략)')
        if failures:
            print('실패:', ', '.join(failures))
            raise SystemExit(1)
        return
    base, key = env_pair()
    tables = ['tasks', 'family_notes', 'family_tier_events']
    before = {table: rest_count(table) for table in tables}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )
        context = browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Seoul', locale='ko-KR')
        page = context.new_page()
        errors: list[str] = []
        bad_requests: list[str] = []
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('response', lambda response: bad_requests.append(f'{response.status} {response.url}') if response.status >= 400 else None)
        page.goto(f'{LIVE}?v=batch1#as=mem_dad')
        page.wait_for_timeout(6000)
        check('라이브 화면이 열림', page.get_by_test_id('open-options').count() + page.get_by_test_id('parent-pin-gate').count() > 0)
        sw_text = page.evaluate("(async () => { const r = await navigator.serviceWorker.getRegistration(); const c = await caches.keys(); return c.join(','); })()")
        check('라이브 캐시 이름이 v11', 'study-check-shell-v11' in (sw_text or ''), sw_text)
        real = [error for error in errors if 'favicon' not in error]
        bad = [item for item in bad_requests if 'favicon' not in item]
        check('라이브 콘솔 오류 0', len(real) == 0, ' | '.join(real[:3]))
        check('라이브 404·실패 요청 없음', len(bad) == 0, ' | '.join(bad[:3]))
        page.screenshot(path=str(SHOTS / '11-live.png'))
        browser.close()

    after = {table: rest_count(table) for table in tables}
    check('라이브 DB 행 수 그대로', before == after, f'{before} → {after}')

    print(f'\n{checks - len(failures)}/{checks} 통과')
    if failures:
        print('실패:', ', '.join(failures))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
