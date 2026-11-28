"""단위 검증용 묶음 만들기 — season/report/defaults/app-settings 를 esbuild 로 묶고
node 로 규칙(② 100% 당일 체크, ⑧ 버스트 소급 금지, ⑪ 티어 난이도, ④⑤ 기본 목록)을 확인합니다.

    python3 scripts/verify-batch2-units.py
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp-b2'
NODE_BIN = '/workspace/.tools/node/bin'

CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, extra: str = '') -> None:
    CHECKS.append((name, bool(cond), extra))
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}", flush=True)


def main() -> int:
    OUT.mkdir(exist_ok=True)
    env = os.environ.copy()
    env['PATH'] = NODE_BIN + os.pathsep + env.get('PATH', '')
    entries = ['season', 'report', 'defaults', 'app-settings']
    for entry in entries:
        result = subprocess.run(
            [str(ROOT / 'node_modules' / '.bin' / 'esbuild'), f'src/lib/{entry}.ts', '--bundle', '--format=esm',
             f'--outdir={OUT}'],
            cwd=ROOT, env=env, capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(result.stderr, file=sys.stderr)
            return 1

    script = OUT / 'run.mjs'
    script.write_text(
        """
import { levelForXp, computePastSeason, recentSeasons, tierThreshold, settlementOf } from './season.js';
import { streakThrough, computeMemberReport } from './report.js';
import { autoBurstOn, itemsForDay, normalizeAppSettings, withRoutineItems } from './app-settings.js';
import { defaultItemsForDay } from './defaults.js';

const ok = (name, cond, extra = '') => console.log(`RESULT\\t${cond ? 'PASS' : 'FAIL'}\\t${name}\\t${extra}`);
const day = (offset) => {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
};
const member = { id: 'c1', family_id: 'f', name: '아이', role: 'child', grade: '중1', emoji: '🙂', color: 'sky', presets: [] };

// ⑪ 기본 문턱값
ok('기본 0%: 200 XP = 실버', levelForXp(200, 0).key === 'silver', levelForXp(200, 0).title);
ok('기본 0%: 449 XP = 실버 I', levelForXp(449, 0).title === '실버 I', levelForXp(449, 0).title);
ok('기본 0%: 450 XP = 골드 III', levelForXp(450, 0).title === '골드 III', levelForXp(450, 0).title);
ok('기본 0%: 800 = 플래티넘 III', levelForXp(800, 0).title === '플래티넘 III', levelForXp(800, 0).title);
ok('기본 0%: 1200 = 다이아 III', levelForXp(1200, 0).title === '다이아 III', levelForXp(1200, 0).title);
ok('기본 0%: 1600 = 마스터', levelForXp(1600, 0).title === '마스터', levelForXp(1600, 0).title);
ok('+5%: 1680 = 마스터', levelForXp(1680, 5).title === '마스터', levelForXp(1680, 5).title);
ok('+5%: 1679 = 다이아', levelForXp(1679, 5).key === 'diamond', levelForXp(1679, 5).title);
ok('tierThreshold(1600,+5)=1680', tierThreshold(1600, 5) === 1680, String(tierThreshold(1600, 5)));

// ② 당일 체크만 100%
const yesterday = day(-1);
const today = day(0);
const tasksLate = [
  { id: 'a', family_id: 'f', member_id: 'c1', title: '수학', subject: 'math', due_date: yesterday, status: 'verified', created_by: 'p', created_at: `${yesterday}T00:00:00Z`, verified_at: `${today}T01:00:00Z` },
  { id: 'b', family_id: 'f', member_id: 'c1', title: '영어', subject: 'english', due_date: yesterday, status: 'verified', created_by: 'p', created_at: `${yesterday}T00:00:00Z`, verified_at: `${yesterday}T10:00:00Z` },
];
const past = computePastSeason(tasksLate, 'c1', yesterday.slice(0, 7));
const dayStat = past.days.find((d) => d.date === yesterday);
ok('② 이월 체크 1건이 있으면 그 날 100% 아님', dayStat && dayStat.allClear === false, JSON.stringify({ allClear: dayStat?.allClear, late: dayStat?.lateVerified }));
ok('② 이월 체크면 그 주 연속 100% 0', streakThrough(tasksLate, 'c1', yesterday, today) === 0, String(streakThrough(tasksLate, 'c1', yesterday, today)));

const tasksOnTime = tasksLate.map((t, i) => i === 0 ? { ...t, due_date: today, verified_at: `${today}T09:00:00Z` } : { ...t, due_date: yesterday });
const rep = computeMemberReport(tasksOnTime, [], 'c1', { mode: 'week', start: yesterday, end: today, season: today.slice(0, 7), label: '', kindLabel: '' }, today);
ok('② 그날 체크만 한 날은 100%', rep.days.find((d) => d.date === today)?.allClear === true);

// ⑧ 자동 버스트 소급 금지
ok('⑧ 자동 버스트: 켠 날 이전 날짜는 꺼짐', autoBurstOn('2026-11-20', 7, '2026-11-28') === false);
ok('⑧ 자동 버스트: 켠 날 이후 월말은 켜짐', autoBurstOn('2026-11-28', 7, '2026-11-28') === true);

// ④⑤ 프리셋 항목 — 적용 요일·순서·부모 확인
let settings = normalizeAppSettings({
  presets: { semester: { routines: { c1: { '1': [{ title: '수학', subject: 'math' }], '3': [{ title: '수학', subject: 'math' }], '6': [{ title: '독서록', subject: 'reading' }] } } } },
});
ok('④ 예전 요일별 목록 → 항목으로 변환', itemsForDay(settings, 'c1', 1).length === 1, String(itemsForDay(settings, 'c1', 1).length));
ok('⑤ 같은 공부는 적용 요일 합침 (월·수)', (itemsForDay(settings, 'c1', 3)[0]?.days ?? []).join(',') === '1,3', JSON.stringify(itemsForDay(settings, 'c1', 3)[0]?.days));
settings = withRoutineItems(settings, 'c1', [
  { id: 'i1', title: '수학', subject: 'math', days: [1, 2], order: 0 },
  { id: 'i2', title: '독서록 (아빠 검사)', subject: 'reading', days: [6], order: 1, needParent: true },
]);
ok('⑤ 순서 저장', itemsForDay(settings, 'c1', 6).map((item) => item.title).join('|') === '독서록 (아빠 검사)', itemsForDay(settings, 'c1', 6).map((item) => item.title).join('|'));
const filled = defaultItemsForDay([], member, '2026-11-28', itemsForDay(settings, 'c1', 6), false);
ok('⑬ 부모 확인 항목이 기본 목록에 표시와 함께 들어감', filled.length === 1 && filled[0].needParent === true, JSON.stringify(filled));
const vacation = normalizeAppSettings({ presets: { vacation: { routines: {} } } });
ok('④ 방학 프리셋은 처음에 비어 있음', itemsForDay(vacation, 'c1', 1, 'vacation').length === 0);

// 📅 최근 12개월
const seasons = recentSeasons('2026-11-28', 12);
ok('⑩ 최근 12개월 목록', seasons.length === 12 && seasons[0] === '2026-10' && seasons[11] === '2025-11', seasons.join(','));
const frozen = settlementOf([], 'c1', '2026-10', '2026-11-28', { tierDifficulty: 5 }, { xp: 321, title: '실버 II', tier: 'silver', division: 2, level: 4 });
ok('⑩ 고정된 결산은 이름 그대로', frozen.level.title === '실버 II' && frozen.xp === 321, `${frozen.level.title} ${frozen.xp}`);
"""
    )

    env2 = os.environ.copy()
    env2['PATH'] = NODE_BIN + os.pathsep + env2.get('PATH', '')
    result = subprocess.run([str(pathlib.Path(NODE_BIN) / 'node'), str(script)], cwd=OUT, env=env2, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        return 1
    fails = [line for line in result.stdout.splitlines() if line.startswith('RESULT\tFAIL')]
    print(f"\n단위 검사 {len([l for l in result.stdout.splitlines() if l.startswith('RESULT')])}개 · 실패 {len(fails)}개")
    return 1 if fails else 0


if __name__ == '__main__':
    raise SystemExit(main())
