# 📚 공부 체크 (Study Check)

가족이 함께 쓰는 **주간 공부 체크리스트** 웹앱(PWA)입니다.
아이는 공부를 추가하고 **완료**를 누르면 그 시각(`오후 8:42 완료`)이 바로 기록되고, 부모는 확인·되돌리기·삭제를 **부모 관리 PIN**으로 합니다.

- 대상: 아빠 · 엄마 · 첫째(중1) · 둘째(초4)
- 스택: **Vite + React 18 + TypeScript + Tailwind CSS**, 저장은 `localStorage`(데모) 또는 **Supabase**(클라우드)
- 모바일 우선(390×844 기준) · 한국어 UI · PWA 설치 가능(manifest + 서비스 워커)

---

## 1. 실행

```bash
cd study-check-app
npm install
npm run dev      # http://127.0.0.1:5174
npm run build    # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기 (http://127.0.0.1:4174)
```

> Node 18+ 가 필요합니다. 이 작업 환경에는 Node 가 없어서 `/workspace/.tools/node` 에 20.18.0 을 설치해 두었습니다:
> `export PATH=/workspace/.tools/node/bin:$PATH`

## 2. 데모 사용법 (설정 없이 바로)

첫 실행 시 샘플 가족과 이번 주(월~일) 숙제가 자동으로 채워집니다.
상단 오른쪽 **이름 버튼 → 아빠 / 엄마 / 첫째 / 둘째** 을 눌러 시점을 바꾸면 권한 차이를 바로 볼 수 있습니다.

- `http://127.0.0.1:5174/#as=mem_child2` 처럼 해시로 시작 사용자를 지정할 수 있습니다.
- 아이 시점에서는 **부모로 바꾸는 메뉴가 아예 보이지 않습니다.**
- 부모 시점(`#as=mem_dad`, `#as=mem_mom`, 또는 기본 주소)은 **부모 관리 PIN(4자리)** 을 먼저 물어봅니다.
  - Supabase 를 연결하면 PIN 은 **DB 에 bcrypt 해시로만** 저장되고 앱은 서버에 맞는지만 물어봅니다.
    (PIN 숫자는 이 저장소 어디에도 없습니다. `supabase/schema.sql` 의 6번 주석 참고)
  - Supabase 없이 이 기기에만 저장하는 데모 모드에서는, 그 기기에서 처음 부모 화면을 열 때 PIN 을 정합니다(이 기기에만 해시로 저장).
- 선택한 사용자와 데이터는 브라우저 `localStorage`(`study-check.db.v1`)에 남습니다.
- 부모 시점에서 프로필 시트 하단의 **샘플 데이터로 되돌리기** 로 초기화할 수 있습니다.
- Supabase 를 연결하면 같은 링크가 **로그인 없이** 가족 공유 링크가 됩니다(5번 참고).

## 3. 역할별 권한

| 할 수 있는 일 | 부모 (아빠·엄마) | 아이 (첫째·둘째) |
| --- | :---: | :---: |
| 공부 항목 추가 | 다른 아이에게도 추가 | 자기 것만 |
| 항목 수정 | ✅ (PIN) | ❌ |
| 항목 삭제 | ✅ (PIN) | ❌ (버튼 자체가 없음 + 상태 로직·DB 에서 차단) |
| 완료 체크 (`todo → verified`, 시각 기록) | ✅ | 자기 것만 |
| 완료 되돌리기 (`verified → todo`) | ✅ (PIN) | ❌ |
| 공부 복사(다른 날로) | ✅ | 자기 것만 |
| 부모 화면 열기 / 아이→부모 전환 | PIN 입력 | ❌ (메뉴 자체가 없음) |
| 구성원 이름 바꾸기 | ✅ (PIN) | ❌ |

상태 흐름: **할 일(todo) → 완료(verified)** — 완료를 누른 순간 `verified_at` 에 시각이 남고 카드에 `오후 8:42 완료` 로 보입니다.
(예전 두 단계 흐름의 `pending_verification` 은 옛 데이터 호환을 위해 남아 있고, 화면에서는 '확인 대기'로 보입니다.)

권한은 UI(버튼 숨김)·도메인 로직(`src/lib/store.ts`)·DB RPC(`study_*`) 세 곳에서 검사합니다.
RLS 는 읽기만 열고 직접 INSERT/UPDATE/DELETE 는 막아 두어, 앱을 거치지 않은 쓰기는 DB 에서 거부됩니다.
부모 관리 PIN 은 DB 의 `family_secrets`(RLS 정책 없음)에 bcrypt 해시로만 있고, 되돌리기·삭제·이름 바꾸기 RPC 가 `p_pin` 을 확인합니다.

## 4. 화면 구성

- **주간 달력 스트립**: 월~일, 이전/다음 주, `오늘` 버튼. 날짜별 진행률 막대(확인 대기/진행 중/모두 완료).
  - **공휴일과 일요일은 빨간색**입니다. 공휴일에는 날짜 옆에 빨간 점이 붙고, 스트립 아래에 이번 주 공휴일 이름이 나옵니다.
    (2026–2027 관공서 공휴일 · 설날·부처님오신날·추석 · 대체공휴일 포함, `src/lib/date.ts`)
- **날짜 요약**: 전체·완료 수, 진행률 링. 공휴일이면 날짜 옆에 빨간 공휴일 이름 배지.
- **복사 줄**: `이 날 공부 복사` · `어제 것 가져오기` — 날짜를 골라 여러 날에 한 번에 붙여넣습니다.
- **아이별 체크리스트**: 상태 배지(할 일 / 완료), 완료 카드에는 `오후 8:42 완료` 처럼 체크한 시각.
- **복사 시트**: 누구 공부를(아이별) · 며칠에 붙여넣을지(이번 주 날짜·내일·모레·다른 날) 고르고 복사. 이미 있는 숙제는 건너뜁니다.
- **추가/수정 시트**: 아이 선택, 과목, 제목(+자주 쓰는 항목 프리셋), 날짜.
- **역할 전환 시트**: 부모/아이 목록, 저장 상태 표시, `관리 잠금`, (부모) 이름 바꾸기.
- **부모 PIN 잠금 화면**: 부모 시점으로 열면 4자리 숫자 키패드로 잠금을 풉니다. 아래에서 아이 시점으로 바로 바꿀 수 있습니다.

## 5. Supabase(가족 실시간 동기화) 연결

**로그인·매직링크를 쓰지 않습니다.** 가족 링크를 아는 기기끼리 같은 데이터를 보고,
쓰기는 DB RPC 가 `actor`(누가)와 (필요하면) 부모 관리 PIN 을 받아 권한을 검사합니다.

1. Supabase 프로젝트 → **SQL Editor** 에서 [`supabase/schema.sql`](supabase/schema.sql) 전체 실행 (한 번, 여러 번 실행해도 안전)
   - 배포 페이지에 복사 버튼이 있는 안내 페이지도 있습니다: **https://youngma2.github.io/study-check-app/setup.html**
2. **부모 관리 PIN 정하기** — SQL Editor 에서 한 번만 (PIN 숫자는 저장소에 적지 않습니다):
   ```sql
   select public.study_set_parent_pin('fam_our_home', '네자리PIN');
   ```
   - 나중에 바꿀 때: `select public.study_set_parent_pin('fam_our_home', '새PIN', '지금PIN');`
   - PIN 은 `family_secrets` 에 bcrypt 해시(`crypt` + `gen_salt('bf')`)로만 저장되고, 그 표는 anon 키로 읽을 수 없습니다(RLS 정책 없음).
3. **Project Settings → API** 의 Project URL / **Publishable key** 를 `.env.local` 에 넣기 (`.env.example` 복사)
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```
   > publishable(anon) 키는 브라우저 번들에 들어가는 **공개 키**입니다. `service_role` / `sb_secret_` 키는 절대 넣지 마세요.
4. `npm run build` → 폰끼리 실시간 동기화가 켜집니다.

SQL 을 실행하면 가족과 이번 주 샘플이 함께 들어가고, 아래 링크가 바로 동작합니다.

| 누구 | 링크 |
| --- | --- |
| 아빠 | `https://youngma2.github.io/study-check-app/#as=mem_dad` |
| 엄마 | `https://youngma2.github.io/study-check-app/#as=mem_mom` |
| 첫째 | `https://youngma2.github.io/study-check-app/#as=mem_child1` |
| 둘째 | `https://youngma2.github.io/study-check-app/#as=mem_child2` |

**SQL 실행 전(표가 없을 때)** 앱은 죽지 않고 이 기기 저장(localStorage)으로 계속 동작하며,
목록 위에 `가족 동기화 준비 중` 안내를 보여 줍니다. SQL 을 실행하면 새로고침만 하면 연결됩니다.

### 동기화 방식

- **읽기**: `families` / `family_members` / `tasks` 를 RLS(`select` 허용)로 읽습니다.
- **쓰기**: 표를 직접 고치지 않고 아래 RPC 만 사용합니다(RLS 는 직접 쓰기를 막음).

| RPC | 하는 일 | 허용 |
| --- | --- | --- |
| `study_add_task` | 숙제 추가 (복사도 이 RPC 로 한 건씩) | 부모: 아무 아이, 아이: 자기 것만 |
| `study_update_task` | 제목·과목·날짜 수정 | 부모만 |
| `study_set_task_status` | 완료 체크(시각 기록) / 되돌리기 | 완료: 부모 모두 · 아이 자기 것 / 되돌리기: 부모 + `p_pin` |
| `study_delete_task` | 삭제 | 부모 + `p_pin` |
| `study_verify_parent_pin` | 부모 관리 PIN 확인 | 누구나(맞는지 boolean 만) |
| `study_set_parent_pin` | 부모 관리 PIN 정하기/바꾸기 | 처음 정할 때만 PIN 없이, 이후에는 지금 PIN 필요 |
| `study_rename_member` | 구성원 이름 바꾸기 | 부모 + `p_pin` |

- `study_verify_parent_pin` 은 **틀린 횟수 제한이 없는 4자리 확인**이라, 가족 링크를 공개된 곳에 두면 안 됩니다.
  필요하면 시도 제한(lock-out)이나 더 긴 PIN 으로 바꿀 수 있습니다.

- **실시간**: `tasks` · `family_members` · `families` 를 `supabase_realtime` publication 에 넣고
  앱이 `postgres_changes` 를 구독합니다. 아이가 완료 요청을 누르면 부모 폰에 **새로고침 없이** 반영됩니다.
  - 삭제까지 실시간으로 보내려면 두 테이블에 `replica identity full` 이 필요합니다(schema.sql 에 포함).
  - 앱을 다시 열거나 화면에 돌아오면 최신 목록을 한 번 받아 와서, 백그라운드 중 놓친 변경도 맞춥니다.
- 앱은 화면을 먼저 바꾸고(낙관적 반영) RPC 결과를 기다립니다. 서버가 거부하면 원래 상태로 되돌리고 이유를 보여 줍니다.

> 가족 링크(`#as=...`)를 아는 사람은 그 사람 시점으로 열 수 있습니다. 링크를 공개된 곳에 올리지 마세요.
> 부모 화면과 되돌리기·삭제는 **부모 관리 PIN** 으로 잠겨 있습니다(위 2번).

### 데이터 모델

```
families(id text, name)
  ├ family_members(id text, family_id, name, role['parent'|'child'], grade?, emoji, color, presets)
  ├ tasks(id text, family_id, member_id, title, subject, due_date, status, note?, created_by, verified_by?, verified_at?)
  └ family_secrets(family_id text primary key, parent_pin_hash text)   ← 부모 관리 PIN 해시 (anon 접근 불가)
```

- 아이디는 사람이 읽을 수 있는 text 입니다(`fam_our_home`, `mem_dad`, `t_mem_child1_2026-11-23_0`).
  그래서 링크(`#as=mem_dad`)와 시드 데이터가 그대로 맞물립니다.
- `verified_at` 이 곧 **완료 체크한 시각**입니다(카드의 `오후 8:42 완료`).
- `StorageAdapter`(`src/lib/storage.ts`)만 갈아끼우면 저장소가 바뀝니다.
  Supabase 어댑터는 스냅샷 덮어쓰기가 아니라 **한 건씩 RPC** 로 보내고, Realtime 으로 받습니다.

## 6. 폴더 구조

```
src/
  App.tsx                 화면 조립, 주간/일자 상태, 토스트
  main.tsx                엔트리 (StudyProvider)
  index.css               Tailwind + 기본 스타일
  components/
    AppHeader.tsx         로고·가족명·프로필 전환
    WeekStrip.tsx         주간 달력 스트립
    DayOverview.tsx       날짜 요약 + 진행률 링
    ChildBoard.tsx        아이별 보드
    TaskCard.tsx          항목 카드 (완료 체크·시각·부모 메뉴)
    StatusBadge.tsx       상태 배지
    AddTaskSheet.tsx      추가/수정 시트
    CopySheet.tsx         공부 복사 시트 (아이별 · 날짜별 붙여넣기)
    ParentPinGate.tsx     부모 관리 PIN 잠금 화면 (숫자 키패드)
    ProfileSheet.tsx      역할 전환 시트 (+ 관리 잠금·이름 바꾸기)
    Sheet.tsx             바텀시트 공통
    icons.tsx             인라인 SVG 아이콘
  lib/
    types.ts              도메인 타입
    date.ts               로컬 날짜 유틸 (월요일 시작) · 공휴일 표
    seed.ts               샘플 가족/이번 주 숙제
    store.ts              상태 전이·권한 검사·localStorage
    storage.ts            StorageAdapter (local | supabase), 변경 1건 단위 저장 타입
    supabase.ts           Supabase 클라이언트 · 행 매핑 · RPC 쓰기 · Realtime 구독
    pin.ts                부모 관리 PIN (세션 보관 · 데모 모드 해시)
    study-context.tsx     React 상태/액션 훅 (낙관적 반영 + 실시간 병합 + 복사)
    theme.ts, cx.ts       색상 테마·className 유틸
supabase/schema.sql       테이블 + RLS + study_* RPC + Realtime + 가족/이번 주 시드
scripts/gen-setup.mjs     schema.sql → public/setup.html (SQL 복사 버튼 페이지)
scripts/verify-sync.py    동기화 전/후 화면 자동 검증
scripts/verify-live-sync.py  라이브 사이트에서 두 사람 시점 실시간 검증(테스트 항목 자동 정리)
public/manifest.json      PWA 매니페스트
public/sw.js              서비스 워커(앱 셸 캐시·오프라인 폴백)
public/icons/             앱 아이콘(192/512/maskable/apple)
```

## 7. 배포

정적 호스팅이면 그대로 됩니다. `npm run build` → `dist/` 업로드 (Vercel/Netlify/Cloudflare Pages).

- 라이브: **https://youngma2.github.io/study-check-app/** (GitHub Pages, `gh-pages` 브랜치)
- SQL 복사 페이지: **https://youngma2.github.io/study-check-app/setup.html**
- 이 저장소용 배포 스크립트: `/workspace/deploy-study-check-app.sh`
  - `dist` 에서 **`sb_secret_` / service_role JWT** 만 검사해 막고, 공개용 `sb_publishable_` 키는 통과시킵니다.
  - `.env.local` 은 git 에 올라가지 않고, 빌드 시 값만 번들에 인라인됩니다.
- HTTPS + `manifest.json` + `sw.js`(서비스 워커)가 갖춰져 있어 Chrome/Android 에서 **앱처럼 설치**할 수 있습니다.
  주소창 오른쪽 설치 아이콘 또는 메뉴 → `앱 설치`. (iOS: 공유 → 홈 화면에 추가)
- 서비스 워커는 **네트워크 우선**이라 새 배포가 바로 반영되고, 네트워크가 없을 때만 캐시된 앱 셸을 씁니다.

## 8. 검증 기록

- `npx tsc --noEmit` — 타입 오류 0 · `npm run build` 성공 (`dist/`, `setup.html` 자동 생성)
- `supabase/schema.sql` — 로컬 PostgreSQL(PGlite) 49개 검사 전부 통과
  - 시드(가족 1 · 구성원 4 · 이번 주 숙제 39개, 공개 시드는 `첫째`·`둘째`) · 두 번 실행해도 중복 없음 · Realtime publication 3개
  - anon: 읽기만 허용 / 직접 INSERT·UPDATE·DELETE 차단 / `family_secrets` 조회·쓰기 불가
  - 예전 3-인자 `study_set_task_status`·`study_delete_task` 는 남지 않음(PIN 우회 방지)
  - 아이: 자기 숙제 추가·바로 완료(시각 기록) 가능 / 남의 숙제 완료·되돌리기·수정·삭제 차단
  - 부모: 완료·되돌리기(PIN)·삭제(PIN)·이름 바꾸기(PIN) / PIN 없거나 틀리면 거부
  - PIN 은 평문이 아니라 해시로만 저장, 4자리만 허용, 이미 정한 PIN 은 지금 PIN 없이 못 바꿈
- `python3 scripts/verify-parent-pin.py` — 390×844 헤드리스 Chrome(데모 빌드) 31개 검사 전부 통과
  - 아이 시점: PIN 화면 없음 · 프로필에 부모 항목 없음 · 완료를 누르면 `오후 9:20 완료` 처럼 시각 기록 ·
    삭제·되돌리기 없음 · 이 날 공부를 내일로 복사(복사본은 `할 일`) · 12/25 성탄절 빨간 점·빨간 날짜·배지
  - 부모 시점: PIN 잠금이 먼저 · 잠금 전 목록 안 보임 · 두 번 입력 불일치 오류 · 관리 잠금 · 틀린 PIN 거부 ·
    맞는 PIN 으로 열림 · 삭제·완료·되돌리기 · JS 오류 0
- **라이브 검증** (실제 사이트 + 실제 Supabase DB, 390×844 헤드리스 Chrome) 28개 검사 전부 통과
  - DB: 구성원 표시 이름이 실제 아이 이름으로 바뀜 · `study_verify_parent_pin` 이 맞는 PIN 에 true, 틀린 PIN 에 false
  - 아이(`#as=mem_child2`): PIN 화면 없음, 프로필에 `아빠`·`엄마` 없음, 완료를 누르면 그 자리에서 완료 +
    시각이 DB(`verified_at`)에 저장, 삭제 버튼 없음
  - 부모(`#as=mem_dad`): PIN 잠금이 먼저, 틀린 PIN 거부, 맞는 PIN 으로만 열림, 아이 이름이 실제 이름으로 표시,
    되돌리기가 DB 에 반영, 삭제는 PIN, `관리 잠금` 으로 다시 잠금
  - 복사: 부모 화면에서 한 항목을 내일로 복사 → 내일 날짜에 같은 숙제가 `할 일`(완료 기록 없음)로 생김
  - 공휴일: 12/25 성탄절 빨간 점·주간 목록·날짜 제목 배지
  - 실시간: 부모가 추가한 숙제가 아이 화면에 새로고침 없이 등장
  - 검증용 숙제는 모두 삭제, 숙제 수 39개 원복
- 라이브 DB 적용 SQL(비공개)을 예전 스키마 위에서 그대로 실행하는 마이그레이션 검사 — 21개 통과
  (PIN 해시 저장 · 아이 이름 변경 · 옛 확인 대기 → 완료 이전 · 두 번 실행 안전)

> `scripts/verify-sync.py` · `scripts/verify-live-sync.py` · `scripts/capture.py` 는 **예전 두 단계(완료 요청 → 확인 완료) 흐름** 기준의 기록용 스크립트입니다.
> 지금 흐름(바로 완료 + PIN)의 검증은 위 `verify-parent-pin.py` 와 라이브 검증이 담당합니다.

스크린샷: `/workspace/downloads/study_app_child_completed.png`(아이 완료 시각), `study_app_parent_pin.png`(PIN 잠금),
`study_app_parent_unlocked.png`(부모 화면), `study_app_copy_sheet.png`(복사 시트), `study_app_holiday.png`(성탄절 빨간 표시)

## 9. 다음에 붙이면 좋은 것

- 부모에게 확인 대기 알림(Web Push / 카카오 알림톡)
- 매일 반복 숙제 템플릿(요일별 자동 생성)
- 주간 완료율 리포트, 아이별 보상(스티커)
- 가족 초대 링크(부모가 자녀 계정 연결)
