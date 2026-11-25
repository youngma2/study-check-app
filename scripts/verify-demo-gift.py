"""🧪 뽑기 상자 체험 페이지(demo.html) 검증 — 로컬 빌드 / 라이브 공통.

    python3 scripts/verify-demo-gift.py            # dist/ 를 preview 로 띄워 확인
    python3 scripts/verify-demo-gift.py --live     # https://youngma2.github.io/study-check-app/demo.html

확인하는 것
  · 🧪 체험 모드 배너 문구 · 접속하자마자 3택1 팝업 자동 열림
  · 상자 3개 → 고르기 → 두근두근 → 당첨(+N분) · 나머지 두 상자 공개 · 진동 · 효과음
  · 닫고 `다시 뽑아보기` 로 몇 번이고 재체험(매번 새 뽑기) · 화면 기록(최근 5개)
  · 🔊/🔇 토글 · 부모처럼 `사용 완료` 버튼
  · Supabase(RPC·REST)·기기 저장으로 가는 요청 0건 — 라이브에서는 DB 건수 전/후 동일

스크린샷: /workspace/downloads/study_demo_*.png
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import socket
import subprocess
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
LIVE_BASE = 'https://youngma2.github.io/study-check-app/'
PORT = 4183
LOCAL_BASE = f'http://127.0.0.1:{PORT}/study-check-app/'

BANNER = '🧪 체험용 데모 모드 · 실제 가족 기록에는 저장되지 않습니다'
POOL = [5, 10, 15, 20]

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
        ['npx', 'vite', 'preview', '--outDir', 'dist', '--port', str(PORT)],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    if not wait_for_port(PORT):
        raise RuntimeError('preview 서버가 뜨지 않았습니다.')
    return proc


def env_pair() -> tuple[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values['VITE_SUPABASE_URL'], values['VITE_SUPABASE_ANON_KEY']


def table_count(table: str) -> int:
    base, key = env_pair()
    request = urllib.request.Request(
        f'{base}/rest/v1/{table}?select=id',
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Prefer': 'count=exact',
            'Range': '0-0',
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        content_range = response.headers.get('Content-Range', '*/0')
    return int(content_range.rsplit('/', 1)[-1])


SPY = """
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


def minutes_of(text: str) -> int | None:
    for value in POOL:
        if f'+{value}분' in text:
            return value
    return None


def run(live: bool) -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    prefix = 'study_demo_live' if live else 'study_demo_local'
    base = LIVE_BASE if live else LOCAL_BASE
    url = f'{base}demo.html'
    server = None if live else start_server()

    before = None
    if live:
        before = {'tasks': table_count('tasks'), 'family_tier_events': table_count('family_tier_events')}
        print(f'DB 확인 전: tasks={before["tasks"]} · family_tier_events={before["family_tier_events"]}', flush=True)

    request_log: list[str] = []
    console_errors: list[str] = []
    page_errors: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox', '--disable-dev-shm-usage'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            context = browser.new_context(
                viewport={'width': 390, 'height': 844},
                device_scale_factor=2,
                locale='ko-KR',
                timezone_id='Asia/Seoul',
                is_mobile=True,
                has_touch=True,
            )
            context.add_init_script(SPY)
            page = context.new_page()
            page.on('request', lambda request: request_log.append(request.url))
            page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
            page.on('pageerror', lambda error: page_errors.append(str(error)))

            # ---------------------------------------------------- 1) 접속 → 자동으로 팝업
            response = page.goto(url, wait_until='networkidle')
            check('체험 페이지 HTTP 200', response is not None and response.status == 200,
                  str(response.status if response else 'no response'))
            check('체험 모드 배너 문구', BANNER in page.locator('[data-testid="demo-banner"]').inner_text())
            check('페이지 제목', '뽑기 상자 체험' in page.title(), page.title())

            page.wait_for_selector('[data-testid="reward-modal"]', timeout=8000)
            check('접속하자마자 3택1 팝업이 자동으로 열림', page.locator('[data-testid="reward-modal"]').count() == 1)
            check('팝업 안 상자 3개', page.locator('[data-testid^="reward-gift-"]').count() == 3)
            check('고르기 전에는 당첨 시간이 안 보임',
                  page.locator('[data-testid="reward-win-minutes"]').count() == 0)
            check('고르기 전 안내에 보상 풀 표시',
                  all(f'+{value}분' in page.locator('[data-testid="reward-modal"]').inner_text() for value in POOL))
            page.screenshot(path=str(DOWNLOADS / f'{prefix}_choose.png'))

            # ---------------------------------------------------- 2) 상자 고르기 → 결과
            page.locator('[data-testid="reward-gift-0"]').click()
            page.wait_for_selector('[data-testid="reward-opening"]', timeout=3000)
            check('고르면 "여는 중" 연출', page.locator('[data-testid="reward-opening"]').count() == 1)

            page.wait_for_selector('[data-testid="reward-result"]', timeout=6000)
            result_text = page.locator('[data-testid="reward-result"]').inner_text()
            win_text = page.locator('[data-testid="reward-win-minutes"]').inner_text()
            win = minutes_of(win_text)
            check('당첨 시간이 보상 풀 안의 값', win is not None, win_text)
            check('결과 문구에 획득 표시', '획득' in result_text, result_text.replace('\n', ' '))
            others = page.locator('[data-testid="reward-others"]').inner_text()
            check('나머지 두 상자 값 공개', others.startswith('다른 상자엔') and others.count('+') == 2, others)
            check('나머지 두 상자 칸이 열림',
                  page.locator('[data-testid="reward-gift-0"]').inner_text().count('+') >= 1)
            page.screenshot(path=str(DOWNLOADS / f'{prefix}_result.png'))

            # 진동·효과음 (누른 뒤 잠깐 기다려 1.7초 뒤 두 번째 진동까지)
            time.sleep(2.0)
            vibrate = page.evaluate('window.__vibrateCalls')
            audio = page.evaluate('window.__audioStarts')
            check('진동이 울린다', len(vibrate) >= 3, json.dumps(vibrate))
            check('효과음(Oscillator)이 울린다', audio >= 5, str(audio))

            # 🔊/🔇 토글
            mute = page.locator('[data-testid="reward-mute"]')
            before_label = mute.get_attribute('aria-label')
            mute.click()
            after_label = mute.get_attribute('aria-label')
            check('🔊/🔇 토글이 바뀐다', before_label != after_label, f'{before_label} → {after_label}')
            mute.click()

            # 사용 완료 (부모 화면과 같은 버튼)
            page.locator('[data-testid="reward-modal-use"]').click()
            page.wait_for_selector('text=사용 완료', timeout=3000)
            check('사용 완료 버튼이 동작(저장 없음)',
                  '사용 완료' in page.locator('[data-testid="reward-modal"]').inner_text())
            page.screenshot(path=str(DOWNLOADS / f'{prefix}_used.png'))

            # ---------------------------------------------------- 3) 닫고 다시 뽑기
            page.locator('[data-testid="reward-modal-done"]').click()
            page.wait_for_selector('[data-testid="reward-modal"]', state='detached', timeout=3000)
            check('확인을 누르면 팝업이 닫힘', page.locator('[data-testid="reward-modal"]').count() == 0)
            check('버튼이 "다시 뽑아보기" 로 바뀜',
                  '다시 뽑아보기' in page.locator('[data-testid="demo-open"]').inner_text())
            history_rows = page.locator('[data-testid="demo-history-row"]').count()
            check('화면에 뽑은 기록 1건', history_rows == 1, str(history_rows))
            check('기록에 당첨 시간', f'+{win}분' in page.locator('[data-testid="demo-history"]').inner_text())
            page.screenshot(path=str(DOWNLOADS / f'{prefix}_closed.png'))

            page.locator('[data-testid="demo-open"]').click()
            page.wait_for_selector('[data-testid="reward-modal"]', timeout=4000)
            check('다시 뽑으면 고르기 화면부터', page.locator('[data-testid="reward-result"]').count() == 0
                  and page.locator('[data-testid^="reward-gift-"]').count() == 3)
            page.locator('[data-testid="reward-gift-2"]').click()
            page.wait_for_selector('[data-testid="reward-result"]', timeout=6000)
            second = minutes_of(page.locator('[data-testid="reward-win-minutes"]').inner_text())
            check('두 번째 뽑기도 당첨', second is not None,
                  page.locator('[data-testid="reward-win-minutes"]').inner_text())
            page.screenshot(path=str(DOWNLOADS / f'{prefix}_second.png'))
            page.locator('[data-testid="reward-modal-done"]').click()
            page.wait_for_selector('[data-testid="reward-modal"]', state='detached', timeout=3000)
            rows = page.locator('[data-testid="demo-history-row"]').count()
            check('기록이 2건으로 늘어남', rows == 2, str(rows))

            # ---------------------------------------------------- 4) 저장·요청 흔적 없음
            supabase_calls = [item for item in request_log if 'supabase' in item or '/rest/v1/' in item]
            rpc_calls = [item for item in request_log if '/rpc/' in item]
            check('Supabase 요청 0건', supabase_calls == [], str(supabase_calls)[:200])
            check('RPC 요청 0건', rpc_calls == [], str(rpc_calls)[:200])
            storage_keys = page.evaluate('Object.keys(window.localStorage)')
            leaked = [key for key in storage_keys
                      if str(key).startswith('study-check.') and not str(key).startswith('study-check.demo.')]
            check('실제 앱 설정·가족 데이터·뽑기 기록이 기기에 남지 않음',
                  leaked == [],
                  f'{leaked} (전체: {storage_keys})')
            check('JS 오류 0', page_errors == [], str(page_errors)[:300])
            check('콘솔 오류 0', console_errors == [], str(console_errors)[:300])

            context.close()
            browser.close()
    finally:
        if server is not None:
            try:
                os.killpg(os.getpgid(server.pid), 15)
            except Exception:
                server.kill()

    if live and before is not None:
        after = {'tasks': table_count('tasks'), 'family_tier_events': table_count('family_tier_events')}
        print(f'DB 확인 후: tasks={after["tasks"]} · family_tier_events={after["family_tier_events"]}', flush=True)
        check('DB: tasks 건수 그대로', after['tasks'] == before['tasks'], f'{before["tasks"]} → {after["tasks"]}')
        check('DB: family_tier_events 그대로',
              after['family_tier_events'] == before['family_tier_events'],
              f'{before["family_tier_events"]} → {after["family_tier_events"]}')

    print(f'\n{"=" * 60}\n{checks - len(failures)}/{checks} 통과 · 실패 {len(failures)}')
    for name in failures:
        print(f'  FAIL  {name}')
    return 1 if failures else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    raise SystemExit(run(args.live))
