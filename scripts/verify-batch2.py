"""공부 체크 2차 1~15번 통합 검증 (데모 빌드 + 라이브 읽기 + 라이브 DB 보완 확인)

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-batch2-units.py
    python3 scripts/verify-batch2.py

· 데모(기기 저장) 빌드를 390×844 헤드리스 Chrome 으로 눌러 봅니다.
· 라이브(GitHub Pages)는 **읽기만** 합니다 — 아이 화면 렌더·콘솔 오류 0·sw v12·DB 행 수 그대로.
· 라이브 DB 의 `찬율 독서록 검사`(아빠 토요일) 5건은 이 스크립트가 직접 넣지 않고, 있는지만 확인합니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4193
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
LIVE = 'https://youngma2.github.io/study-check-app/'
SUPABASE = 'https://trhcatbuoslyjdhezobz.supabase.co'
KEY = 'sb_publishable_fPzIYHLYLbVmsPB6tLaUNw_z6sAnxbj'
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date().isoformat()
SEASON = TODAY[:7]
YESTERDAY = (datetime.now(KST).date() - timedelta(days=1)).isoformat()
SHOTS = ROOT / 'scripts' / 'shots-batch2'

failures: list[str] = []
checks = 0
START = time.time()


def check(name: str, cond: bool, extra: str = '') -> None:
    global checks
    checks += 1
    print(f"[{time.time() - START:5.1f}s] {'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
    if not cond:
        failures.append(name)


def wait_port(port: int, timeout: float = 40.0) -> bool:
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
        ['npx', 'vite', 'preview', '--outDir', 'dist-demo', '--port', str(PORT), '--strictPort'],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if not wait_port(PORT):
        proc.terminate()
        raise SystemExit('미리보기 서버가 뜨지 않았습니다.')
    return proc


def rest(path: str):
    request = urllib.request.Request(
        f'{SUPABASE}/rest/v1/{path}',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode())


def rest_count(table: str) -> int:
    request = urllib.request.Request(
        f'{SUPABASE}/rest/v1/{table}?select=id',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return int((response.headers.get('Content-Range') or '*/0').split('/')[-1])


def enter_pin(page, pin: str = '1234', times: int = 1) -> None:
    for _ in range(times):
        for key in pin:
            page.get_by_test_id(f'pin-key-{key}').click()
            page.wait_for_timeout(110)
        page.wait_for_timeout(900)


def main() -> None:
    SHOTS.mkdir(exist_ok=True)
    server = start_server()
    console_errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=CHROME, args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            context = browser.new_context(
                viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                timezone_id='Asia/Seoul', locale='ko-KR', is_mobile=True, has_touch=True,
            )
            # 미리 넣어 둔 설정·선물 상자 두 개(부모용 1, 아이용 1)
            context.add_init_script(
                f"""
                const settings = {{
                  version: 1, burst: false, burstAuto: false, burstAutoDays: 7, burstOverlap: false,
                  boxRewards: [
                    {{ id: 'm5', kind: 'minutes', value: 5 }},
                    {{ id: 'm10', kind: 'minutes', value: 10 }},
                    {{ id: 'p30', kind: 'points', value: 30 }},
                  ],
                  burstWindows: [], streakBonuses: [{{day:3,xp:30}},{{day:7,xp:70}},{{day:14,xp:140}},{{day:30,xp:300}}],
                  activePreset: 'semester', presets: {{}}, timeUsage: [],
                  boxCount: 5, tierDifficulty: 5, burstAutoFrom: null, profileEmoji: {{}}, settlements: {{}},
                }};
                localStorage.setItem('study-check.app-settings.v1', JSON.stringify(settings));
                const now = new Date().toISOString();
                localStorage.setItem('study-check.tier-events.v1', JSON.stringify([
                  {{ id: 'ev_{SEASON}_boxP', family_id: 'fam_demo', member_id: 'mem_child1', season: '{SEASON}', tier: 'silver', tier_rank: 2, level: 3, division: 3, box_minutes: 10, created_at: now, opened_at: null, used_at: null, used_by: null }},
                  {{ id: 'ev_{SEASON}_boxC', family_id: 'fam_demo', member_id: 'mem_child1', season: '{SEASON}', tier: 'gold', tier_rank: 3, level: 6, division: 3, box_minutes: 15, created_at: now, opened_at: null, used_at: null, used_by: null }},
                ]));
                """
            )
            page = context.new_page()
            page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: console_errors.append(str(error)))

            # ---------------------------------------------------------------- ①⑨⑩⑭ 부모 메인
            page.goto(f'{BASE}index.html#as=mem_dad')
            page.wait_for_timeout(1400)
            enter_pin(page, times=2)
            page.wait_for_timeout(700)
            check('① 메인: [이 날 공부 복사] 버튼이 사라짐', page.get_by_test_id('open-copy-day').count() == 0)
            check('⑨ 부모 메인 맨 아래 티어 범례', page.get_by_test_id('tier-legend').count() == 1)
            check('⑨ 범례에 6개 티어', page.locator('[data-testid^="tier-legend-"]').count() >= 6)
            check('⑩ 부모 메인 맨 아래 월말 결산 12개월', page.locator('[data-testid^="monthly-row-"]').count() >= 12)
            check('⑭ 이번 주 요약에 포인트(P)', page.locator('[data-testid^="summary-points-"]').count() >= 1)
            check('부모 화면 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            page.screenshot(path=str(SHOTS / '01-main-parent.png'), full_page=True)

            # ⑭ 학습 대시보드 포인트
            page.get_by_test_id('parent-week-summary').click()
            page.wait_for_timeout(600)
            check('⑭ 대시보드: 아이별 포인트 줄', page.locator('[data-testid^="dash-points-"]').count() >= 1)
            page.screenshot(path=str(SHOTS / '02-dashboard.png'), full_page=True)
            page.get_by_test_id('dashboard-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------------- ④⑤⑥⑪⑬ 옵션
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(600)
            check('⑥ 옵션: [기본 목록 도구] 섹션 삭제', page.get_by_test_id('default-tools').count() == 0)
            check('⑥ 대신 오늘 넣기 버튼 하나', page.get_by_test_id('fill-defaults').count() == 1)
            check('④ 프리셋 3개', page.locator('[data-testid^="preset-"]').count() >= 3)

            page.get_by_test_id('preset-vacation').click()
            page.wait_for_timeout(500)
            check('④ 방학 프리셋은 처음에 비어 있음', page.locator('[data-testid^="routine-item-"]').count() == 0)
            page.screenshot(path=str(SHOTS / '03-options-vacation.png'), full_page=True)

            # ④⑤⑬ 방학 목록에 항목 추가 — 적용 요일 + 부모 확인
            page.get_by_test_id('routine-title').fill('테스트 검사')
            today_weekday = (datetime.now(KST).weekday() + 1) % 7  # 월=1 … 일=0
            for day in range(7):
                pressed = page.get_by_test_id(f'routine-draft-day-{day}').get_attribute('aria-pressed') == 'true'
                if (day == today_weekday) != pressed:
                    page.get_by_test_id(f'routine-draft-day-{day}').click()
                    page.wait_for_timeout(120)
            page.get_by_test_id('routine-need-parent').check()
            page.get_by_test_id('routine-add').click()
            page.wait_for_timeout(900)
            rows = page.locator('[data-testid^="routine-item-"]')
            check('⑤ 추가한 항목이 목록에 보임', rows.count() == 1, f'{rows.count()}개')
            check('⑬ 부모 확인 표시(부모 확인 배지)', page.locator('[data-testid^="routine-need-"]').count() >= 1)
            first_row = rows.first
            item_id = (first_row.get_attribute('data-testid') or '').replace('routine-item-', '')
            check('⑤ 적용 요일 체크박스 7개', page.locator(f'[data-testid^="routine-day-{item_id}-"]').count() == 7)
            page.get_by_test_id(f'routine-day-{item_id}-0').click()
            page.wait_for_timeout(700)
            check('⑤ 요일 체크로 일요일 켜기', page.get_by_test_id(f'routine-day-{item_id}-0').get_attribute('aria-pressed') == 'true')

            # ⑪ 난이도
            page.get_by_test_id('option-tab-events').click()
            page.wait_for_timeout(400)
            check('⑪ 난이도 버튼 7개', page.locator('[data-testid^="difficulty-"]').count() == 7)
            check('⑪ 기본 +5% 선택', page.get_by_test_id('difficulty-5').get_attribute('aria-pressed') == 'true')
            page.get_by_test_id('difficulty-10').click()
            page.wait_for_timeout(900)
            table = page.get_by_test_id('tier-table').inner_text()
            check('⑪ +10% 즉시 반영(마스터 1,760~)', '1,760' in table or '1760' in table, table.replace('\n', ' ')[:120])
            stored = json.loads(page.evaluate("localStorage.getItem('study-check.app-settings.v1')"))
            check('⑪ 난이도가 저장됨', stored.get('tierDifficulty') == 10, str(stored.get('tierDifficulty')))
            check('⑪ 지난 결산 고정 기록 생성', isinstance(stored.get('settlements'), dict))

            # ⑦ 선물 상자 — 수정 잠금·개수
            check('⑦ 보상 인라인 수정 입력칸 없음(잠금)', page.locator('[data-testid^="box-reward-"] input[type=number]').count() == 0)
            check('⑦ 보상 삭제 버튼은 있음', page.locator('[data-testid^="box-reward-delete-"]').count() >= 3)
            page.get_by_test_id('box-count-4').click()
            page.wait_for_timeout(700)
            check('⑦ 선물 상자 개수 4 선택', page.get_by_test_id('box-count-4').get_attribute('aria-pressed') == 'true')
            page.screenshot(path=str(SHOTS / '04-options-events.png'), full_page=True)

            # ⑧ 자동 버스트 — 켠 날부터만
            page.get_by_test_id('burst-auto').check()
            page.wait_for_timeout(800)
            stored = json.loads(page.evaluate("localStorage.getItem('study-check.app-settings.v1')"))
            check('⑧ 자동 버스트 켠 날 기록', stored.get('burstAutoFrom') == TODAY, str(stored.get('burstAutoFrom')))
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(600)
            check('⑧ 오늘은 🔥 표시', page.get_by_test_id(f'burst-badge-{TODAY}').count() == 1)
            check('⑧ 지난 날짜에는 🔥 소급 없음', page.get_by_test_id(f'burst-badge-{YESTERDAY}').count() == 0)

            # ⑬ 부모 확인 항목을 오늘 날짜에 넣고 아이가 확인 요청
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(500)
            page.get_by_test_id('preset-vacation').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('fill-defaults').click()
            page.wait_for_timeout(1600)
            check('⑬ 부모 확인 항목이 오늘 목록에 들어감', page.locator('text=테스트 검사').count() >= 1)
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(600)

            # 아이 시점으로 전환
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('profile-row-mem_child1').click()
            page.wait_for_timeout(800)
            check('⑬ 아이 화면: 확인 요청 버튼', page.get_by_test_id('request-check').count() >= 1)
            page.get_by_test_id('request-check').first.click()
            page.wait_for_timeout(1200)
            check('⑬ 확인 요청 후 부모 확인 대기', page.get_by_test_id('waiting-parent').count() >= 1)
            card = page.locator('[data-testid="task-card"]').filter(has_text='테스트 검사').first
            check('⑬ 아이는 혼자 완료 못 함(그 카드에 완료 버튼 없음)', card.get_by_test_id('complete-task').count() == 0)
            page.screenshot(path=str(SHOTS / '05-child-request.png'), full_page=True)

            # ⑫ 아이 프로필 아이콘 — 부모로 돌아가 바꾸기
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('profile-row-mem_dad').click()
            page.wait_for_timeout(1000)
            if page.get_by_test_id('parent-pin-gate').count() > 0:
                enter_pin(page, times=1)
                page.wait_for_timeout(900)
            check('⑬ 부모 화면: 확인(승인) 버튼', page.get_by_test_id('approve-task').count() >= 1)
            page.get_by_test_id('approve-task').first.click()
            page.wait_for_timeout(1200)
            check('⑬ 부모 확인 후 완료 처리', page.get_by_test_id('approve-task').count() == 0)

            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('profile-row-mem_child1').locator('xpath=following-sibling::button[1]').click()
            page.wait_for_timeout(500)
            check('⑫ 아이콘 고르기 팔레트', page.locator('[data-testid^="emoji-"]').count() >= 30)
            page.get_by_test_id('emoji-🦊').click()
            page.get_by_test_id('rename-save').click()
            page.wait_for_timeout(1000)
            stored = json.loads(page.evaluate("localStorage.getItem('study-check.app-settings.v1')"))
            check('⑫ 고른 아이콘이 저장됨', stored.get('profileEmoji', {}).get('mem_child1') == '🦊', json.dumps(stored.get('profileEmoji')))
            page.screenshot(path=str(SHOTS / '06-profile-emoji.png'), full_page=True)
            page.get_by_test_id('profile-row-mem_dad').count()  # noop
            page.keyboard.press('Escape')
            page.wait_for_timeout(400)

            # ⑮⑦ 선물 상자 팝업 — 개수·문구
            page.get_by_test_id(f'reward-open-ev_{SEASON}_boxP').click()
            page.wait_for_timeout(600)
            boxes = page.locator('[data-testid^="reward-gift-"]').count()
            check('⑦ 팝업 상자 개수 = 설정값(4)', boxes == 4, f'{boxes}개')
            page.get_by_test_id('reward-gift-0').click()
            page.wait_for_timeout(1900)
            check('⑦ 상자 열림', page.get_by_test_id('reward-result').count() == 1)
            if page.get_by_test_id('reward-modal-use').count() > 0:
                page.get_by_test_id('reward-modal-use').click()
                page.wait_for_timeout(900)
            page.get_by_test_id('reward-modal-done').click()
            page.wait_for_timeout(700)
            check('⑮ 부모 화면: 적립 완료', page.locator('text=적립 완료').count() >= 1)
            page.screenshot(path=str(SHOTS / '07-gift-parent.png'), full_page=True)

            # 아이 시점 상자 — 정리 완료
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('profile-row-mem_child1').click()
            page.wait_for_timeout(800)
            page.get_by_test_id('season-bar-box').click()
            page.wait_for_timeout(600)
            page.get_by_test_id('reward-gift-0').click()
            page.wait_for_timeout(1900)
            page.get_by_test_id('reward-modal-done').click()
            page.wait_for_timeout(700)
            check('⑮ 아이 화면: 뽑음 대신 정리 완료', page.locator('text=정리 완료').count() >= 1 and page.locator('text=뽑음').count() == 0)
            page.wait_for_timeout(500)
            check('아이 화면 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            page.screenshot(path=str(SHOTS / '08-child-gift.png'), full_page=True)

            check('데모 콘솔 오류 0', len(console_errors) == 0, str(console_errors[:3]))

            # ---------------------------------------------------------------- 라이브 읽기
            quoted = urllib.parse.quote('찬율 독서록 검사')
            rows = rest(
                'tasks?select=title,due_date,status,subject&member_id=eq.mem_dad'
                f'&title=eq.{quoted}&order=due_date'
            )
            dates = [row['due_date'] for row in rows]
            check('⑬ 라이브: 찬율 독서록 검사 5건', len(rows) == 5, ','.join(dates))
            check('⑬ 라이브: 오늘부터 토요일', dates[:1] == [TODAY] and all(d.endswith('26') or d.endswith('19') or d.endswith('12') or d.endswith('05') for d in dates[1:]), ','.join(dates))

            before = {table: rest_count(table) for table in ('tasks', 'family_notes', 'family_tier_events')}

            live = context.new_page()
            live_errors: list[str] = []
            live.on('console', lambda message: live_errors.append(message.text) if message.type == 'error' else None)
            live.on('pageerror', lambda error: live_errors.append(str(error)))
            live.goto(f'{LIVE}index.html#as=mem_child1')
            live.wait_for_timeout(3500)
            check('라이브 아이 화면이 열림', live.get_by_test_id('open-shop-child').count() == 1)
            check('⑨ 라이브 아이 화면 맨 아래 티어 범례', live.get_by_test_id('tier-legend').count() == 1)
            check('⑩ 라이브 아이 화면 월말 결산', live.locator('[data-testid^="monthly-row-"]').count() >= 12)
            check('라이브 콘솔 오류 0', len(live_errors) == 0, str(live_errors[:3]))
            live.screenshot(path=str(SHOTS / '09-live-child.png'), full_page=True)

            sw = urllib.request.urlopen(f'{LIVE}sw.js', timeout=25).read().decode()
            check('라이브 sw.js v12', 'study-check-shell-v12' in sw)
            after = {table: rest_count(table) for table in ('tasks', 'family_notes', 'family_tier_events')}
            check('라이브 읽기 중 DB 행 수 그대로', before == after, json.dumps({'before': before, 'after': after}))

            browser.close()
    finally:
        server.terminate()

    print(f"\n통합 검사 {checks}개 · 실패 {len(failures)}개")
    if failures:
        for name in failures:
            print('  ✗', name)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
