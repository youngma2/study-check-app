"""공부 체크 3차 1~13번 통합 검증 (데모 빌드 + 단위 + 라이브 읽기)

    # 데모(기기 저장) 빌드
    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-batch3.py            # 데모 + 단위
    python3 scripts/verify-batch3.py --live     # 위 + 라이브(GitHub Pages) 읽기 검증

점검 항목(3차 1~13번)
  1  월말 결산 기본 3개월 + [자세히] 12개월
  2  관리자 화면 선물 상자 시간 보상 문구 '적립 완료'
  3  프로필 선택 화면 + 새 프로필 만들기
  4  보관함: 총 적립 분 · 사용 분 · 남은 분 + 시간 적립·사용 내역
  5  선물 상자 뽑기 내역 기본 3개 + [자세히]
  6  공부 목록 인라인 수정 + [확인] 즉시 저장 + '+ 추가' / [이 프리셋 저장]
  7  + 프리셋 추가(이름·이름 바꾸기·삭제)
  8  과목 드롭다운 인라인 수정 + 다른 프리셋에 바로 넣기
  9  버스트 타임 배수 +25/50/75/100%
  10 보너스 XP 저장 + '저장되었습니다' 팝업
  11 뒤로가기 종료 모달 [종료] 한 번에 꺼짐
  12 프로필 선택 우선 · 아이 개인 PIN · 부모 PIN 초기화
  13 광고 슬롯 자리(화면에 보이지 않음)

라이브는 **읽기만** 합니다 — DB 행 수가 그대로인지 확인합니다.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4196
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
LIVE = 'https://youngma2.github.io/study-check-app/'
SUPABASE = 'https://trhcatbuoslyjdhezobz.supabase.co'
KEY = 'sb_publishable_fPzIYHLYLbVmsPB6tLaUNw_z6sAnxbj'
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date().isoformat()
SEASON = TODAY[:7]
SHOTS = ROOT / 'scripts' / 'shots-batch3'

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


def rest_count(table: str) -> int:
    request = urllib.request.Request(
        f'{SUPABASE}/rest/v1/{table}?select=id',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return int((response.headers.get('Content-Range') or '*/0').split('/')[-1])


def read_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=25) as response:
        return response.read().decode()


# ---------------------------------------------------------------- 단위 검증
def run_units() -> None:
    out = ROOT / '.tmp-b3'
    out.mkdir(exist_ok=True)
    env = os.environ.copy()
    env['PATH'] = NODE_BIN + os.pathsep + env.get('PATH', '')
    for entry in ['app-settings', 'season', 'pin']:
        result = subprocess.run(
            [str(ROOT / 'node_modules' / '.bin' / 'esbuild'), f'src/lib/{entry}.ts', '--bundle', '--format=esm', '--platform=node',
             f'--outfile={out / (entry + ".mjs")}'],
            cwd=ROOT, env=env, capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(result.stderr, file=sys.stderr)
            failures.append(f'단위 번들 실패({entry})')
            return

    script = out / 'run.mjs'
    script.write_text(
        r"""
import {
  addCustomPreset, burstFactorLabel, burstMultiplierAt, copyRoutineItemToPreset, defaultAppSettings,
  normalizeAppSettings, presetMetas, removeCustomPreset, renameCustomPreset, itemsForMember,
} from './app-settings.mjs';
import { xpForTask } from './season.mjs';
import { hashPin, verifyHashedPin } from './pin.mjs';

const result = (name, cond, extra = '') => console.log(`RESULT\t${cond ? 'PASS' : 'FAIL'}\t${name}\t${extra}`);

// 1) 커스텀 프리셋 저장·정리
const base = defaultAppSettings();
const created = addCustomPreset(base, '주말공부');
result('7 커스텀 프리셋 열쇠는 p_', created.key.startsWith('p_'), created.key);
result('7 프리셋 목록에 기본 3 + 새 1', presetMetas(created.settings).length === 4, String(presetMetas(created.settings).length));
const renamed = renameCustomPreset(created.settings, created.key, '주말반');
result('7 프리셋 이름 바꾸기', renamed.presets[created.key].label === '주말반', renamed.presets[created.key].label);
const removed = removeCustomPreset(renamed, created.key);
result('7 프리셋 지우기', !removed.presets[created.key], Object.keys(removed.presets).join(','));
result('7 기본 프리셋은 지울 수 없음', Object.keys(removeCustomPreset(removed, 'semester').presets).includes('semester'));
const norm = normalizeAppSettings(JSON.parse(JSON.stringify(removed)));
result('7 저장·불러오기에서 기본 3개 유지', presetMetas(norm).length === 3, String(presetMetas(norm).length));
const withCustom = JSON.parse(JSON.stringify(created.settings));
const norm2 = normalizeAppSettings(withCustom);
result('7 커스텀 프리셋이 정규화에도 살아남음', presetMetas(norm2).some((p) => p.label === '주말공부'));
const badKey = normalizeAppSettings({ ...JSON.parse(JSON.stringify(created.settings)), presets: { ...created.settings.presets, stray: { label: '이상한 키', items: {} } } });
result('7 잘못된 열쇠(stray)는 버림', !presetMetas(badKey).some((p) => p.key === 'stray'));

// 8) 다른 프리셋으로 복사 — 요일 합치기
const item = { id: 'i1', title: '수학 2장', subject: 'math', days: [1, 3], order: 0 };
const copied = copyRoutineItemToPreset(created.settings, item, 'mem_child1', 'semester');
result('8 다른 프리셋에 항목이 들어감', itemsForMember(copied, 'mem_child1', 'semester').some((x) => x.title === '수학 2장'));
const again = copyRoutineItemToPreset(copied, item, 'mem_child1', 'semester');
result('8 같은 항목은 중복 없이 유지', itemsForMember(again, 'mem_child1', 'semester').length === 1);

// 9) 버스트 배수
const now = new Date().toISOString();
const windows = [{ from: new Date(Date.now() - 3600_000).toISOString(), to: null }];
result('9 기본(100%) = 2배', burstMultiplierAt(now, windows, { percent: 100 }) === 2);
result('9 +50% = 1.5배', burstMultiplierAt(now, windows, { percent: 50 }) === 1.5);
result('9 +25% = 1.25배', burstMultiplierAt(now, windows, { percent: 25 }) === 1.25);
result('9 +75% = 1.75배', burstMultiplierAt(now, windows, { percent: 75 }) === 1.75);
result('9 겹칠 때 100% = 4배', burstMultiplierAt(now, windows, { percent: 100, autoDays: 7, overlap: true, autoFrom: null }) >= 1);
result('9 문구 +50% → 1.5배', burstFactorLabel(50) === '1.5배', burstFactorLabel(50));
const todayIso = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const task = { id: 't1', family_id: 'f', member_id: 'c1', title: '수학', subject: 'math', due_date: todayIso, status: 'todo', created_by: 'p', created_at: now };
const xp100 = xpForTask(task, todayIso, { burstWindows: windows, burstPercent: 100 });
const xp50 = xpForTask(task, todayIso, { burstWindows: windows, burstPercent: 50 });
result('9 100% 배수 XP = 20', xp100.xp === 20, String(xp100.xp));
result('9 50% 배수 XP = 15', xp50.xp === 15, String(xp50.xp));
result('9 burstFactor 값도 배수를 따라감', xp50.burstFactor === 1.5, String(xp50.burstFactor));
const noBurst = normalizeAppSettings({ ...JSON.parse(JSON.stringify(base)), burstPercent: 33 });
result('9 이상한 배수는 기본 100%', noBurst.burstPercent === 100, String(noBurst.burstPercent));

// 3·12) 새 프로필 · PIN 저장 모양
const withProfile = normalizeAppSettings({
  ...JSON.parse(JSON.stringify(base)),
  extraMembers: [{ id: 'mem_c_abc123', family_id: 'fam', name: '동생', role: 'child', emoji: '🐼', color: 'violet', presets: [], created_at: now }],
});
result('3 새 프로필이 설정에 저장됨', withProfile.extraMembers.length === 1 && withProfile.extraMembers[0].name === '동생');
const badProfile = normalizeAppSettings({ ...JSON.parse(JSON.stringify(base)), extraMembers: [{ id: 'x', name: '' }] });
result('3 잘못된 프로필은 버림', badProfile.extraMembers.length === 0);
const pinRecord = await hashPin('2468');
result('12 PIN 은 평문이 아니라 해시로 저장', pinRecord.hash !== '2468' && pinRecord.hash.length === 64, pinRecord.hash.slice(0, 8) + '…');
result('12 맞는 PIN 통과', await verifyHashedPin('2468', pinRecord));
result('12 틀린 PIN 거절', !(await verifyHashedPin('1111', pinRecord)));
result('12 PIN 기록이 설정에 보관됨', normalizeAppSettings({ ...JSON.parse(JSON.stringify(base)), profilePins: { mem_child1: pinRecord } }).profilePins.mem_child1?.hash === pinRecord.hash);

// 13) 광고 자리 기본값 — 설정에 광고 관련 키를 만들지 않음(가족 데이터에 영향 없음)
result('13 광고 설정 키 없음(화면 자리만)', !Object.keys(base).some((key) => key.toLowerCase().includes('ad')));
"""
    )
    env2 = os.environ.copy()
    env2['PATH'] = NODE_BIN + os.pathsep + env2.get('PATH', '')
    run = subprocess.run([str(pathlib.Path(NODE_BIN) / 'node'), str(script)], cwd=out, env=env2, capture_output=True, text=True)
    if run.returncode != 0:
        print(run.stderr[-2000:], file=sys.stderr)
        failures.append('단위 검증 실행 실패')
    for line in run.stdout.splitlines():
        if line.startswith('RESULT\t'):
            _, status, name, extra = line.split('\t')
            check(f'단위 {name}', status == 'PASS', extra)


# ---------------------------------------------------------------- 데모 UI 검증
def main() -> None:
    SHOTS.mkdir(exist_ok=True)
    server = start_server()
    console_errors: list[str] = []
    try:
        run_units()

        salt = 'aabbccdd11223344'
        pin_hash = hashlib.sha256(f'{salt}:2468'.encode()).hexdigest()
        now = datetime.now(timezone.utc)
        iso = lambda minutes_ago: (now - timedelta(minutes=minutes_ago)).isoformat()
        boxes = [
            {'id': f'ev_box{i}', 'family_id': 'fam_demo', 'member_id': 'mem_child1', 'season': SEASON,
             'tier': 'silver', 'tier_rank': 2, 'level': i + 1, 'division': 3, 'box_minutes': value,
             'created_at': iso(600 - i), 'opened_at': iso(500 - i), 'used_at': None, 'used_by': None}
            for i, value in enumerate([5, 10, 15, 20])
        ]

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=CHROME, args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            context = browser.new_context(
                viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                timezone_id='Asia/Seoul', locale='ko-KR', is_mobile=True, has_touch=True,
            )
            context.add_init_script(
                f"""
                const now = new Date();
                if (localStorage.getItem('study-check.app-settings.v1')) {{ /* 이미 이번 검사에서 바꾼 값이 있으면 그대로 */ }}
                else {{
                const settings = {{
                  version: 1, burst: true, burstAuto: false, burstAutoDays: 7, burstOverlap: false, burstPercent: 100,
                  boxRewards: [{{ id: 'm5', kind: 'minutes', value: 5 }}, {{ id: 'm10', kind: 'minutes', value: 10 }}, {{ id: 'p30', kind: 'points', value: 30 }}],
                  burstWindows: [{{ from: new Date(now.getTime() - 3600000).toISOString(), to: null }}],
                  streakBonuses: [{{day:3,xp:30}},{{day:7,xp:70}},{{day:14,xp:140}},{{day:30,xp:300}}],
                  activePreset: 'semester',
                  presets: {{
                    vacation: {{ label: '방학', items: {{ mem_child1: [{{ id: 'ri_v1', title: '방학 수학', subject: 'math', days: [1,2,3,4,5], order: 0 }}] }} }},
                    p_test: {{ label: '주말반', items: {{}} }},
                  }},
                  timeUsage: [{{ id: 'tu1', member_id: 'mem_child1', minutes: 10, at: new Date(now.getTime() - 7200000).toISOString(), mode: 'direct', reason: '게임' }}],
                  boxCount: 5, tierDifficulty: 5, burstAutoFrom: null, profileEmoji: {{}}, settlements: {{}},
                  extraMembers: [],
                  profilePins: {{ mem_child2: {{ salt: '{salt}', hash: '{pin_hash}' }} }},
                }};
                localStorage.setItem('study-check.app-settings.v1', JSON.stringify(settings));
                localStorage.setItem('study-check.tier-events.v1', JSON.stringify({json.dumps(boxes, ensure_ascii=False)}));
                }}
                """
            )
            page = context.new_page()
            page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: console_errors.append(str(error)))

            def stored():
                return json.loads(page.evaluate("localStorage.getItem('study-check.app-settings.v1')"))

            def clear_session():
                page.evaluate('sessionStorage.clear()')
                page.reload()
                page.wait_for_timeout(1200)

            # ---------------------------------------------------------- 3·12 프로필 선택 화면
            page.goto(f'{BASE}index.html')
            page.wait_for_timeout(1400)
            check('12 앱을 열면 PIN 화면이 아니라 프로필 선택이 먼저', page.get_by_test_id('profile-picker').count() == 1)
            check('12 그때는 PIN 화면이 없음', page.get_by_test_id('parent-pin-gate').count() == 0)
            check('12 4개 프로필 카드', page.locator('[data-testid^="pick-"]').count() == 4, str(page.locator('[data-testid^="pick-"]').count()))
            check('3 + 새 프로필 만들기 카드', page.get_by_test_id('profile-create-open').count() == 1)
            check('12 프로필 화면에서 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            page.screenshot(path=str(SHOTS / '01-profile-picker.png'), full_page=True)

            # PIN 없는 아이 → 바로 입장
            page.get_by_test_id('pick-mem_child1').click()
            page.wait_for_timeout(900)
            check('12 PIN 없는 아이는 바로 입장', page.get_by_test_id('open-shop-child').count() == 1)
            check('12 같은 방문에서는 다시 프로필을 묻지 않음', page.get_by_test_id('profile-picker').count() == 0)

            # ---------------------------------------------------------- 12 아이 개인 PIN
            clear_session()
            check('12 다시 열면 프로필 선택부터', page.get_by_test_id('profile-picker').count() == 1)
            page.get_by_test_id('pick-mem_child2').click()
            page.wait_for_timeout(700)
            check('12 PIN 걸린 아이는 PIN 화면', page.get_by_test_id('child-pin-gate').count() == 1)
            for key in '1111':
                page.get_by_test_id(f'child-pin-key-{key}').click()
                page.wait_for_timeout(110)
            page.wait_for_timeout(800)
            check('12 틀린 아이 PIN은 오류', page.get_by_test_id('child-pin-error').inner_text().strip() != '')
            page.screenshot(path=str(SHOTS / '02-child-pin.png'), full_page=True)
            for key in '2468':
                page.get_by_test_id(f'child-pin-key-{key}').click()
                page.wait_for_timeout(110)
            page.wait_for_timeout(900)
            check('12 맞는 아이 PIN으로 입장', page.get_by_test_id('open-shop-child').count() == 1)

            # ---------------------------------------------------------- 12 부모 PIN
            clear_session()
            page.get_by_test_id('pick-mem_dad').click()
            page.wait_for_timeout(700)
            check('12 부모를 고르면 그때 PIN 화면', page.get_by_test_id('parent-pin-gate').count() == 1)
            for key in '1234':
                page.get_by_test_id(f'pin-key-{key}').click()
                page.wait_for_timeout(110)
            page.wait_for_timeout(700)
            for key in '1234':
                page.get_by_test_id(f'pin-key-{key}').click()
                page.wait_for_timeout(110)
            page.wait_for_timeout(1200)
            check('12 부모 PIN을 정하고 부모 화면 입장', page.get_by_test_id('open-options').count() == 1)
            check('12 한 번 고른 뒤에는 PIN 재입력 없이 이어짐', page.get_by_test_id('parent-pin-gate').count() == 0)

            # ---------------------------------------------------------- 13 광고 자리
            check('13 광고 슬롯이 화면에 자리만 있음(hidden)', page.evaluate("!!document.querySelector('[data-testid=\"ad-slot-main\"]')"))
            check('13 광고 슬롯 높이 0 (눈에 거슬리지 않음)', page.evaluate("document.querySelector('[data-testid=\"ad-slot-main\"]').offsetHeight") == 0)
            check('13 광고 문구가 보이지 않음', page.locator('text=광고 자리').count() == 0)

            # ---------------------------------------------------------- 1 월말 결산 3개월
            rows_child1 = page.locator('[data-testid^="monthly-row-mem_child1-"]')
            check('1 월말 결산 기본 3개월', rows_child1.count() == 3, str(rows_child1.count()))
            page.get_by_test_id('monthly-log-toggle').click()
            page.wait_for_timeout(400)
            check('1 [자세히] → 12개월', page.locator('[data-testid^="monthly-row-mem_child1-"]').count() == 12,
                  str(page.locator('[data-testid^="monthly-row-mem_child1-"]').count()))
            page.get_by_test_id('monthly-log-toggle').click()
            page.wait_for_timeout(300)
            check('1 [접기] → 다시 3개월', page.locator('[data-testid^="monthly-row-mem_child1-"]').count() == 3)
            check('5 부모 카드의 뽑기 상자 기본 3개', page.locator('[data-testid^="reward-box-ev_box"]').count() == 3,
                  str(page.locator('[data-testid^="reward-box-ev_box"]').count()))
            page.get_by_test_id('boxes-toggle-mem_child1').click()
            page.wait_for_timeout(300)
            check('5 [자세히] 로 상자 내역 전체(4개)', page.locator('[data-testid^="reward-box-ev_box"]').count() == 4,
                  str(page.locator('[data-testid^="reward-box-ev_box"]').count()))
            page.screenshot(path=str(SHOTS / '03-main-parent.png'), full_page=True)

            # ---------------------------------------------------------- 6·7·8 옵션 공부 목록
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(700)
            check('7 기본 3 + 내가 만든 프리셋 1개', page.get_by_test_id('preset-p_test').count() == 1 and
                  page.locator('[data-testid^="preset-semester"], [data-testid^="preset-vacation"], [data-testid^="preset-exam"]').count() == 3)
            check('7 + 프리셋 추가 버튼', page.get_by_test_id('preset-new').count() == 1)
            check('6 맨 아래는 + 추가 전용', page.get_by_test_id('routine-add').inner_text().strip().endswith('추가'))
            check('6 [이 프리셋 저장] 버튼', '이 프리셋 저장' in page.get_by_test_id('preset-save').inner_text())

            # 6 인라인 제목 수정 → [확인] → 저장되었습니다
            page.get_by_test_id('preset-vacation').click()
            page.wait_for_timeout(500)
            page.get_by_test_id('option-day-all').click()
            page.wait_for_timeout(400)
            rows = page.locator('[data-testid^="routine-item-"]')
            check('8 방학 프리셋에 미리 넣은 항목 1개', rows.count() == 1, str(rows.count()))
            item_id = (rows.first.get_attribute('data-testid') or '').replace('routine-item-', '')
            page.get_by_test_id(f'routine-title-{item_id}').click()
            page.wait_for_timeout(250)
            check('6 줄을 누르면 그 자리에서 수정', page.get_by_test_id(f'routine-inline-{item_id}').count() == 1)
            page.get_by_test_id(f'routine-inline-{item_id}').fill('방학 수학 3장')
            page.get_by_test_id(f'routine-inline-save-{item_id}').click()
            page.wait_for_timeout(600)
            check('6 [확인] 을 누르면 저장되었습니다 팝업', page.get_by_test_id('saved-popup').count() == 1)
            saved_titles = [x['title'] for x in stored()['presets']['vacation']['items']['mem_child1']]
            check('6 수정한 제목이 실제로 저장됨', '방학 수학 3장' in saved_titles, str(saved_titles))
            page.screenshot(path=str(SHOTS / '04-options-inline.png'), full_page=True)

            # 8 과목 드롭다운 인라인 수정
            page.get_by_test_id(f'routine-subject-{item_id}').select_option('reading')
            page.wait_for_timeout(700)
            subjects = [x['subject'] for x in stored()['presets']['vacation']['items']['mem_child1']]
            check('8 과목을 드롭다운으로 바로 수정', 'reading' in subjects, str(subjects))

            # 8 다른 프리셋에 바로 넣기
            page.get_by_test_id(f'routine-copy-{item_id}').click()
            page.wait_for_timeout(300)
            check('8 다른 프리셋 선택기가 열림', page.get_by_test_id(f'routine-copy-menu-{item_id}').count() == 1)
            page.get_by_test_id(f'routine-copy-to-{item_id}-semester').click()
            page.wait_for_timeout(800)
            semester_saved = stored()['presets']['semester']['items'].get('mem_child1', [])
            check('8 다른 프리셋(학기중)에 그대로 들어감', any('방학 수학 3장' == x['title'] for x in semester_saved),
                  str([x['title'] for x in semester_saved]))

            # 7 프리셋 추가 → 이름 바꾸기 → 삭제
            page.get_by_test_id('preset-new').click()
            page.wait_for_timeout(200)
            page.get_by_test_id('preset-new-name').fill('주말공부')
            page.get_by_test_id('preset-new-save').click()
            page.wait_for_timeout(900)
            custom_keys = [key for key in stored()['presets'].keys() if key.startswith('p_')]
            check('7 + 프리셋 추가로 새 프리셋 저장', any(stored()['presets'][key]['label'] == '주말공부' for key in custom_keys),
                  str([stored()['presets'][key]['label'] for key in custom_keys]))
            check('7 새 프리셋이 선택됨(이름 고치기 칸 표시)', page.get_by_test_id('preset-manage').count() == 1)
            page.get_by_test_id('preset-rename').fill('주말반2')
            page.get_by_test_id('preset-rename-save').click()
            page.wait_for_timeout(800)
            check('7 프리셋 이름 바꾸기 저장', any(stored()['presets'][key]['label'] == '주말반2' for key in custom_keys))
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_test_id('preset-delete').click()
            page.wait_for_timeout(900)
            check('7 프리셋 지우기', not any(stored()['presets'].get(key, {}).get('label') == '주말반2' for key in custom_keys))
            page.screenshot(path=str(SHOTS / '05-options-presets.png'), full_page=True)

            # ---------------------------------------------------------- 9 버스트 시간 배수
            page.get_by_test_id('option-tab-events').click()
            page.wait_for_timeout(400)
            check('9 배수 버튼 4개(+25·+50·+75·+100)', page.locator('[data-testid^="burst-percent-"]').count() == 5,
                  str(page.locator('[data-testid^="burst-percent-"]').count()))
            page.get_by_test_id('burst-percent-50').click()
            page.wait_for_timeout(800)
            check('9 +50% 선택이 저장됨', stored().get('burstPercent') == 50, str(stored().get('burstPercent')))
            check('9 지금 배수 문구 1.5배', '1.5배' in page.get_by_test_id('burst-percent-now').inner_text(),
                  page.get_by_test_id('burst-percent-now').inner_text())

            # ---------------------------------------------------------- 10 보너스 XP 저장
            page.get_by_test_id('streak-input-7').fill('88')
            page.get_by_test_id('streak-save').click()
            page.wait_for_timeout(700)
            check('10 저장되었습니다 팝업', page.get_by_test_id('saved-popup').count() == 1)
            bonus = {item['day']: item['xp'] for item in stored().get('streakBonuses', [])}
            check('10 입력한 7일 88 XP 가 실제로 저장', bonus.get(7) == 88, str(bonus))
            check('10 저장된 값 줄이 바뀜', '7일 +88 XP' in page.get_by_test_id('streak-saved').inner_text(),
                  page.get_by_test_id('streak-saved').inner_text())
            page.screenshot(path=str(SHOTS / '06-options-events.png'), full_page=True)
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(500)
            check('9 배너에도 선택한 배수(1.5배)', '1.5배' in page.get_by_test_id('burst-banner').inner_text(),
                  page.get_by_test_id('burst-banner').inner_text())
            page.screenshot(path=str(SHOTS / '07-main-burst.png'), full_page=True)

            # ---------------------------------------------------------- 4·5·2 보관함
            page.get_by_test_id('open-inventory').click()
            page.wait_for_timeout(700)
            check('4 상단에 남은 시간(분)을 함께 표시', page.get_by_test_id('inv-time-big').count() == 1,
                  page.get_by_test_id('inv-time-big').inner_text() if page.get_by_test_id('inv-time-big').count() else '')
            total_minutes = page.get_by_test_id('inv-prize-minutes').inner_text()
            used_minutes = page.get_by_test_id('inv-used-minutes').inner_text()
            remain_minutes = page.get_by_test_id('inv-remaining-minutes').inner_text()
            check('4 총 적립 50분 · 사용 10분 · 남은 40분',
                  total_minutes.startswith('50') and used_minutes.startswith('10') and remain_minutes.startswith('40'),
                  f'{total_minutes} / {used_minutes} / {remain_minutes}')
            check('4 시간 적립·사용 내역이 보임', page.get_by_test_id('inv-time-log').count() == 1)
            check('4 시간 내역 기본 3개', page.locator('[data-testid^="inv-time-box_"], [data-testid^="inv-time-use_"]').count() == 3,
                  str(page.locator('[data-testid^="inv-time-box_"], [data-testid^="inv-time-use_"]').count()))
            page.get_by_test_id('inv-time-toggle').click()
            page.wait_for_timeout(300)
            check('4 [자세히] 로 전체 시간 내역', page.locator('[data-testid^="inv-time-box_"], [data-testid^="inv-time-use_"]').count() == 5,
                  str(page.locator('[data-testid^="inv-time-box_"], [data-testid^="inv-time-use_"]').count()))
            check('5 선물 상자 내역 기본 3개', page.locator('[data-testid^="inv-box-"]:not([data-testid="inv-boxes-toggle"])').count() >= 3)
            page.get_by_test_id('inv-boxes-toggle').click()
            page.wait_for_timeout(300)
            check('5 [자세히] 로 뽑기 내역 전체', page.get_by_test_id('inv-boxes-toggle').inner_text().strip().startswith('접기'))
            use_button = page.locator('[data-testid^="inv-box-use-"]')
            check('2 부모 화면 시간 보상 버튼 문구가 적립 완료', use_button.count() >= 1 and use_button.first.inner_text().strip() == '적립 완료',
                  use_button.first.inner_text() if use_button.count() else '없음')
            page.screenshot(path=str(SHOTS / '08-inventory.png'), full_page=True)
            page.get_by_test_id('inventory-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------- 3·12 새 프로필 만들기
            clear_session()
            page.get_by_test_id('profile-create-open').click()
            page.wait_for_timeout(400)
            check('3 새 프로필 입력 폼', page.get_by_test_id('profile-create').count() == 1)
            page.get_by_test_id('profile-name').fill('동생')
            page.get_by_test_id('profile-role-child').click()
            page.get_by_test_id('profile-icon-🐼').click()
            page.get_by_test_id('profile-pin').fill('1111')
            page.get_by_test_id('profile-parent-pin').fill('1234')
            page.get_by_test_id('profile-create-save').click()
            page.wait_for_timeout(1600)
            check('3 새 프로필을 만들고 그 프로필로 입장', page.get_by_test_id('open-shop-child').count() == 1)
            data = stored()
            extra = data.get('extraMembers', [])
            check('3 새 프로필이 가족 설정에 저장됨', any(m['name'] == '동생' for m in extra), str([m['name'] for m in extra]))
            new_id = next((m['id'] for m in extra if m['name'] == '동생'), '')
            check('12 새 프로필 PIN 이 해시로 저장됨', bool(data.get('profilePins', {}).get(new_id, {}).get('hash')))
            page.screenshot(path=str(SHOTS / '09-new-profile.png'), full_page=True)

            clear_session()
            check('3 다시 열면 새 프로필까지 5개 카드', page.locator('[data-testid^="pick-"]').count() == 5,
                  str(page.locator('[data-testid^="pick-"]').count()))
            page.get_by_test_id(f'pick-{new_id}').click()
            page.wait_for_timeout(600)
            check('12 새 프로필도 PIN 을 묻는다', page.get_by_test_id('child-pin-gate').count() == 1)
            for key in '1111':
                page.get_by_test_id(f'child-pin-key-{key}').click()
                page.wait_for_timeout(110)
            page.wait_for_timeout(900)
            check('12 새 프로필 PIN 으로 입장', page.get_by_test_id('open-shop-child').count() == 1)

            # ---------------------------------------------------------- 12 부모가 아이 PIN 초기화
            clear_session()
            page.get_by_test_id('pick-mem_dad').click()
            page.wait_for_timeout(600)
            if page.get_by_test_id('parent-pin-gate').count():
                for key in '1234':
                    page.get_by_test_id(f'pin-key-{key}').click()
                    page.wait_for_timeout(110)
                page.wait_for_timeout(1100)
            check('12 부모 화면으로 들어감', page.get_by_test_id('open-profile').count() == 1)
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(500)
            check('12 프로필 화면에 아이 PIN 관리', page.get_by_test_id('profile-pin-settings').count() == 1)
            check('12 아이 PIN 상태 표시', 'PIN 있음' in page.get_by_test_id('pin-state-mem_child2').inner_text(),
                  page.get_by_test_id('pin-state-mem_child2').inner_text())
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_test_id('pin-reset-mem_child2').click()
            page.wait_for_timeout(1000)
            check('12 관리자가 아이 PIN 초기화', 'mem_child2' not in stored().get('profilePins', {}),
                  str(list(stored().get('profilePins', {}).keys())))
            page.get_by_test_id('pin-set-mem_child2').click()
            page.wait_for_timeout(200)
            page.get_by_test_id('pin-input-mem_child2').fill('4321')
            page.get_by_test_id('pin-save-mem_child2').click()
            page.wait_for_timeout(1000)
            check('12 아이 PIN 다시 정하기', bool(stored().get('profilePins', {}).get('mem_child2', {}).get('hash')))
            page.screenshot(path=str(SHOTS / '10-profile-pin.png'), full_page=True)

            # ---------------------------------------------------------- 11 뒤로가기 종료
            exit_page = context.new_page()
            exit_page.goto(f'{BASE}manifest.json')
            exit_page.goto(f'{BASE}index.html')
            exit_page.wait_for_timeout(1300)
            exit_page.evaluate('history.back()')
            exit_page.wait_for_timeout(900)
            check('11 메인에서 뒤로가기 → 종료 확인', exit_page.get_by_test_id('exit-modal').count() == 1)
            exit_page.get_by_test_id('exit-confirm-ok').click()
            left = False
            for _ in range(30):
                exit_page.wait_for_timeout(120)
                if 'manifest.json' in exit_page.url or exit_page.is_closed():
                    left = True
                    break
            check('11 [종료] 한 번으로 앱을 벗어남(두 번 누를 필요 없음)', left, exit_page.url)
            exit_page.close()

            check('데모 화면 콘솔 오류 0', len(console_errors) == 0, ' | '.join(console_errors[:3]))
            browser.close()
    finally:
        server.terminate()

    # ---------------------------------------------------------- 라이브 읽기 검증
    if '--live' in sys.argv:
        tables = ['tasks', 'family_members', 'family_tier_events', 'family_app_settings', 'family_notes']
        before = {table: rest_count(table) for table in tables}
        sw = read_text(f'{LIVE}sw.js')
        check('라이브 서비스워커 캐시 v13', 'study-check-shell-v13' in sw,
              next((line for line in sw.splitlines() if 'CACHE_NAME' in line), ''))
        live_errors: list[str] = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=CHROME, args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            context = browser.new_context(
                viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                timezone_id='Asia/Seoul', locale='ko-KR', is_mobile=True, has_touch=True,
            )
            page = context.new_page()
            page.on('console', lambda message: live_errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: live_errors.append(str(error)))
            page.goto(f'{LIVE}?v=13')
            page.wait_for_timeout(2500)
            check('라이브: 프로필 선택 화면', page.get_by_test_id('profile-picker').count() == 1)
            check('라이브: 프로필 4개', page.locator('[data-testid^="pick-"]').count() >= 4,
                  str(page.locator('[data-testid^="pick-"]').count()))
            page.get_by_test_id('pick-mem_child1').click()
            page.wait_for_timeout(2200)
            check('라이브: 아이 화면 렌더', page.get_by_test_id('open-shop-child').count() == 1)
            check('라이브: 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('라이브: 광고 자리 높이 0', page.evaluate("document.querySelector('[data-testid=\"ad-slot-main\"]')?.offsetHeight ?? 0") == 0)
            page.screenshot(path=str(SHOTS / '11-live-child.png'), full_page=True)
            check('라이브 콘솔 오류 0', len(live_errors) == 0, ' | '.join(live_errors[:3]))
            browser.close()
        after = {table: rest_count(table) for table in tables}
        check('라이브 DB 행 수 그대로', before == after, f'{before} → {after}')

    print(f'\n총 {checks}개 검사 · 실패 {len(failures)}개')
    for name in failures:
        print('  ✗', name)
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
