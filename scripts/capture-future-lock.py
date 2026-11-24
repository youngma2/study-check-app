"""잠긴 완료 버튼 화면 캡처 (README·보고용)."""
from __future__ import annotations

import os
import pathlib
import re
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = '/workspace/.tools/chrome/chrome-headless-shell-linux64/chrome-headless-shell'
CHROME_LIBS = '/workspace/.tools/chrome/lib'
NODE_BIN = '/workspace/.tools/node/bin'
PORT = 4186
BASE = f'http://127.0.0.1:{PORT}/study-check-app/'
OUT = pathlib.Path('/workspace/downloads')

env = os.environ.copy()
env['PATH'] = NODE_BIN + os.pathsep + env.get('PATH', '')
server = subprocess.Popen(
    ['npx', 'vite', 'preview', '--outDir', 'dist-demo', '--port', str(PORT), '--host', '127.0.0.1'],
    cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, preexec_fn=os.setsid,
)
deadline = time.time() + 40
while time.time() < deadline:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        if sock.connect_ex(('127.0.0.1', PORT)) == 0:
            break
    time.sleep(0.3)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'], env={**os.environ, 'LD_LIBRARY_PATH': CHROME_LIBS})
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul', device_scale_factor=2)
        page = ctx.new_page()
        page.goto(BASE + '#as=mem_child2')
        page.wait_for_selector('[data-testid="task-card"]')
        page.get_by_role('button', name=re.compile('11월 25일')).first.click()
        page.wait_for_timeout(500)
        OUT.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT / 'study_app_future_lock.png'))
        print('saved', OUT / 'study_app_future_lock.png')
        browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
