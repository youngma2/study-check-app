"""📊 부모 전용 이번 주 요약 → 상세 대시보드 검증 (데모 빌드, 기기 저장).

dist-demo 빌드를 미리보기 서버로 띄우고, 390×844 모바일 화면에서
  · 부모 화면 위쪽의 '이번 주 요약' 카드 (완료율 · 연속 100% · 남은 보너스 시간)
  · 카드를 누르면 열리는 상세 대시보드 (주별/월별 전환 · 기간 이동 · 아이별 진행도 ·
    연속 100% · 보너스 시간 합산/내역 · 일별 막대·월간 캘린더 · 취합용 복사)
  · 아이 화면에는 이 카드도 대시보드도 없다

를 확인하고 스크린샷을 /workspace/downloads 에 남깁니다.

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-dashboard.py
"""
from __future__ import annotations

import json
import os
import pathlib
from datetime import datetime, timedelta, timezone
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4183
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

failures: list[str] = []
checks = 0

# 테스트 데이터의 날짜(2026-11-23~25)에 맞춰 '오늘'을 고정합니다 — 시간이 지나도 같은 결과가 나옵니다.
FIXED_NOW = datetime(2026, 11, 25, 20, 0, tzinfo=timezone(timedelta(hours=9)))


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
def task(member: str, due: str, index: int, status: str) -> dict:
    return {
        'id': f't_{member}_{due}_{index}',
        'family_id': 'fam_test',
        'member_id': member,
        'title': '수학 문제집',
        'subject': 'math',
        'due_date': due,
        'status': status,
        'created_by': member,
        'created_at': f'{due}T00:00:00.000Z',
        'verified_by': 'mem_dad' if status == 'verified' else None,
        'verified_at': f'{due}T12:00:00.000Z' if status == 'verified' else None,
    }


def build_db() -> dict:
    members = [
        {'id': 'mem_dad', 'family_id': 'fam_test', 'name': '아빠', 'role': 'parent', 'emoji': '👨🏻', 'color': 'sky', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
        {'id': 'mem_mom', 'family_id': 'fam_test', 'name': '엄마', 'role': 'parent', 'emoji': '👩🏻', 'color': 'violet', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
        {'id': 'mem_yewon', 'family_id': 'fam_test', 'name': '예원', 'role': 'child', 'grade': '중1', 'emoji': '🌸', 'color': 'rose', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
        {'id': 'mem_chanyul', 'family_id': 'fam_test', 'name': '찬율', 'role': 'child', 'grade': '초4', 'emoji': '⚡', 'color': 'amber', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
    ]

    tasks: list[dict] = []
    # 예원: 이번 주 11/23·11/24 100%, 오늘(11/25) 2/3 → 완료율 8/9 = 89%
    for due in ['2026-11-23', '2026-11-24']:
        for index in range(3):
            tasks.append(task('mem_yewon', due, index, 'verified'))
    tasks.append(task('mem_yewon', '2026-11-25', 0, 'verified'))
    tasks.append(task('mem_yewon', '2026-11-25', 1, 'verified'))
    tasks.append(task('mem_yewon', '2026-11-25', 2, 'todo'))

    # 찬율: 11/24 100%, 오늘 1/2 → 완료율 3/4 = 75%
    for index in range(2):
        tasks.append(task('mem_chanyul', '2026-11-24', index, 'verified'))
    tasks.append(task('mem_chanyul', '2026-11-25', 0, 'verified'))
    tasks.append(task('mem_chanyul', '2026-11-25', 1, 'todo'))

    return {
        'version': 1,
        'families': [{'id': 'fam_test', 'name': '우리 가족 공부방', 'created_at': '2026-11-01T00:00:00.000Z'}],
        'members': members,
        'tasks': tasks,
    }


def tier_event(member: str, level: int, tier: str, rank: int, division: int, minutes: int | None,
               opened_at: str | None, used_at: str | None = None) -> dict:
    return {
        'id': f'ev_{member}_2026-11_{level}',
        'family_id': 'fam_test',
        'member_id': member,
        'season': '2026-11',
        'tier': tier,
        'tier_rank': rank,
        'level': level,
        'division': division,
        'box_minutes': minutes,
        'created_at': f'2026-11-{20 + level}T09:00:00.000Z',
        'opened_at': opened_at,
        'used_at': used_at,
        'used_by': 'mem_dad' if used_at else None,
    }


# 예원: 실버 III(+10분, 아직 안 씀) · 골드 III(+20분, 사용 완료) — 이번 주 보너스 30분 중 10분 남음
TIER_EVENTS = [
    tier_event('mem_yewon', 1, 'bronze', 1, 2, None, None),
    tier_event('mem_yewon', 2, 'bronze', 1, 1, None, None),
    tier_event('mem_yewon', 3, 'silver', 2, 3, 10, '2026-11-23T10:00:00.000Z'),
    tier_event('mem_yewon', 4, 'silver', 2, 2, None, None),
    tier_event('mem_yewon', 5, 'silver', 2, 1, None, None),
    tier_event('mem_yewon', 6, 'gold', 3, 3, 20, '2026-11-24T10:00:00.000Z', '2026-11-24T11:00:00.000Z'),
    tier_event('mem_yewon', 7, 'gold', 3, 2, None, None),
    tier_event('mem_yewon', 8, 'gold', 3, 1, None, None),
    tier_event('mem_chanyul', 1, 'bronze', 1, 2, None, None),
]

SPY = """
window.__copied = null;
try {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { window.__copied = text; } },
  });
} catch (e) { /* 클립보드를 못 바꾸는 브라우저 */ }
document.execCommand = function () { return true; };
"""

INIT = f"""
window.localStorage.setItem('study-check.db.v1', {json.dumps(json.dumps(build_db(), ensure_ascii=False))});
window.localStorage.setItem('study-check.member.v1', 'mem_dad');
window.localStorage.setItem('study-check.tier-events.v1', {json.dumps(json.dumps(TIER_EVENTS, ensure_ascii=False))});
"""


def enter_pin(page, digits: list[str]) -> None:
    for _ in range(2):  # 데모: PIN 정하기 → 한 번 더
        for key in digits:
            page.click(f'[data-testid="pin-key-{key}"]')
        page.wait_for_timeout(500)


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

            # ---------------------------------------------------- 1) 부모 화면
            parent = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            parent.add_init_script(SPY)
            parent.add_init_script(INIT)
            ppage = parent.new_page()
            ppage.clock.set_fixed_time(FIXED_NOW)
            errors: list[str] = []
            ppage.on('pageerror', lambda exc: errors.append(str(exc)))
            ppage.on('console', lambda msg: errors.append(f'console.{msg.type}: {msg.text}') if msg.type == 'error' else None)

            ppage.goto(f'{BASE}#as=mem_dad', wait_until='networkidle')
            ppage.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=20000)
            enter_pin(ppage, ['1', '2', '3', '4'])
            ppage.wait_for_selector('[data-testid="parent-week-summary"]', timeout=20000)

            summary = ppage.locator('[data-testid="parent-week-summary"]')
            check('부모 화면에 이번 주 요약 카드가 있다', summary.count() == 1)
            yewon = ppage.locator('[data-testid="summary-child-mem_yewon"]').inner_text()
            chanyul = ppage.locator('[data-testid="summary-child-mem_chanyul"]').inner_text()
            check('요약: 예원 이번 주 완료율 89%', '89%' in yewon, yewon.replace('\n', ' '))
            check('요약: 예원 연속 100% 2일 · 남은 보너스 10분', '🔥2일' in yewon and '🎁10분' in yewon, yewon.replace('\n', ' '))
            check('요약: 찬율 완료율 75% · 연속 1일 · 보너스 0분', '75%' in chanyul and '🔥1일' in chanyul and '🎁0분' in chanyul, chanyul.replace('\n', ' '))
            ppage.screenshot(path=str(DOWNLOADS / 'study_dashboard_summary.png'))

            # ---------------------------------------------------- 2) 상세 대시보드
            summary.click()
            ppage.wait_for_selector('[data-testid="parent-dashboard"]', timeout=10000)
            check('요약 카드를 누르면 상세 대시보드가 열린다', ppage.locator('[data-testid="parent-dashboard"]').count() == 1)
            check('주별 탭이 기본', '2026.11.23 – 11.29' in ppage.locator('[data-testid="dash-period"]').inner_text(),
                  ppage.locator('[data-testid="dash-period"]').inner_text())

            yewon_card = ppage.locator('[data-testid="dash-child-mem_yewon"]')
            chanyul_card = ppage.locator('[data-testid="dash-child-mem_chanyul"]')
            check('아이별 카드 2장', yewon_card.count() == 1 and chanyul_card.count() == 1)
            check('예원 진행도 89% (8/9)', ppage.locator('[data-testid="dash-rate-mem_yewon"]').inner_text().strip() == '89%',
                  ppage.locator('[data-testid="dash-rate-mem_yewon"]').inner_text())
            check('찬율 진행도 75% (3/4)', ppage.locator('[data-testid="dash-rate-mem_chanyul"]').inner_text().strip() == '75%')
            check('예원 연속 100% 2일차 · 기간 내 2일', ppage.locator('[data-testid="dash-streak-mem_yewon"]').inner_text().startswith('2일차'),
                  ppage.locator('[data-testid="dash-streak-mem_yewon"]').inner_text())
            bonus_line = ppage.locator('[data-testid="dash-bonus-line-mem_yewon"]').inner_text()
            check(
                '보너스 시간 합산: 받음 30분 · 사용 20분 · 남음 10분',
                '받음 30분' in bonus_line and '사용 20분' in bonus_line and '남음 10분' in bonus_line,
                bonus_line,
            )
            check('전체 미사용 합계도 함께', '전체 미사용 10분' in bonus_line, bonus_line)
            card_text = yewon_card.inner_text()
            check('뽑기 내역: 11/23 +10분(남음) · 11/24 +20분(사용 완료)',
                  '+10분' in card_text and '+20분' in card_text and '사용 완료' in card_text)
            check('팝업/인라인 상자 없이 티어·XP 도 보인다', 'XP' in card_text and ('실버' in card_text or '골드' in card_text))
            check('일별 막대(이번 주 7칸)', ppage.locator('[data-testid^="dash-day-mem_yewon-"]').count() == 7,
                  str(ppage.locator('[data-testid^="dash-day-mem_yewon-"]').count()))
            ppage.screenshot(path=str(DOWNLOADS / 'study_dashboard_week.png'))

            # 취합용 복사 (주간)
            ppage.locator('[data-testid="dash-export"]').click()
            ppage.wait_for_timeout(400)
            copied = ppage.evaluate("() => window.__copied || ''")
            check('취합용 복사: 주간 통계 텍스트', '[공부 체크] 주간 통계' in copied, copied[:60].replace('\n', ' '))
            check('복사본에 진행도·연속·보너스·일별 달성률', all(
                key in copied for key in ['진행도: 전체 9개', '완료율 89%', '연속 100%: 2일차', '보너스 게임 시간: 받음 30분', '일별 달성률']
            ))
            check('복사본에 아이별 줄이 모두', '예원' in copied and '찬율' in copied and '합계' in copied)

            # 월별 탭
            ppage.locator('[data-testid="dash-tab-month"]').click()
            ppage.wait_for_timeout(300)
            check('월별 탭 → 이번 달', ppage.locator('[data-testid="dash-period"]').inner_text() == '2026년 11월',
                  ppage.locator('[data-testid="dash-period"]').inner_text())
            check('월별: 캘린더 칸(11/23)', ppage.locator('[data-testid="dash-cell-mem_yewon-2026-11-23"]').count() == 1)
            check('월별: 주차별 요약표', '주 (' in ppage.locator('[data-testid="parent-dashboard"]').inner_text())
            ppage.screenshot(path=str(DOWNLOADS / 'study_dashboard_month.png'))

            month_copied_before = ppage.evaluate("() => window.__copied || ''")
            ppage.locator('[data-testid="dash-export-bottom"]').click()
            ppage.wait_for_timeout(400)
            month_copied = ppage.evaluate("() => window.__copied || ''")
            check('월간 복사: [공부 체크] 월간 통계 · 2026년 11월',
                  '[공부 체크] 월간 통계 · 2026년 11월' in month_copied and month_copied != month_copied_before,
                  month_copied.splitlines()[0] if month_copied else '')

            # 기간 이동
            ppage.locator('[data-testid="dash-prev"]').click()
            ppage.wait_for_timeout(300)
            check('이전 달로 이동', ppage.locator('[data-testid="dash-period"]').inner_text() == '2026년 10월',
                  ppage.locator('[data-testid="dash-period"]').inner_text())
            ppage.locator('[data-testid="dash-next"]').click()
            ppage.wait_for_timeout(300)
            check('다음 달로 복귀', ppage.locator('[data-testid="dash-period"]').inner_text() == '2026년 11월')

            ppage.locator('[data-testid="dash-tab-week"]').click()
            ppage.wait_for_timeout(300)
            ppage.locator('[data-testid="dash-prev"]').click()
            ppage.wait_for_timeout(300)
            prev_week = ppage.locator('[data-testid="dash-period"]').inner_text()
            check('이전 주로 이동 (11/16 주)', prev_week.startswith('2026.11.16'), prev_week)
            check('이전 주에는 기록이 없어 0%', ppage.locator('[data-testid="dash-rate-mem_yewon"]').inner_text().strip() == '0%')
            ppage.locator('[data-testid="dash-today"]').click()
            ppage.wait_for_timeout(300)
            check('이번 주로 돌아오기', '2026.11.23' in ppage.locator('[data-testid="dash-period"]').inner_text())
            check('돌아오면 89% 그대로', ppage.locator('[data-testid="dash-rate-mem_yewon"]').inner_text().strip() == '89%')

            ppage.locator('[data-testid="dashboard-close"]').click()
            ppage.wait_for_timeout(300)
            check('닫으면 부모 화면으로', ppage.locator('[data-testid="parent-dashboard"]').count() == 0
                  and ppage.locator('[data-testid="parent-week-summary"]').count() == 1)
            parent.close()

            # ---------------------------------------------------- 3) 아이 화면
            child = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            child.add_init_script(SPY)
            child.add_init_script(INIT)
            cpage = child.new_page()
            cpage.clock.set_fixed_time(FIXED_NOW)
            cpage.on('pageerror', lambda exc: errors.append(str(exc)))
            cpage.goto(f'{BASE}#as=mem_yewon', wait_until='networkidle')
            cpage.wait_for_selector('[data-testid="tier-panel-mem_yewon"]', timeout=20000)
            check('아이 화면에는 요약 카드가 없다', cpage.locator('[data-testid="parent-week-summary"]').count() == 0)
            check('아이 화면에는 대시보드도 없다', cpage.locator('[data-testid="parent-dashboard"]').count() == 0)
            body = cpage.locator('body').inner_text()
            check('아이 화면 본문에 대시보드/이번 주 요약 문구가 없다', '학습 대시보드' not in body and '이번 주 요약' not in body)
            check('아이 화면에는 취합용 복사 버튼도 없다', cpage.locator('[data-testid="dash-export"]').count() == 0)
            cpage.screenshot(path=str(DOWNLOADS / 'study_dashboard_child_hidden.png'))
            child.close()

            check('JS 오류 0', not errors, str(errors[:3]))
            browser.close()
    finally:
        try:
            os.killpg(os.getpgid(server.pid), 15)
        except Exception:
            server.kill()

    print(f'\n검사 {checks}개 · 실패: {failures if failures else "없음"}')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(run())
