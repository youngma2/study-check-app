"""가족 실시간 동기화 검증 스크립트.

A) SQL 실행 전(실제 Supabase 표 없음) — 안내 문구 + 기기 저장 폴백 + 크래시 없음
B) SQL 실행 후 모양(모의 REST) — 클라우드 데이터 로드, 역할별 RPC, 거부 시 롤백

사용법:
    python3 scripts/verify-sync.py            # 미리보기 서버를 직접 띄우고 검사
    python3 scripts/verify-sync.py --url http://127.0.0.1:4174/
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4174
BASE_URL = f'http://127.0.0.1:{PORT}/'
TODAY = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()

failures: list[str] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
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
        ['npm', 'run', 'preview', '--', '--port', str(PORT)],
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


def member_rows():
    return [
        {"id": "mem_dad", "family_id": "fam_our_home", "name": "아빠", "role": "parent", "grade": None,
         "emoji": "👨🏻", "color": "sky", "presets": [], "created_at": "2026-11-20T00:00:00+00:00"},
        {"id": "mem_mom", "family_id": "fam_our_home", "name": "엄마", "role": "parent", "grade": None,
         "emoji": "👩🏻", "color": "violet", "presets": [], "created_at": "2026-11-20T00:01:00+00:00"},
        {"id": "mem_child1", "family_id": "fam_our_home", "name": "첫째", "role": "child", "grade": "중1",
         "emoji": "🌸", "color": "rose", "presets": [{"title": "스픽 10분 말하기", "subject": "english"}],
         "created_at": "2026-11-20T00:02:00+00:00"},
        {"id": "mem_child2", "family_id": "fam_our_home", "name": "둘째", "role": "child", "grade": "초4",
         "emoji": "⚡", "color": "amber", "presets": [],
         "created_at": "2026-11-20T00:03:00+00:00"},
    ]


def task_rows():
    base = {
        "family_id": "fam_our_home",
        "note": None,
        "created_by": "mem_child1",
        "created_at": f"{TODAY}T08:00:00+00:00",
        "verified_by": None,
        "verified_at": None,
    }
    return [
        {**base, "id": "t_c1_1", "member_id": "mem_child1", "title": "스픽 10분 말하기", "subject": "english",
         "due_date": TODAY, "status": "todo"},
        {**base, "id": "t_c1_2", "member_id": "mem_child1", "title": "수학 문제집 2쪽", "subject": "math",
         "due_date": TODAY, "status": "pending_verification", "created_at": f"{TODAY}T08:02:00+00:00"},
        {**base, "id": "t_c2_1", "member_id": "mem_child2", "title": "책 읽기 20분", "subject": "reading",
         "due_date": TODAY, "status": "todo", "created_by": "mem_child2", "created_at": f"{TODAY}T08:03:00+00:00"},
        {**base, "id": "t_c1_9", "member_id": "mem_child1", "title": "구름 숙제", "subject": "etc",
         "due_date": TODAY, "status": "todo", "created_at": f"{TODAY}T08:04:00+00:00"},
    ]


def install_mock(page, captured, reject_status=None, state=None):
    """REST(읽기/RPC)를 모의해 'SQL 실행 후' 화면을 검사합니다."""

    def handle(route, request):
        url = request.url
        method = request.method
        if state is not None and state.get('fail'):
            route.abort('internetdisconnected')
            return
        if '/rest/v1/rpc/' in url:
            name = url.split('/rest/v1/rpc/')[1].split('?')[0]
            body = {}
            try:
                body = json.loads(request.post_data or '{}')
            except json.JSONDecodeError:
                body = {}
            captured.append({'rpc': name, 'body': body})
            if name == 'study_delete_task':
                route.fulfill(status=204, body='')
                return
            if reject_status and name == reject_status:
                route.fulfill(
                    status=403,
                    content_type='application/json',
                    body=json.dumps({"code": "42501", "message": "확인 완료는 부모님만 할 수 있습니다.",
                                     "details": None, "hint": None}),
                )
                return
            now = datetime.now(ZoneInfo('UTC')).isoformat().replace('+00:00', 'Z')
            row = {
                "id": body.get('p_id') or f"t_new_{len(captured)}",
                "family_id": "fam_our_home",
                "member_id": body.get('p_member_id'),
                "title": body.get('p_title'),
                "subject": body.get('p_subject') or 'etc',
                "due_date": body.get('p_due_date') or TODAY,
                "status": body.get('p_status') or 'todo',
                "note": body.get('p_note'),
                "created_by": body.get('p_actor_id'),
                "verified_by": None,
                "verified_at": None,
                "created_at": now,
                "updated_at": now,
            }
            route.fulfill(status=200, content_type='application/json', body=json.dumps(row))
            return
        if method == 'GET' and '/rest/v1/families' in url:
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps([{"id": "fam_our_home", "name": "우리 가족 공부방",
                                            "created_at": "2026-11-20T00:00:00+00:00"}]))
            return
        if method == 'GET' and '/rest/v1/family_members' in url:
            route.fulfill(status=200, content_type='application/json', body=json.dumps(member_rows()))
            return
        if method == 'GET' and '/rest/v1/tasks' in url:
            route.fulfill(status=200, content_type='application/json', body=json.dumps(task_rows()))
            return
        route.continue_()

    page.route(re.compile(r'https://trhcatbuoslyjdhezobz\.supabase\.co/rest/v1/.*'), handle)


def install_missing_schema(page):
    """SQL 실행 전 상태(표 없음)를 모의합니다. 실제 DB 상태와 무관하게 검사할 수 있습니다."""

    def handle(route, request):
        route.fulfill(
            status=404,
            content_type='application/json',
            body=json.dumps({
                "code": "PGRST205",
                "details": None,
                "hint": None,
                "message": "Could not find the table 'public.tasks' in the schema cache",
            }),
        )

    page.route(re.compile(r'https://trhcatbuoslyjdhezobz\.supabase\.co/rest/v1/.*'), handle)


def open_profile(page):
    page.click('[data-testid="open-profile"]')
    page.wait_for_timeout(250)


def main() -> int:
    server = None
    if '--url' in sys.argv:
        base = sys.argv[sys.argv.index('--url') + 1]
    else:
        server = start_server()
        base = BASE_URL

    try:
        with sync_playwright() as p:
            launch_env = os.environ.copy()
            launch_env['LD_LIBRARY_PATH'] = CHROME_LIBS + os.pathsep + launch_env.get('LD_LIBRARY_PATH', '')
            browser = p.chromium.launch(
                executable_path=CHROME,
                headless=True,
                env=launch_env,
                args=['--no-sandbox', '--disable-dev-shm-usage'],
            )

            # ---------------- A) SQL 실행 전 ----------------
            print('\n[A] SQL 실행 전 (표 없음 응답을 모의)')
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            page = ctx.new_page()
            install_missing_schema(page)
            errors: list[str] = []
            bad: list[str] = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on(
                'console',
                lambda m: errors.append(f'console.{m.type}: {m.text}')
                if m.type == 'error' and 'Failed to load resource' not in m.text  # 표가 없을 때 나는 네트워크 404 로그는 제외
                else None,
            )
            page.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 else None)

            page.goto(base, wait_until='networkidle')
            page.evaluate('window.localStorage.clear()')
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(1200)
            body = page.inner_text('body')
            check('앱이 뜨고 가족명 표시', '우리 가족 공부방' in body)
            check('안내 문구 표시', '가족 동기화 준비 중' in body)
            check('샘플 숙제 표시(폴백)', '스픽 10분 말하기' in body and '책 읽기 20분' in body)
            check('자바스크립트 오류 없음', not errors, '; '.join(errors[:3]))
            print('   (HTTP 4xx: ' + ', '.join(sorted(set(bad))[:3]) + ')')

            # 기기 저장 폴백으로 추가가 되는지
            page.click('[data-testid="open-add"]')
            page.wait_for_timeout(300)
            page.fill('input[placeholder*="수학 문제집"]', '폴백 테스트')
            page.click('[data-testid="save-task"]')
            page.wait_for_timeout(600)
            check('SQL 전에도 항목 추가(기기 저장)', '폴백 테스트' in page.inner_text('body'))
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(900)
            check('새로고침 후에도 유지', '폴백 테스트' in page.inner_text('body'))

            # 아이 시점 링크
            page.goto(base + '#as=mem_child1', wait_until='networkidle')
            page.wait_for_timeout(900)
            child_body = page.inner_text('body')
            check('아이 링크가 아이 시점으로 열림', '첫째 시점' in child_body or '내 공부 추가' in child_body)
            check('아이에게 삭제 버튼 없음', page.locator('button[aria-label="삭제"]').count() == 0)
            ctx.close()

            # ---------------- B) SQL 실행 후(모의) ----------------
            print('\n[B] SQL 실행 후 모양 (모의 REST 응답)')
            ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            captured: list[dict] = []
            page2 = ctx2.new_page()
            errs2: list[str] = []
            page2.on('pageerror', lambda e: errs2.append(str(e)))
            install_mock(page2, captured)
            page2.goto(base + '#as=mem_mom', wait_until='networkidle')
            page2.wait_for_timeout(1200)
            body2 = page2.inner_text('body')
            check('클라우드 숙제 표시', '스픽 10분 말하기' in body2 and '수학 문제집 2쪽' in body2)
            check('엄마 시점', '엄마' in body2)
            open_profile(page2)
            sheet = page2.inner_text('body')
            check('동기화 상태 표시', '가족과 실시간 동기화 중' in sheet)
            page2.keyboard.press('Escape')
            page2.wait_for_timeout(300)

            # 부모 확인 완료 → RPC
            page2.locator('button:has-text("확인 완료")').first.click()
            page2.wait_for_timeout(700)
            verify_calls = [c for c in captured if c['rpc'] == 'study_set_task_status']
            check(
                '확인 완료가 RPC로 전송',
                bool(verify_calls) and verify_calls[-1]['body'].get('p_status') == 'verified'
                and verify_calls[-1]['body'].get('p_actor_id') == 'mem_mom',
                json.dumps(verify_calls[-1]['body'], ensure_ascii=False) if verify_calls else 'no call',
            )

            # 삭제 → RPC
            page2.on('dialog', lambda d: d.accept())
            page2.locator('button[aria-label="삭제"]').first.click()
            page2.wait_for_timeout(700)
            check('삭제가 RPC로 전송', any(c['rpc'] == 'study_delete_task' for c in captured))
            ctx2.close()

            # 아이 시점 + 거부 롤백
            ctx3 = browser.new_context(viewport={'width': 390, 'height': 844})
            captured3: list[dict] = []
            page3 = ctx3.new_page()
            install_mock(page3, captured3, reject_status='study_set_task_status')
            page3.goto(base + '#as=mem_child1', wait_until='networkidle')
            page3.wait_for_timeout(1200)
            page3.locator('button:has-text("완료 요청")').first.click()
            page3.wait_for_timeout(800)
            check('아이 완료 요청 RPC', any(c['rpc'] == 'study_set_task_status' for c in captured3))
            toast = ''
            try:
                toast = page3.locator('.animate-toast-in').inner_text()
            except Exception:
                toast = ''
            check('서버 거부 메시지를 토스트로 표시', '부모님만' in toast, toast)
            check(
                '거부되면 원래 상태로 되돌림',
                page3.locator('[data-testid="request-task"]').count() >= 1,
                f'완료 요청 버튼 {page3.locator("[data-testid=\"request-task\"]").count()}개',
            )
            ctx3.close()

            # ---------------- C) 연결이 끊겼을 때 ----------------
            print('\n[C] 연결 끊김 → 마지막 목록 유지 + 저장 차단 + 자동 복구')
            ctx4 = browser.new_context(viewport={'width': 390, 'height': 844})
            state = {'fail': False}
            captured4: list[dict] = []
            page4 = ctx4.new_page()
            install_mock(page4, captured4, state=state)
            page4.goto(base + '#as=mem_dad', wait_until='networkidle')
            page4.wait_for_timeout(1200)
            check('연결 상태: 클라우드 목록 표시', '구름 숙제' in page4.inner_text('body'))

            state['fail'] = True
            page4.reload(wait_until='networkidle')
            page4.wait_for_timeout(1200)
            body4 = page4.inner_text('body')
            check('연결 실패 안내 표시', '클라우드에 연결하지 못했어요' in body4)
            check('샘플이 아니라 마지막 목록 유지', '구름 숙제' in body4)
            page4.locator('button:has-text("확인 완료")').first.click()
            page4.wait_for_timeout(700)
            toast4 = ''
            try:
                toast4 = page4.locator('.animate-toast-in').inner_text()
            except Exception:
                toast4 = ''
            check('연결 끊김 중 저장 거부 안내', '저장할 수 없어요' in toast4, toast4)

            state['fail'] = False
            page4.wait_for_timeout(9500)  # 8초 자동 재시도
            check('자동 재연결', '클라우드에 연결하지 못했어요' not in page4.inner_text('body'))
            ctx4.close()
            browser.close()
    finally:
        if server is not None:
            try:
                os.killpg(os.getpgid(server.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass

    print(f'\n{"모두 통과" if not failures else "실패 " + str(len(failures)) + "건: " + ", ".join(failures)}')
    return 0 if not failures else 1


if __name__ == '__main__':
    sys.exit(main())
