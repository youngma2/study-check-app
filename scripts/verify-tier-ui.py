"""🏆 월간 티어 · 🔥 연속 100% · 🎁 뽑기 상자 화면 검증 (데모 빌드, 기기 저장).

dist-demo 빌드를 미리보기 서버로 띄우고, 390×844 모바일 화면에서
  · 아이 이름 옆 티어 엠블럼(SVG)과 티어 이름·XP·게이지
  · 🔥 달성률 100% N일차 (주말·공휴일 제외)
  · 큰 티어 승급마다 생기는 🎁 뽑기 상자 → 눌러서 열기 → 사용 완료(부모)
  · 부모 PIN 화면·보상 설정
을 확인하고 스크린샷을 /workspace/downloads 에 남깁니다.

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-tier-ui.py
"""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4182
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

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
def task(member: str, due: str, index: int, status: str, title: str = '수학 문제집') -> dict:
    return {
        'id': f't_{member}_{due}_{index}',
        'family_id': 'fam_test',
        'member_id': member,
        'title': title,
        'subject': 'math',
        'due_date': due,
        'status': status,
        'created_by': member,
        'created_at': f'{due}T00:00:00.000Z',
        'verified_by': 'mem_mom' if status == 'verified' else None,
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

    # 예원: 11/16(월)~11/24(화) 평일 매일 3개 전부 완료 → 7일 연속 100%
    #   하루 30 + 100% 20 = 50, 3일째부터 +10 → 400 XP (골드 I)
    for due in ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24']:
        for index in range(3):
            tasks.append(task('mem_yewon', due, index, 'verified'))
    # 예원 오늘(11/25): 1개 완료, 2개 남음 → 진행 중(연속 유지)
    tasks.append(task('mem_yewon', '2026-11-25', 0, 'verified'))
    tasks.append(task('mem_yewon', '2026-11-25', 1, 'todo'))
    tasks.append(task('mem_yewon', '2026-11-25', 2, 'todo'))

    # 찬율: 11/23·11/24 100% → 연속 2일차, 오늘은 아직
    for index in range(2):
        tasks.append(task('mem_chanyul', '2026-11-23', index, 'verified'))
        tasks.append(task('mem_chanyul', '2026-11-24', index, 'verified'))
    tasks.append(task('mem_chanyul', '2026-11-25', 0, 'verified'))
    tasks.append(task('mem_chanyul', '2026-11-25', 1, 'todo'))

    return {
        'version': 1,
        'families': [{'id': 'fam_test', 'name': '우리 가족 공부방', 'created_at': '2026-11-01T00:00:00.000Z'}],
        'members': members,
        'tasks': tasks,
    }


SEED = json.dumps(build_db(), ensure_ascii=False)
INIT = f"""
window.localStorage.setItem('study-check.db.v1', {json.dumps(SEED)});
window.localStorage.setItem('study-check.member.v1', 'mem_yewon');
"""


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

            # ---------------------------------------------------- 1) 예원(아이) 화면
            child = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            child.add_init_script(INIT)
            page = child.new_page()
            page.goto(f'{BASE}#as=mem_yewon', wait_until='networkidle')
            page.wait_for_selector('[data-testid="tier-panel-mem_yewon"]', timeout=15000)

            panel = page.locator('[data-testid="tier-panel-mem_yewon"]')
            check('아이 카드에 티어 패널이 있다', panel.count() == 1)
            check(
                '티어 이름 = 골드 I',
                page.locator('[data-testid="tier-title-mem_yewon"]').inner_text().strip() == '골드 I',
                page.locator('[data-testid="tier-title-mem_yewon"]').inner_text(),
            )
            check(
                'XP 표시 = 410 XP (7일 100% + 오늘 1개)',
                page.locator('[data-testid="tier-xp-mem_yewon"]').inner_text().strip() == '410 XP',
                page.locator('[data-testid="tier-xp-mem_yewon"]').inner_text(),
            )
            streak = page.locator('[data-testid="streak-mem_yewon"]').inner_text().strip()
            check('🔥 달성률 100% 7일차 (주말은 빼고 셈)', streak == '🔥 달성률 100% 7일차', streak)

            gauge = page.locator('[data-testid="tier-gauge-mem_yewon"]')
            width = gauge.evaluate("el => el.style.width")
            # 골드 I: 384~449 XP → 410 XP = (410-384)/(450-384) = 39.4%
            check('게이지가 다음 단계까지의 비율만큼 찼다 (39%)', width == '39%', width)

            emblems = page.locator('[data-testid="tier-panel-mem_yewon"] svg[data-tier]')
            check('패널에 티어 엠블럼 SVG', emblems.count() >= 1)
            check('엠블럼 = gold', emblems.first.get_attribute('data-tier') == 'gold', emblems.first.get_attribute('data-tier'))
            check(
                '이름 옆 작은 엠블럼도 gold (아이 카드 헤더)',
                page.locator('[data-testid="day-stat-mem_yewon"] svg[data-tier]').first.get_attribute('data-tier') == 'gold',
            )
            check(
                '상단 프로필 아이콘에도 티어 배지',
                page.locator('header svg[data-tier]').first.get_attribute('data-tier') == 'gold',
            )

            boxes = page.locator('[data-testid^="reward-box-"]')
            check('큰 티어 승급 2번 = 상자 2개 (실버 III·골드 III)', boxes.count() == 2, str(boxes.count()))
            check(
                '상자에는 뽑기 안내가 보인다 (2개 남음)',
                '2개 남음' in page.locator('[data-testid="tier-panel-mem_yewon"]').inner_text()
                and page.locator('[data-testid^="reward-open-"]').count() == 2,
            )

            bar = page.locator('[data-testid="season-bar"]')
            check('상단 시즌 바에 티어·XP 가 보인다', bar.count() == 1 and '골드 I' in bar.inner_text(), bar.inner_text().replace('\n', ' ') if bar.count() else '')
            check('상단 바에 🔥 일차와 남은 상자 수', '🔥 7일차' in bar.inner_text() and '🎁 2' in bar.inner_text())

            page.screenshot(path=str(DOWNLOADS / 'study_tier_child.png'), full_page=False)
            panel.screenshot(path=str(DOWNLOADS / 'study_tier_panel.png'))

            # 상자 열기 — 두근거리는 연출 뒤 보상이 나온다
            open_button = page.locator('[data-testid^="reward-open-"]').first
            open_button.click()
            page.wait_for_selector('[data-testid^="reward-box-"]:has-text("게임 시간")', timeout=5000)
            box_text = page.locator('[data-testid^="reward-box-"]').first.inner_text()
            check('상자를 열면 게임 시간 보상이 나온다 (+5·10·15·20분)', '분' in box_text and '게임 시간' in box_text, box_text.replace('\n', ' / '))
            check('아이 화면에는 사용 완료 버튼이 없다', page.locator('[data-testid^="reward-use-"]').count() == 0)

            page.screenshot(path=str(DOWNLOADS / 'study_tier_box_opened.png'), full_page=False)

            # 새로고침해도 상자는 한 번만 생기고, 열어 둔 상태가 남는다
            page.reload(wait_until='networkidle')
            page.wait_for_selector('[data-testid="tier-panel-mem_yewon"]', timeout=15000)
            page.wait_for_timeout(800)
            check('새로고침해도 상자 수 그대로 (중복 없음)', page.locator('[data-testid^="reward-box-"]').count() == 2)
            check(
                '열어 둔 상자는 열린 채로 남는다',
                '게임 시간' in page.locator('[data-testid^="reward-box-"]').first.inner_text(),
            )
            child.close()

            # ---------------------------------------------------- 2) 부모 화면 (PIN)
            parent = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            parent.add_init_script(INIT)
            ppage = parent.new_page()
            ppage.goto(f'{BASE}#as=mem_dad', wait_until='networkidle')
            ppage.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=15000)
            ppage.screenshot(path=str(DOWNLOADS / 'study_tier_pin_gate.png'))

            for _ in range(2):  # 데모: PIN 정하기 → 한 번 더
                for key in ['1', '2', '3', '4']:
                    ppage.click(f'[data-testid="pin-key-{key}"]')
                ppage.wait_for_timeout(500)

            ppage.wait_for_selector('[data-testid="tier-panel-mem_chanyul"]', timeout=15000)
            check(
                '부모 화면: 찬율 카드도 티어 표시 (브론즈 I, 90 XP)',
                ppage.locator('[data-testid="tier-title-mem_chanyul"]').inner_text().strip() == '브론즈 I',
                ppage.locator('[data-testid="tier-title-mem_chanyul"]').inner_text(),
            )
            check(
                '찬율 🔥 100% 2일차',
                ppage.locator('[data-testid="streak-mem_chanyul"]').inner_text().strip() == '🔥 달성률 100% 2일차',
                ppage.locator('[data-testid="streak-mem_chanyul"]').inner_text(),
            )
            check(
                '찬율에게는 아직 상자가 없다 (큰 티어 승급 전)',
                ppage.locator('[data-testid="tier-panel-mem_chanyul"] [data-testid^="reward-box-"]').count() == 0,
            )
            check(
                '예원 카드 엠블럼은 gold, 찬율은 bronze',
                ppage.locator('[data-testid="tier-panel-mem_yewon"] svg[data-tier]').first.get_attribute('data-tier') == 'gold'
                and ppage.locator('[data-testid="tier-panel-mem_chanyul"] svg[data-tier]').first.get_attribute('data-tier') == 'bronze',
            )

            ppage.screenshot(path=str(DOWNLOADS / 'study_tier_parent.png'))

            # 부모 폰에서 상자를 열면 그 자리에서 '사용 완료' 처리까지 할 수 있습니다
            ppage.locator('[data-testid^="reward-open-"]').first.click()
            ppage.wait_for_selector('[data-testid^="reward-use-"]', timeout=6000)
            use_buttons = ppage.locator('[data-testid^="reward-use-"]')
            check('상자를 연 뒤 부모에게 사용 완료 버튼이 보인다', use_buttons.count() >= 1, str(use_buttons.count()))
            page_shot = DOWNLOADS / 'study_tier_parent.png'
            ppage.screenshot(path=str(page_shot))

            use_buttons.first.click()
            ppage.wait_for_timeout(700)
            check(
                '사용 완료를 누르면 배지가 바뀐다',
                '사용 완료' in ppage.locator('[data-testid^="reward-box-"]').first.inner_text(),
            )
            ppage.screenshot(path=str(DOWNLOADS / 'study_tier_reward_used.png'))

            # 보상 설정 (부모)
            ppage.click('[data-testid="open-profile"]')
            ppage.wait_for_selector('[data-testid="reward-settings"]', timeout=8000)
            ppage.screenshot(path=str(DOWNLOADS / 'study_tier_reward_settings.png'))
            ppage.click('[data-testid="pool-5"]')
            ppage.wait_for_timeout(900)
            pool_after = ppage.evaluate("() => JSON.parse(localStorage.getItem('study-check.reward-settings.v1') || '{}')")
            check('보상 풀에서 +5분을 끄면 저장된다', pool_after.get('pool') == [10, 15, 20], str(pool_after.get('pool')))
            ppage.click('[data-testid="notify-step"]')
            ppage.wait_for_timeout(900)
            notify_after = ppage.evaluate("() => JSON.parse(localStorage.getItem('study-check.reward-settings.v1') || '{}')")
            check('세부 단계 알림을 끄면 저장된다', notify_after.get('notify_step') is False, str(notify_after))

            parent.close()
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
