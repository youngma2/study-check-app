"""부모 PIN 키패드 진동 검증.

데모(기기 저장) 빌드(dist-demo)를 미리보기 서버로 띄운 뒤, 390×844 헤드리스 Chrome 에서
navigator.vibrate 를 가로채 숫자·지우기·취소 버튼과 틀린 PIN 의 진동 패턴을 확인합니다.
    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-pin-vibrate.py
"""
from __future__ import annotations

import os
import pathlib
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4181
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

failures: list[str] = []

STUB = """
Object.defineProperty(navigator, 'vibrate', {
  configurable: true,
  writable: true,
  value: function (pattern) { window.__vibrations.push(pattern); return true; },
});
window.__vibrations = [];
"""


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


def main() -> int:
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox', '--disable-dev-shm-usage'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            page.add_init_script(STUB)
            page.goto(f'{BASE}#as=mem_dad', wait_until='networkidle')
            page.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=15000)

            # 1) 숫자 키 → 15ms 톡
            page.click('[data-testid="pin-key-1"]')
            page.click('[data-testid="pin-key-2"]')
            vib = page.evaluate('window.__vibrations')
            check('숫자 키 2번 = 진동 2번(15ms)', vib == [15, 15], str(vib))

            # 2) 지우기 → 15ms 톡
            page.click('[data-testid="pin-key-del"]')
            vib = page.evaluate('window.__vibrations')
            check('지우기 = 15ms 진동', vib == [15, 15, 15], str(vib))
            check('지우기 후 점 1개', page.locator('[data-testid="pin-dot-0"]').evaluate(
                "el => el.className.includes('bg-indigo-600')"))

            # 3) 4자리를 다르게 두 번 → 틀린 PIN 패턴
            page.evaluate('window.__vibrations = []')
            for key in ['1', '2', '3', '4']:
                page.click(f'[data-testid="pin-key-{key}"]')
            page.wait_for_timeout(400)
            second = page.locator('[data-testid="parent-pin-gate"]').inner_text()
            if '한 번 더' in second:
                for key in ['1', '2', '3', '5']:
                    page.click(f'[data-testid="pin-key-{key}"]')
                page.wait_for_timeout(600)
                vib = page.evaluate('window.__vibrations')
                check('틀린(서로 다른) PIN = [30,50,30]', [30, 50, 30] in vib, str(vib))
                check('오류 문구 표시', '달라요' in page.locator('[data-testid="pin-error"]').inner_text())

            # 4) 키보드 입력도 진동
            page.evaluate('window.__vibrations = []')
            page.keyboard.press('7')
            vib = page.evaluate('window.__vibrations')
            check('키보드 숫자 입력도 15ms', vib == [15], str(vib))

            # 5) iOS 처럼 vibrate 가 없는 기기에서도 오류 없이 동작
            page.evaluate("delete navigator.vibrate; Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true})")
            errors: list[str] = []
            page.on('pageerror', lambda exc: errors.append(str(exc)))
            page.click('[data-testid="pin-key-9"]')
            page.wait_for_timeout(300)
            check('vibrate 없는 기기에서도 JS 오류 없음', not errors, str(errors))
            check('vibrate 없어도 점은 찍힘', page.locator('[data-testid="pin-dot-1"]').evaluate(
                "el => el.className.includes('bg-indigo-600')"))

            page.screenshot(path=str(__import__('pathlib').Path('/workspace/downloads/study_pin_vibrate.png')))
            browser.close()
    finally:
        try:
            os.killpg(os.getpgid(server.pid), 15)
        except Exception:
            server.kill()

    print()
    print('실패:', failures if failures else '없음')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
