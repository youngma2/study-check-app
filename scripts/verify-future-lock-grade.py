"""미래 날짜 완료 잠금 · 매년 3월 학년 자동 진급 — 화면 검증.

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-future-lock-grade.py

390×844 헤드리스 Chrome(데모 빌드, Asia/Seoul)으로 확인합니다.
- 아직 안 온 날짜(내일·다음 주)는 완료 버튼이 `disabled` + 자물쇠로 잠기고, 눌러도 상태가 바뀌지 않는다.
- 오늘·지난 날짜는 그대로 완료된다(부모도 동일).
- 학년은 화면(아이 보드·프로필)에서 3월 1일에 한 학년 올라간다(2/28 에는 그대로).
"""
from __future__ import annotations

import datetime
import os
import pathlib
import re
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4185
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
KST = datetime.timezone(datetime.timedelta(hours=9))

DB_KEY = 'study-check.db.v1'

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
        ['npx', 'vite', 'preview', '--outDir', 'dist-demo', '--port', str(PORT), '--host', '127.0.0.1'],
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


def open_day(page, month: int, day: int) -> None:
    page.get_by_role('button', name=re.compile(f'{month}월 {day}일')).first.click()
    page.wait_for_timeout(350)


def locked_count(page) -> int:
    return page.locator('[data-testid="complete-locked"]').count()


def complete_count(page) -> int:
    return page.locator('[data-testid="complete-task"]').count()


def verified_on(page, iso: str) -> int:
    return page.evaluate(
        """(args) => {
            const [key, iso] = args;
            const raw = window.localStorage.getItem(key);
            if (!raw) return 0;
            const db = JSON.parse(raw);
            return db.tasks.filter((t) => t.due_date === iso && t.status === 'verified').length;
        }""",
        [DB_KEY, iso],
    )


def grade_text(page, member: str) -> str:
    node = page.locator(f'[data-testid="member-grade-{member}"]')
    return node.first.inner_text() if node.count() > 0 else ''


def main() -> int:
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )

            def new_page(clock: datetime.datetime | None = None):
                ctx = browser.new_context(
                    viewport={'width': 390, 'height': 844},
                    locale='ko-KR',
                    timezone_id='Asia/Seoul',
                )
                page = ctx.new_page()
                if clock is not None:
                    page.clock.install(time=clock)
                return ctx, page

            # ---------------------------------------------------------------
            # A. 아이 화면 — 아직 안 온 날짜는 완료 버튼이 잠긴다 (오늘 = 2026-11-24)
            # ---------------------------------------------------------------
            # 검사는 날짜를 고정합니다 — 스크립트가 보는 날짜(오늘 2026-11-24)가 실제 날짜와 달라도 같은 결과.
            ctx_a, page = new_page(clock=datetime.datetime(2026, 11, 24, 15, 0, tzinfo=KST))
            errors: list[str] = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE + '#as=mem_child2')
            page.wait_for_selector('[data-testid="task-card"]')

            check('오늘(11/24): 완료 버튼이 그대로 있다', complete_count(page) > 0, f'{complete_count(page)}개')
            check('오늘(11/24): 잠긴 버튼은 없다', locked_count(page) == 0)

            # 내일(11/25 수)
            open_day(page, 11, 25)
            cards = page.locator('[data-testid="task-card"]').count()
            locked = locked_count(page)
            check('내일(11/25): 카드마다 잠긴 완료 버튼', locked == cards and cards > 0, f'카드 {cards} · 잠김 {locked}')
            check('내일(11/25): 완료 버튼은 하나도 없다', complete_count(page) == 0)
            check('내일(11/25): 완료된 항목 없음', page.locator('[data-testid="completed-at"]').count() == 0)

            first_locked = page.locator('[data-testid="complete-locked"]').first
            check('잠긴 버튼은 disabled', first_locked.is_disabled())
            check('잠긴 버튼에 자물쇠 아이콘', first_locked.locator('svg').count() == 1)
            check(
                '잠긴 버튼이 이유를 알려 준다',
                '그날' in (first_locked.get_attribute('title') or '')
                and '그날' in (first_locked.get_attribute('aria-label') or ''),
                first_locked.get_attribute('title') or '',
            )

            # disabled 라서 눌러도 아무 일도 없다 — 스크립트로 눌러 봐도 상태 그대로
            page.evaluate(
                """() => {
                    document.querySelectorAll('[data-testid="complete-locked"]').forEach((btn) => btn.click());
                }"""
            )
            page.wait_for_timeout(500)
            check('눌러도 완료되지 않는다', page.locator('[data-testid="completed-at"]').count() == 0)
            check('눌러도 DB 에 완료가 생기지 않는다', verified_on(page, '2026-11-25') == 0)
            check('눌러도 여전히 할 일', page.locator('[data-testid="task-card"]').first.inner_text().count('할 일') == 1)
            check('눌러도 잠금 풀리지 않음', locked_count(page) == cards)

            # 다음 주(12/1) — 샘플 목록이 없는 날이라 하나 추가해 보고, 그 항목도 잠기는지
            page.get_by_role('button', name='다음 주').click()
            page.wait_for_timeout(400)
            open_day(page, 12, 1)
            check('다음 주(12/1): 처음엔 항목 없음', page.locator('[data-testid="task-card"]').count() == 0)
            page.get_by_role('button', name=re.compile('항목 추가하기')).first.click()
            page.wait_for_selector('[data-testid="save-task"]')
            page.get_by_placeholder('예) 문제집과 오답 노트').fill('다음 주 미리 숙제')
            page.click('[data-testid="save-task"]')
            page.wait_for_selector('[data-testid="task-card"]', timeout=6000)
            page.wait_for_timeout(400)
            next_cards = page.locator('[data-testid="task-card"]').count()
            check(
                '다음 주(12/1): 새로 넣은 항목도 잠김',
                next_cards == 1 and locked_count(page) == 1 and complete_count(page) == 0,
                f'카드 {next_cards} · 잠김 {locked_count(page)}',
            )
            check('다음 주(12/1): DB 완료 0', verified_on(page, '2026-12-01') == 0)

            # 오늘로 돌아와 완료 — 오늘은 잠기지 않는다
            page.get_by_role('button', name='오늘').click()
            page.wait_for_timeout(400)
            today_complete = complete_count(page)
            check('오늘로 돌아오면 완료 버튼이 살아 있다', today_complete > 0 and locked_count(page) == 0)
            page.locator('[data-testid="complete-task"]').first.click()
            page.wait_for_selector('[data-testid="completed-at"]', timeout=6000)
            check('오늘: 완료가 그대로 된다', page.locator('[data-testid="completed-at"]').count() >= 1)
            check('오늘: DB 에 완료 기록(시각 포함)', verified_on(page, '2026-11-24') >= 1)

            # 지난 날(11/23 월)의 확인 대기 항목도 완료할 수 있다
            open_day(page, 11, 23)
            check('지난 날(11/23): 완료 버튼이 살아 있다', complete_count(page) > 0 and locked_count(page) == 0)
            page.locator('[data-testid="complete-task"]').first.click()
            page.wait_for_timeout(700)
            check('지난 날도 몰아서 완료된다', verified_on(page, '2026-11-23') >= 1)

            # 학년 표시(오늘 = 2026-11-24, 기준 학년도 2026)
            check('아이 보드 학년: 둘째 초4', grade_text(page, 'mem_child2') == '초4', grade_text(page, 'mem_child2'))
            page.click('[data-testid="open-profile"]')
            page.wait_for_selector('[role="dialog"]')
            check(
                '프로필 학년: 첫째 중1 · 둘째 초4',
                page.locator('[data-testid="profile-grade-mem_child1"]').inner_text() == '중1'
                and page.locator('[data-testid="profile-grade-mem_child2"]').inner_text() == '초4',
            )
            page.locator('[role="dialog"] button[aria-label="닫기"]').click()
            page.wait_for_selector('[role="dialog"]', state='detached')
            ctx_a.close()

            # ---------------------------------------------------------------
            # B. 부모 화면에서도 미래 날짜는 잠긴다
            # ---------------------------------------------------------------
            ctx_b, dad = new_page(clock=datetime.datetime(2026, 11, 24, 15, 0, tzinfo=KST))
            dad.on('pageerror', lambda error: errors.append(str(error)))
            dad.goto(BASE + '#as=mem_dad')
            dad.wait_for_selector('[data-testid="parent-pin-gate"]')
            type_pin(dad, '1111')
            type_pin(dad, '1111')
            dad.wait_for_selector('[data-testid="task-card"]', timeout=8000)
            open_day(dad, 11, 26)
            parent_cards = dad.locator('[data-testid="task-card"]').count()
            check(
                '부모: 미래 날짜(11/26) 전부 잠김',
                parent_cards > 0 and locked_count(dad) == parent_cards and complete_count(dad) == 0,
                f'카드 {parent_cards} · 잠김 {locked_count(dad)}',
            )
            dad.get_by_role('button', name='오늘').click()
            dad.wait_for_timeout(400)
            check('부모: 오늘은 완료할 수 있다', complete_count(dad) > 0 and locked_count(dad) == 0)
            check('부모: 학년이 화면에 보인다', grade_text(dad, 'mem_child1') == '중1', grade_text(dad, 'mem_child1'))
            ctx_b.close()

            # ---------------------------------------------------------------
            # C. 3월 1일 학년 자동 진급 (브라우저 시계를 옮겨 확인)
            # ---------------------------------------------------------------
            def grades_at(moment: datetime.datetime, member: str) -> str:
                ctx, page = new_page(clock=moment)
                page.goto(BASE + f'#as={member}')
                page.wait_for_selector(f'[data-testid="member-grade-{member}"]')
                value = grade_text(page, member)
                ctx.close()
                return value

            check(
                '2026-11-24: 첫째 중1 · 둘째 초4',
                grades_at(datetime.datetime(2026, 11, 24, 10, 0, tzinfo=KST), 'mem_child1') == '중1'
                and grades_at(datetime.datetime(2026, 11, 24, 10, 0, tzinfo=KST), 'mem_child2') == '초4',
            )
            check(
                '2027-02-28 23:30 (학기 중): 아직 중1 · 초4',
                grades_at(datetime.datetime(2027, 2, 28, 23, 30, tzinfo=KST), 'mem_child1') == '중1'
                and grades_at(datetime.datetime(2027, 2, 28, 23, 30, tzinfo=KST), 'mem_child2') == '초4',
            )
            check(
                '2027-03-01 00:30: 한 학년 올라 중2 · 초5',
                grades_at(datetime.datetime(2027, 3, 1, 0, 30, tzinfo=KST), 'mem_child1') == '중2'
                and grades_at(datetime.datetime(2027, 3, 1, 0, 30, tzinfo=KST), 'mem_child2') == '초5',
            )
            check(
                '2029-03-01: 초6→중1 · 중3→고1 로 이어짐',
                grades_at(datetime.datetime(2029, 3, 1, 9, 0, tzinfo=KST), 'mem_child1') == '고1'
                and grades_at(datetime.datetime(2029, 3, 1, 9, 0, tzinfo=KST), 'mem_child2') == '중1',
            )
            check(
                '2030-01-15 (아직 2029 학년도): 그대로 고1 · 중1',
                grades_at(datetime.datetime(2030, 1, 15, 9, 0, tzinfo=KST), 'mem_child1') == '고1'
                and grades_at(datetime.datetime(2030, 1, 15, 9, 0, tzinfo=KST), 'mem_child2') == '중1',
            )
            check(
                '2032-03-01: 고3 은 졸업',
                grades_at(datetime.datetime(2032, 3, 1, 9, 0, tzinfo=KST), 'mem_child1') == '졸업'
                and grades_at(datetime.datetime(2032, 3, 1, 9, 0, tzinfo=KST), 'mem_child2') == '고1',
            )

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
