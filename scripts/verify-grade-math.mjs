/**
 * 학년 자동 진급 · 미래 날짜 완료 잠금 — 계산 로직 단위 검사.
 *
 *   node scripts/verify-grade-math.mjs
 *
 * src/lib/*.ts 를 esbuild 로 묶어 그대로 불러와 검사합니다(브라우저 없이).
 * 날짜는 전부 한국 시간(Asia/Seoul) 기준으로 넣었습니다.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = mkdtempSync(path.join(tmpdir(), 'study-grade-'));

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${error.message}`);
  }
}

const entry = path.join(OUT, 'entry.ts');
writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/grade.ts'))};\n` +
    `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/date.ts'))};\n` +
    `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/store.ts'))};\n`,
);

const bundle = path.join(OUT, 'domain.mjs');
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'silent',
});

const { displayGrade, schoolYearOf, koreaTodayISO, isFutureDate, changeTaskStatus, PermissionError } = await import(
  pathToFileURL(bundle).href
);

/** 한국 시간 문자열 → Date */
const kst = (iso) => new Date(iso);

/* ------------------------------------------------------------------ */
/* 1. 학년도 경계 (3월 1일)                                             */
/* ------------------------------------------------------------------ */

check('학년도: 2026-11-24 → 2026', () => assert.equal(schoolYearOf(kst('2026-11-24T09:00:00+09:00')), 2026));
check('학년도: 2027-02-28 → 2026 (아직 지난 학년도)', () =>
  assert.equal(schoolYearOf(kst('2027-02-28T23:59:00+09:00')), 2026));
check('학년도: 2027-03-01 → 2027', () =>
  assert.equal(schoolYearOf(kst('2027-03-01T00:00:00+09:00')), 2027));
check('학년도: UTC 로는 2/28 이어도 한국은 3/1 → 2027', () =>
  assert.equal(schoolYearOf(new Date('2027-02-28T15:00:00Z')), 2027));

/* ------------------------------------------------------------------ */
/* 2. 요청한 학년 예시                                                   */
/* ------------------------------------------------------------------ */

const d024 = (grade) => displayGrade(grade, 2026, kst('2026-11-24T10:00:00+09:00'));
const d0228 = (grade) => displayGrade(grade, 2026, kst('2027-02-28T23:30:00+09:00'));
const d0301 = (grade) => displayGrade(grade, 2026, kst('2027-03-01T08:00:00+09:00'));
const d2029 = (grade) => displayGrade(grade, 2026, kst('2029-03-01T08:00:00+09:00'));

check('2026-11-24: 초4 → 초4', () => assert.equal(d024('초4'), '초4'));
check('2026-11-24: 중1 → 중1', () => assert.equal(d024('중1'), '중1'));
check('2027-02-28: 초4 → 초4 (학기 중)', () => assert.equal(d0228('초4'), '초4'));
check('2027-02-28: 중1 → 중1 (학기 중)', () => assert.equal(d0228('중1'), '중1'));
check('2027-03-01: 초4 → 초5', () => assert.equal(d0301('초4'), '초5'));
check('2027-03-01: 중1 → 중2', () => assert.equal(d0301('중1'), '중2'));
check('2029-03-01: 초4 → 중1 (초6 다음은 중1)', () => assert.equal(d2029('초4'), '중1'));
check('2029-03-01: 중1 → 고1 (중3 다음은 고1)', () => assert.equal(d2029('중1'), '고1'));

/* ------------------------------------------------------------------ */
/* 3. 경계·예외                                                        */
/* ------------------------------------------------------------------ */

check('3/1 자정 직전(2/28 23:59)에는 아직 안 오름', () =>
  assert.equal(displayGrade('초5', 2026, kst('2027-02-28T23:59:59+09:00')), '초5'));
check('3/1 자정에는 오름', () =>
  assert.equal(displayGrade('초5', 2026, kst('2027-03-01T00:00:00+09:00')), '초6'));
check('고3 → 이듬해 3월 1일 졸업', () =>
  assert.equal(displayGrade('고3', 2026, kst('2027-03-01T08:00:00+09:00')), '졸업'));
check('졸업은 더 지나도 졸업', () => assert.equal(d2029('고3'), '졸업'));
check('기준 학년도보다 이전이면 그대로', () =>
  assert.equal(displayGrade('중2', 2026, kst('2024-05-01T09:00:00+09:00')), '중2'));
check('학년 형태가 아니면 그대로: 유치원', () => assert.equal(d0301('유치원'), '유치원'));
check('학년 형태가 아니면 그대로: 빈 값', () => assert.equal(displayGrade('', 2026, kst('2029-03-01T09:00:00+09:00')), ''));
check('학년 형태가 아니면 그대로: 중4', () => assert.equal(d2029('중4'), '중4'));
check('초6 다음은 중1 (한 번에 두 단계도 이어짐)', () =>
  assert.equal(displayGrade('초6', 2026, kst('2028-03-01T09:00:00+09:00')), '중2'));
check('baseYear 를 바꾸면 그 해 기준으로 셈', () =>
  assert.equal(displayGrade('초1', 2027, kst('2027-05-01T09:00:00+09:00')), '초1'));

/* ------------------------------------------------------------------ */
/* 4. 한국 날짜 · 미래 판정                                             */
/* ------------------------------------------------------------------ */

check("koreaTodayISO: UTC 15:30 = 한국 다음 날 00:30", () =>
  assert.equal(koreaTodayISO(new Date('2026-11-24T15:30:00Z')), '2026-11-25'));
check('koreaTodayISO: UTC 14:59 = 한국 같은 날 23:59', () =>
  assert.equal(koreaTodayISO(new Date('2026-11-24T14:59:00Z')), '2026-11-24'));
check('미래 날짜: 내일은 잠금', () => assert.equal(isFutureDate('2026-11-25', '2026-11-24'), true));
check('미래 날짜: 오늘은 잠금 아님', () => assert.equal(isFutureDate('2026-11-24', '2026-11-24'), false));
check('미래 날짜: 지난 날은 잠금 아님', () => assert.equal(isFutureDate('2026-11-20', '2026-11-24'), false));

/* ------------------------------------------------------------------ */
/* 5. store 규칙: 미래 날짜는 완료 불가 (부모·아이 모두)                  */
/* ------------------------------------------------------------------ */

function makeDb() {
  const base = {
    version: 1,
    families: [{ id: 'fam', name: '테스트', created_at: '2026-11-01T00:00:00.000Z' }],
    members: [
      { id: 'mem_dad', family_id: 'fam', name: '아빠', role: 'parent', emoji: '👨🏻', color: 'sky', presets: [], created_at: '2026-11-01T00:00:00.000Z' },
      { id: 'mem_kid', family_id: 'fam', name: '아이', role: 'child', grade: '초4', emoji: '⚡', color: 'amber', presets: [], created_at: '2026-11-01T00:00:00.000Z' },
    ],
    tasks: [],
  };
  const task = (id, due_date, status = 'todo') => ({
    id,
    family_id: 'fam',
    member_id: 'mem_kid',
    title: `숙제 ${id}`,
    subject: 'math',
    due_date,
    status,
    created_by: 'mem_kid',
    created_at: '2026-11-01T00:00:00.000Z',
    verified_by: null,
    verified_at: null,
  });
  base.tasks = [task('t_future', '2026-12-01'), task('t_today', '2026-11-24'), task('t_past', '2026-11-20')];
  return { db: base, kid: base.members[1], dad: base.members[0] };
}

const TODAY = '2026-11-24';

check('store: 아이가 미래 날짜를 완료하려 하면 거부', () => {
  const { db, kid } = makeDb();
  assert.throws(() => changeTaskStatus(db, kid, 't_future', 'verified', TODAY), PermissionError);
});
check('store: 거부 문구가 이유를 알려 준다', () => {
  const { db, kid } = makeDb();
  assert.throws(() => changeTaskStatus(db, kid, 't_future', 'verified', TODAY), /아직 날짜가 되지 않은 공부/);
});
check('store: 부모도 미래 날짜는 완료할 수 없다', () => {
  const { db, dad } = makeDb();
  assert.throws(() => changeTaskStatus(db, dad, 't_future', 'verified', TODAY), PermissionError);
});
check('store: 미래 날짜는 그대로 할 일로 남는다', () => {
  const { db, kid } = makeDb();
  let after = db;
  try {
    after = changeTaskStatus(db, kid, 't_future', 'verified', TODAY);
  } catch {
    /* 거부가 정상 */
  }
  const task = after.tasks.find((item) => item.id === 't_future');
  assert.equal(task.status, 'todo');
  assert.equal(task.verified_at, null);
});
check('store: 오늘 날짜는 완료된다', () => {
  const { db, kid } = makeDb();
  const after = changeTaskStatus(db, kid, 't_today', 'verified', TODAY);
  const task = after.tasks.find((item) => item.id === 't_today');
  assert.equal(task.status, 'verified');
  assert.equal(task.verified_by, 'mem_kid');
  assert.ok(task.verified_at);
});
check('store: 지난 날짜도 완료된다(몰아서 체크)', () => {
  const { db, kid } = makeDb();
  const after = changeTaskStatus(db, kid, 't_past', 'verified', TODAY);
  assert.equal(after.tasks.find((item) => item.id === 't_past').status, 'verified');
});
check('store: 그날이 되면(오늘=12/01) 미래였던 항목도 완료된다', () => {
  const { db, kid } = makeDb();
  const after = changeTaskStatus(db, kid, 't_future', 'verified', '2026-12-01');
  assert.equal(after.tasks.find((item) => item.id === 't_future').status, 'verified');
});

rmSync(OUT, { recursive: true, force: true });

console.log(`\n=== 통과 ${pass} · 실패 ${failures.length} ===`);
if (failures.length > 0) {
  console.log(failures.map((name) => `- ${name}`).join('\n'));
  process.exit(1);
}
