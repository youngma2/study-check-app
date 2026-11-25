/**
 * 시즌 티어 계산 단위 검증 — XP 구간 / 세부 단계 / 연속 100%(주말·공휴일 제외)
 *   사용법: node scripts/verify-season.mjs   (esbuild 로 src/lib/season.ts 를 묶어 검사합니다)
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'node_modules', '.cache', 'season-test.mjs');
execFileSync(
  path.join(root, 'node_modules', '.bin', 'esbuild'),
  ['src/lib/season.ts', '--bundle', '--format=esm', `--outfile=${bundle}`, '--platform=node', '--log-level=error'],
  { cwd: root, stdio: 'inherit' },
);

const {
  computeSeasonStats,
  computePastSeason,
  levelForXp,
  levelOfIndex,
  previousSeason,
  seasonEnd,
  pickRewardMinutes,
  TIERS,
} = await import(`file://${bundle}`);

let fails = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`}`);
  if (!ok) fails += 1;
}

function task(memberId, due, status, i = 0, title = '수학') {
  return {
    id: `t_${memberId}_${due}_${i}`,
    family_id: 'fam',
    member_id: memberId,
    title,
    subject: 'math',
    due_date: due,
    status,
    created_by: memberId,
    created_at: `${due}T00:00:00.000Z`,
    verified_by: status === 'verified' ? 'mem_dad' : null,
    verified_at: status === 'verified' ? `${due}T12:00:00.000Z` : null,
  };
}

/* ── 1. 티어 구간 ───────────────────────────────────────────── */
const bounds = [
  [0, '브론즈 III'], [33, '브론즈 III'], [34, '브론즈 II'], [67, '브론즈 II'], [68, '브론즈 I'], [99, '브론즈 I'],
  [100, '실버 III'], [149, '실버 III'], [150, '실버 II'], [200, '실버 I'], [249, '실버 I'],
  [250, '골드 III'], [316, '골드 III'], [317, '골드 II'], [384, '골드 I'], [449, '골드 I'],
  [450, '플래티넘 III'], [533, '플래티넘 III'], [534, '플래티넘 II'], [618, '플래티넘 I'], [699, '플래티넘 I'],
  [700, '다이아 III'], [799, '다이아 III'], [800, '다이아 II'], [900, '다이아 I'], [999, '다이아 I'],
  [1000, '마스터'], [99999, '마스터'],
];
for (const [xp, title] of bounds) {
  check(`XP ${xp} → ${title}`, levelForXp(xp).title, title);
}

/* ── 2. 칸 번호 ↔ XP 왕복 ───────────────────────────────────── */
check('칸 0 = 브론즈 III', levelOfIndex(0).title, '브론즈 III');
check('칸 3 = 실버 III', levelOfIndex(3).title, '실버 III');
check('칸 15 = 마스터', levelOfIndex(15).title, '마스터');
check('마스터는 다음 칸 없음', levelOfIndex(15).nextXp, null);
for (let index = 0; index < 15; index += 1) {
  const level = levelOfIndex(index);
  check(`칸 ${index}(${level.title}) 시작 XP ${level.minXp} → 같은 칸`, levelForXp(level.minXp).index, index);
  if (index > 0) check(`칸 ${index} 바로 아래 XP ${level.minXp - 1} → 이전 칸`, levelForXp(level.minXp - 1).index, index - 1);
}
check('티어 6개', TIERS.map((tier) => tier.label), ['브론즈', '실버', '골드', '플래티넘', '다이아', '마스터']);

/* ── 3. XP: 확인 완료 10 / 100% 20 / 3일째부터 연속 10 ────────── */
// 11/20(금) 100%, 토·일 쉽니다, 11/23(월) 100%, 11/24(화) 100%, 11/25(수)는 진행 중
const tasksA = [
  task('c1', '2026-11-20', 'verified', 0),
  task('c1', '2026-11-23', 'verified', 0), task('c1', '2026-11-23', 'verified', 1),
  task('c1', '2026-11-24', 'verified', 0), task('c1', '2026-11-24', 'verified', 1),
  task('c1', '2026-11-25', 'verified', 0), task('c1', '2026-11-25', 'todo', 1),
];
const statsA = computeSeasonStats(tasksA, 'c1', '2026-11-25');
// 11/20: 10+20=30 (연속1), 11/23: 20+20=40 (연속2), 11/24: 20+20+10=50 (연속3 보너스), 11/25: 10 (진행 중)
check('XP 합계 (금 100% → 주말 건너뜀 → 월·화 100% → 3일째 보너스)', statsA.xp, 30 + 40 + 50 + 10);
check('연속 100% = 3일차 (주말은 빼고 셈)', statsA.streak, 3);
check('오늘(11/25)은 아직 100% 아님', statsA.todayAllClear, false);
check('100% 달성일 수 (주말 포함 전체)', statsA.allClearDays, 3);
check('확인 완료 항목 수', statsA.verified, 6);
check('티어 = 실버 III(130 XP)', statsA.level.title, '실버 III');

// 평일 미달이면 연속이 끊깁니다 (다음 날 볼 때)
const statsB = computeSeasonStats(tasksA, 'c1', '2026-11-26');
check('11/25 평일 미달 → 연속 0', statsB.streak, 0);
check('미달이어도 XP 는 그대로', statsB.xp, statsA.xp);

// 오늘 아직 진행 중이면 어제까지의 연속을 보여 줍니다
const tasksC = [
  task('c1', '2026-11-19', 'verified', 0),
  task('c1', '2026-11-23', 'verified', 0),
  task('c1', '2026-11-24', 'verified', 0),
  task('c1', '2026-11-25', 'todo', 0),
];
check('오늘 미완료(진행 중) → 어제까지 3일차', computeSeasonStats(tasksC, 'c1', '2026-11-25').streak, 3);

// 공휴일(2026-12-25 금)은 연속 계산에서 빠집니다
const tasksD = [
  task('c1', '2026-12-24', 'verified', 0),
  task('c1', '2026-12-25', 'todo', 0), task('c1', '2026-12-25', 'todo', 1),
  task('c1', '2026-12-28', 'verified', 0),
];
const statsD = computeSeasonStats(tasksD, 'c1', '2026-12-28');
check('성탄절(금) 미달은 연속을 끊지 않음 → 2일차', statsD.streak, 2);
check('공휴일 미달은 XP 만 0', statsD.xp, 30 + 0 + 30);
check('연속 첫날은 보너스 없음(2일차까지 0)', statsD.days.find((day) => day.date === '2026-12-24').xp, 30);

// 통화 항목은 XP 에서 제외
const tasksE = [
  task('c1', '2026-11-24', 'verified', 0),
  task('c1', '2026-11-24', 'verified', 1, '📞 통화 1 (하교 후)'),
];
check('📞 통화 항목은 XP·100% 계산에서 제외', computeSeasonStats(tasksE, 'c1', '2026-11-24').xp, 10 + 20);

// 다른 아이 항목은 내 XP 가 아닙니다
const tasksF = [task('c1', '2026-11-24', 'verified', 0), task('c2', '2026-11-24', 'verified', 0)];
check('다른 아이 XP 는 내 것 아님', computeSeasonStats(tasksF, 'c1', '2026-11-24').xp, 30);

/* ── 4. 지난달/월 경계 ──────────────────────────────────────── */
check('지난달 = 2026-10', previousSeason('2026-11'), '2026-10');
check('1월의 지난달 = 지난해 12월', previousSeason('2027-01'), '2026-12');
check('11월 마지막 날', seasonEnd('2026-11'), '2026-11-30');
check('윤년 2월 마지막 날', seasonEnd('2028-02'), '2028-02-29');

const past = computePastSeason([task('c1', '2026-10-05', 'verified', 0), task('c1', '2026-10-06', 'verified', 0)], 'c1', '2026-10');
check('지난달 XP (10/5 100% + 10/6)', past.xp, 30 + 30);
check('지난달 최고 티어 (60 XP = 브론즈 II)', past.level.title, '브론즈 II');

// 이번 달 밖 항목은 이번 달 XP 에서 빠집니다
const crossMonth = computeSeasonStats([task('c1', '2026-10-31', 'verified', 0), task('c1', '2026-11-01', 'verified', 0)], 'c1', '2026-11-01');
check('지난달 항목은 이번 달 XP 에서 제외', crossMonth.xp, 30);

/* ── 5. 보상 뽑기 ──────────────────────────────────────────── */
const pool = [5, 10, 15, 20];
const picked = new Set();
for (let i = 0; i < 400; i += 1) picked.add(pickRewardMinutes(pool, 2));
check('뽑기는 정해진 보상 안에서만', [...picked].sort((a, b) => a - b), [5, 10, 15, 20]);
const highPicks = [];
for (let i = 0; i < 3000; i += 1) highPicks.push(pickRewardMinutes(pool, 5));
const highAvg = highPicks.reduce((sum, value) => sum + value, 0) / highPicks.length;
check('상위 티어는 평균 보상이 더 큼 (다이아 16분 이상)', highAvg > 16, true);
check('보상 풀이 비면 기본값', [5, 10, 15, 20].includes(pickRewardMinutes([], 2)), true);

console.log(`\n${fails === 0 ? '모두 통과' : `${fails}개 실패`}`);
process.exit(fails === 0 ? 0 : 1);
