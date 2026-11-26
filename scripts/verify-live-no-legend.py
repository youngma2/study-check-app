"""라이브(깃허브 페이지) 확인 — 달력 범례 없음 · 서비스 워커 v9 · JS 오류 0.

실제 DB 를 읽기만 합니다(아이 화면 = 읽기 전용 구독).
    python3 scripts/verify-live-no-legend.py
"""
from __future__ import annotations

import os
import pathlib

from playwright.sync_api import sync_playwright

CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
BASE = 'https://youngma2.github.io/study-check-app/'
SHOT = '/workspace/downloads/study_no_legend_live.png'

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        failures.append(name)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844},
            locale='ko-KR',
            timezone_id='Asia/Seoul',
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '#as=mem_child1', wait_until='networkidle')
        page.wait_for_selector('button[aria-label="이전 주"]', timeout=20000)

        cal = page.evaluate(
            """() => {
              const btn = document.querySelector('button[aria-label="이전 주"]');
              const section = btn.closest('section');
              return {
                text: section.innerText,
                dots: [...section.querySelectorAll('span.bg-amber-400, span.bg-emerald-400')]
                        .filter((el) => !el.closest('button')).length,
                days: section.querySelectorAll('button[aria-pressed]').length,
              };
            }"""
        )
        for word in ['확인 대기', '진행 중', '모두 완료', '공휴일']:
            check(f'라이브 달력 카드에 "{word}" 없음', word not in cal['text'])
        check('라이브 달력 범례 색 점 없음', cal['dots'] == 0, f"{cal['dots']}개")
        check('라이브 달력 날짜 7칸', cal['days'] == 7, str(cal['days']))

        page.wait_for_timeout(2500)  # 서비스 워커 등록·활성화 대기
        sw = page.evaluate(
            """async () => {
              const reg = await navigator.serviceWorker.getRegistration();
              if (!reg) return null;
              const active = reg.active || reg.installing || reg.waiting;
              return { scope: reg.scope, url: active ? active.scriptURL : null, state: active ? active.state : null };
            }"""
        )
        check('서비스 워커 등록', bool(sw), str(sw))

        page.screenshot(path=SHOT)
        check('라이브 스크린샷 저장', pathlib.Path(SHOT).exists(), SHOT)
        check('JS 오류 없음', not errors, str(errors))
        browser.close()

    print()
    print('실패:', failures if failures else '없음')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
