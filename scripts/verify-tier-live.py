"""🏆 라이브(깃허브 페이지 + 실제 Supabase) 확인 — 티어·연속 100%·🎁 뽑기 상자·부모 PIN 화면.

    python3 scripts/verify-tier-live.py

· live DB(family_tier_events)에 검증용 승급 1건이 있어야 상자가 보입니다:
    select public.study_tier_promotion('mem_dad','mem_child2','2026-11',3,false);
  (확인 뒤에는 지웁니다 — 스크립트는 DB 를 건드리지 않습니다)
"""
from __future__ import annotations

import os
import pathlib
import sys

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


def main() -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )

        # ---------------------------------------------------- 아이 화면 (찬율)
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        page = ctx.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.on('console', lambda msg: errors.append(f'console.{msg.type}: {msg.text}') if msg.type == 'error' else None)

        page.goto(f'{URL}#as=mem_child2', wait_until='networkidle')
        page.wait_for_selector('[data-testid="season-bar"]', timeout=25000)
        page.wait_for_selector('[data-testid="tier-panel-mem_child2"]', timeout=25000)

        bar = page.locator('[data-testid="season-bar"]').inner_text().replace('\n', ' ')
        tier_names = ['브론즈', '실버', '골드', '플래티넘', '다이아', '마스터']
        check('라이브: 상단 시즌 바(티어·XP)', any(name in bar for name in tier_names) and 'XP' in bar, bar)
        check(
            '라이브: 이름 옆 티어 엠블럼(SVG)',
            page.locator('[data-testid="day-stat-mem_child2"] svg[data-tier]').count() >= 1,
            page.locator('[data-testid="day-stat-mem_child2"] svg[data-tier]').first.get_attribute('data-tier')
            if page.locator('[data-testid="day-stat-mem_child2"] svg[data-tier]').count()
            else 'none',
        )
        panel = page.locator('[data-testid="tier-panel-mem_child2"]')
        check('라이브: 티어 패널', panel.count() == 1)

        # live DB에 검증용 승급 1건(실버 III)이 있으면 상자가 보입니다 → 클라우드에서 읽어 왔다는 증거
        boxes = page.locator('[data-testid^="reward-box-"]')
        if boxes.count() > 0:
            check('라이브: Supabase 승급 기록을 읽어 🎁 상자 표시', '실버 III' in panel.inner_text(), panel.inner_text().replace('\n', ' ')[:120])
            page.screenshot(path=str(DOWNLOADS / 'study_tier_live_child.png'))
            if page.locator('[data-testid^="reward-open-"]').count() > 0:
                page.locator('[data-testid^="reward-open-"]').first.click()
                page.wait_for_selector('[data-testid^="reward-box-"]:has-text("게임 시간")', timeout=8000)
            check('라이브: 상자를 눌러 열면 보상이 나온다', '게임 시간' in boxes.first.inner_text(), boxes.first.inner_text().replace('\n', ' / '))
            page.screenshot(path=str(DOWNLOADS / 'study_tier_live_box.png'))
        else:
            check('라이브: 승급 기록 없음(빈 상태 안내)', '큰 티어' in panel.inner_text(), panel.inner_text().replace('\n', ' ')[:120])
            page.screenshot(path=str(DOWNLOADS / 'study_tier_live_child.png'))

        check('라이브: JS 오류 0', not errors, str(errors[:3]))
        check(
            '라이브: 서비스 워커 등록(셸 캐시 v4)',
            page.evaluate("async () => (await navigator.serviceWorker.getRegistrations()).length > 0"),
        )

        ctx.close()

        # ---------------------------------------------------- 부모 PIN 화면 (새 탭 = 새로 열기)
        ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        ppage = ctx2.new_page()
        ppage.goto(f'{URL}#as=mem_dad', wait_until='networkidle')
        ppage.wait_for_selector('[data-testid="parent-pin-gate"]', timeout=25000)
        check('라이브: 부모 시점은 PIN 화면부터', ppage.locator('[data-testid="parent-pin-gate"]').count() == 1)
        check('라이브: 키패드 숫자 0~9 + 지우기', ppage.locator('[data-testid^="pin-key-"]').count() == 11)
        ppage.screenshot(path=str(DOWNLOADS / 'study_tier_live_pin.png'))
        ctx2.close()

        browser.close()

    print(f'\n검사 {checks}개 · 실패: {failures if failures else "없음"}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
