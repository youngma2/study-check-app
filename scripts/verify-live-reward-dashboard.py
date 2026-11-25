"""📊🎁 라이브(깃허브 페이지 + 실제 Supabase) 확인 — 부모 요약/대시보드 · 3택1 팝업.

    python3 scripts/verify-live-reward-dashboard.py

라이브 DB 는 **읽기만** 합니다.
 · 부모 요약·대시보드: 실제 DB(가족·할 일·승급 기록)를 그대로 읽어 화면을 확인합니다.
 · 3택1 팝업: 라이브 DB 에는 아직 뽑기 상자가 없어서, 이 브라우저 안에서만
   family_tier_events 응답과 study_open_reward 응답을 가짜 1건으로 바꿔 끼워
   '배포된 번들이 팝업을 띄우고 RPC 를 부르는지'를 확인합니다(DB 에는 아무것도 쓰지 않음).
   확인 뒤 실제 family_tier_events 가 비어 있는지 다시 조회합니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.request

from playwright.sync_api import sync_playwright

URL = 'https://youngma2.github.io/study-check-app/'
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'

failures: list[str] = []
checks = 0


def check(name: str, cond: bool, extra: str = '') -> None:
    global checks
    checks += 1
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
    if not cond:
        failures.append(name)


def env_pair() -> tuple[str, str]:
    values: dict[str, str] = {}
    for line in (pathlib.Path(__file__).resolve().parent.parent / '.env.local').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values['VITE_SUPABASE_URL'], values['VITE_SUPABASE_ANON_KEY']


def live_tier_events() -> list[dict]:
    base, key = env_pair()
    request = urllib.request.Request(
        f'{base}/rest/v1/family_tier_events?select=id,member_id,box_minutes,opened_at',
        headers={'apikey': key, 'Authorization': f'Bearer {key}'},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())

SPY = """
window.__copied = null;
try {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { window.__copied = text; } },
  });
} catch (e) { /* 클립보드를 못 바꾸는 브라우저 */ }
window.__vibrateCalls = [];
try {
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: function (pattern) { window.__vibrateCalls.push(pattern); return true; },
  });
} catch (e) { /* 진동을 못 바꾸는 브라우저 */ }
window.__audioStarts = 0;
(function () {
  class Param {
    setValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
    linearRampToValueAtTime() { return this; }
  }
  class Node {
    constructor() { this.gain = new Param(); this.frequency = new Param(); this.type = 'sine'; }
    connect() { return this; }
    start() { window.__audioStarts += 1; }
    stop() {}
  }
  class FakeContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return new Node(); }
    createGain() { return new Node(); }
    resume() { return Promise.resolve(); }
  }
  window.AudioContext = FakeContext;
  window.webkitAudioContext = FakeContext;
})();
"""

FAKE_EVENT = {
    'id': 'ev_verify_child2_2026-11_3',
    'family_id': 'fam_our_home',
    'member_id': 'mem_child2',
    'season': '2026-11',
    'tier': 'silver',
    'tier_rank': 2,
    'level': 3,
    'division': 3,
    'box_minutes': 15,
    'created_at': '2026-11-25T01:00:00.000Z',
    'opened_at': None,
    'used_at': None,
    'used_by': None,
}


def main() -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    before = live_tier_events()
    check('라이브 DB: 확인 전 family_tier_events 비어 있음', before == [], str(before)[:120])

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )

        # ---------------------------------------------------- 1) 부모 화면 (PIN 2510)
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        ctx.add_init_script(SPY)
        page = ctx.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.on('console', lambda msg: errors.append(f'console.{msg.type}: {msg.text}') if msg.type == 'error' else None)

        page.goto(f'{URL}#as=mem_dad', wait_until='networkidle')
        page.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=30000)
        for key in ['2', '5', '1', '0']:
            page.click(f'[data-testid="pin-key-{key}"]')
        page.wait_for_selector('[data-testid="parent-week-summary"]', timeout=25000)

        summary = page.locator('[data-testid="parent-week-summary"]')
        check('라이브: 부모 화면에 이번 주 요약 카드', summary.count() == 1)
        summary_text = summary.inner_text().replace('\n', ' ')
        check('라이브: 요약 카드에 우리 아이 둘', '예원' in summary_text and '찬율' in summary_text, summary_text)
        check('라이브: 완료율·연속·보너스가 함께 보인다', '%' in summary_text and '🔥' in summary_text and '🎁' in summary_text, summary_text)
        page.screenshot(path=str(DOWNLOADS / 'study_live_summary.png'))

        summary.click()
        page.wait_for_selector('[data-testid="parent-dashboard"]', timeout=15000)
        period_label = page.locator('[data-testid="dash-period"]').inner_text().strip()
        check('라이브: 요약 → 상세 대시보드 열림', page.locator('[data-testid="parent-dashboard"]').count() == 1)
        check('라이브: 이번 주 기간 표시', period_label.startswith('2026.11.23'), period_label)
        check('라이브: 아이별 상세 카드 둘', page.locator('[data-testid^="dash-child-"]').count() == 2,
              str(page.locator('[data-testid^="dash-child-"]').count()))
        rates = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"dash-rate-\"]')).map((el) => el.textContent.trim())"
        )
        check('라이브: 실제 DB 로 완료율 계산', all(rate.endswith('%') for rate in rates) and len(rates) == 2, str(rates))
        bonus_lines = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"dash-bonus-line-\"]')).map((el) => el.textContent.trim())"
        )
        check('라이브: 보너스 시간 합산 줄', all('받음' in line and '사용' in line and '남음' in line for line in bonus_lines),
              str(bonus_lines)[:160])
        check('라이브: 일별 막대 7칸', page.locator('[data-testid^="dash-day-"]').count() == 14,
              str(page.locator('[data-testid^="dash-day-"]').count()))
        page.screenshot(path=str(DOWNLOADS / 'study_live_dashboard_week.png'))

        page.locator('[data-testid="dash-export"]').click()
        page.wait_for_timeout(500)
        copied = page.evaluate("() => window.__copied || ''")
        check('라이브: 취합용 복사(주간)', '[공부 체크] 주간 통계' in copied and '보너스 게임 시간' in copied, copied[:50].replace('\n', ' '))

        page.locator('[data-testid="dash-tab-month"]').click()
        page.wait_for_timeout(400)
        check('라이브: 월별 탭', page.locator('[data-testid="dash-period"]').inner_text().strip() == '2026년 11월',
              page.locator('[data-testid="dash-period"]').inner_text())
        check('라이브: 월간 캘린더 칸', page.locator('[data-testid^="dash-cell-"]').count() >= 60,
              str(page.locator('[data-testid^="dash-cell-"]').count()))
        page.screenshot(path=str(DOWNLOADS / 'study_live_dashboard_month.png'))
        page.locator('[data-testid="dash-prev"]').click()
        page.wait_for_timeout(400)
        check('라이브: 지난달 이동', page.locator('[data-testid="dash-period"]').inner_text().strip() == '2026년 10월',
              page.locator('[data-testid="dash-period"]').inner_text())
        page.locator('[data-testid="dash-today"]').click()
        page.wait_for_timeout(300)
        page.locator('[data-testid="dashboard-close"]').click()
        page.wait_for_timeout(300)
        check('라이브: 닫으면 부모 화면', page.locator('[data-testid="parent-dashboard"]').count() == 0)
        check('라이브: 부모 화면 JS 오류 0', not errors, str(errors[:3]))
        ctx.close()

        # ---------------------------------------------------- 2) 아이 화면 (요약·대시보드 없음)
        child = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        child.add_init_script(SPY)
        cpage = child.new_page()
        child_errors: list[str] = []
        cpage.on('pageerror', lambda exc: child_errors.append(str(exc)))
        cpage.on('console', lambda msg: child_errors.append(f'console.{msg.type}: {msg.text}') if msg.type == 'error' else None)

        cpage.goto(f'{URL}#as=mem_child2', wait_until='networkidle')
        cpage.wait_for_selector('[data-testid="tier-panel-mem_child2"]', timeout=30000)
        check('라이브: 아이 화면에 요약 카드 없음', cpage.locator('[data-testid="parent-week-summary"]').count() == 0)
        check('라이브: 아이 화면에 대시보드 없음', cpage.locator('[data-testid="parent-dashboard"]').count() == 0)
        body = cpage.locator('body').inner_text()
        check('라이브: 아이 화면 본문에 대시보드 문구 없음', '학습 대시보드' not in body and '이번 주 요약' not in body)
        cpage.screenshot(path=str(DOWNLOADS / 'study_live_child.png'))
        check('라이브: 아이 화면 JS 오류 0', not child_errors, str(child_errors[:3]))

        # ---------------------------------------------------- 3) 3택1 팝업 (응답만 가짜 · DB 무변경)
        opened_event = dict(FAKE_EVENT, opened_at='2026-11-25T03:00:00.000Z')
        rpc_payloads: list[str] = []

        def handle_events(route):
            route.fulfill(
                status=200,
                content_type='application/json',
                headers={'content-range': '0-0/1'},
                body=json.dumps([FAKE_EVENT], ensure_ascii=False),
            )

        def handle_open(route):
            rpc_payloads.append(route.request.post_data or '')
            route.fulfill(
                status=200,
                content_type='application/json',
                body=json.dumps(opened_event, ensure_ascii=False),
            )

        # 서비스 워커를 끈 새 창에서만 응답을 바꿔 끼웁니다(워커가 대신 받아 가면 가로챌 수 없어요).
        stub = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
        stub.add_init_script(SPY)
        cpage = stub.new_page()
        stub.on('pageerror', lambda exc: child_errors.append(str(exc)))
        stub.route('**/rest/v1/family_tier_events*', handle_events)
        stub.route('**/rest/v1/rpc/study_open_reward', handle_open)
        cpage.goto(f'{URL}#as=mem_child2', wait_until='networkidle')
        cpage.wait_for_selector('[data-testid="tier-panel-mem_child2"]', timeout=30000)
        cpage.wait_for_selector('[data-testid^="reward-open-"]', timeout=15000)
        check('라이브: (스텁) 뽑기 상자가 카드에 보인다', cpage.locator('[data-testid^="reward-box-"]').count() == 1,
              str(cpage.locator('[data-testid^="reward-box-"]').count()))

        cpage.locator('[data-testid^="reward-open-"]').first.click()
        cpage.wait_for_selector('[data-testid="reward-modal"]', timeout=8000)
        check('라이브: 눌러서 열기 → 가운데 3택1 팝업', cpage.locator('[data-testid="reward-modal"]').count() == 1)
        check('라이브: 팝업 안 상자 3개', cpage.locator('[data-testid^="reward-gift-"]').count() == 3)
        cpage.screenshot(path=str(DOWNLOADS / 'study_live_gift_choose.png'))

        cpage.locator('[data-testid^="reward-gift-"]').nth(2).click()
        cpage.wait_for_selector('[data-testid="reward-result"]', timeout=10000)
        win_text = cpage.locator('[data-testid="reward-win-minutes"]').inner_text().strip()
        others_text = cpage.locator('[data-testid="reward-others"]').inner_text().strip()
        check('라이브: 고른 상자 당첨 +15분', '+15분' in win_text, win_text)
        check('라이브: 나머지 두 상자 값 공개', others_text.startswith('다른 상자엔') and others_text.count('+') == 2, others_text)
        calls = cpage.evaluate("() => window.__vibrateCalls || []")
        check('라이브: 진동 순서(톡 → 두근두근 → 당첨)',
              calls[:1] == [15] and [20, 40, 20, 40, 50] in calls and [40, 30, 80] in calls, str(calls))
        starts = cpage.evaluate("() => window.__audioStarts || 0")
        check('라이브: 효과음(Web Audio) 재생', starts > 0, str(starts))
        check('라이브: 배포 번들이 study_open_reward RPC 를 부른다',
              any('ev_verify_child2_2026-11_3' in payload for payload in rpc_payloads), str(rpc_payloads)[:120])
        stored = cpage.evaluate("() => JSON.parse(localStorage.getItem('study-check.reward-opens.v1') || '[]')")
        check('라이브: 뽑은 값이 localStorage 에도 남는다',
              len(stored) == 1 and stored[0]['minutes'] == 15 and stored[0]['member_id'] == 'mem_child2', str(stored))
        cpage.screenshot(path=str(DOWNLOADS / 'study_live_gift_result.png'))

        cpage.locator('[data-testid="reward-modal-done"]').click()
        cpage.wait_for_timeout(400)
        check('라이브: 닫으면 카드에 +15분', '+15분' in cpage.locator('[data-testid^="reward-box-"]').first.inner_text(),
              cpage.locator('[data-testid^="reward-box-"]').first.inner_text().replace('\n', ' / '))
        child.close()
        stub.close()

        browser.close()

    after = live_tier_events()
    check('라이브 DB: 확인 뒤에도 family_tier_events 그대로(비어 있음)', after == [], str(after)[:120])

    print(f'\n검사 {checks}개 · 실패: {failures if failures else "없음"}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
