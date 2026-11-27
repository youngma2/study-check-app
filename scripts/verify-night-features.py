"""①~⑤ 새벽 수정사항 — 뒤로가기 종료 확인 · 타이머 · 버스트 타임 · 옵션/프리셋 · 연속 보너스 검증.

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-night-features.py

데모(기기 저장) 빌드를 미리보기 서버로 띄워 390×844 헤드리스 Chrome 으로 검사합니다.
· 2026-11-26(목) 20:00 로 시계를 고정해 스트릭·XP 계산을 셈으로 확인합니다.
· 타이머는 실제 시간으로 돌아가는지 봐야 해서 시계를 고정하지 않은 창에서 검사합니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import time
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4188
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
KST = timezone(timedelta(hours=9))
FIXED_NOW = datetime(2026, 11, 26, 20, 0, tzinfo=KST)  # 목요일

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


MEMBERS = [
    {'id': 'mem_dad', 'family_id': 'fam_demo', 'name': '아빠', 'role': 'parent', 'emoji': '👨🏻', 'color': 'sky', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
    {'id': 'mem_mom', 'family_id': 'fam_demo', 'name': '엄마', 'role': 'parent', 'emoji': '👩🏻', 'color': 'violet', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
    {'id': 'mem_child1', 'family_id': 'fam_demo', 'name': '첫째', 'role': 'child', 'grade': '중1', 'emoji': '🌸', 'color': 'rose', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
    {'id': 'mem_child2', 'family_id': 'fam_demo', 'name': '둘째', 'role': 'child', 'grade': '초4', 'emoji': '⚡', 'color': 'amber', 'presets': [], 'created_at': '2026-11-01T00:00:00.000Z'},
]


def make_task(task_id: str, member_id: str, due: str, status: str = 'todo', verified_at: str | None = None) -> dict:
    return {
        'id': task_id,
        'family_id': 'fam_demo',
        'member_id': member_id,
        'title': f'{due} 공부',
        'subject': 'math',
        'due_date': due,
        'status': status,
        'created_by': 'mem_dad',
        'created_at': f'{due}T09:00:00+09:00',
        'verified_by': 'mem_mom' if status == 'verified' else None,
        'verified_at': verified_at,
        'updated_at': verified_at,
    }


def build_db(tasks: list[dict]) -> dict:
    return {
        'version': 1,
        'families': [{'id': 'fam_demo', 'name': '우리 가족 공부방', 'created_at': '2026-11-01T00:00:00.000Z'}],
        'members': MEMBERS,
        'tasks': tasks,
    }


def seed(page, *, db: dict, settings: dict | None = None, tier_events: list | None = None) -> None:
    page.evaluate(
        """(payload) => {
            localStorage.setItem('study-check.db.v1', JSON.stringify(payload.db));
            if (payload.settings) localStorage.setItem('study-check.app-settings.v1', JSON.stringify(payload.settings));
            if (payload.tierEvents) localStorage.setItem('study-check.tier-events.v1', JSON.stringify(payload.tierEvents));
            localStorage.setItem('study-check.member.v1', payload.member);
        }""",
        {'db': db, 'settings': settings, 'tierEvents': tier_events, 'member': 'mem_dad'},
    )
    page.reload()
    page.wait_for_selector('[data-testid="open-options"], [data-testid="parent-pin-gate"]', timeout=15000)


def login_parent(page) -> None:
    if page.locator('[data-testid="parent-pin-gate"]').count() > 0:
        for digit in '1111':
            page.click(f'[data-testid="pin-key-{digit}"]')
        for digit in '1111':
            page.click(f'[data-testid="pin-key-{digit}"]')
    page.wait_for_selector('[data-testid="open-options"]', timeout=15000)


def read_settings(page) -> dict:
    raw = page.evaluate("() => localStorage.getItem('study-check.app-settings.v1')")
    return json.loads(raw) if raw else {}


def main() -> int:
    server = start_server()
    errors: list[str] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )

            # ==========================================================
            # A. ① 뒤로가기 — 새로 연 창(앱이 첫 기록)에서
            # ==========================================================
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
            guard = ctx.new_page()
            guard.clock.set_fixed_time(FIXED_NOW)
            guard.on('pageerror', lambda error: errors.append(str(error)))
            guard.on('console', lambda message: errors.append('console: ' + message.text) if message.type == 'error' else None)
            guard.goto(BASE + '#as=mem_child2')
            guard.wait_for_selector('[data-testid="open-profile"]')

            guard.evaluate('history.back()')
            guard.wait_for_selector('[data-testid="exit-modal"]', timeout=5000)
            check('① 메인 화면에서 뒤로가기 → 종료 확인 모달', guard.locator('[data-testid="exit-modal"]').count() == 1)
            check('① "앱을 종료하시겠습니까?" 문구', '앱을 종료하시겠습니까?' in guard.inner_text('[data-testid="exit-modal"]'))
            check('① 앱은 닫히지 않고 화면이 그대로', guard.locator('[data-testid="open-profile"]').count() == 1)
            guard.click('[data-testid="exit-cancel"]')
            guard.wait_for_timeout(250)
            check('① [취소] → 메인 화면에 머문다', guard.locator('[data-testid="exit-modal"]').count() == 0 and guard.locator('[data-testid="open-profile"]').count() == 1)

            guard.click('[data-testid="open-profile"]')
            guard.wait_for_selector('[role="dialog"]')
            guard.evaluate('history.back()')
            guard.wait_for_timeout(500)
            check(
                '① 다른 창이 열려 있으면 뒤로가기는 그 창만 닫는다',
                guard.locator('[role="dialog"]').count() == 0 and guard.locator('[data-testid="exit-modal"]').count() == 0,
            )
            guard.evaluate('history.back()')
            guard.wait_for_timeout(500)
            check('① 창을 닫은 뒤 다시 뒤로가기 → 종료 확인', guard.locator('[data-testid="exit-modal"]').count() == 1)

            # [종료] 를 누르면 그때만 앱을 떠납니다.
            guard.click('[data-testid="exit-confirm-ok"]')
            guard.wait_for_timeout(1200)
            try:
                left = 'study-check-app' not in guard.url
            except Exception:
                left = True
            check('① [종료] → 앱을 떠난다', left, guard.url)
            guard.close()

            # ==========================================================
            # B. ③④⑤ — 시계 고정(2026-11-26 목) 부모 화면
            # ==========================================================
            page = ctx.new_page()
            page.clock.set_fixed_time(FIXED_NOW)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append('console: ' + message.text) if message.type == 'error' else None)
            page.goto(BASE + '#as=mem_dad')
            page.wait_for_selector('[data-testid="parent-pin-gate"]')
            page.evaluate('history.back()')
            page.wait_for_timeout(500)
            check('① 부모 PIN 화면에서도 뒤로가기 → 종료 확인', page.locator('[data-testid="exit-modal"]').count() == 1)
            page.click('[data-testid="exit-cancel"]')
            page.wait_for_timeout(200)
            check('① PIN 화면 [취소] → 잠금 화면 그대로', page.locator('[data-testid="parent-pin-gate"]').count() == 1)
            # 이 기기 PIN 정하기(1111)
            for digit in '1111':
                page.click(f'[data-testid="pin-key-{digit}"]')
            for digit in '1111':
                page.click(f'[data-testid="pin-key-{digit}"]')
            page.wait_for_selector('[data-testid="open-options"]', timeout=15000)

            # ⑤ 스트릭: 11/23(월)·24(화)·25(수) 100%, 오늘(26목)은 할 일 없음 → 3일 연속
            streak_tasks = [
                make_task('t_mon', 'mem_child1', '2026-11-23', 'verified', '2026-11-23T20:10:00+09:00'),
                make_task('t_tue', 'mem_child1', '2026-11-24', 'verified', '2026-11-24T20:10:00+09:00'),
                make_task('t_wed', 'mem_child1', '2026-11-25', 'verified', '2026-11-25T20:10:00+09:00'),
                # 둘째: 목·금 + (토·일 건너뛰고) 월·화·수 → 5일 연속
                make_task('t_c2_thu', 'mem_child2', '2026-11-19', 'verified', '2026-11-19T20:10:00+09:00'),
                make_task('t_c2_fri', 'mem_child2', '2026-11-20', 'verified', '2026-11-20T20:10:00+09:00'),
                make_task('t_c2_mon', 'mem_child2', '2026-11-23', 'verified', '2026-11-23T20:10:00+09:00'),
                make_task('t_c2_tue', 'mem_child2', '2026-11-24', 'verified', '2026-11-24T20:10:00+09:00'),
                make_task('t_c2_wed', 'mem_child2', '2026-11-25', 'verified', '2026-11-25T20:10:00+09:00'),
            ]
            seed(page, db=build_db(streak_tasks))
            login_parent(page)

            congrats = page.locator('[data-testid="streak-congrats-mem_child1"]')
            check('⑤ 3일 연속 — 쪼꼬 축하 한마디', congrats.count() == 1, congrats.inner_text() if congrats.count() else '')
            text = congrats.inner_text() if congrats.count() else ''
            check('⑤ 축하 한마디에 3일 · 보너스 +30 XP', '3일' in text and '+30' in text, text)
            xp_text = page.inner_text('[data-testid="tier-xp-mem_child1"]')
            # 3일 × (10 + 100% 20) + 3일째 연속 +10 + 3일 보너스 30 = 130
            check('⑤ XP 계산(항목 30 + 100% 60 + 연속 10 + 보너스 30 = 130)', xp_text.strip() == '130 XP', xp_text)
            check('⑤ 3일 연속 배지', '3일차' in page.inner_text('[data-testid="streak-mem_child1"]'))
            check('⑤ 토·일은 끊기지 않는다(둘째: 목·금 + 월·화·수 = 5일)', '5일차' in page.inner_text('[data-testid="streak-mem_child2"]'), page.inner_text('[data-testid="streak-mem_child2"]'))
            xp_child2 = page.inner_text('[data-testid="tier-xp-mem_child2"]')
            # 5일 × 30 + 연속 3·4·5일째 +10×3 + 3일 보너스 30 = 210
            check('⑤ 주말 낀 5일 연속 XP(150 + 30 + 30 = 210)', xp_child2.strip() == '210 XP', xp_child2)

            # ④ 옵션 페이지
            page.click('[data-testid="open-options"]')
            page.wait_for_selector('[data-testid="options-page"]')
            page.click('[data-testid="option-child-mem_child1"]')
            page.click('[data-testid="option-day-4"]')
            page.fill('[data-testid="routine-title"]', '테스트 수학 문제집')
            page.select_option('[data-testid="routine-subject"]', 'math')
            page.click('[data-testid="routine-add"]')
            page.wait_for_timeout(700)
            check('④ 아이·요일별 기본 목록 추가', page.locator('[data-testid="routine-item-0"]').count() == 1)
            saved = read_settings(page)
            item_titles = saved.get('presets', {}).get('semester', {}).get('routines', {}).get('mem_child1', {}).get('4', [])
            check('④ 저장된 기본 목록(첫째·목요일)', any(i['title'] == '테스트 수학 문제집' for i in item_titles), json.dumps(item_titles, ensure_ascii=False))

            page.click('[data-testid="preset-vacation"]')
            page.wait_for_timeout(700)
            check('④ 방학 프리셋 원터치 적용', '방학' in page.inner_text('[data-testid="active-preset"]'))
            check('④ 프리셋을 바꾸면 기본 일정이 한 번에 전환(방학은 비어 있음)', page.locator('[data-testid="routine-item-0"]').count() == 0)
            check('④ 저장된 activePreset = vacation', read_settings(page).get('activePreset') == 'vacation')
            page.click('[data-testid="option-tab-events"]')
            page.wait_for_timeout(200)
            check('⚙️ 설정 저장 위치 안내가 보인다', page.locator('[data-testid="settings-sync-note"]').count() == 1, page.inner_text('[data-testid="settings-sync-note"]'))
            page.click('[data-testid="option-tab-routines"]')
            page.wait_for_timeout(200)
            page.click('[data-testid="preset-semester"]')
            page.wait_for_timeout(700)
            check('④ 학기중으로 되돌리면 목록이 그대로 살아 있다', page.locator('[data-testid="routine-item-0"]').count() == 1)

            page.click('[data-testid="routine-edit-0"]')
            page.fill('[data-testid="routine-title"]', '수정된 수학')
            page.click('[data-testid="routine-add"]')
            page.wait_for_timeout(700)
            edited = read_settings(page)['presets']['semester']['routines']['mem_child1']['4']
            check('④ 기본 목록 수정', edited[0]['title'] == '수정된 수학', json.dumps(edited, ensure_ascii=False))

            # ③ 버스트 타임
            page.click('[data-testid="option-tab-events"]')
            page.wait_for_timeout(200)
            check('③ 버스트 타임 기본 꺼짐', page.get_attribute('[data-testid="burst-toggle"]', 'aria-pressed') == 'false')
            page.click('[data-testid="burst-toggle"]')
            page.wait_for_timeout(700)
            check('③ 버스트 타임 켜기', page.get_attribute('[data-testid="burst-toggle"]', 'aria-pressed') == 'true')
            check('③ 진행 중 안내', '진행 중' in page.inner_text('[data-testid="burst-status"]'))
            after_burst = read_settings(page)
            check('③ burst=true · 열린 시간대 저장', after_burst.get('burst') is True and any(w.get('to') is None for w in after_burst.get('burstWindows', [])))

            # ⑤ 연속 보너스 XP 조정
            page.fill('[data-testid="streak-input-3"]', '50')
            page.click('[data-testid="streak-save"]')
            page.wait_for_timeout(700)
            check('⑤ 연속 보너스 XP 조정 저장(3일 30→50)', any(b['day'] == 3 and b['xp'] == 50 for b in read_settings(page).get('streakBonuses', [])))

            page.click('[data-testid="options-close"]')
            page.wait_for_timeout(300)
            check('③ 아이들 화면 위 안내 배너', page.locator('[data-testid="burst-banner"]').count() == 1 and '2배' in page.inner_text('[data-testid="burst-banner"]'))
            xp_after_bonus = page.inner_text('[data-testid="tier-xp-mem_child1"]')
            check('⑤ 보너스 30→50 이 XP 에 반영(150 XP)', xp_after_bonus.strip() == '150 XP', xp_after_bonus)

            # ④ [기본 목록] 이 옵션의 목록을 넣는다 (오늘 11/26 목요일)
            page.get_by_role('button', name='목요일').first.click()
            page.wait_for_timeout(200)
            page.click('[data-testid="fill-defaults"]')
            page.wait_for_timeout(1800)
            check('④ [기본 목록]이 옵션에서 정한 목록을 넣는다', page.get_by_text('수정된 수학').count() >= 1)

            # ③ 버스트 중 완료 → XP 2배
            card = page.locator('[data-testid="task-card"]').filter(has_text='수정된 수학').first
            card.locator('[data-testid="complete-task"]').click()
            page.wait_for_timeout(900)
            toast_locator = page.locator('div.animate-toast-in')
            toast = toast_locator.first.inner_text() if toast_locator.count() else ''
            check('③ 완료 토스트에 버스트 2배 안내', '버스트' in toast, toast)
            check('③ 카드에 🔥×2 표시', page.locator('[data-testid="task-xp-burst"]').count() >= 1)
            burst_card = page.locator('[data-testid="task-card"]').filter(has_text='수정된 수학').first
            check('③ 버스트 동안 완료한 항목 XP 20', '+20 XP' in burst_card.inner_text(), burst_card.inner_text().replace('\n', ' ')[:90])

            page.screenshot(path=str(pathlib.Path('/workspace/downloads/study-night-parent.png')))
            page.close()

            # 아이 화면 — 부모 도구가 없고 버스트 배너는 보인다
            child = ctx.new_page()
            child.clock.set_fixed_time(FIXED_NOW)
            child.on('pageerror', lambda error: errors.append(str(error)))
            child.goto(BASE + '#as=mem_child2')
            child.wait_for_selector('[data-testid="open-profile"]')
            check('②·④ 아이 화면: 옵션·타이머 버튼 없음', child.locator('[data-testid="open-options"]').count() == 0 and child.locator('[data-testid="open-timer"]').count() == 0)
            check('③ 아이 화면: 버스트 타임 배너', child.locator('[data-testid="burst-banner"]').count() == 1)
            child.screenshot(path=str(pathlib.Path('/workspace/downloads/study-night-child.png')))
            child.close()
            ctx.close()

            # ==========================================================
            # C. ② 타이머 — 실제 시간(시계 고정 없음)
            # ==========================================================
            ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
            page2 = ctx2.new_page()
            page2.on('pageerror', lambda error: errors.append(str(error)))
            page2.on('console', lambda message: errors.append('console: ' + message.text) if message.type == 'error' else None)
            page2.goto(BASE + '#as=mem_dad')
            page2.wait_for_selector('[data-testid="parent-pin-gate"]')
            for digit in '1111':
                page2.click(f'[data-testid="pin-key-{digit}"]')
            for digit in '1111':
                page2.click(f'[data-testid="pin-key-{digit}"]')
            page2.wait_for_selector('[data-testid="open-options"]', timeout=15000)

            box_event = {
                'id': 'ev_test_box',
                'family_id': 'fam_demo',
                'member_id': 'mem_child1',
                'season': '2026-11',
                'tier': 'gold',
                'tier_rank': 3,
                'level': 6,
                'division': 3,
                'box_minutes': 20,
                'created_at': '2026-11-25T10:00:00+09:00',
                'opened_at': '2026-11-25T10:00:00+09:00',
                'used_at': None,
                'used_by': None,
            }
            seed(page2, db=build_db([]), tier_events=[box_event])
            login_parent(page2)
            page2.click('[data-testid="open-timer"]')
            page2.wait_for_selector('[data-testid="timer-panel"]')
            page2.click('[data-testid="timer-child-mem_child1"]')
            page2.wait_for_timeout(400)
            remaining_text = page2.inner_text('[data-testid="timer-remaining"]')
            check('② 뽑기로 받은 남은 시간 20분', '20분' in remaining_text, remaining_text)

            page2.fill('[data-testid="timer-minutes"]', '7')
            page2.click('[data-testid="timer-start"]')
            page2.wait_for_timeout(900)
            clock_text = page2.inner_text('[data-testid="timer-clock"]')
            check('② [사용 시작] → 분 단위 차감 + 카운트다운', clock_text.startswith('06:5') or clock_text.startswith('07:0'), clock_text)
            check('② 남은 시간 20 → 13분', '13분' in page2.inner_text('[data-testid="timer-remaining"]'))
            stored = read_settings(page2)
            check('② 분할 사용 기록(7분)이 남는다', sum(u['minutes'] for u in stored.get('timeUsage', [])) == 7, json.dumps(stored.get('timeUsage'), ensure_ascii=False))

            page2.reload()
            page2.wait_for_selector('[data-testid="timer-strip"]', timeout=15000)
            reloaded_clock = page2.inner_text('[data-testid="timer-strip-clock"]')
            check('② 새로고침해도 타이머 유지(끝나는 시각 저장)', reloaded_clock.startswith('06:') or reloaded_clock.startswith('07:0'), reloaded_clock)

            page2.click('[data-testid="timer-strip-toggle"]')
            page2.wait_for_timeout(300)
            paused_clock = page2.inner_text('[data-testid="timer-strip-clock"]')
            page2.reload()
            page2.wait_for_selector('[data-testid="timer-strip"]', timeout=15000)
            page2.wait_for_timeout(1400)
            check('② 일시 멈춤 — 새로고침해도 그대로', page2.inner_text('[data-testid="timer-strip-clock"]') == paused_clock, page2.inner_text('[data-testid="timer-strip-clock"]'))
            page2.click('[data-testid="timer-strip-toggle"]')
            page2.wait_for_timeout(1300)
            check('② 재개하면 다시 줄어든다', page2.inner_text('[data-testid="timer-strip-clock"]') != paused_clock)

            # 시간이 다 된 상황을 만들어 종료 알림 확인
            page2.evaluate(
                """() => {
                    const raw = JSON.parse(localStorage.getItem('study-check.timer.v1'));
                    raw.ends_at = new Date(Date.now() - 2000).toISOString();
                    raw.status = 'running';
                    raw.alerted = false;
                    localStorage.setItem('study-check.timer.v1', JSON.stringify(raw));
                }"""
            )
            page2.reload()
            page2.wait_for_selector('[data-testid="timer-ended"]', timeout=15000)
            ended_text = page2.inner_text('[data-testid="timer-ended"]')
            check('② 시간이 끝나면 "시간이 끝났습니다!" 알림', '시간이 끝났습니다' in ended_text, ended_text.replace('\n', ' '))
            page2.click('[data-testid="timer-ended-ok"]')
            page2.wait_for_timeout(300)
            check('② 알림 확인으로 닫힌다', page2.locator('[data-testid="timer-ended"]').count() == 0)

            # 아이 화면에서는 남은 시간만 보이고 조작은 없다
            page2.evaluate(
                """() => localStorage.setItem('study-check.timer.v1', JSON.stringify({
                    id: 'tm_child', member_id: 'mem_child2', member_name: '둘째', minutes: 5,
                    started_at: new Date().toISOString(),
                    ends_at: new Date(Date.now() + 5 * 60000).toISOString(),
                    status: 'running', remaining_sec: 300, alerted: false,
                }))"""
            )
            child2 = ctx2.new_page()
            child2.goto(BASE + '#as=mem_child2')
            child2.wait_for_selector('[data-testid="timer-strip"]', timeout=15000)
            check('② 아이 화면: 남은 시간은 보인다', child2.locator('[data-testid="timer-strip-clock"]').count() == 1)
            check('② 아이 화면: 멈춤·관리 버튼은 없다', child2.locator('[data-testid="timer-strip-toggle"]').count() == 0 and child2.locator('[data-testid="open-timer"]').count() == 0)
            child2.close()
            ctx2.close()

            browser.close()
    finally:
        os.killpg(os.getpgid(server.pid), 15)

    print()
    print('=== 콘솔/페이지 오류 ===')
    if errors:
        for error in errors[:20]:
            print(' ·', error)
    check('JS 오류 0', not errors, f'{len(errors)}개')

    print()
    print(f'=== 실패 {len(failures)} / 검사 {checks} ===')
    for name in failures:
        print(' ·', name)
    return 0 if not failures else 1


if __name__ == '__main__':
    raise SystemExit(main())
