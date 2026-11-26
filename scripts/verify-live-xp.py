"""⚖️ 완료 시점별 XP 차등 · 취소 회수 — 라이브(깃허브 페이지 + 실제 Supabase) 확인.

    python3 scripts/verify-live-xp.py

라이브 DB 는 **읽기만** 합니다(완료·되돌리기 같은 쓰기를 하지 않습니다).
 · 항목 카드의 XP 칩(+10 / +5 · 하루 지남 50% / +2.5 · 이틀 이상 25%)과 지난 날짜 안내를 봅니다.
 · 화면에 뜬 이번 달 XP 가, DB 를 같은 규칙(당일 100%·하루 50%·이틀+ 25%, 100% +20, 연속 +10)으로
   파이썬에서 다시 센 값과 같은지 비교합니다 — 배포된 번들이 새 규칙으로 도는지 확인하는 핵심 검사입니다.
 · 서비스 워커 캐시가 study-check-shell-v7 인지 확인합니다.
 · 확인 전/후 tasks·family_tier_events 행 수가 그대로인지 봅니다(DB 무변경).
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

URL = 'https://youngma2.github.io/study-check-app/'
DOWNLOADS = pathlib.Path('/workspace/downloads')
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date()

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


def rest(path: str) -> list[dict]:
    base, key = env_pair()
    request = urllib.request.Request(
        f'{base}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}'},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode())


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'Pragma': 'no-cache'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read().decode('utf-8', 'replace')


# ---------------------------------------------------------------- XP 계산 replica
def is_hidden(task: dict) -> bool:
    return '📞 통화' in task['title'] or '_call1' in task['id'] or '_call2' in task['id']


def kst_date(timestamp: str | None) -> date | None:
    if not timestamp:
        return None
    return datetime.fromisoformat(timestamp).astimezone(KST).date()


def item_xp(task: dict) -> tuple[float, int]:
    due = date.fromisoformat(task['due_date'])
    done = kst_date(task.get('verified_at')) or kst_date(task.get('updated_at')) or due
    delay = max(0, (done - due).days)
    percent = 100 if delay == 0 else 50 if delay == 1 else 25
    return round(10 * percent / 100, 1), delay


def month_xp(tasks: list[dict], member_id: str, today: date) -> float:
    days: dict[str, dict] = {}
    for task in tasks:
        if task['member_id'] != member_id or is_hidden(task):
            continue
        due = task['due_date']
        if due[:7] != today.isoformat()[:7] or due > today.isoformat():
            continue
        slot = days.setdefault(due, {'total': 0, 'verified': 0, 'itemXp': 0.0})
        slot['total'] += 1
        if task['status'] == 'verified':
            xp, _ = item_xp(task)
            slot['verified'] += 1
            slot['itemXp'] += xp

    xp = 0.0
    streak = 0
    cursor = date(today.year, today.month, 1)
    while cursor <= today:
        key = cursor.isoformat()
        slot = days.get(key, {'total': 0, 'verified': 0, 'itemXp': 0.0})
        all_clear = slot['total'] > 0 and slot['verified'] == slot['total']
        day_xp = slot['itemXp']
        if all_clear:
            day_xp += 20
        if cursor.weekday() < 5:  # 2026년 11월에는 공휴일이 없습니다
            if all_clear:
                streak += 1
                if streak >= 3:
                    day_xp += 10
            elif slot['total'] > 0 and key != today.isoformat():
                streak = 0
        xp += day_xp
        cursor += timedelta(days=1)
    return round(xp, 1)


def format_xp(value: float) -> str:
    rounded = round(value, 1)
    return str(int(rounded)) if rounded == int(rounded) else f'{rounded:.1f}'


def text_of(page, selector: str) -> str:
    locator = page.locator(selector)
    return locator.first.inner_text().strip() if locator.count() else ''


def run() -> int:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    tasks_before = rest('tasks?select=id,member_id,due_date,status,title,verified_at,updated_at')
    events_before = rest('family_tier_events?select=id')
    check('라이브 DB 읽기 (tasks 497 근처)', len(tasks_before) >= 400, str(len(tasks_before)))

    sw = fetch_text(f'{URL}sw.js?verify={int(datetime.now().timestamp())}')
    check('서비스 워커 캐시 = study-check-shell-v7', "study-check-shell-v7" in sw,
          (re.search(r"study-check-shell-v\d+", sw) or ['없음'])[0])

    js_errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
            env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
        )
        context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        page = context.new_page()
        page.on('pageerror', lambda error: js_errors.append(str(error)))

        # ------------------------------------------------ 1) 예원(첫째) 오늘 화면
        page.goto(f'{URL}#as=mem_child1', wait_until='networkidle')
        page.wait_for_selector('[data-testid="season-bar"]', timeout=30000)

        expected1 = month_xp(tasks_before, 'mem_child1', TODAY)
        shown1 = text_of(page, '[data-testid="tier-xp-mem_child1"]')
        check('예원 이번 달 XP = DB 재계산 값', shown1 == f'{format_xp(expected1)} XP',
              f'화면 {shown1} / 계산 {format_xp(expected1)} XP')
        check('XP 안내(⚖️ 완료 XP)가 라이브에 있다', page.locator('[data-testid="xp-rule-mem_child1"]').count() == 1)
        rule = text_of(page, '[data-testid="xp-rule-mem_child1"]').replace('\n', ' ')
        check('안내 문구: 당일 100% · 하루 지남 50% · 2일+ 25% · 회수',
              all(piece in rule for piece in ['당일 100%', '하루 지남 50%', '2일+ 25%', '회수']), rule)

        # 오늘 항목 카드 — 전화 항목을 뺀 카드마다 XP 칩
        cards = page.locator('[data-testid="task-card"]')
        chips = page.locator('[data-testid="task-xp"]')
        check('오늘 항목 카드마다 XP 칩', cards.count() > 0 and chips.count() == cards.count(),
              f'카드 {cards.count()} · 칩 {chips.count()}')
        check('오늘 칩은 +10 XP (당일 100%)', chips.first.inner_text().strip() == '+10 XP', chips.first.inner_text().strip())
        page.screenshot(path=str(DOWNLOADS / 'study_xp_live_child1.png'))

        # ------------------------------------------------ 2) 찬율(둘째) 어제 화면 — 50%
        # 해시만 바뀌면 앱이 다시 읽지 않으므로 새로고침해서 역할·날짜를 바꿉니다.
        page.goto(f'{URL}#as=mem_child2', wait_until='networkidle')
        page.reload(wait_until='networkidle')
        page.wait_for_selector('[data-testid="tier-panel-mem_child2"]', timeout=30000)
        expected2 = month_xp(tasks_before, 'mem_child2', TODAY)
        shown2 = text_of(page, '[data-testid="tier-xp-mem_child2"]')
        check('찬율 이번 달 XP = DB 재계산 값', shown2 == f'{format_xp(expected2)} XP',
              f'화면 {shown2} / 계산 {format_xp(expected2)} XP')

        yesterday = TODAY - timedelta(days=1)
        page.goto(f'{URL}#as=mem_child2&d={yesterday.isoformat()}', wait_until='networkidle')
        page.reload(wait_until='networkidle')
        page.wait_for_selector('[data-testid="task-card"]', timeout=30000)

        yesterday_tasks = [t for t in tasks_before if t['member_id'] == 'mem_child2'
                           and t['due_date'] == yesterday.isoformat() and not is_hidden(t)]
        open_today = [t for t in yesterday_tasks if t['status'] != 'verified']
        check('어제 화면에 지난 날짜 안내 (XP 50%)', 'XP 50%' in text_of(page, '[data-testid="day-xp-notice"]'),
              text_of(page, '[data-testid="day-xp-notice"]'))
        if open_today:
            card = page.locator('[data-testid="task-card"]', has_text=open_today[0]['title']).first
            chip = card.locator('[data-testid="task-xp"]').first.inner_text().strip()
            check('어제 남은 항목 칩 = +5 XP · 하루 지남 50%', chip == '+5 XP\n· 하루 지남 50%' or '+5 XP' in chip and '50%' in chip, chip)
        else:
            check('어제 남은 항목 칩 (어제 항목이 모두 완료라 건너뜀)', True)
        # 어제 항목마다 칩이 DB 상태와 맞는지 (완료=+10 XP / 남음=+5 XP · 50%)
        seen: set[str] = set()
        mismatched: list[str] = []
        for task in yesterday_tasks:
            if task['title'] in seen:
                continue
            seen.add(task['title'])
            card = page.locator('[data-testid="task-card"]').filter(
                has=page.locator(f'p[title="{task["title"]}"]')
            ).first
            if card.count() == 0:
                mismatched.append(f"{task['title']}: 카드 없음")
                continue
            chip = card.locator('[data-testid="task-xp"]').first
            label = chip.inner_text().strip() if chip.count() else '칩 없음'
            if task['status'] == 'verified':
                ok = label == '+10 XP'
            else:
                ok = '+5 XP' in label and '50%' in label
            if not ok:
                mismatched.append(f"{task['title']}({task['status']}): {label.replace(chr(10), ' ')}")
        check('어제 항목 칩이 DB 상태와 맞다 (완료 +10 / 남음 +5·50%)', not mismatched, ' / '.join(mismatched[:4]))
        page.locator('[data-testid="day-xp-notice"]').screenshot(path=str(DOWNLOADS / 'study_xp_live_notice.png'))
        page.screenshot(path=str(DOWNLOADS / 'study_xp_live_child2_yesterday.png'))

        # ------------------------------------------------ 3) 그제 화면 — 25%
        two_ago = TODAY - timedelta(days=2)
        page.goto(f'{URL}#as=mem_child2&d={two_ago.isoformat()}', wait_until='networkidle')
        page.reload(wait_until='networkidle')
        page.wait_for_selector('[data-testid="task-card"]', timeout=30000)
        notice25 = text_of(page, '[data-testid="day-xp-notice"]')
        check('그제 화면 안내 (XP 25%)', 'XP 25%' in notice25 and '이틀 이상' in notice25, notice25)

        check('JS 오류 없음', not js_errors, ' / '.join(js_errors[:3]))
        browser.close()

    tasks_after = rest('tasks?select=id,member_id,due_date,status,title,verified_at,updated_at')
    events_after = rest('family_tier_events?select=id')
    check('DB 무변경 — tasks 행 수 그대로', len(tasks_after) == len(tasks_before), f'{len(tasks_before)} → {len(tasks_after)}')
    check('DB 무변경 — family_tier_events 그대로', len(events_after) == len(events_before),
          f'{len(events_before)} → {len(events_after)}')
    check('DB 무변경 — 완료 상태 그대로', [t['status'] for t in tasks_after] == [t['status'] for t in tasks_before])

    print(f"\n{checks - len(failures)}/{checks} 통과")
    if failures:
        print('실패:', ', '.join(failures))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
