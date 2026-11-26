"""달력 하단 상태 안내 범례 제거 검증.

데모(기기 저장) 빌드(dist-no-legend)를 미리보기 서버로 띄워 390×844 헤드리스 Chrome 으로
  - 달력 카드 안에 상태 안내 범례(확인 대기 · 진행 중 · 모두 완료 · 공휴일)가 없음
  - 달력/체크리스트/한마디/통계 기능이 그대로 동작함
을 확인하고 스크린샷을 남깁니다.
    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-no-legend
    python3 scripts/verify-no-legend.py
"""
from __future__ import annotations

import os
import pathlib
import re
import socket
import subprocess
from datetime import date, datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4187
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
SHOT = '/workspace/downloads/study_no_legend.png'

FIXED_TODAY = date(2026, 11, 25)
FIXED_NOW = datetime(2026, 11, 25, 20, 0, tzinfo=timezone(timedelta(hours=9)))

LEGEND_WORDS = ['확인 대기', '진행 중', '모두 완료', '공휴일']

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        failures.append(name)


def wait_for_port(port: int, timeout: float = 40.0) -> bool:
    import time

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
        ['npx', 'vite', 'preview', '--outDir', 'dist-no-legend', '--port', str(PORT)],
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


CALENDAR_JS = """() => {
  const btn = document.querySelector('button[aria-label="이전 주"]');
  if (!btn) return null;
  const section = btn.closest('section');
  return section ? { text: section.innerText, html: section.outerHTML } : null;
}"""


def main() -> int:
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox', '--disable-dev-shm-usage'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            ctx = browser.new_context(
                viewport={'width': 390, 'height': 844},
                locale='ko-KR',
                timezone_id='Asia/Seoul',
                is_mobile=True,
                has_touch=True,
            )
            page = ctx.new_page()
            page.clock.set_fixed_time(FIXED_NOW)
            errors: list[str] = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            page.goto(BASE + '#as=mem_dad')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            for _ in range(2):
                for digit in '1111':
                    page.click(f'[data-testid="pin-key-{digit}"]')
            page.wait_for_selector('[data-testid="task-card"]', timeout=10000)

            # 1) 달력 카드 안에 범례가 없다
            cal = page.evaluate(CALENDAR_JS)
            check('달력 카드가 화면에 있다', bool(cal))
            if cal:
                text = cal['text']
                for word in LEGEND_WORDS:
                    check(f'달력 카드 텍스트에 "{word}" 없음', word not in text, repr(word))
                # 범례용 색 점(확인 대기·모두 완료)의 흔적이 없다.
                # (공휴일 빨간 점은 날짜 칸의 정상 표시라 따로 셉니다.)
                dots = page.evaluate(
                    """() => {
                      const btn = document.querySelector('button[aria-label="이전 주"]');
                      const section = btn.closest('section');
                      return {
                        amber: [...section.querySelectorAll('span.bg-amber-400')].filter((el) => !el.closest('button')).length,
                        emerald: [...section.querySelectorAll('span.bg-emerald-400')].filter((el) => !el.closest('button')).length,
                        rose: [...section.querySelectorAll('span.bg-rose-500')].filter((el) => !el.closest('button')).length,
                        holidayDots: section.querySelectorAll('[data-testid^="holiday-dot-"]').length,
                      };
                    }"""
                )
                check('달력 카드에 범례용 노란 점(확인 대기) 없음', dots['amber'] == 0, f"{dots['amber']}개")
                check('달력 카드에 범례용 초록 점(모두 완료) 없음', dots['emerald'] == 0, f"{dots['emerald']}개")
                check('달력 카드에 범례용 빨간 점(공휴일 표시줄) 없음', dots['rose'] == 0, f"{dots['rose']}개")
                check('공휴일 점은 날짜 칸 안에만 있음', dots['holidayDots'] == 0 or dots['rose'] == 0, f"holiday {dots['holidayDots']}")
            body_text = page.inner_text('body')
            check('화면 어디에도 "진행 중" 문구 없음', '진행 중' not in body_text)

            # 2) 달력 기능: 요일 7칸 · 날짜 선택 · 다음 주 이동 · 공휴일 표시
            day_buttons = page.locator('button[aria-pressed]')
            check('달력 날짜 버튼 7개', day_buttons.count() == 7, str(day_buttons.count()))
            page.get_by_role('button', name=re.compile('11월 25일')).first.click()
            page.wait_for_timeout(200)
            check('날짜 선택 동작', '11월 25일' in page.inner_text('body'))
            before_range = page.evaluate(CALENDAR_JS)['text']
            page.get_by_role('button', name='다음 주').click()
            page.wait_for_timeout(250)
            after_range = page.evaluate(CALENDAR_JS)['text']
            check('다음 주 이동', after_range != before_range, after_range.splitlines()[1] if len(after_range.splitlines()) > 1 else after_range)
            # 2026-12-25 성탄절 주 → 공휴일 줄은 그대로 남아 있어야 한다
            for _ in range(3):
                page.get_by_role('button', name='다음 주').click()
                page.wait_for_timeout(150)
            check('공휴일 안내 줄 유지(12/25 성탄절)', '성탄절' in page.inner_text('[data-testid="week-holidays"]'))
            check('공휴일 빨간 점 표시', page.locator('[data-testid="holiday-dot-2026-12-25"]').count() == 1)
            page.get_by_role('button', name='오늘').click()
            page.wait_for_timeout(250)

            # 3) 체크리스트 동작 (부모 확인)
            cards = page.locator('[data-testid="task-card"]')
            check('체크리스트 카드 표시', cards.count() > 0, f'{cards.count()}개')
            cards.first.locator('[data-testid="complete-task"]').click()
            page.wait_for_timeout(400)
            check('완료 체크 → 완료 시각', page.locator('[data-testid="completed-at"]').count() >= 1)
            page.locator('[data-testid="revert-task"]').first.click()
            page.wait_for_timeout(400)

            # 4) 한마디 게시판
            check('가족 한마디 게시판 표시', page.locator('[data-testid="family-notes"]').count() == 1)
            note = f'범례 제거 검증 {FIXED_NOW:%H:%M}'
            page.fill('[data-testid="note-input"]', note)
            page.click('[data-testid="note-submit"]')
            page.wait_for_timeout(500)
            check('한마디 등록', note in page.inner_text('[data-testid="family-notes"]'))

            # 5) 통계 대시보드
            page.click('[data-testid="parent-week-summary"]')
            page.wait_for_selector('[data-testid="parent-dashboard"]', timeout=8000)
            dash = page.inner_text('[data-testid="parent-dashboard"]')
            check('통계 대시보드 열림', '통계' in dash or '주간' in dash or '%' in dash)
            page.click('[data-testid="dashboard-close"]')
            page.wait_for_selector('[data-testid="parent-dashboard"]', state='detached')

            # 6) 가로 오버플로 없음 + 스크린샷
            overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check('390px 가로 오버플로 없음', overflow <= 0, f'{overflow}px')
            page.evaluate('window.scrollTo(0, 0)')
            page.wait_for_timeout(200)
            page.screenshot(path=SHOT, full_page=True)
            check('스크린샷 저장', pathlib.Path(SHOT).exists(), SHOT)

            check('JS 오류 없음', not errors, str(errors))
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
