"""프로필 PIN 전환 · 부모 할 일 보드 · 💬 우리 가족 한마디 검증 (데모 빌드).

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-family-board.py

390×844 헤드리스 Chrome 으로 dist-demo 를 띄워 확인합니다.
데모 PIN 은 코드에 적지 않고 이 기기에서 처음 정하는 값(1111)을 씁니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4178
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

DEMO_PIN = '1111'
DB_KEY = 'study-check.db.v1'
NOTES_KEY = 'study-check.notes.v1'

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        failures.append(name)


def korea_today() -> date:
    """앱은 한국 날짜로 '오늘'을 셉니다 — 검사도 같은 날짜를 씁니다."""
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


def open_profile(page) -> None:
    page.click('[data-testid="open-profile"]')
    page.wait_for_selector('[role="dialog"]')


def goto_day(page, target: date) -> None:
    page.get_by_role('button', name='오늘', exact=True).click()
    page.wait_for_timeout(200)
    today = date.today()
    current_week = today - timedelta(days=today.weekday())
    target_week = target - timedelta(days=target.weekday())
    delta = (target_week - current_week).days // 7
    for _ in range(abs(delta)):
        page.get_by_role('button', name=('다음 주' if delta > 0 else '이전 주')).click()
        page.wait_for_timeout(150)
    page.get_by_role('button', name=re.compile(f'{target.month}월 {target.day}일')).first.click()
    page.wait_for_timeout(350)


def main() -> int:
    today = korea_today()
    tomorrow = today + timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())
    saturday = week_start + timedelta(days=5)

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

            # ---------------------------------------------------------------
            # A. 아이 화면 프로필 — 아빠·엄마가 보이고, 누르면 PIN 부터
            # ---------------------------------------------------------------
            page.goto(BASE + '#as=mem_child1')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('아이 시점: PIN 잠금 화면이 없다', page.locator('[data-testid="parent-pin-gate"]').count() == 0)

            open_profile(page)
            sheet = page.locator('[role="dialog"]').inner_text()
            check('아이 프로필: 아빠 행이 보인다', page.locator('[data-testid="profile-row-mem_dad"]').count() == 1)
            check('아이 프로필: 엄마 행이 보인다', page.locator('[data-testid="profile-row-mem_mom"]').count() == 1)
            check('아이 프로필: 아빠·엄마에 자물쇠 배지', page.locator('[data-testid="lock-badge-mem_dad"]').count() == 1
                  and page.locator('[data-testid="lock-badge-mem_mom"]').count() == 1)
            check('아이 프로필: PIN 필요 안내가 보인다', 'PIN' in sheet, sheet.replace('\n', ' / ')[:80])
            check('아이 프로필: 예전 부모 복귀 버튼은 없다', page.locator('[data-testid="request-parent-pin"]').count() == 0)

            # ---------------------------------------------------------------
            # B. 아빠를 누르면 PIN 화면 → 취소하면 아이 화면 그대로
            # ---------------------------------------------------------------
            page.click('[data-testid="profile-row-mem_dad"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            gate_text = page.inner_text('[data-testid="parent-pin-gate"]')
            check('아빠 누르기: PIN 화면이 먼저 나온다', '부모 관리 PIN' in gate_text, gate_text.replace('\n', ' / ')[:80])
            check('아빠 누르기: 아직 목록이 보이지 않는다', page.locator('[data-testid="task-card"]').count() == 0)

            page.click('[data-testid="cancel-parent-gate"]')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('취소: 보던 아이 화면으로 돌아온다', '첫째' in page.inner_text('header'))
            check('취소: 부모 기능은 열리지 않았다', page.locator('[data-testid="delete-task"]').count() == 0)
            check('취소: 기본 목록 버튼도 없다', page.locator('[data-testid="fill-defaults"]').count() == 0)

            # ---------------------------------------------------------------
            # C. PIN 을 정하면 누른 그 부모(아빠) 화면으로
            # ---------------------------------------------------------------
            open_profile(page)
            page.click('[data-testid="profile-row-mem_dad"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            check('다시 눌러도 PIN 화면부터', 'PIN 정하기' in page.inner_text('[data-testid="parent-pin-gate"]'))
            type_pin(page, DEMO_PIN)
            page.wait_for_timeout(300)
            type_pin(page, DEMO_PIN)
            page.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            check('PIN 통과: 누른 아빠 화면으로 바뀐다', '아빠' in page.inner_text('header'))
            check('PIN 통과: 부모 전용 기능이 보인다', page.locator('[data-testid="delete-task"]').count() > 0)

            # ---------------------------------------------------------------
            # D. 부모끼리는 PIN 없이, 아이 화면으로 가면 다시 PIN
            # ---------------------------------------------------------------
            open_profile(page)
            page.click('[data-testid="profile-row-mem_mom"]')
            page.wait_for_timeout(500)
            check('부모 시점에서 엄마로는 PIN 없이 바뀐다', '엄마' in page.inner_text('header'))

            open_profile(page)
            page.click('[data-testid="profile-row-mem_child1"]')
            page.wait_for_timeout(500)
            check('부모가 아이 시점으로 바꾸면 아이 화면', '첫째' in page.inner_text('header'))
            check('아이 화면: 부모 기능 숨김', page.locator('[data-testid="delete-task"]').count() == 0)

            open_profile(page)
            page.click('[data-testid="profile-row-mem_mom"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            check('아이 화면에서 엄마를 누르면 다시 PIN', '부모 관리 PIN' in page.inner_text('[data-testid="parent-pin-gate"]'))
            check('PIN 화면: 누른 엄마 안내', '엄마' in page.inner_text('[data-testid="parent-pin-gate"]'))
            page.click('[data-testid="cancel-parent-gate"]')
            page.wait_for_selector('[data-testid="open-profile"]')
            check('PIN 취소: 첫째 화면 그대로', '첫째' in page.inner_text('header'))

            open_profile(page)
            page.click('[data-testid="profile-row-mem_mom"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            type_pin(page, '9999')
            page.wait_for_timeout(600)
            check('틀린 PIN 은 거부된다', '맞지 않아요' in page.inner_text('[data-testid="pin-error"]'))
            check('틀린 PIN 뒤에도 잠김', page.locator('[data-testid="task-card"]').count() == 0)
            type_pin(page, DEMO_PIN)
            page.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            check('맞는 PIN 이면 누른 엄마 화면(아빠 아님)', '엄마' in page.inner_text('header'))

            # ---------------------------------------------------------------
            # E. 아빠(부모) 할 일이 부모 화면에 보인다 — localStorage 로 준비
            # ---------------------------------------------------------------
            # 먼저 아무 항목이나 저장해 데모 DB 를 기기에 남깁니다.
            page.click('[data-testid="open-add"]')
            page.wait_for_selector('[data-testid="save-task"]')
            page.fill('[role="dialog"] input[placeholder="예) 수학 문제집 2쪽 풀기"]', '준비용 항목')
            page.click('[data-testid="save-task"]')
            page.wait_for_selector('text=공부 항목을 추가했어요', timeout=8000)
            page.wait_for_timeout(500)

            seeded = page.evaluate(
                """({ dbKey, saturday }) => {
                    const raw = localStorage.getItem(dbKey);
                    if (!raw) return 'db 없음';
                    const db = JSON.parse(raw);
                    db.tasks.push({
                      id: 't_dad_board_check',
                      family_id: db.families[0].id,
                      member_id: 'mem_dad',
                      title: '독서록 검사',
                      subject: 'reading',
                      due_date: saturday,
                      status: 'todo',
                      created_by: 'mem_dad',
                      created_at: new Date().toISOString(),
                      verified_by: null,
                      verified_at: null,
                    });
                    localStorage.setItem(dbKey, JSON.stringify(db));
                    return 'ok';
                }""",
                {'dbKey': DB_KEY, 'saturday': saturday.isoformat()},
            )
            check('준비: 아빠 토요일 할 일을 기기에 넣었다', seeded == 'ok', str(seeded))

            page.reload()
            page.wait_for_selector('[data-testid="open-profile"]')
            # 주소의 #as=mem_child1 이 우선이라, 다시 아빠 화면으로 들어갑니다(PIN 은 이번에 묻습니다).
            open_profile(page)
            page.click('[data-testid="profile-row-mem_dad"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            type_pin(page, DEMO_PIN)
            page.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            check('새로고침 뒤에도 아빠는 PIN 으로 열 수 있다', '아빠' in page.inner_text('header'))
            goto_day(page, saturday)
            check('부모 화면: 부모 할 일 보드가 있다', page.locator('[data-testid="parent-boards"]').count() == 1)
            parent_text = page.inner_text('[data-testid="parent-boards"]')
            check('부모 화면: 아빠 이름으로 보인다', '아빠' in parent_text, parent_text.replace('\n', ' / ')[:80])
            check('부모 화면: 독서록 검사가 보인다', '독서록 검사' in parent_text)
            check(
                '부모 화면: 그 항목을 완료 체크할 수 있다 (아직 안 온 날짜면 잠긴 완료)',
                page.locator('[data-testid="parent-boards"] [data-testid="complete-task"]').count()
                + page.locator('[data-testid="parent-boards"] [data-testid="complete-locked"]').count()
                >= 1,
            )

            # 아이 화면에서는 부모 보드가 보이지 않는다
            open_profile(page)
            page.click('[data-testid="profile-row-mem_child1"]')
            page.wait_for_timeout(500)
            goto_day(page, saturday)
            check('아이 화면: 부모 할 일 보드는 없다', page.locator('[data-testid="parent-boards"]').count() == 0)
            check('아이 화면: 아빠 항목도 보이지 않는다', '독서록 검사' not in page.inner_text('main'))

            # ---------------------------------------------------------------
            # F. 💬 우리 가족 한마디 — 날짜마다 따로 붙는다
            # ---------------------------------------------------------------
            check('알림판: 칸이 있다', page.locator('[data-testid="family-notes"]').count() == 1)
            check('알림판: 이 날은 처음엔 비어 있다', page.locator('[data-testid="notes-empty"]').count() == 1)
            sat_chip = page.inner_text('[data-testid="notes-date"]')
            check(
                '알림판: 보고 있는 날짜(토요일)를 단다',
                f'{saturday.month}/{saturday.day}' in sat_chip,
                sat_chip,
            )
            page.fill('[data-testid="note-input"]', '오늘 수학 숙제 다 했어요')
            page.click('[data-testid="note-submit"]')
            page.wait_for_selector('[data-testid="family-note"]', timeout=5000)
            notes_text = page.inner_text('[data-testid="family-notes"]')
            check('알림판: 남긴 글이 보인다', '오늘 수학 숙제 다 했어요' in notes_text)
            check('알림판: 쓴 사람이 표시된다', '첫째' in notes_text, notes_text.replace('\n', ' / ')[:90])
            check('알림판: 빈 안내는 사라진다', page.locator('[data-testid="notes-empty"]').count() == 0)
            check('알림판: 내 글에는 지우기 버튼이 있다', page.locator('[data-testid="delete-note"]').count() >= 1)
            saved_id = page.evaluate(
                """({ notesKey }) => {
                    const notes = JSON.parse(localStorage.getItem(notesKey) || '[]');
                    const mine = notes.find((note) => note.content === '오늘 수학 숙제 다 했어요');
                    return mine ? mine.id : '';
                }""",
                {'notesKey': NOTES_KEY},
            )
            check('알림판: 남긴 글 id 에 그 날짜가 들어간다', str(saved_id).startswith(f'n_{saturday.isoformat()}_'), str(saved_id))

            # 오늘·내일 알림판은 따로 — 토요일 글은 그 두 날에 보이지 않는다
            goto_day(page, today)
            check('날짜 분리: 오늘 알림판은 따로 비어 있다', page.locator('[data-testid="notes-empty"]').count() == 1)
            check(
                '날짜 분리: 토요일 글은 오늘 알림판에 없다',
                '오늘 수학 숙제 다 했어요' not in page.inner_text('[data-testid="family-notes"]'),
            )

            goto_day(page, tomorrow)
            tomorrow_chip = page.inner_text('[data-testid="notes-date"]')
            check(
                '날짜 분리: 내일 알림판은 그 날짜를 단다',
                f'{tomorrow.month}/{tomorrow.day}' in tomorrow_chip,
                tomorrow_chip,
            )
            check('날짜 분리: 내일 알림판도 따로 비어 있다', page.locator('[data-testid="notes-empty"]').count() == 1)
            page.fill('[data-testid="note-input"]', '내일 학원 6시 30분이에요')
            page.click('[data-testid="note-submit"]')
            page.wait_for_selector('[data-testid="family-note"]', timeout=5000)
            check(
                '날짜 분리: 내일 남긴 글은 내일 알림판에만 있다',
                '내일 학원 6시 30분이에요' in page.inner_text('[data-testid="family-notes"]'),
            )
            goto_day(page, today)
            check(
                '날짜 분리: 내일 글은 오늘 알림판에 없다',
                '내일 학원 6시 30분이에요' not in page.inner_text('[data-testid="family-notes"]'),
            )
            goto_day(page, saturday)
            check(
                '날짜 분리: 토요일로 돌아오면 그 날 글이 그대로',
                '오늘 수학 숙제 다 했어요' in page.inner_text('[data-testid="family-notes"]'),
            )

            # ---------------------------------------------------------------
            # G. 다른 사람이 남긴 새 글 → 위쪽 알림 배너 · 누르면 그 날 알림판으로
            # ---------------------------------------------------------------
            added = page.evaluate(
                """({ notesKey, dbKey }) => {
                    const db = JSON.parse(localStorage.getItem(dbKey));
                    const familyId = db.families[0].id;
                    const notes = JSON.parse(localStorage.getItem(notesKey) || '[]');
                    notes.unshift({
                      id: 'n_mom_alert',
                      family_id: familyId,
                      author_id: 'mem_mom',
                      content: '저녁 7시에 데리러 가요',
                      created_at: new Date().toISOString(),
                    });
                    localStorage.setItem(notesKey, JSON.stringify(notes));
                    return notes.length;
                }""",
                {'notesKey': NOTES_KEY, 'dbKey': DB_KEY},
            )
            check('준비: 엄마 이름으로 새 글을 넣었다', isinstance(added, int) and added >= 2, str(added))

            page.reload()
            page.wait_for_selector('[data-testid="open-profile"]')
            page.wait_for_selector('[data-testid="family-note-alert"]', timeout=6000)
            alert_text = page.inner_text('[data-testid="family-note-alert"]')
            check('새 글: 위쪽 알림 배너가 뜬다', '저녁 7시에 데리러 가요' in alert_text)
            check('새 글: 누가 남겼는지 나온다', '엄마' in alert_text)
            check('새 글: 누르면 닫힌다고 알려 준다', '눌러서 닫기' in alert_text, alert_text.replace('\n', ' / ')[:90])

            goto_day(page, saturday)
            check('새 글: 다른 날을 봐도 배너는 남아 있다', page.locator('[data-testid="family-note-alert"]').count() == 1)
            check(
                '새 글: 배너는 보던 날(토요일) 알림판에는 안 붙는다',
                '저녁 7시에 데리러 가요' not in page.inner_text('[data-testid="family-notes"]'),
            )

            # 배너 본문을 누르면: 닫히고 그 글이 붙은 날짜(오늘)로 이동
            page.click('[data-testid="open-note-alert"]')
            page.wait_for_timeout(500)
            check('배너 누르기: 배너가 닫힌다', page.locator('[data-testid="family-note-alert"]').count() == 0)
            tapped_chip = page.inner_text('[data-testid="notes-date"]')
            check(
                '배너 누르기: 그 글이 붙은 날짜로 이동한다',
                f'{today.month}/{today.day}' in tapped_chip,
                tapped_chip,
            )
            check(
                '배너 누르기: 그 날 알림판에 글이 보인다',
                '저녁 7시에 데리러 가요' in page.inner_text('[data-testid="family-notes"]'),
            )

            page.reload()
            page.wait_for_selector('[data-testid="open-profile"]')
            page.wait_for_timeout(800)
            check('배너 닫기: 다시 열어도 울리지 않는다', page.locator('[data-testid="family-note-alert"]').count() == 0)

            # ✕ 버튼도 날짜를 바꾸지 않고 배너만 닫는다
            page.evaluate(
                """({ notesKey }) => {
                    const notes = JSON.parse(localStorage.getItem(notesKey) || '[]');
                    notes.unshift({
                      id: 'n_mom_alert_x',
                      family_id: 'fam_demo',
                      author_id: 'mem_mom',
                      content: '우유 사다 놓을게요',
                      created_at: new Date().toISOString(),
                    });
                    localStorage.setItem(notesKey, JSON.stringify(notes));
                }""",
                {'notesKey': NOTES_KEY},
            )
            page.reload()
            page.wait_for_selector('[data-testid="family-note-alert"]', timeout=6000)
            goto_day(page, saturday)
            check('✕ 준비: 다른 날을 보고 있어도 배너는 그대로', page.locator('[data-testid="family-note-alert"]').count() == 1)
            page.click('[data-testid="dismiss-note-alert"]')
            page.wait_for_timeout(400)
            check('✕ 버튼: 배너가 닫힌다', page.locator('[data-testid="family-note-alert"]').count() == 0)
            x_chip = page.inner_text('[data-testid="notes-date"]')
            check(
                '✕ 버튼: 보던 날짜(토요일)를 바꾸지 않는다',
                f'{saturday.month}/{saturday.day}' in x_chip,
                x_chip,
            )

            # ---------------------------------------------------------------
            # H. 내가 쓴 한마디 지우기 — 그 날 알림판만 비워진다
            # ---------------------------------------------------------------
            goto_day(page, saturday)
            before_notes = page.locator('[data-testid="family-note"]').count()
            page.locator('[data-testid="family-note"]', has_text='오늘 수학 숙제 다 했어요').locator('[data-testid="delete-note"]').first.click()
            page.wait_for_timeout(600)
            check('한마디 지우기: 개수가 줄어든다', page.locator('[data-testid="family-note"]').count() == before_notes - 1)
            check('한마디 지우기: 그 날 알림판이 다시 빈 안내', page.locator('[data-testid="notes-empty"]').count() == 1)
            goto_day(page, tomorrow)
            check(
                '한마디 지우기: 다른 날(내일) 글은 그대로',
                '내일 학원 6시 30분이에요' in page.inner_text('[data-testid="family-notes"]'),
            )

            # ---------------------------------------------------------------
            # I. 📞 통화 1·2 는 아이 화면에는 안 보이고 부모 화면에만
            # ---------------------------------------------------------------
            page.evaluate(
                """({ dbKey, saturday }) => {
                    const db = JSON.parse(localStorage.getItem(dbKey));
                    const now = new Date().toISOString();
                    db.tasks.push(
                      { id: 't_c1_20261128_call1', family_id: db.families[0].id, member_id: 'mem_child1',
                        title: '🏫 하교 16:05 → 📞 통화 1 (17:05)', subject: 'etc', due_date: saturday,
                        status: 'todo', created_by: 'mem_child1', created_at: now, verified_by: null, verified_at: null },
                      { id: 't_c1_20261128_call2', family_id: db.families[0].id, member_id: 'mem_child1',
                        title: '📞 통화 2 · 공부 진행 확인 (18:30)', subject: 'etc', due_date: saturday,
                        status: 'todo', created_by: 'mem_child1', created_at: now, verified_by: null, verified_at: null },
                    );
                    localStorage.setItem(dbKey, JSON.stringify(db));
                }""",
                {'dbKey': DB_KEY, 'saturday': saturday.isoformat()},
            )
            page.reload()
            page.wait_for_selector('[data-testid="open-profile"]')
            goto_day(page, saturday)
            child_main = page.inner_text('main')
            check('통화 항목: 아이 화면에는 통화 1·2 가 안 보인다',
                  '통화' not in child_main and '하교' not in child_main, child_main.replace('\n', ' / ')[:90])
            check('통화 항목: 아이 날짜 요약에서도 빠진다', '전체 1개' in child_main, child_main.replace('\n', ' / ')[:60])
            check('통화 항목: 아이 보드 카드도 1개만', page.locator('[data-testid="task-card"]').count() == 1,
                  str(page.locator('[data-testid="task-card"]').count()))

            open_profile(page)
            page.click('[data-testid="profile-row-mem_dad"]')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            type_pin(page, DEMO_PIN)
            page.wait_for_selector('[data-testid="open-profile"]', timeout=8000)
            goto_day(page, saturday)
            dad_main = page.inner_text('main')
            check('통화 항목: 부모 화면에는 통화 1 이 보인다', '통화 1' in dad_main)
            check('통화 항목: 부모 화면에는 통화 2 도 보인다', '통화 2' in dad_main)
            check('통화 항목: 부모 화면에는 하교 시간도 보인다', '하교' in dad_main)

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
