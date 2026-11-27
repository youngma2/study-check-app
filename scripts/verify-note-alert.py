"""새 한마디 알림 경로 검증 — 안드로이드 크롬(서비스 워커 알림) · 진동 · 배너 닫기 동작.

    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
    python3 scripts/verify-note-alert.py

390×844 헤드리스 Chrome 으로 dist-demo 를 띄워 확인합니다.
브라우저 알림 API 는 기록만 하도록 바꿔 끼워(헤드리스에는 알림 표시가 없음),
앱이 실제로 어느 경로(showNotification / new Notification)를 부르는지 봅니다.
"""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4179
ORIGIN = f'http://127.0.0.1:{PORT}'
BASE = ORIGIN + '/study-check-app/'

DB_KEY = 'study-check.db.v1'  # (데모 모드는 첫 변경 때 저장되므로 이 검사에서는 쓰지 않습니다.)
NOTES_KEY = 'study-check.notes.v1'

failures: list[str] = []


def korea_today() -> tuple[int, int]:
    today = datetime.now(ZoneInfo('Asia/Seoul')).date()
    return today.month, today.day


def check(name: str, cond: bool, extra: str = '') -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        failures.append(name)


def wait_for_port(port: int, timeout: float = 60.0) -> bool:
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
        ['npx', 'vite', 'preview', '--outDir', 'dist-demo', '--port', str(PORT), '--host', '127.0.0.1'],
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


# 알림/진동 API 를 기록용으로 바꿔 끼웁니다(앱 코드는 그대로 실행).
INSTRUMENT = """
(() => {
  const rec = { sw: [], ctor: [], vibrate: [] };
  window.__notifyRec = rec;

  // new Notification(...) — 안드로이드 크롬에서는 실제로 던지는 경로라 기록만 합니다.
  function FakeNotification(title, options) {
    rec.ctor.push({ title, options: options || {} });
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = () => Promise.resolve('granted');
  try {
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
  } catch (error) {}

  // ServiceWorkerRegistration.showNotification(...) — 실제로 표시하지 않고 기록만 합니다.
  try {
    const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
    if (proto) {
      proto.showNotification = function (title, options) {
        rec.sw.push({ title, options: options || {} });
        return Promise.resolve();
      };
    }
  } catch (error) {}

  try {
    navigator.vibrate = function (pattern) {
      rec.vibrate.push(pattern);
      return true;
    };
  } catch (error) {}
})();
"""


def main() -> int:
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME,
                args=['--no-sandbox'],
                env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS},
            )
            ctx = browser.new_context(
                viewport={'width': 390, 'height': 844},
                locale='ko-KR',
                timezone_id='Asia/Seoul',
                permissions=['notifications'],
            )
            ctx.add_init_script(INSTRUMENT)
            page = ctx.new_page()
            page.on('dialog', lambda dialog: dialog.accept())
            errors: list[str] = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            # 1) 앱을 한 번 열어 데모 DB 를 만들고, 엄마 이름의 새 글을 기기에 넣습니다.
            page.goto(BASE + '#as=mem_child1')
            page.wait_for_selector('[data-testid="open-profile"]', timeout=15000)
            seeded = page.evaluate(
                """({ notesKey }) => {
                    const notes = JSON.parse(localStorage.getItem(notesKey) || '[]');
                    notes.unshift({
                      id: 'n_mom_alert_probe',
                      family_id: 'fam_demo',
                      author_id: 'mem_mom',
                      content: '학원 6시 30분이에요',
                      created_at: new Date().toISOString(),
                    });
                    localStorage.setItem(notesKey, JSON.stringify(notes));
                    return notes.length;
                }""",
                {'notesKey': NOTES_KEY},
            )
            check('준비: 엄마 이름의 새 글을 기기에 넣었다', isinstance(seeded, int), str(seeded))

            # 2) 새로 열면(=앱이 화면에 떠 있는 상태) 알림이 나가야 합니다.
            page.reload()
            page.wait_for_selector('[data-testid="family-note-alert"]', timeout=10000)
            visible = page.evaluate('document.visibilityState')
            check('앱이 화면에 떠 있다(visibilityState=visible)', visible == 'visible', visible)
            page.wait_for_timeout(3500)  # serviceWorker.ready 대기 여유

            rec = page.evaluate('window.__notifyRec')
            sw_calls = rec.get('sw', [])
            ctor_calls = rec.get('ctor', [])
            vib = rec.get('vibrate', [])

            check('서비스워커 알림(showNotification)을 불렀다', len(sw_calls) >= 1, json.dumps(sw_calls, ensure_ascii=False)[:200])
            first = sw_calls[0] if sw_calls else {'title': '', 'options': {}}
            check('알림 제목', first['title'] == '💬 우리 가족 한마디', str(first['title']))
            check('알림 본문에 보낸 사람과 내용', '엄마' in str(first['options'].get('body', '')) and '학원 6시 30분이에요' in str(first['options'].get('body', '')), str(first['options'].get('body', '')))
            check('알림 태그', str(first['options'].get('tag', '')).startswith('study-note-'), str(first['options'].get('tag', '')))
            check('renotify: true', first['options'].get('renotify') is True, str(first['options'].get('renotify')))
            check('new Notification(...) 로는 가지 않았다', len(ctor_calls) == 0, str(len(ctor_calls)))
            # 안드로이드 크롬은 사용자가 화면을 한 번도 만지지 않은 상태의 진동을 막고 콘솔에 경고를 남깁니다.
            # 그래서 앱은 그런 경우 진동을 조용히 건너뜁니다(막힌 진동과 결과는 같고 경고만 없습니다).
            check('화면을 만지기 전에는 진동을 부르지 않는다(브라우저 차단 회피)', not vib, str(vib))

            # 화면을 한 번 만진 뒤 오는 새 글에는 진동이 울립니다.
            page.click('[data-testid="family-notes"] h2')
            page.wait_for_timeout(300)
            page.evaluate(
                """({ notesKey }) => {
                    const notes = JSON.parse(localStorage.getItem(notesKey) || '[]');
                    notes.unshift({
                      id: 'n_mom_alert_probe2',
                      family_id: 'fam_demo',
                      author_id: 'mem_mom',
                      content: '수학 5쪽까지예요',
                      created_at: new Date(Date.now() + 1000).toISOString(),
                    });
                    localStorage.setItem(notesKey, JSON.stringify(notes));
                    window.dispatchEvent(new StorageEvent('storage', { key: notesKey }));
                }""",
                {'notesKey': NOTES_KEY},
            )
            page.wait_for_timeout(2500)
            vib2 = page.evaluate('window.__notifyRec').get('vibrate', [])
            check('화면을 만진 뒤 새 글이 오면 진동 [150, 80, 150]', any(list(v) == [150, 80, 150] for v in vib2), str(vib2))

            # 3) 알림판을 눌러도 아직 안 본 배너가 사라지지 않아야 합니다.
            page.click('[data-testid="family-notes"] h2')
            page.wait_for_timeout(600)
            check('알림판을 눌러도 배너는 그대로', page.locator('[data-testid="family-note-alert"]').count() == 1)
            page.click('[data-testid="note-input"]')
            page.wait_for_timeout(400)
            check('알림판 입력칸을 눌러도 배너는 그대로', page.locator('[data-testid="family-note-alert"]').count() == 1)

            # 4) 배너 본문을 누르면 닫히고, 그 글이 붙은 날 알림판으로 갑니다.
            page.click('[data-testid="open-note-alert"]')
            page.wait_for_timeout(500)
            check('배너 누르기: 배너가 사라진다', page.locator('[data-testid="family-note-alert"]').count() == 0)
            board = page.inner_text('[data-testid="family-notes"]')
            check('배너 누르기: 그 글이 그 날 알림판에 보인다', '학원 6시 30분이에요' in board, board.replace('\n', ' / ')[:90])
            month, day = korea_today()
            chip = page.inner_text('[data-testid="notes-date"]')
            check('배너 누르기: 그 글이 붙은 날짜로 맞춰 준다', f'{month}/{day}' in chip, chip)

            page.reload()
            page.wait_for_selector('[data-testid="open-profile"]', timeout=10000)
            page.wait_for_timeout(1800)
            check('닫은 뒤 다시 열면 배너가 없다', page.locator('[data-testid="family-note-alert"]').count() == 0)
            rec2 = page.evaluate('window.__notifyRec')
            check('닫은 뒤에는 알림도 다시 울리지 않는다', len(rec2.get('sw', [])) == 0, str(len(rec2.get('sw', []))))

            # 4-2) ✕ 버튼도 배너만 닫습니다(보던 날짜는 그대로).
            page.evaluate(
                """({ notesKey }) => {
                    const notes = JSON.parse(localStorage.getItem(notesKey) || '[]');
                    notes.unshift({
                      id: 'n_mom_alert_x',
                      family_id: 'fam_demo',
                      author_id: 'mem_mom',
                      content: '우유 사다 놓을게요',
                      created_at: new Date().toISOString(),
                    });
                    localStorage.setItem(notesKey, JSON.stringify(notes));
                }""",
                {'notesKey': NOTES_KEY},
            )
            page.reload()
            page.wait_for_selector('[data-testid="family-note-alert"]', timeout=10000)
            page.click('[data-testid="dismiss-note-alert"]')
            page.wait_for_timeout(500)
            check('✕ 버튼: 배너가 사라진다', page.locator('[data-testid="family-note-alert"]').count() == 0)
            chip_x = page.inner_text('[data-testid="notes-date"]')
            check('✕ 버튼: 날짜를 바꾸지 않는다', f'{month}/{day}' in chip_x, chip_x)

            check('자바스크립트 오류 없음', not errors, ' / '.join(errors)[:200])

            # 5) 서비스 워커가 준비되지 않는 상황(예: 첫 설치 직후)에는 2.5초 뒤 new Notification 으로 넘어갑니다.
            ctx2 = browser.new_context(
                viewport={'width': 390, 'height': 844},
                locale='ko-KR',
                timezone_id='Asia/Seoul',
                permissions=['notifications'],
            )
            ctx2.add_init_script(
                INSTRUMENT
                + """
                try {
                  Object.defineProperty(navigator.serviceWorker, 'ready', {
                    get: () => new Promise(() => {}),
                    configurable: true,
                  });
                } catch (error) {}
                """
            )
            page2 = ctx2.new_page()
            errors2: list[str] = []
            page2.on('pageerror', lambda error: errors2.append(str(error)))
            page2.goto(BASE + '#as=mem_child1')
            page2.wait_for_selector('[data-testid="open-profile"]', timeout=15000)
            page2.evaluate(
                """({ notesKey }) => {
                    localStorage.setItem(notesKey, JSON.stringify([{
                      id: 'n_mom_alert_fallback',
                      family_id: 'fam_demo',
                      author_id: 'mem_mom',
                      content: '저녁 7시에 데리러 가요',
                      created_at: new Date().toISOString(),
                    }]));
                }""",
                {'notesKey': NOTES_KEY},
            )
            page2.reload()
            page2.wait_for_selector('[data-testid="family-note-alert"]', timeout=10000)
            page2.wait_for_timeout(4200)
            rec_fb = page2.evaluate('window.__notifyRec')
            check('워커가 없으면 new Notification 으로 넘어간다', len(rec_fb.get('ctor', [])) == 1, str(len(rec_fb.get('ctor', []))))
            check('넘어간 알림 본문', '엄마' in str((rec_fb.get('ctor') or [{}])[0].get('options', {}).get('body', '')), str((rec_fb.get('ctor') or [{}])[0].get('options', {}).get('body', '')))
            check('워커가 없을 때는 showNotification 을 부르지 않는다', len(rec_fb.get('sw', [])) == 0, str(len(rec_fb.get('sw', []))))
            check('자바스크립트 오류 없음 (워커 없음)', not errors2, ' / '.join(errors2)[:200])

            browser.close()
    finally:
        server.kill()

    print()
    if failures:
        print(f'{len(failures)}개 실패: ' + ', '.join(failures))
        return 1
    print('모두 통과')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
