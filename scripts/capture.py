"""모바일(390x844) 스크린샷 + 역할별 권한 스모크 테스트.

사용법:
    python3 scripts/capture.py            # 미리보기 서버를 직접 띄우고 캡처
    python3 scripts/capture.py --url http://127.0.0.1:4174/   # 이미 떠 있는 서버 사용
"""

from __future__ import annotations

import os
import pathlib
import signal
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
PORT = 4174
BASE_URL = f'http://127.0.0.1:{PORT}/'
NODE_BIN = '/workspace/.tools/node/bin'


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
        ['npm', 'run', 'preview', '--', '--port', str(PORT)],
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


def stop_server(proc):
    if proc is None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass


def hide_fixed_bottom(page, hidden: bool) -> None:
    page.evaluate(
        """(hidden) => {
            const bar = document.querySelector('[data-fixed-bottom]');
            if (bar && bar.parentElement) bar.parentElement.style.display = hidden ? 'none' : '';
        }""",
        hidden,
    )


def main() -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    server = None
    if '--url' in sys.argv:
        url = sys.argv[sys.argv.index('--url') + 1]
    else:
        server = start_server()
        url = BASE_URL

    launch_env = os.environ.copy()
    launch_env['LD_LIBRARY_PATH'] = CHROME_LIBS + os.pathsep + launch_env.get('LD_LIBRARY_PATH', '')

    failures: list[str] = []
    console_errors: list[str] = []

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=CHROME,
                headless=True,
                env=launch_env,
                args=['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
            )
            context = browser.new_context(
                viewport={'width': 390, 'height': 844},
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                locale='ko-KR',
                timezone_id='Asia/Seoul',
            )
            page = context.new_page()
            page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
            page.on('pageerror', lambda err: console_errors.append(f'pageerror: {err}'))

            # ---------------------------------------------------------------
            # 1) 부모(아빠) 시점 스크린샷
            # ---------------------------------------------------------------
            page.goto(url, wait_until='networkidle')
            page.wait_for_timeout(800)
            page.screenshot(path=str(DOWNLOADS / 'study_app_parent.png'), animations='disabled')

            hide_fixed_bottom(page, True)
            page.screenshot(
                path=str(DOWNLOADS / 'study_app_parent_full.png'),
                full_page=True,
                animations='disabled',
            )
            hide_fixed_bottom(page, False)

            parent_verify = page.get_by_test_id('verify-task').count()
            parent_delete = page.get_by_test_id('delete-task').count()
            parent_cards = page.get_by_test_id('task-card').count()
            print(f'[parent] cards={parent_cards} verify={parent_verify} delete={parent_delete}')
            if parent_verify == 0:
                failures.append('부모 시점에 확인 완료 버튼이 보이지 않습니다.')
            if parent_delete == 0:
                failures.append('부모 시점에 삭제 버튼이 보이지 않습니다.')

            # 부모가 '확인 대기' 항목을 확인 완료 처리
            pending_before = page.locator('[data-testid="task-card"] >> text=확인 대기').count()
            page.get_by_test_id('verify-task').first.click()
            page.wait_for_timeout(400)
            pending_after = page.locator('[data-testid="task-card"] >> text=확인 대기').count()
            print(f'[parent] pending {pending_before} -> {pending_after}')
            if pending_after >= pending_before:
                failures.append('확인 완료 클릭 후 확인 대기 항목 수가 줄지 않았습니다.')

            # 주간 이동 (다음 주 → 오늘)
            page.get_by_label('다음 주').click()
            page.wait_for_timeout(300)
            next_week_title = page.locator('h2').first.inner_text()
            page.get_by_role('button', name='오늘', exact=True).click()
            page.wait_for_timeout(300)
            today_title = page.locator('h2').first.inner_text()
            print(f'[parent] next-week={next_week_title!r} / today={today_title!r}')
            if next_week_title == today_title:
                failures.append('다음 주 버튼으로 날짜가 이동하지 않았습니다.')

            # 항목 추가
            cards_before_add = page.get_by_test_id('task-card').count()
            page.get_by_test_id('open-add').click()
            page.wait_for_timeout(300)
            page.get_by_placeholder('예) 수학 문제집 2쪽 풀기').fill('테스트 항목')
            page.get_by_test_id('save-task').click()
            page.wait_for_timeout(500)
            cards_after_add = page.locator('[data-testid="task-card"] >> text=테스트 항목').count()
            print(f'[parent] add: cards {cards_before_add} -> +{cards_after_add} (테스트 항목)')
            if cards_after_add != 1:
                failures.append('항목 추가가 반영되지 않았습니다.')

            # 새로고침 후에도 남아 있는지(저장 확인)
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(500)
            persisted = page.locator('[data-testid="task-card"] >> text=테스트 항목').count()
            manifest_ok = page.evaluate("Boolean(document.querySelector('link[rel=manifest]'))")
            print(f'[parent] persisted after reload={persisted}, manifest link={manifest_ok}')
            if persisted != 1:
                failures.append('새로고침 후 추가한 항목이 사라졌습니다(localStorage).')
            if not manifest_ok:
                failures.append('manifest.json 링크가 없습니다(PWA).')

            # 삭제(확인창 수락)
            cards_before_delete = page.get_by_test_id('task-card').count()
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_test_id('delete-task').first.click()
            page.wait_for_timeout(500)
            cards_after_delete = page.get_by_test_id('task-card').count()
            print(f'[parent] delete: cards {cards_before_delete} -> {cards_after_delete}')
            if cards_after_delete >= cards_before_delete:
                failures.append('삭제 후 항목 수가 줄지 않았습니다.')

            # ---------------------------------------------------------------
            # 2) 아이(둘째) 시점 — 저장소를 비워 샘플 상태에서 캡처
            # ---------------------------------------------------------------
            page.evaluate('window.localStorage.clear()')
            page.goto(url + '#as=mem_child2', wait_until='networkidle')
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(800)
            page.screenshot(path=str(DOWNLOADS / 'study_app_child.png'), animations='disabled')

            hide_fixed_bottom(page, True)
            page.screenshot(
                path=str(DOWNLOADS / 'study_app_child_full.png'),
                full_page=True,
                animations='disabled',
            )
            hide_fixed_bottom(page, False)

            child_delete = page.get_by_test_id('delete-task').count()
            child_verify = page.get_by_test_id('verify-task').count()
            child_request = page.get_by_test_id('request-task').count()
            child_cards = page.get_by_test_id('task-card').count()
            owner_name = page.get_by_test_id('open-profile').inner_text()
            print(f'[child] cards={child_cards} verify={child_verify} delete={child_delete} request={child_request}')
            print(f'[child] profile chip={owner_name!r}')

            if '둘째' not in owner_name:
                failures.append('아이 시점으로 전환되지 않았습니다.')
            if child_delete != 0:
                failures.append('아이 시점에 삭제 버튼이 노출됩니다.')
            if child_verify != 0:
                failures.append('아이 시점에 확인 완료 버튼이 노출됩니다.')
            if child_request == 0:
                failures.append('아이 시점에 완료 요청 버튼이 없습니다.')

            # 아이가 완료 요청 → 상태 전이 확인
            before_pending = page.locator('[data-testid="task-card"] >> text=확인 대기').count()
            page.get_by_test_id('request-task').first.click()
            page.wait_for_timeout(500)
            after_pending = page.locator('[data-testid="task-card"] >> text=확인 대기').count()
            toast_text = page.get_by_text('부모님께 완료 요청을 보냈어요').count()
            print(f'[child] pending {before_pending} -> {after_pending}, toast={toast_text}')
            if after_pending <= before_pending:
                failures.append('완료 요청 후 확인 대기 항목이 늘지 않았습니다.')
            if toast_text == 0:
                failures.append('완료 요청 안내 토스트가 보이지 않았습니다.')

            # 아이가 새 항목 추가 (자기 것만)
            page.get_by_test_id('open-add').click()
            page.wait_for_timeout(300)
            page.get_by_placeholder('예) 수학 문제집 2쪽 풀기').fill('아이 추가 항목')
            page.get_by_test_id('save-task').click()
            page.wait_for_timeout(500)
            added_by_child = page.locator('[data-testid="task-card"] >> text=아이 추가 항목').count()
            still_no_delete = page.get_by_test_id('delete-task').count()
            print(f'[child] add own item={added_by_child}, delete buttons still={still_no_delete}')
            if added_by_child != 1:
                failures.append('아이가 자기 항목을 추가하지 못했습니다.')
            if still_no_delete != 0:
                failures.append('아이 화면에 삭제 버튼이 생겼습니다.')

            # 3) 부모로 돌아가 확인 → 아이가 요청한 항목 검증
            page.goto(url + '#as=mem_dad', wait_until='networkidle')
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(500)
            before_verified = page.locator('[data-testid="task-card"] >> text=부모 확인 완료').count()
            page.get_by_test_id('verify-task').first.click()
            page.wait_for_timeout(400)
            after_verified = page.locator('[data-testid="task-card"] >> text=부모 확인 완료').count()
            print(f'[parent] verified badges {before_verified} -> {after_verified}')
            if after_verified <= before_verified:
                failures.append('부모 확인 완료 처리가 반영되지 않았습니다.')

            context.close()
            browser.close()
    finally:
        stop_server(server)

    if console_errors:
        print('[console errors]')
        for line in console_errors[:10]:
            print(' -', line)

    # Supabase 표를 아직 만들지 않은 상태(SQL 실행 전)에는 REST 404 가 정상이라
    # 브라우저가 남기는 'Failed to load resource' 로그는 오류로 보지 않습니다.
    relevant_console_errors = [
        line
        for line in console_errors
        if 'favicon' not in line and 'manifest' not in line and 'Failed to load resource' not in line
    ]
    if relevant_console_errors:
        failures.append(f'브라우저 콘솔 오류 {len(relevant_console_errors)}건')

    print()
    if failures:
        print('FAIL')
        for item in failures:
            print(' -', item)
        return 1

    print('PASS: 스크린샷 저장 + 권한 규칙 확인 완료')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
