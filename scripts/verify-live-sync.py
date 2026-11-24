"""라이브 실시간 동기화 검증 — 폰 두 대 대신 브라우저 컨텍스트 두 개.

  · 부모(#as=mem_dad)가 둘째 숙제를 추가  → 둘째(#as=mem_child2) 화면에 새로고침 없이 나타남
  · 둘째가 '완료 요청'                    → 부모 화면에 즉시 '확인 대기'
  · 부모가 '확인 완료'                    → 둘째 화면에 즉시 '부모 확인 완료'
  · 부모가 삭제                           → 둘째 화면에서 즉시 사라짐
  · 끝나면 테스트 항목은 지우고, 원래 숙제 수(39)로 돌아왔는지 확인

사용법: python3 scripts/verify-live-sync.py [url]
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

URL = (sys.argv[1] if len(sys.argv) > 1 else 'https://youngma2.github.io/study-check-app/').rstrip('/') + '/'
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
SUPABASE = 'https://trhcatbuoslyjdhezobz.supabase.co'
KEY = 'sb_publishable_fPzIYHLYLbVmsPB6tLaUNw_z6sAnxbj'
STAMP = datetime.now(ZoneInfo('Asia/Seoul')).strftime('%H:%M:%S')
TITLE = f'동기화 테스트 {STAMP}'

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)
    if not cond:
        failures.append(name)


def rest(path: str):
    req = urllib.request.Request(f'{SUPABASE}/rest/v1/{path}', headers={'apikey': KEY})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode())


def wait_until(fn, timeout: float = 15.0, interval: float = 0.4) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False


def open_page(browser, env, member_id: str, shot: str):
    ctx = browser.new_context(
        viewport={'width': 390, 'height': 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        locale='ko-KR',
        timezone_id='Asia/Seoul',
    )
    page = ctx.new_page()
    errors: list[str] = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL + f'#as={member_id}', wait_until='networkidle')
    page.wait_for_timeout(1500)
    return ctx, page, errors


def card(page, title: str):
    return page.locator('[data-testid="task-card"]').filter(has_text=title)


def card_status(page, title: str) -> str:
    loc = card(page, title)
    if loc.count() == 0:
        return ''
    return loc.first.inner_text().replace('\n', ' ')


def open_profile(page) -> str:
    page.click('[data-testid="open-profile"]')
    page.wait_for_timeout(300)
    text = page.locator('[role="dialog"]').inner_text()
    page.keyboard.press('Escape')
    page.wait_for_timeout(250)
    return text.replace('\n', ' ')


def main() -> int:
    env = os.environ.copy()
    env['LD_LIBRARY_PATH'] = CHROME_LIBS + os.pathsep + env.get('LD_LIBRARY_PATH', '')

    before = len(rest('tasks?select=id'))
    print(f'시작 시 숙제 수: {before}')
    check('시드 숙제가 들어 있음', before >= 30, f'n={before}')

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, env=env,
                                    args=['--no-sandbox', '--disable-dev-shm-usage'])
        ctx_dad, dad, dad_err = open_page(browser, env, 'mem_dad', 'dad')
        ctx_child, child, child_err = open_page(browser, env, 'mem_child2', 'child')

        dad_state = open_profile(dad)
        child_state = open_profile(child)
        print('부모 상태:', dad_state[:110])
        print('아이 상태:', child_state[:110])
        check('부모: 가족 실시간 동기화', '가족과 실시간 동기화 중' in dad_state)
        check('부모: 실시간 연결됨', '실시간 연결됨' in dad_state, dad_state[-60:])
        check('아이: 가족 실시간 동기화', '가족과 실시간 동기화 중' in child_state)
        check('아이: 실시간 연결됨', '실시간 연결됨' in child_state)
        check('아이 시점(둘째)', '둘째' in dad.inner_text('body') and '내 공부 추가' in child.inner_text('body'))

        # 1) 부모가 둘째 숙제 추가
        dad.click('[data-testid="open-add"]')
        dad.wait_for_timeout(400)
        dialog = dad.locator('[role="dialog"]')
        dialog.locator('button', has_text='둘째').first.click()
        dialog.locator('input[placeholder*="수학 문제집"]').fill(TITLE)
        dad.click('[data-testid="save-task"]')
        dad.wait_for_timeout(1200)
        check('부모 화면에 추가됨', card(dad, TITLE).count() == 1, card_status(dad, TITLE))

        got = wait_until(lambda: card(child, TITLE).count() == 1, 15)
        check('② 아이 화면에 실시간 등장(새로고침 없음)', got, card_status(child, TITLE))

        # 2) 아이가 완료 요청
        child_card = card(child, TITLE).first
        child_card.locator('[data-testid="request-task"]').click()
        child.wait_for_timeout(800)
        check('아이 화면: 확인 대기로 바뀜', '확인 대기' in card_status(child, TITLE), card_status(child, TITLE))

        got = wait_until(lambda: '확인 대기' in card_status(dad, TITLE), 15)
        check('③ 부모 화면에 실시간 완료 요청', got, card_status(dad, TITLE))

        # 3) 부모가 확인 완료
        card(dad, TITLE).first.locator('[data-testid="verify-task"]').click()
        dad.wait_for_timeout(800)
        got = wait_until(lambda: '부모 확인 완료' in card_status(child, TITLE), 15)
        check('④ 아이 화면에 실시간 확인 완료', got, card_status(child, TITLE))

        # 4) 부모가 삭제
        dad.once('dialog', lambda d: d.accept())
        card(dad, TITLE).first.locator('[data-testid="delete-task"]').click()
        dad.wait_for_timeout(900)
        check('부모 화면에서 삭제됨', card(dad, TITLE).count() == 0)
        got = wait_until(lambda: card(child, TITLE).count() == 0, 15)
        check('⑤ 아이 화면에서도 실시간 삭제', got)

        check('브라우저 오류 없음(부모)', not dad_err, '; '.join(dad_err[:2]))
        check('브라우저 오류 없음(아이)', not child_err, '; '.join(child_err[:2]))

        # 스크린샷(보고용)
        os.makedirs('/workspace/downloads', exist_ok=True)
        dad.goto(URL + '#as=mem_dad', wait_until='networkidle')
        dad.wait_for_timeout(1200)
        dad.screenshot(path='/workspace/downloads/study_app_sync_dad.png', animations='disabled')
        child.goto(URL + '#as=mem_child2', wait_until='networkidle')
        child.wait_for_timeout(1200)
        child.screenshot(path='/workspace/downloads/study_app_sync_child.png', animations='disabled')

        ctx_dad.close()
        ctx_child.close()
        browser.close()

    time.sleep(2)
    rows = rest(f'tasks?select=id,title&title=eq.{urllib.parse.quote(TITLE)}')
    total = len(rest('tasks?select=id'))
    check('테스트 항목이 DB에서 정리됨', rows == [], json.dumps(rows, ensure_ascii=False)[:120])
    check('숙제 수 원복', total == before, f'{before} -> {total}')

    print()
    if failures:
        print(f'실패 {len(failures)}건: ' + ', '.join(failures))
        return 1
    print('모두 통과 — 실시간 동기화 확인 완료')
    return 0


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (title 인코딩용)

    raise SystemExit(main())
