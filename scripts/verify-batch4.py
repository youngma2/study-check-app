"""공부 체크 4차(1~12번) 통합 검증 — 데모 빌드 + 단위 + 라이브 읽기

    # 데모(기기 저장) 빌드
    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-batch4.py            # 데모 + 단위
    python3 scripts/verify-batch4.py --live     # 위 + 라이브(GitHub Pages) 읽기 검증

점검 항목(4차 1~12번)
  1  부모 PIN 비상 복구 — 복구 질문·6자리 코드 저장(해시) → PIN 화면 `비밀번호 찾기` 로 새 PIN
  2  아이 전용 프로필 창 — 닉네임·학년·아이콘·아이 PIN 만 (개인정보 항목 없음)
  3  `적립 완료` 문구 통일 (부모·아이)
  4  상점 사용 완료 → 보유 목록에서 사라짐 (중복 사용 방지)
  5  아이 화면 상단 우측 `⋮` → `프로필 관리`
  6  학습 대시보드 게이지 한 줄 정렬
  7  옵션 → 폰 백업(.json) 저장 · 백업 파일로 복원
  8  관리자 `직접 시간 추가` (직접 시간 차감 바로 위) → 남은 시간에 적립
  9  `선물 상자` → `뽑기 상자` 전체 통일
  10 보관함 하단 `다 쓴 것은…` 안내 문구 삭제
  11 상점 `구매·사용 내역` + `사용 완료` 표시
  12 `+5분` · `+10분` · `+1시간` 누적 버튼 (추가·차감 입력란)

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
PORT = 4197
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
LIVE = 'https://youngma2.github.io/study-check-app/'
SUPABASE = 'https://trhcatbuoslyjdhezobz.supabase.co'
KEY = 'sb_publishable_fPzIYHLYLbVmsPB6tLaUNw_z6sAnxbj'
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date().isoformat()
SEASON = TODAY[:7]
SHOTS = ROOT / 'scripts' / 'shots-batch4'

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
        f'{SUPABASE}/rest/v1/{table}?select=*',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return int((response.headers.get('Content-Range') or '*/0').split('/')[-1])


def read_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=25) as response:
        return response.read().decode()


# ---------------------------------------------------------------- 단위 검증
def run_units() -> None:
    out = ROOT / '.tmp-b4'
    out.mkdir(exist_ok=True)
    env = os.environ.copy()
    env['PATH'] = NODE_BIN + os.pathsep + env.get('PATH', '')
    for entry in ['app-settings', 'pin', 'shop']:
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
  addTimeGrant, defaultAppSettings, grantedBonusMinutes, normalizeAppSettings, remainingBonusMinutes,
  normalizeSelfProfiles,
} from './app-settings.mjs';
import { generateRecoveryCode, hashPin, verifyHashedPin } from './pin.mjs';
import { availablePurchasesFor, pointEntryKindLabel } from './shop.mjs';

const result = (name, cond, extra = '') => console.log(`RESULT\t${cond ? 'PASS' : 'FAIL'}\t${name}\t${extra}`);
const NOW = new Date('2026-11-29T01:00:00.000Z');

// 8·12) 직접 시간 추가 — 남은 시간 셈
const base = defaultAppSettings();
result('8 기본 설정에 timeGrants 있음', Array.isArray(base.timeGrants));
const added = addTimeGrant(base, 'mem_child1', 25, '칭찬 보너스', NOW);
result('8 시간 추가가 기록됨', added.timeGrants.length === 1 && added.timeGrants[0].minutes === 25);
result('8 시간 추가 합계 25분', grantedBonusMinutes(added, 'mem_child1') === 25);
const withUsage = { ...added, timeUsage: [{ id: 'u1', member_id: 'mem_child1', minutes: 10, at: NOW.toISOString(), mode: 'direct' }] };
result('8 남은 분 = 50(뽑음) + 25(추가) - 10(사용) = 65', remainingBonusMinutes(withUsage, 'mem_child1', 50) === 65,
  String(remainingBonusMinutes(withUsage, 'mem_child1', 50)));
result('8 다른 아이에게는 더해지지 않음', grantedBonusMinutes(added, 'mem_child2') === 0);
result('8 600분을 넘는 추가는 600분으로', addTimeGrant(base, 'mem_child1', 9999, 'x', NOW).timeGrants[0].minutes === 600);
const normGrants = normalizeAppSettings({ ...JSON.parse(JSON.stringify(base)), timeGrants: [{ id: 'g1', member_id: 'mem_child1', minutes: 15, at: NOW.toISOString(), reason: '생일' }] });
result('8 저장·불러오기에도 시간 추가가 남음', normGrants.timeGrants.length === 1 && normGrants.timeGrants[0].reason === '생일');
const badGrants = normalizeAppSettings({ ...JSON.parse(JSON.stringify(base)), timeGrants: [{ id: 'x', member_id: 'mem_child1' }] });
result('8 잘못된 시간 추가 기록은 버림', badGrants.timeGrants.length === 0);

// 1) 비상 복구 코드
const code = generateRecoveryCode();
result('1 복구 코드는 6자리 숫자', /^\d{6}$/.test(code), code);
const codeRecord = await hashPin(code);
result('1 복구 코드도 평문이 아니라 해시', codeRecord.hash.length === 64 && codeRecord.hash !== code);
result('1 맞는 복구 코드 통과', await verifyHashedPin(code, codeRecord));
result('1 틀린 복구 코드 거절', !(await verifyHashedPin('000000', codeRecord)));
const withRecovery = normalizeAppSettings({
  ...JSON.parse(JSON.stringify(base)),
  parentRecovery: { question: '어릴 적 별명은?', salt: codeRecord.salt, hash: codeRecord.hash, codeSalt: codeRecord.salt, codeHash: codeRecord.hash, updated_at: NOW.toISOString() },
});
result('1 비상 복구 설정이 저장 모양을 통과', withRecovery.parentRecovery?.question === '어릴 적 별명은?');
const brokenRecovery = normalizeAppSettings({ ...JSON.parse(JSON.stringify(base)), parentRecovery: { question: '질문', salt: 'zz' } });
result('1 불완전한 복구 설정은 버림', brokenRecovery.parentRecovery === null);

// 2) 아이 프로필(닉네임·학년) · 기기 저장 값
const profiled = normalizeAppSettings({
  ...JSON.parse(JSON.stringify(base)),
  profileNames: { mem_child1: '  예원  ' },
  profileGrades: { mem_child1: ' 중1 ' },
});
result('2 닉네임·학년이 다듬어져 저장됨', profiled.profileNames.mem_child1 === '예원' && profiled.profileGrades.mem_child1 === '중1');
const self = normalizeSelfProfiles({ mem_child1: { name: '찬율', grade: '초4', emoji: '🦊', pin: codeRecord }, bad: { name: 'x' } });
result('2 기기 저장 프로필 값이 읽힘', self.mem_child1?.name === '찬율' && Boolean(self.mem_child1?.pin));
result('2 잘못된 구성원 열쇠는 버림', !self.bad);

// 4·11) 상점 사용 완료
const t = (id, title, status) => ({ id, family_id: 'f', member_id: 'mem_child1', title, subject: 'shop', due_date: '2000-01-01', status, created_by: 'p', created_at: NOW.toISOString() });
const product = { id: 'sp_1', family_id: 'f', member_id: 'p', title: '간식 쿠폰', subject: 'shop', due_date: '2000-01-01', status: 'todo', created_by: 'p', created_at: NOW.toISOString(), note: JSON.stringify({ shop: 'product', emoji: '🍦', desc: '편의점', price: 50 }) };
const pending = { ...t('pt_buy_1', '🛒 🍦 간식 쿠폰', 'todo'), note: JSON.stringify({ shop: 'point', kind: 'spend', p: 50, label: '간식 쿠폰', product: 'sp_1' }) };
const done = { ...t('pt_buy_2', '🛒 🍬 사탕', 'verified'), note: JSON.stringify({ shop: 'point', kind: 'spend', p: 10, label: '사탕', product: 'sp_1' }) };
const state = (task) => pointEntryKindLabel({
  id: task.id, member_id: 'mem_child1', delta: -50, kind: 'spend', label: 'x', created_at: NOW.toISOString(),
  delivered: task.status === 'verified', task,
});
result('4 사용 대기 라벨', state(pending) === '구매 · 사용 대기', state(pending));
result('4 사용 완료 라벨', state(done) === '구매 · 사용 완료', state(done));
const available = availablePurchasesFor([product, pending, done], 'mem_child1');
result('4 사용 완료한 상품은 보유 목록에서 빠짐', available.length === 1 && available[0].id === 'pt_buy_1',
  available.map((x) => x.id).join(','));

// 9) 옛 문구가 남지 않음(데이터 이름)
result('9 설정 키 이름에 옛 문구 없음', !Object.keys(base).some((key) => key.includes('giftBox')));
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
                accept_downloads=True,
            )
            context.add_init_script(
                f"""
                const now = new Date();
                if (localStorage.getItem('study-check.app-settings.v1')) {{ /* 이미 이번 검사에서 바꾼 값이 있으면 그대로 */ }}
                else {{
                const settings = {{
                  version: 1, burst: false, burstAuto: false, burstAutoDays: 7, burstOverlap: false, burstPercent: 100,
                  boxRewards: [{{ id: 'm5', kind: 'minutes', value: 5 }}, {{ id: 'm10', kind: 'minutes', value: 10 }}, {{ id: 'p30', kind: 'points', value: 30 }}],
                  burstWindows: [],
                  streakBonuses: [{{day:3,xp:30}},{{day:7,xp:70}},{{day:14,xp:140}},{{day:30,xp:300}}],
                  activePreset: 'semester',
                  presets: {{}},
                  timeUsage: [{{ id: 'tu1', member_id: 'mem_child1', minutes: 10, at: new Date(now.getTime() - 7200000).toISOString(), mode: 'direct', reason: '게임' }}],
                  timeGrants: [],
                  boxCount: 3, tierDifficulty: 5, burstAutoFrom: null, profileEmoji: {{}}, settlements: {{}},
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

            def enter_pin(prefix: str, pin: str, wait: int = 900):
                for key in pin:
                    page.get_by_test_id(f'{prefix}{key}').click()
                    page.wait_for_timeout(110)
                page.wait_for_timeout(wait)

            page.goto(f'{BASE}index.html')
            page.wait_for_timeout(1500)
            check('시작: 프로필 선택 화면', page.get_by_test_id('profile-picker').count() == 1)

            # ---------------------------------------------------------- 2·5 아이 전용 프로필 창
            page.get_by_test_id('pick-mem_child1').click()
            page.wait_for_timeout(900)
            check('5 아이 화면 상단 우측 ⋮ 메뉴가 있음', page.get_by_test_id('header-more').count() == 1)
            page.get_by_test_id('header-more').click()
            page.wait_for_timeout(250)
            check('5 ⋮ 메뉴에 프로필 관리', page.get_by_test_id('menu-profile-manage').count() == 1)
            page.get_by_test_id('menu-profile-manage').click()
            page.wait_for_timeout(500)
            check('5 프로필 관리로 아이 전용 창이 열림', page.get_by_test_id('child-profile').count() == 1)
            check('2 닉네임·학년·아이콘·PIN 칸이 있음',
                  page.get_by_test_id('child-profile-name').count() == 1
                  and page.get_by_test_id('child-profile-grade').count() == 1
                  and page.get_by_test_id('child-profile-icons').count() == 1
                  and page.get_by_test_id('child-profile-pin').count() == 1)
            # 개인정보 항목이 '칸'으로 있는지만 봅니다(안내 문구에 '생일·연락처'라는 말은 나옴)
            private_fields = page.evaluate(
                "document.querySelectorAll('[data-testid=\"child-profile\"] input[type=\"tel\"], "
                "[data-testid=\"child-profile\"] input[type=\"date\"], "
                "[data-testid=\"child-profile\"] input[type=\"email\"]').length"
            )
            input_count = page.evaluate("document.querySelectorAll('[data-testid=\"child-profile\"] input').length")
            check('2 생일·연락처 같은 개인정보 입력칸 없음', private_fields == 0 and input_count <= 5,
                  f'개인정보칸 {private_fields} · 전체 입력칸 {input_count}')
            check('2 개인정보는 받지 않는다는 안내', '개인정보는 받지 않아요' in page.get_by_test_id('child-profile-privacy').inner_text())

            page.get_by_test_id('child-profile-name').fill('예원짱')
            page.get_by_test_id('child-profile-grade-중1').click()
            page.get_by_test_id('child-profile-emoji-🦊').click()
            page.get_by_test_id('child-profile-save').click()
            page.wait_for_timeout(700)
            check('2 저장되면 헤더 닉네임이 바뀜', '예원짱' in page.inner_text('header'), page.inner_text('header')[:60])
            check('2 아이가 바꾼 값은 이 폰에 저장', json.loads(page.evaluate("localStorage.getItem('study-check.self-profile.v1')") or '{}').get('mem_child1', {}).get('name') == '예원짱')
            page.screenshot(path=str(SHOTS / '01-child-profile.png'), full_page=True)
            page.get_by_test_id('child-profile-close').click()
            page.wait_for_timeout(400)

            # 2 아이 PIN 정하기
            page.get_by_test_id('header-more').click()
            page.wait_for_timeout(200)
            page.get_by_test_id('menu-profile-manage').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('child-profile-pin-open').click()
            page.wait_for_timeout(200)
            page.get_by_test_id('child-profile-pin-new').fill('4321')
            page.get_by_test_id('child-profile-pin-again').fill('4321')
            page.get_by_test_id('child-profile-pin-save').click()
            page.wait_for_timeout(700)
            check('2 아이가 자기 PIN 을 정함(PIN 있음)', 'PIN 있음' in page.get_by_test_id('child-profile-pin-state').inner_text(),
                  page.get_by_test_id('child-profile-pin-state').inner_text())
            check('2 아이 PIN 도 평문 저장 없음',
                  '4321' not in (page.evaluate("localStorage.getItem('study-check.self-profile.v1')") or ''))
            page.get_by_test_id('child-profile-close').click()
            page.wait_for_timeout(400)

            # 2 아이 PIN 으로 다시 들어오기
            clear_session()
            page.get_by_test_id('pick-mem_child1').click()
            page.wait_for_timeout(600)
            check('2 아이 PIN 을 물어봄', page.get_by_test_id('child-pin-gate').count() == 1)
            enter_pin('child-pin-key-', '4321')
            check('2 정한 아이 PIN 으로 입장', page.get_by_test_id('open-shop-child').count() == 1)

            # 2 아이가 자기 프로필을 누르면 전용 창
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(500)
            page.get_by_test_id('profile-row-mem_child1').click()
            page.wait_for_timeout(600)
            check('2 아이 프로필을 누르면 아이 전용 창이 열림', page.get_by_test_id('child-profile').count() == 1)
            page.get_by_test_id('child-profile-close').click()
            page.wait_for_timeout(300)

            # ---------------------------------------------------------- 부모 입장 (PIN 정하기)
            clear_session()
            page.get_by_test_id('pick-mem_dad').click()
            page.wait_for_timeout(600)
            check('부모를 고르면 PIN 화면', page.get_by_test_id('parent-pin-gate').count() == 1)
            enter_pin('pin-key-', '1234', wait=400)
            enter_pin('pin-key-', '1234', wait=1200)
            check('부모 화면 입장', page.get_by_test_id('open-options').count() == 1)

            # 2 부모도 아이 프로필 창을 열 수 있음
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(500)
            check('2 부모 화면에 아이 프로필 창 열기 버튼', page.get_by_test_id('manage-profile-mem_child1').count() == 1)
            page.get_by_test_id('manage-profile-mem_child1').click()
            page.wait_for_timeout(500)
            check('2 부모가 연 아이 전용 프로필 창', page.get_by_test_id('child-profile').count() == 1)
            page.get_by_test_id('child-profile-close').click()
            page.wait_for_timeout(300)

            # ---------------------------------------------------------- 9·3 문구 통일 + 10 안내 문구 삭제
            main_text = page.inner_text('body')
            check('9 메인 화면에 `선물 상자` 없음', '선물 상자' not in main_text)
            check('3 메인 화면에 `정리 완료` 없음', '정리 완료' not in main_text)

            page.get_by_test_id('open-inventory').click()
            page.wait_for_timeout(600)
            inv_text = page.inner_text('body')
            check('9 보관함에 `선물 상자` 없음', '선물 상자' not in inv_text)
            check('9 보관함에 `뽑기 상자` 있음', '뽑기 상자' in inv_text)
            check('3 보관함에 `정리 완료` 없음', '정리 완료' not in inv_text)
            check('10 보관함 하단 `다 쓴 것은` 안내 문구 삭제', '다 쓴 것은' not in inv_text)
            page.screenshot(path=str(SHOTS / '02-inventory.png'), full_page=True)
            page.get_by_test_id('inventory-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------- 8·12 직접 시간 추가 · 누적 버튼
            page.get_by_test_id('open-timer').click()
            page.wait_for_timeout(700)
            grant_box = page.get_by_test_id('direct-grant').bounding_box()
            deduct_box = page.get_by_test_id('direct-deduct').bounding_box()
            check('8 `직접 시간 추가` 가 `직접 시간 차감` 바로 위에 있음',
                  bool(grant_box and deduct_box and grant_box['y'] < deduct_box['y']),
                  f"{grant_box and round(grant_box['y'])} / {deduct_box and round(deduct_box['y'])}")
            start_value = page.get_by_test_id('grant-minutes').input_value()
            page.get_by_test_id('grant-quick-5').click()
            page.wait_for_timeout(120)
            page.get_by_test_id('grant-quick-5').click()
            page.wait_for_timeout(150)
            check('12 +5분 두 번 → 입력 분이 누적(10 → 20)', page.get_by_test_id('grant-minutes').input_value() == '20',
                  f"{start_value} → {page.get_by_test_id('grant-minutes').input_value()}")
            page.get_by_test_id('grant-quick-60').click()
            page.wait_for_timeout(150)
            check('12 +1시간(60분) 누적 → 80', page.get_by_test_id('grant-minutes').input_value() == '80',
                  page.get_by_test_id('grant-minutes').input_value())
            page.get_by_test_id('grant-minutes').fill('20')
            page.get_by_test_id('direct-grant-button').click()
            page.wait_for_timeout(900)
            grants = stored().get('timeGrants', [])
            check('8 시간 추가가 저장됨(+20분)', any(int(g['minutes']) == 20 for g in grants), str(grants)[:120])
            check('8 시간 내역에 +20분 으로 보임', '+20분' in page.inner_text('[data-testid="time-usage-log"]'),
                  page.inner_text('[data-testid="time-usage-log"]')[:80])

            # 12 차감 입력란 누적 버튼
            page.get_by_test_id('deduct-quick-5').click()
            page.wait_for_timeout(150)
            check('12 차감 입력란도 +5분 누적(5 → 10)', page.get_by_test_id('direct-minutes').input_value() == '10' or
                  page.get_by_test_id('direct-minutes').input_value() == '15',
                  page.get_by_test_id('direct-minutes').input_value())
            check('12 차감 입력란에 +1시간 버튼', page.get_by_test_id('deduct-quick-60').count() == 1)
            page.screenshot(path=str(SHOTS / '03-timer.png'), full_page=True)
            page.get_by_test_id('timer-close').click()
            page.wait_for_timeout(400)

            page.get_by_test_id('open-inventory').click()
            page.wait_for_timeout(600)
            remain_text = page.get_by_test_id('inv-remaining-minutes').inner_text()
            check('8 보관함 남은 분에 더한 시간이 반영(40+20=60)', remain_text.startswith('60'), remain_text)
            page.get_by_test_id('inventory-close').click()
            page.wait_for_timeout(300)

            # ---------------------------------------------------------- 6 대시보드 게이지 한 줄
            page.get_by_test_id('parent-week-summary').click()
            page.wait_for_timeout(700)
            page.get_by_test_id('dash-tab-month').click()
            page.wait_for_timeout(600)
            rates = page.locator('[data-testid^="dash-week-rate-"]')
            check('6 월별 주간 게이지 줄이 있음', rates.count() >= 1, str(rates.count()))
            single_line = True
            no_wrap = True
            for index in range(rates.count()):
                item = rates.nth(index)
                style = item.evaluate("el => getComputedStyle(el).whiteSpace")
                box = item.bounding_box() or {'height': 99}
                if style != 'nowrap':
                    no_wrap = False
                if box['height'] > 18:
                    single_line = False
            check('6 달성률 텍스트가 한 줄(줄바꿈 없음)', single_line and no_wrap, f'nowrap={no_wrap} single={single_line}')
            dash_text = page.inner_text('[data-testid="parent-dashboard"]')
            check('8 대시보드 보너스 시간 내역에도 `시간 추가 +20분`', '시간 추가' in dash_text and '+20분' in dash_text,
                  dash_text[:0])
            page.screenshot(path=str(SHOTS / '04-dashboard.png'), full_page=True)
            page.get_by_test_id('dashboard-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------- 1 비상 복구 설정 + 7 백업
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(700)
            check('1 옵션에 설정·백업 탭', page.get_by_test_id('option-tab-system').count() == 1)
            page.get_by_test_id('option-tab-system').click()
            page.wait_for_timeout(400)
            check('1 부모 PIN·비상 복구 영역', page.get_by_test_id('pin-recovery-section').count() == 1)
            page.get_by_test_id('recovery-question').fill('어릴 적 별명은?')
            page.get_by_test_id('recovery-answer').fill('땅콩')
            page.get_by_test_id('recovery-code').fill('135790')
            page.get_by_test_id('recovery-save').click()
            page.wait_for_timeout(900)
            data = stored()
            rec = data.get('parentRecovery') or {}
            check('1 비상 복구 질문·코드가 저장됨', rec.get('question') == '어릴 적 별명은?')
            check('1 복구 답·코드는 평문이 아니라 해시', '땅콩' not in json.dumps(rec, ensure_ascii=False) and '135790' not in json.dumps(rec, ensure_ascii=False))
            check('1 저장 안내가 보임', page.get_by_test_id('recovery-saved').count() == 1)

            # 7 백업 저장
            with page.expect_download() as download_info:
                page.get_by_test_id('backup-save').click()
            download = download_info.value
            backup_path = pathlib.Path(download.path())
            check('7 폰에 백업 저장(.json) 이 내려받아짐', backup_path.exists() and download.suggested_filename.endswith('.json'),
                  download.suggested_filename)
            saved_backup = json.loads(backup_path.read_text())
            check('7 백업 파일에 공부·옵션·한마디가 들어 있음',
                  'db' in saved_backup and 'appSettings' in saved_backup and 'notes' in saved_backup,
                  ','.join(saved_backup.keys()))
            page.screenshot(path=str(SHOTS / '05-options-backup.png'), full_page=True)
            page.get_by_test_id('options-close').click()
            page.wait_for_timeout(400)

            # ---------------------------------------------------------- 4·11 상점 사용 완료
            page.get_by_test_id('open-shop').click()
            page.wait_for_timeout(700)
            page.get_by_test_id('shop-tab-manage').click()
            page.wait_for_timeout(300)
            page.get_by_test_id('shop-product-name').fill('간식 쿠폰')
            page.get_by_test_id('shop-product-desc').fill('편의점에서 하나')
            page.get_by_test_id('shop-product-price').fill('50')
            page.get_by_test_id('shop-product-save').click()
            page.wait_for_timeout(900)
            page.get_by_test_id('shop-tab-orders').click()
            page.wait_for_timeout(300)
            check('11 탭 이름이 `구매·사용 내역`', '구매·사용 내역' in page.inner_text('[data-testid^="shop-tab-orders"]'))
            page.get_by_test_id('shop-tab-manage').click()
            page.wait_for_timeout(300)
            page.get_by_test_id('shop-grant-points').fill('100')
            page.get_by_test_id('shop-grant-label').fill('테스트')
            page.get_by_test_id('shop-grant-save').click()
            page.wait_for_timeout(900)
            page.get_by_test_id('shop-tab-shop').click()
            page.wait_for_timeout(400)
            buy = page.locator('[data-testid^="shop-buy-"]').first
            check('4 상품 구매 버튼', buy.count() == 1)
            buy.click()
            page.wait_for_timeout(300)
            page.get_by_test_id('shop-buy-ok').click()
            page.wait_for_timeout(1000)
            page.get_by_test_id('shop-tab-orders').click()
            page.wait_for_timeout(400)
            orders_text = page.get_by_test_id('shop-orders').inner_text()
            check('11 구매 줄이 `사용 대기` 로 보임', '사용 대기' in orders_text, orders_text[:120].replace('\n', ' '))
            deliver = page.locator('[data-testid^="shop-deliver-"]').first
            check('4 부모가 [사용 완료] 를 누를 수 있음', deliver.count() == 1)
            deliver.click()
            page.wait_for_timeout(900)
            orders_text = page.get_by_test_id('shop-orders').inner_text()
            check('11 처리 뒤 `사용 완료` 로 표시', '사용 완료' in orders_text and '사용 대기' not in orders_text,
                  orders_text[:140].replace('\n', ' '))
            page.screenshot(path=str(SHOTS / '06-shop-orders.png'), full_page=True)
            page.get_by_test_id('shop-close').click()
            page.wait_for_timeout(400)

            page.get_by_test_id('open-inventory').click()
            page.wait_for_timeout(600)
            inv_products = page.get_by_test_id('inv-products').inner_text()
            check('4 사용 완료한 상품은 보유 목록에서 사라짐', '간식 쿠폰' not in inv_products, inv_products[:120].replace('\n', ' '))
            page.get_by_test_id('inventory-close').click()
            page.wait_for_timeout(300)

            # ---------------------------------------------------------- 1 비상 복구로 PIN 재설정
            page.get_by_test_id('open-profile').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('lock-parent').click()
            page.wait_for_timeout(800)
            clear_session()
            page.get_by_test_id('pick-mem_dad').click()
            page.wait_for_timeout(600)
            check('1 PIN 화면에 비밀번호 찾기', page.get_by_test_id('pin-recover-open').count() == 1)
            page.get_by_test_id('pin-recover-open').click()
            page.wait_for_timeout(300)
            check('1 복구 질문이 보임', '어릴 적 별명은?' in page.get_by_test_id('pin-recover-question').inner_text())
            page.get_by_test_id('pin-recover-secret').fill('999999')
            page.get_by_test_id('pin-recover-new').fill('5678')
            page.get_by_test_id('pin-recover-again').fill('5678')
            page.get_by_test_id('pin-recover-submit').click()
            page.wait_for_timeout(900)
            check('1 틀린 복구 코드는 거절', page.get_by_test_id('pin-recover-error').count() == 1,
                  page.get_by_test_id('pin-recover-error').inner_text() if page.get_by_test_id('pin-recover-error').count() else '')
            page.get_by_test_id('pin-recover-secret').fill('135790')
            page.get_by_test_id('pin-recover-submit').click()
            page.wait_for_timeout(1200)
            check('1 복구 코드로 새 PIN 재설정 후 부모 화면', page.get_by_test_id('open-options').count() == 1)
            page.screenshot(path=str(SHOTS / '07-pin-recover.png'), full_page=True)

            # 새 PIN 으로 다시 들어오기
            clear_session()
            page.get_by_test_id('pick-mem_dad').click()
            page.wait_for_timeout(600)
            enter_pin('pin-key-', '5678', wait=1100)
            check('1 새 PIN(5678)으로 잠금 해제', page.get_by_test_id('open-options').count() == 1)

            # ---------------------------------------------------------- 7 백업 파일로 복원
            restore_settings = dict(saved_backup['appSettings'])
            restore_settings['boxCount'] = 2
            restore_settings['boxRewards'] = [{'id': 'm7', 'kind': 'minutes', 'value': 7}]
            restore_file = dict(saved_backup)
            restore_file['appSettings'] = restore_settings
            restore_path = ROOT / '.tmp-b4' / 'restore.json'
            restore_path.write_text(json.dumps(restore_file, ensure_ascii=False))
            page.get_by_test_id('open-options').click()
            page.wait_for_timeout(700)
            page.get_by_test_id('option-tab-system').click()
            page.wait_for_timeout(400)
            page.get_by_test_id('backup-file').set_input_files(str(restore_path))
            page.wait_for_timeout(500)
            check('7 백업 파일을 고르면 복원 확인 창', page.get_by_test_id('restore-confirm').count() == 1)
            check('7 복원 확인 창에 개수가 보임', '공부' in page.get_by_test_id('restore-counts').inner_text())
            page.get_by_test_id('restore-apply').click()
            page.wait_for_timeout(3200)
            restored = json.loads(page.evaluate("localStorage.getItem('study-check.app-settings.v1')"))
            check('7 복원한 옵션이 이 폰에 적용됨(상자 2개)', restored.get('boxCount') == 2, str(restored.get('boxCount')))

            check('데모 화면 콘솔 오류 0', len(console_errors) == 0, ' | '.join(console_errors[:3]))
            browser.close()
    finally:
        server.terminate()

    # ---------------------------------------------------------- 라이브 읽기 검증
    if '--live' in sys.argv:
        tables = ['tasks', 'family_members', 'family_tier_events', 'family_app_settings', 'family_notes']
        before = {table: rest_count(table) for table in tables}
        sw = read_text(f'{LIVE}sw.js')
        check('라이브 서비스워커 캐시 v14', 'study-check-shell-v14' in sw,
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
            page.goto(f'{LIVE}?v=14')
            page.wait_for_timeout(2500)
            check('라이브: 프로필 선택 화면', page.get_by_test_id('profile-picker').count() == 1)
            check('라이브: 프로필 4개', page.locator('[data-testid^="pick-"]').count() >= 4,
                  str(page.locator('[data-testid^="pick-"]').count()))
            page.get_by_test_id('pick-mem_child1').click()
            page.wait_for_timeout(2200)
            check('라이브: 아이 화면 렌더', page.get_by_test_id('open-shop-child').count() == 1)
            check('라이브: 아이 화면 상단 ⋮ 메뉴', page.get_by_test_id('header-more').count() == 1)
            page.get_by_test_id('header-more').click()
            page.wait_for_timeout(300)
            check('라이브: ⋮ → 프로필 관리', page.get_by_test_id('menu-profile-manage').count() == 1)
            page.get_by_test_id('menu-profile-manage').click()
            page.wait_for_timeout(700)
            check('라이브: 아이 전용 프로필 창', page.get_by_test_id('child-profile').count() == 1)
            check('라이브: 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('라이브: 옛 문구(`선물 상자`) 없음', '선물 상자' not in page.inner_text('body'))
            page.screenshot(path=str(SHOTS / '08-live-child.png'), full_page=True)
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
