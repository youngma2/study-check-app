"""⚖️ 완료 시점별 XP 차등 · 취소 회수 화면 검증 (데모 빌드, 기기 저장).

dist-demo 빌드를 미리보기 서버로 띄우고, 390×844 모바일 화면에서
  · 항목 카드의 XP 칩 — 오늘 +10 XP · 하루 지남 +5 XP(50%) · 이틀 이상 +2.5 XP(25%)
  · 지난 날짜 안내 줄 ("지금 완료하면 항목 XP 50%")
  · 티어 패널의 ⚖️ 완료 XP 안내(당일 100% · 하루 지남 50% · 2일+ 25% · 되돌리면 회수)
  · 완료 토스트(+XP · 100% 보너스) · 되돌리기 토스트(XP 회수) · 회수 뒤 XP 원복
을 확인하고 스크린샷을 /workspace/downloads 에 남깁니다.

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-xp-delay-ui.py
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import socket
import subprocess
import time
from datetime import date, datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4183
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
PIN = '1234'

failures: list[str] = []
checks = 0


def check(name: str, cond: bool, extra: str = '') -> None:
    global checks
    checks += 1
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
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


# ---------------------------------------------------------------- 테스트 데이터
KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
TODAY: date = NOW.date()
YESTERDAY = TODAY - timedelta(days=1)
TWO_AGO = TODAY - timedelta(days=2)


def iso(day: date) -> str:
    return day.isoformat()


def stamp(day: date, hour: int, minute: int = 0) -> str:
    """그 날 한국 시간 hour:minute → ISO 타임스탬프 (UTC 로 저장되는 실제 DB 와 같게)"""
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=KST).astimezone(timezone.utc).isoformat()


def task(member: str, due: date, index: int, status: str, title: str, completed: str | None = None) -> dict:
    return {
        'id': f't_{member}_{iso(due)}_{index}',
        'family_id': 'fam_test',
        'member_id': member,
        'title': title,
        'subject': 'math',
        'due_date': iso(due),
        'status': status,
        'created_by': 'mem_dad',
        'created_at': stamp(due, 7),
        'verified_by': 'mem_dad' if status == 'verified' else None,
        'verified_at': completed,
        'updated_at': completed or stamp(due, 7),
    }


def build_db() -> dict:
    members = [
        {'id': 'mem_dad', 'family_id': 'fam_test', 'name': '아빠', 'role': 'parent', 'emoji': '👨🏻', 'color': 'sky', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
        {'id': 'mem_mom', 'family_id': 'fam_test', 'name': '엄마', 'role': 'parent', 'emoji': '👩🏻', 'color': 'violet', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
        {'id': 'mem_child1', 'family_id': 'fam_test', 'name': '첫째', 'role': 'child', 'grade': '중1', 'emoji': '🌸', 'color': 'rose', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
        {'id': 'mem_child2', 'family_id': 'fam_test', 'name': '둘째', 'role': 'child', 'grade': '초4', 'emoji': '⚡', 'color': 'amber', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
    ]

    tasks = [
        # 오늘: 1개 당일 완료(100%) · 1개 남음
        task('mem_child1', TODAY, 0, 'verified', '수학 문제집', stamp(TODAY, 12)),
        task('mem_child1', TODAY, 1, 'todo', '영어 단어'),
        # 어제: 1개 당일 완료(100%) · 1개 아직 → 지금 완료하면 50%
        task('mem_child1', YESTERDAY, 0, 'verified', '수학 오답', stamp(YESTERDAY, 20)),
        task('mem_child1', YESTERDAY, 1, 'todo', '국어 독해'),
        # 그제: 1개 아직 → 지금 완료하면 25%
        task('mem_child1', TWO_AGO, 0, 'todo', '과학 노트'),
    ]

    return {
        'version': 1,
        'families': [{'id': 'fam_test', 'name': '우리 가족 공부방', 'created_at': '2026-11-01T00:00:00.000Z'}],
        'members': members,
        'tasks': tasks,
    }


def local_pin_record() -> dict:
    salt = '5f3a1c9b7d2e4f6081a2b3c4d5e6f708'
    digest = hashlib.sha256(f'{salt}:{PIN}'.encode('utf-8')).hexdigest()
    return {'salt': salt, 'hash': digest}


SEED = json.dumps(build_db(), ensure_ascii=False)
# 처음 한 번만 씨앗을 넣습니다 — 새로고침·다른 탭이 같은 기기 기록을 이어서 씁니다.
INIT = f"""
if (!window.localStorage.getItem('study-check.db.v1')) {{
  window.localStorage.setItem('study-check.db.v1', {json.dumps(SEED)});
}}
if (!window.localStorage.getItem('study-check.local-pin.v1')) {{
  window.localStorage.setItem('study-check.local-pin.v1', {json.dumps(json.dumps(local_pin_record()))});
}}
"""


def text_of(page, selector: str) -> str:
    locator = page.locator(selector)
    return locator.first.inner_text().strip() if locator.count() else ''


def open_page(page, url: str) -> None:
    """해시(#as=… & d=…)로 날짜·역할을 바꿔 열기 — 해시만 바뀌면 다시 읽지 않으므로 새로고침합니다."""
    page.goto(url, wait_until='networkidle')
    page.reload(wait_until='networkidle')


def card_text(page, title: str) -> str:
    card = page.locator('[data-testid="task-card"]', has_text=title).first
    return card.inner_text()


def card_xp(page, title: str) -> str:
    card = page.locator('[data-testid="task-card"]', has_text=title).first
    chip = card.locator('[data-testid="task-xp"]')
    return chip.first.inner_text().strip() if chip.count() else ''


def run() -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox', '--disable-dev-shm-usage'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )

            # ------------------------------------------------ 1) 아이 화면 · 오늘
            js_errors: list[str] = []
            child = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            child.add_init_script(INIT)
            page = child.new_page()
            page.on('pageerror', lambda error: js_errors.append(str(error)))
            open_page(page, f'{BASE}#as=mem_child1')
            page.wait_for_selector('[data-testid="tier-panel-mem_child1"]', timeout=15000)

            check('아이 화면에 XP 안내가 있다 (⚖️ 완료 XP)', page.locator('[data-testid="xp-rule-mem_child1"]').count() == 1)
            rule = text_of(page, '[data-testid="xp-rule-mem_child1"]').replace('\n', ' ')
            check('안내: 당일 100% · 하루 지남 50% · 2일+ 25% · 되돌리면 회수',
                  all(piece in rule for piece in ['당일 100%', '하루 지남 50%', '2일+ 25%', '회수']), rule)

            xp_today_verified = card_xp(page, '수학 문제집')
            xp_today_todo = card_xp(page, '영어 단어')
            check('오늘 완료 항목 = +10 XP', xp_today_verified == '+10 XP', xp_today_verified)
            check('오늘 남은 항목 = +10 XP (완료하면 100%)', xp_today_todo == '+10 XP', xp_today_todo)
            check('오늘 카드에는 지연 표시가 없다',
                  page.locator('[data-testid="task-xp-delay"]').count() == 0)
            check('오늘 화면에는 지난 날짜 안내가 없다', page.locator('[data-testid="day-xp-notice"]').count() == 0)
            check('처음 XP = 20 (오늘 10 + 어제 10)', text_of(page, '[data-testid="tier-xp-mem_child1"]') == '20 XP',
                  text_of(page, '[data-testid="tier-xp-mem_child1"]'))
            page.locator('[data-testid="tier-panel-mem_child1"]').evaluate(
                "el => el.scrollIntoView({ block: 'center' })"
            )
            page.wait_for_timeout(250)
            page.screenshot(path=str(DOWNLOADS / 'study_xp_child_today.png'))

            # 오늘 남은 항목 완료 → +10 XP 와 100% 보너스 +20
            page.locator('[data-testid="complete-task"]').first.click()
            page.wait_for_selector('text=완료!', timeout=8000)
            toast = page.locator('text=/완료!.*XP/').first.inner_text()
            check('완료 토스트에 +10 XP', '+10 XP' in toast, toast)
            check('완료 토스트에 100% 보너스 +20', '100% 보너스 +20' in toast, toast)
            page.wait_for_timeout(300)
            check('완료 뒤 XP = 50 (20 + 10 + 20)', text_of(page, '[data-testid="tier-xp-mem_child1"]') == '50 XP',
                  text_of(page, '[data-testid="tier-xp-mem_child1"]'))
            page.screenshot(path=str(DOWNLOADS / 'study_xp_complete_toast.png'))
            page.wait_for_timeout(2600)  # 토스트가 사라질 때까지

            # ------------------------------------------------ 2) 어제 화면 (50%)
            open_page(page, f'{BASE}#as=mem_child1&d={iso(YESTERDAY)}')
            page.wait_for_selector('[data-testid="task-card"]', timeout=15000)
            check('어제 남은 항목 = +5 XP (하루 지남 50%)', '+5 XP' in card_xp(page, '국어 독해') and '50%' in card_xp(page, '국어 독해'),
                  card_xp(page, '국어 독해'))
            check('어제 당일 완료 항목은 그대로 +10 XP', card_xp(page, '수학 오답') == '+10 XP', card_xp(page, '수학 오답'))
            notice = text_of(page, '[data-testid="day-xp-notice"]').replace('\n', ' ')
            check('지난 날짜 안내: 지금 완료하면 항목 XP 50%', 'XP 50%' in notice and '하루 지남' in notice, notice)
            page.locator('[data-testid="day-xp-notice"]').screenshot(path=str(DOWNLOADS / 'study_xp_notice_50.png'))
            page.locator('[data-testid="task-card"]').first.evaluate("el => el.scrollIntoView({ block: 'center' })")
            page.wait_for_timeout(200)
            page.screenshot(path=str(DOWNLOADS / 'study_xp_child_yesterday.png'))

            # ------------------------------------------------ 3) 그제 화면 (25%)
            open_page(page, f'{BASE}#as=mem_child1&d={iso(TWO_AGO)}')
            page.wait_for_selector('[data-testid="task-card"]', timeout=15000)
            check('그제 남은 항목 = +2.5 XP (이틀 이상 25%)',
                  '+2.5 XP' in card_xp(page, '과학 노트') and '25%' in card_xp(page, '과학 노트'),
                  card_xp(page, '과학 노트'))
            notice2 = text_of(page, '[data-testid="day-xp-notice"]').replace('\n', ' ')
            check('지난 날짜 안내: 지금 완료하면 항목 XP 25%', 'XP 25%' in notice2 and '이틀 이상' in notice2, notice2)
            page.locator('[data-testid="day-xp-notice"]').screenshot(path=str(DOWNLOADS / 'study_xp_notice_25.png'))
            page.locator('[data-testid="task-card"]').first.evaluate("el => el.scrollIntoView({ block: 'center' })")
            page.wait_for_timeout(200)
            page.screenshot(path=str(DOWNLOADS / 'study_xp_child_two_ago.png'))

            # ------------------------------------------------ 4) 부모 화면 — 늦게 완료 · 회수
            # 같은 기기(같은 컨텍스트) — 아이 화면에서 저장한 기록을 부모 화면이 그대로 봅니다.
            ppage = child.new_page()
            ppage.on('pageerror', lambda error: js_errors.append(str(error)))
            open_page(ppage, f'{BASE}#as=mem_dad&d={iso(TWO_AGO)}')
            ppage.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=15000)
            check('부모 화면은 PIN 부터 (이 기기 PIN 1234)', ppage.locator('[data-testid="parent-pin-gate"]').count() == 1)
            ppage.keyboard.type(PIN)
            ppage.wait_for_selector('[data-testid="task-card"]', timeout=15000)
            check('PIN 을 풀면 부모 화면이 열린다', ppage.locator('[data-testid="parent-pin-gate"]').count() == 0)

            xp_before = text_of(ppage, '[data-testid="tier-xp-mem_child1"]')
            check('부모 화면에도 아이 XP 가 보인다 (50 XP)', xp_before == '50 XP', xp_before)

            # 그제 항목을 지금 완료 → 2.5 + 100% 20 = +22.5
            ppage.locator('[data-testid="task-card"]', has_text='과학 노트').locator('[data-testid="complete-task"]').first.click()
            ppage.wait_for_selector('text=완료!', timeout=8000)
            late_toast = ppage.locator('text=/완료!.*XP/').first.inner_text()
            check('늦게 완료한 토스트: +2.5 XP · 이틀 이상 25%',
                  '+2.5 XP' in late_toast and '이틀 이상 25%' in late_toast, late_toast)
            check('늦게 완료해도 그날을 다 채우면 100% 보너스 +20', '100% 보너스 +20' in late_toast, late_toast)
            ppage.wait_for_timeout(300)
            check('XP 50 → 72.5 (22.5 증가)', text_of(ppage, '[data-testid="tier-xp-mem_child1"]') == '72.5 XP',
                  text_of(ppage, '[data-testid="tier-xp-mem_child1"]'))
            ppage.screenshot(path=str(DOWNLOADS / 'study_xp_parent_late_complete.png'))
            ppage.wait_for_timeout(2600)

            # 되돌리기 → 22.5 XP 정확히 회수
            ppage.locator('[data-testid="task-card"]', has_text='과학 노트').locator('[data-testid="revert-task"]').first.click()
            ppage.wait_for_selector('text=회수', timeout=8000)
            revert_toast = ppage.locator('text=/되돌렸어요.*회수/').first.inner_text()
            check('되돌리기 토스트: 22.5 XP 회수', '22.5 XP 회수' in revert_toast, revert_toast)
            ppage.wait_for_timeout(300)
            check('회수 뒤 XP 가 원래대로 (72.5 → 50)',
                  text_of(ppage, '[data-testid="tier-xp-mem_child1"]') == '50 XP',
                  text_of(ppage, '[data-testid="tier-xp-mem_child1"]'))
            check('되돌린 항목은 다시 할 일 (+2.5 XP 안내로 돌아감)',
                  '25%' in ppage.locator('[data-testid="task-card"]', has_text='과학 노트').locator('[data-testid="task-xp"]').first.inner_text())
            ppage.screenshot(path=str(DOWNLOADS / 'study_xp_revert_toast.png'))

            check('JS 오류 없음 (아이·부모 화면)', not js_errors, ' / '.join(js_errors[:3]))
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()

    print(f"\n{checks - len(failures)}/{checks} 통과")
    if failures:
        print('실패:', ', '.join(failures))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
