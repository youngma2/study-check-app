"""날짜 요약 완료율이 사람별로 나뉘는지 검증 (데모 빌드).

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-day-split.py

390×844 헤드리스 Chrome 으로 dist-demo 를 띄워 확인합니다.
부모 화면: 아이마다 카드 한 장씩(이름·개수·퍼센트·진행 막대) — 이름은 members 에서 옵니다.
아이 화면: 자기 카드 한 장만.
"""
from __future__ import annotations

import os
import pathlib
import re
import socket
import subprocess
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4181
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

DEMO_PIN = '1111'
DB_KEY = 'study-check.db.v1'

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
    if not cond:
        failures.append(name)


def korea_today() -> date:
    return datetime.now(ZoneInfo('Asia/Seoul')).date()


def wait_for_port(port: int, timeout: float = 60.0) -> bool:
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


def open_parent(page) -> None:
    """부모 화면으로 들어가기 (처음이면 PIN 정하기, 이후에는 PIN 입력)."""
    gate = page.locator('[data-testid="parent-pin-gate"]')
    if gate.count() == 0:
        return
    text = gate.inner_text()
    type_pin(page, DEMO_PIN)
    page.wait_for_timeout(300)
    if 'PIN 정하기' in text or '한 번 더' in gate.inner_text():
        type_pin(page, DEMO_PIN)
    page.wait_for_selector('[data-testid="open-profile"]', timeout=10000)


def is_call_task(task: dict) -> bool:
    title = task.get('title', '')
    ident = task.get('id', '')
    return '📞 통화' in title or '_call1' in ident or '_call2' in ident


def summarise(tasks: list[dict]) -> tuple[int, int, int]:
    verified = sum(1 for task in tasks if task['status'] == 'verified')
    pending = sum(1 for task in tasks if task['status'] == 'pending_verification')
    return len(tasks), verified, pending


def percent(verified: int, total: int) -> int:
    return 0 if total == 0 else round(verified / total * 100)


def card(page, member_id: str):
    return page.locator(f'[data-testid="day-stat-{member_id}"]')


def main() -> int:
    today = korea_today().isoformat()
    seeded_child1 = [
        ('t_split_c1_a', 'todo'),
        ('t_split_c1_b', 'verified'),
        ('t_split_c1_c', 'verified'),
        ('t_split_c1_d', 'verified'),
    ]
    seeded_child2 = [
        ('t_split_c2_a', 'todo'),
        ('t_split_c2_b', 'pending_verification'),
        ('t_split_c2_c', 'verified'),
    ]

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
            page.on('dialog', lambda dialog: dialog.accept())
            errors: list[str] = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            page.goto(BASE + '#as=mem_child1')
            page.wait_for_selector('[data-testid="open-profile"]', timeout=45000)
            page.wait_for_selector('[data-testid="day-member-stats"]', timeout=45000)

            # ---------------- 준비: 오늘 항목을 정해진 개수로 맞춘다 ----------------
            # 데모 데이터는 한 번 저장돼야 localStorage 에 남습니다 — 항목 하나를 넣어 둡니다.
            page.click('[data-testid="open-add"]')
            page.wait_for_selector('[data-testid="save-task"]')
            page.fill('[role="dialog"] input[placeholder="예) 수학 문제집 2쪽 풀기"]', '준비용 항목')
            page.click('[data-testid="save-task"]')
            page.wait_for_selector('text=공부 항목을 추가했어요', timeout=8000)
            page.wait_for_timeout(400)

            seeded = page.evaluate(
                """({ dbKey, dateIso, child1, child2 }) => {
                    const db = JSON.parse(localStorage.getItem(dbKey));
                    if (!db) return 'db 없음';
                    db.tasks = db.tasks.filter((task) => task.due_date !== dateIso);
                    const now = new Date().toISOString();
                    const push = (id, memberId, status, subject) => {
                      db.tasks.push({
                        id, family_id: db.families[0].id, member_id: memberId,
                        title: `검사 항목 ${id.slice(-1)}`, subject,
                        due_date: dateIso, status, created_by: memberId,
                        created_at: now,
                        verified_by: status === 'verified' ? 'mem_dad' : null,
                        verified_at: status === 'verified' ? now : null,
                      });
                    };
                    for (const [id, status] of child1) push(id, 'mem_child1', status, 'math');
                    for (const [id, status] of child2) push(id, 'mem_child2', status, 'korean');
                    localStorage.setItem(dbKey, JSON.stringify(db));
                    return 'ok';
                }""",
                {
                    'dbKey': DB_KEY,
                    'dateIso': today,
                    'child1': seeded_child1,
                    'child2': seeded_child2,
                },
            )
            check('준비: 오늘 항목을 둘째 3개·첫째 4개로 맞췄다', seeded == 'ok', str(seeded))

            db = page.evaluate(f"JSON.parse(localStorage.getItem('{DB_KEY}'))")
            names = {member['id']: member['name'] for member in db['members']}
            child_ids = [member['id'] for member in db['members'] if member['role'] == 'child']
            check('준비: 아이가 둘(members 에서 읽음)', len(child_ids) == 2, str([names[i] for i in child_ids]))

            page.reload()
            page.wait_for_selector('[data-testid="day-member-stats"]', timeout=45000)
            page.wait_for_timeout(500)

            # ---------------- A. 아이 화면: 자기 카드 한 장만 ----------------
            stats = page.locator('[data-testid="day-member-stats"] > *')
            check('아이 화면: 날짜 요약 카드가 한 장', stats.count() == 1, str(stats.count()))
            own = child_ids[0]
            other = child_ids[1]
            own_tasks = [task for task in db['tasks']
                         if task['member_id'] == own and task['due_date'] == today and not is_call_task(task)]
            own_total, own_verified, own_pending = summarise(own_tasks)
            own_text = card(page, own).inner_text()
            check('아이 화면: 내 카드만 있다', card(page, own).count() == 1 and card(page, other).count() == 0)
            check(f'아이 화면: 내 이름 — {names[own]}', names[own] in own_text, own_text.replace('\n', ' / '))
            check(
                '아이 화면: 내 완료/전체 개수',
                f'{own_verified} / {own_total}개' in own_text,
                f'{own_verified} / {own_total}개',
            )
            check(
                '아이 화면: 내 완료율',
                f'{percent(own_verified, own_total)}%' in own_text,
                f'{percent(own_verified, own_total)}%',
            )
            check(
                '아이 화면: 진행 막대 길이 = 완료율',
                page.eval_on_selector(
                    f'[data-testid="day-stat-bar-{own}"]',
                    'el => el.style.width',
                ) == f'{percent(own_verified, own_total)}%',
                page.eval_on_selector(f'[data-testid="day-stat-bar-{own}"]', 'el => el.style.width'),
            )
            check('아이 화면: 동생 카드 이름은 안 보인다', names[other] not in page.inner_text('[data-testid="day-member-stats"]'))
            child_summary = re.search(r'전체 (\d+)개 · 완료 (\d+)개', page.inner_text('main'))
            check(
                '아이 화면: 머리 요약도 내 것',
                child_summary is not None and int(child_summary.group(1)) == own_total
                and int(child_summary.group(2)) == own_verified,
                child_summary.group(0) if child_summary else '없음',
            )

            # ---------------- B. 부모 화면: 아이마다 카드 한 장씩 ----------------
            parent_id = next(m['id'] for m in db['members'] if m['role'] == 'parent')
            page.goto(BASE + f'#as={parent_id}')
            page.reload()  # 해시만 바뀌면 다시 읽지 않습니다 — 새로 열어 부모 시점으로 시작
            page.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=45000)
            open_parent(page)
            page.wait_for_selector('[data-testid="day-member-stats"]', timeout=45000)
            page.wait_for_timeout(400)

            cards = page.locator('[data-testid="day-member-stats"] > *')
            check('부모 화면: 아이마다 카드(2장)', cards.count() == 2, str(cards.count()))

            expected = {}
            for member_id in child_ids:
                tasks = [task for task in db['tasks'] if task['member_id'] == member_id and task['due_date'] == today]
                expected[member_id] = summarise(tasks)

            for member_id in child_ids:
                total, verified, pending = expected[member_id]
                text = card(page, member_id).inner_text()
                check(f'부모 화면: {names[member_id]} 이름', names[member_id] in text, text.replace('\n', ' / '))
                check(
                    f'부모 화면: {names[member_id]} 완료/전체 개수',
                    f'{verified} / {total}개' in text,
                    f'{verified} / {total}개',
                )
                check(
                    f'부모 화면: {names[member_id]} 완료율',
                    f'{percent(verified, total)}%' in text,
                    f'{percent(verified, total)}%',
                )
                aria = card(page, member_id).get_attribute('aria-label')
                check(
                    f'부모 화면: {names[member_id]} 접근성 이름',
                    aria is not None and f'{percent(verified, total)}%' in aria,
                    aria or '없음',
                )
                check(
                    f'부모 화면: {names[member_id]} 진행 막대',
                    page.eval_on_selector(
                        f'[data-testid="day-stat-bar-{member_id}"]', 'el => el.style.width'
                    ) == f'{percent(verified, total)}%',
                    page.eval_on_selector(f'[data-testid="day-stat-bar-{member_id}"]', 'el => el.style.width'),
                )

            check(
                '부모 화면: 아이 둘의 숫자가 서로 다르게 나온다',
                card(page, child_ids[0]).inner_text() != card(page, child_ids[1]).inner_text(),
            )

            # 나란히(같은 줄) 놓였는지 — 두 카드의 y 위치가 같고 x 가 다르다
            first = card(page, child_ids[0]).bounding_box()
            second = card(page, child_ids[1]).bounding_box()
            check(
                '부모 화면: 두 카드가 나란히',
                first is not None and second is not None
                and abs(first['y'] - second['y']) <= 2
                and abs(first['x'] - second['x']) > 50,
                f"c1 {first} / c2 {second}" if first and second else '없음',
            )
            check(
                '부모 화면: 두 카드가 화면 폭을 반씩',
                first is not None and second is not None and first['width'] < 260 and second['width'] < 260,
                f"{first['width'] if first else 0:.0f}px / {second['width'] if second else 0:.0f}px",
            )

            total_all = sum(value[0] for value in expected.values())
            verified_all = sum(value[1] for value in expected.values())
            parent_summary = re.search(r'전체 (\d+)개 · 완료 (\d+)개', page.inner_text('main'))
            check(
                '부모 화면: 머리 요약은 둘 합계',
                parent_summary is not None
                and int(parent_summary.group(1)) == total_all
                and int(parent_summary.group(2)) == verified_all,
                parent_summary.group(0) if parent_summary else '없음',
            )

            # 아이가 하나도 없으면 0% 카드도 겹치지 않게
            page.evaluate(
                """({ dbKey, dateIso, emptyId }) => {
                    const db = JSON.parse(localStorage.getItem(dbKey));
                    db.tasks = db.tasks.filter((task) => !(task.member_id === emptyId && task.due_date === dateIso));
                    localStorage.setItem(dbKey, JSON.stringify(db));
                }""",
                {'dbKey': DB_KEY, 'dateIso': today, 'emptyId': child_ids[1]},
            )
            page.reload()
            # 이 탭에서는 PIN 을 한 번 풀면 sessionStorage 로 유지됩니다(잠금 화면이 없을 수 있음).
            page.wait_for_selector('[data-testid="open-profile"]', timeout=45000)
            open_parent(page)
            page.wait_for_selector('[data-testid="day-member-stats"]', timeout=45000)
            page.wait_for_timeout(300)
            empty_text = card(page, child_ids[1]).inner_text()
            check('빈 아이: 0 / 0개', '0 / 0개' in empty_text, empty_text.replace('\n', ' / '))
            check('빈 아이: 0%', '0%' in empty_text, empty_text.replace('\n', ' / '))
            check('빈 아이: 진행 막대 없음(0%)', page.eval_on_selector(
                f'[data-testid="day-stat-bar-{child_ids[1]}"]', 'el => el.style.width') == '0%')

            check('JS 오류 없음', not errors, ' / '.join(errors[:3]))
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)

    print(f'\n=== 실패 {len(failures)} ===')
    for name in failures:
        print(' -', name)
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
