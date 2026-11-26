/**
 * 시즌 티어 계산 단위 검증 — XP 구간 / 세부 단계 / 연속 100%(주말·공휴일 제외)
 *   + ⚖️ 완료 시점별 XP 차등(당일 100% · 하루 지남 50% · 이틀 이상 25%) · 취소 시 회수
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
  xpForTask,
  xpPercentForDelay,
  xpAmountForDelay,
  formatXp,
  delayLabel,
  completionDateOf,
  xpChangeForStatus,
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

/* ── 5. ⚖️ 완료 시점별 XP 차등 · 취소 회수 ─────────────────────── */

/** 완료 시각을 직접 정해 넣는 항목 (verified_at = ISO 타임스탬프) */
function done(memberId, due, completedIso, i = 0, extra = {}) {
  return {
    ...task(memberId, due, 'verified', i),
    verified_at: completedIso,
    ...extra,
  };
}
const open = (memberId, due, i = 0) => task(memberId, due, 'todo', i);

check('0일 → 100%', xpPercentForDelay(0), 100);
check('1일 → 50%', xpPercentForDelay(1), 50);
check('2일 → 25%', xpPercentForDelay(2), 25);
check('5일도 25%', xpPercentForDelay(5), 25);
check('음수(미래 날짜)는 100% 로 방어', xpPercentForDelay(-1), 100);
check('당일 10 XP', xpAmountForDelay(0), 10);
check('하루 지남 5 XP', xpAmountForDelay(1), 5);
check('이틀 지남 2.5 XP', xpAmountForDelay(2), 2.5);
check('나흘 지남도 2.5 XP', xpAmountForDelay(4), 2.5);
check('XP 표기 10', formatXp(10), '10');
check('XP 표기 2.5', formatXp(2.5), '2.5');
check('XP 표기 397.5', formatXp(397.5), '397.5');
check('XP 표기 0', formatXp(0), '0');
check('이름: 당일 100%', delayLabel(0), '당일 100%');
check('이름: 하루 지남 50%', delayLabel(1), '하루 지남 50%');
check('이름: 이틀 이상 25%', delayLabel(3), '이틀 이상 25%');

// 한국 시간 기준 — due 2026-11-24
const onTime = xpForTask(done('c1', '2026-11-24', '2026-11-24T10:00:00+09:00'));
check('당일 완료 → 10 XP', onTime.xp, 10);
check('당일 완료 → 100%', onTime.percent, 100);
const oneDay = xpForTask(done('c1', '2026-11-24', '2026-11-25T08:00:00+09:00'));
check('하루 뒤 완료 → 5 XP', oneDay.xp, 5);
check('하루 뒤 완료 → 지연 1일', oneDay.delayDays, 1);
const twoDays = xpForTask(done('c1', '2026-11-24', '2026-11-26T23:50:00+09:00'));
check('이틀 뒤 완료 → 2.5 XP', twoDays.xp, 2.5);
check('이틀 뒤 완료 → 지연 2일', twoDays.delayDays, 2);
check(
  '나흘 뒤 완료도 2.5 XP',
  xpForTask(done('c1', '2026-11-24', '2026-11-28T09:00:00+09:00')).xp,
  2.5,
);

// UTC 로 저장된 시각도 한국 날짜로 셉니다: 11-24T14:30Z = 11/24 23:30 KST(당일) / 15:30Z = 11/25 00:30 KST(하루)
check(
  'UTC 11/24 23:30 KST → 당일 100%',
  xpForTask(done('c1', '2026-11-24', '2026-11-24T14:30:00.000Z')).xp,
  10,
);
check(
  'UTC 11/25 00:30 KST → 하루 지남 50%',
  xpForTask(done('c1', '2026-11-24', '2026-11-24T15:30:00.000Z')).xp,
  5,
);
check(
  '한국 시간 자정 직후 완료는 다음 날로 셈',
  xpForTask(done('c1', '2026-11-24', '2026-11-24T15:30:00.000Z')).delayDays,
  1,
);

// 예전 행 호환 — verified_at 이 없으면 updated_at, 그것도 없으면 due_date
const legacyUpdated = done('c1', '2026-11-24', null, 0, { updated_at: '2026-11-26T09:00:00+09:00' });
check('verified_at 없음 → updated_at 으로 지연 계산', xpForTask(legacyUpdated).delayDays, 2);
check('verified_at 없음 → updated_at 으로 2.5 XP', xpForTask(legacyUpdated).xp, 2.5);
check('예전 행 표시', completionDateOf(legacyUpdated).legacy, true);
const legacyBare = done('c1', '2026-11-24', null, 0, { updated_at: null });
check('시각이 아예 없으면 due_date 로(당일)', xpForTask(legacyBare).xp, 10);
check(
  '완료한 항목은 오늘 날짜와 상관없이 같은 XP',
  xpForTask(done('c1', '2026-11-24', '2026-11-25T08:00:00+09:00'), '2027-01-01').xp,
  5,
);

// 아직 안 한 지난 항목 → 오늘 완료하면 받을 XP 미리보기
const openYesterday = xpForTask(open('c1', '2026-11-25'), '2026-11-26');
check('어제 항목을 오늘 완료하면 5 XP', openYesterday.xp, 5);
check('모레 완료하면 2.5 XP', xpForTask(open('c1', '2026-11-25'), '2026-11-27').xp, 2.5);

// 하루 안의 합계 — 지연 감점은 항목에만, 100% 보너스는 그날을 다 채우면 그대로
const mixedDay = [
  done('c1', '2026-11-24', '2026-11-24T20:00:00+09:00', 0),
  done('c1', '2026-11-24', '2026-11-25T20:00:00+09:00', 1),
  done('c1', '2026-11-24', '2026-11-27T20:00:00+09:00', 2),
];
const mixedStats = computeSeasonStats(mixedDay, 'c1', '2026-11-27');
check('섞인 날: 항목 XP 10 + 5 + 2.5', mixedStats.days.find((d) => d.date === '2026-11-24').itemXp, 17.5);
check('섞인 날: 100% 보너스 +20 은 그대로', mixedStats.days.find((d) => d.date === '2026-11-24').xp, 37.5);
check('섞인 날: 지연 완료 2개', mixedStats.days.find((d) => d.date === '2026-11-24').lateVerified, 2);
check('이번 시즌 지연 항목 수', mixedStats.lateVerified, 2);
check('합계 37.5 XP', mixedStats.xp, 37.5);
check('소수 XP 도 티어 계산에 그대로 (37.5 → 브론즈 II)', mixedStats.level.title, '브론즈 II');

const lateOnly = [
  done('c1', '2026-11-24', '2026-11-26T20:00:00+09:00', 0),
  done('c1', '2026-11-24', '2026-11-26T20:10:00+09:00', 1),
  done('c1', '2026-11-24', '2026-11-26T20:20:00+09:00', 2),
  done('c1', '2026-11-24', '2026-11-26T20:30:00+09:00', 3),
];
check('모두 이틀 지나 완료 → 4 × 2.5 = 10 XP + 100% 20', computeSeasonStats(lateOnly, 'c1', '2026-11-26').xp, 30);

// 취소(되돌리기) → 그 항목 XP + 그날 100% 보너스까지 정확히 회수
const revokeBase = [
  done('c1', '2026-11-24', '2026-11-24T20:00:00+09:00', 0),
  done('c1', '2026-11-24', '2026-11-24T20:30:00+09:00', 1),
];
const revoke = xpChangeForStatus(revokeBase, revokeBase[1], 'todo', { todayIso: '2026-11-25' });
check('되돌리기 전 XP 40 (10+10+20)', revoke.before, 40);
check('되돌리기 후 XP 10 (남은 1건만 · 100% 보너스는 사라짐)', revoke.after, 10);
check('회수량 -30', revoke.delta, -30);
check('항목 XP 변화 -10', revoke.itemDelta, -10);
check('보너스 변화 -20 (100% 보너스 사라짐 · 연속 없음)', revoke.bonusDelta, -20);
check('이번 시즌 회수', revoke.currentSeason, true);

// 지연 완료한 항목을 되돌리면 깎인 만큼(5 XP)만 회수
const revokeLate = xpChangeForStatus(
  [done('c1', '2026-11-24', '2026-11-25T09:00:00+09:00', 0), open('c1', '2026-11-24', 1)],
  done('c1', '2026-11-24', '2026-11-25T09:00:00+09:00', 0),
  'todo',
  { todayIso: '2026-11-26' },
);
check('지연 완료 되돌리기 → 5 XP 만 회수', revokeLate.delta, -5);
check('지연 완료 되돌리기 → 항목 변화 -5', revokeLate.itemDelta, -5);

// 연속 100% 가 끊겨 다음 날 보너스까지 회수되는 경우
const streakBase = [
  done('c1', '2026-11-20', '2026-11-20T20:00:00+09:00'),
  done('c1', '2026-11-23', '2026-11-23T20:00:00+09:00'),
  done('c1', '2026-11-24', '2026-11-24T20:00:00+09:00'),
];
const streakBefore = computeSeasonStats(streakBase, 'c1', '2026-11-24').xp;
check('3일 연속 100% XP (30+30+40)', streakBefore, 100);
const streakRevoke = xpChangeForStatus(streakBase, streakBase[1], 'todo', { todayIso: '2026-11-24' });
check('11/23 되돌리기 → 회수 -40 (항목 10 + 100% 20 + 다음 날 연속 10)', streakRevoke.delta, -40);
check('11/23 되돌리기 → 항목 10 · 보너스 30', [streakRevoke.itemDelta, streakRevoke.bonusDelta], [-10, -30]);
check('11/23 되돌리기 → 연속 100% 가 3일차에서 1일차로', computeSeasonStats([streakBase[0], open('c1','2026-11-23'), streakBase[2]], 'c1', '2026-11-24').streak, 1);

// 되돌린 뒤 다시 완료하면 지금 시각 기준으로 다시 셈 (오래 미뤄둔 만큼 적게)
const redoToday = xpChangeForStatus([open('c1', '2026-11-24')], open('c1', '2026-11-24'), 'verified', {
  completedAt: '2026-11-26T21:00:00+09:00',
  todayIso: '2026-11-26',
});
check('이틀 뒤 다시 완료 → +22.5 (2.5 + 100% 20)', redoToday.delta, 22.5);

// 지난 시즌(지난달) 기록에서도 회수됩니다
const lastMonth = [done('c1', '2026-10-30', '2026-10-30T20:00:00+09:00')];
check('지난달 항목 XP 30', computePastSeason(lastMonth, 'c1', '2026-10').xp, 30);
const lastMonthRevoke = xpChangeForStatus(lastMonth, lastMonth[0], 'todo', { todayIso: '2026-11-26' });
check('지난 시즌 회수 -30', lastMonthRevoke.delta, -30);
check('지난 시즌 표시', lastMonthRevoke.currentSeason, false);
check('지난 시즌 회수 뒤 0', lastMonthRevoke.after, 0);

// 하루가 완성되지 않으면 100% 보너스 없이 항목 XP 만
check(
  '1/2 완료면 100% 보너스 없음',
  computeSeasonStats([done('c1', '2026-11-24', '2026-11-24T20:00:00+09:00'), open('c1', '2026-11-24', 1)], 'c1', '2026-11-24').xp,
  10,
);

/* ── 6. 보상 뽑기 ──────────────────────────────────────────── */
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
