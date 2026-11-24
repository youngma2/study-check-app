# 📚 공부 체크 (Study Check)

가족이 함께 쓰는 **주간 공부 체크리스트** 웹앱(PWA)입니다.
아이는 공부를 추가하고 **완료 요청**을 보내고, 부모는 확인해서 **확인 완료**를 눌러 줍니다.

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
- 선택한 사용자와 데이터는 브라우저 `localStorage`(`study-check.db.v1`)에 남습니다.
- 부모 시점에서 프로필 시트 하단의 **샘플 데이터로 되돌리기** 로 초기화할 수 있습니다.
- Supabase 를 연결하면 같은 링크가 **로그인 없이** 가족 공유 링크가 됩니다(5번 참고).

## 3. 역할별 권한

| 할 수 있는 일 | 부모 (아빠·엄마) | 아이 (첫째·둘째) |
| --- | :---: | :---: |
| 공부 항목 추가 | 다른 아이에게도 추가 | 자기 것만 |
| 항목 수정 | ✅ | ❌ |
| 항목 삭제 | ✅ | ❌ (버튼 자체가 없음 + 상태 로직에서 차단) |
| 완료 요청 (`todo → pending_verification`) | ✅ | 자기 것만 |
| 확인 완료 (`→ verified`) | ✅ | ❌ |
| 되돌리기 (`→ todo`) | ✅ | 자기 요청 취소만 |

상태 흐름: **할 일(todo) → 확인 대기(pending_verification) → 부모 확인 완료(verified)**
부모는 `todo` 에서 바로 `verified` 로 넘길 수도 있습니다.

권한은 UI(버튼 숨김)와 도메인 로직(`src/lib/store.ts` 의 `changeTaskStatus` / `deleteTask`)에서 모두 검사하고,
Supabase 를 붙이면 **DB RPC(`study_*`)** 가 `actor` 를 받아 역할을 한 번 더 검사합니다(3중 방어).
RLS 는 읽기만 열고 직접 INSERT/UPDATE/DELETE 는 막아 두어, 앱을 거치지 않은 쓰기는 DB 에서 거부됩니다.

## 4. 화면 구성

- **주간 달력 스트립**: 월~일, 이전/다음 주, `오늘` 버튼. 날짜별 진행률 막대(확인 대기/진행 중/모두 확인).
- **날짜 요약**: 전체·확인 완료 수, 확인 대기 수, 진행률 링.
- **아이별 체크리스트**: 상태 배지(할 일 / 확인 대기 / 부모 확인 완료), 확인 대기 항목이 위로 정렬.
- **추가/수정 시트**: 아이 선택, 과목, 제목(+자주 쓰는 항목 프리셋), 날짜.
- **역할 전환 시트**: 부모/아이 목록, 저장 상태 표시.

## 5. Supabase(가족 실시간 동기화) 연결

**로그인·매직링크를 쓰지 않습니다.** 가족 링크를 아는 기기끼리 같은 데이터를 보고,
쓰기는 DB RPC 가 `actor`(누가)를 받아 부모/아이 권한을 검사합니다.

1. Supabase 프로젝트 → **SQL Editor** 에서 [`supabase/schema.sql`](supabase/schema.sql) 전체 실행 (한 번, 여러 번 실행해도 안전)
   - 배포 페이지에 복사 버튼이 있는 안내 페이지도 있습니다: **https://youngma2.github.io/study-check-app/setup.html**
2. **Project Settings → API** 의 Project URL / **Publishable key** 를 `.env.local` 에 넣기 (`.env.example` 복사)
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```
   > publishable(anon) 키는 브라우저 번들에 들어가는 **공개 키**입니다. `service_role` / `sb_secret_` 키는 절대 넣지 마세요.
3. `npm run build` → 폰끼리 실시간 동기화가 켜집니다.

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
| `study_add_task` | 숙제 추가 | 부모: 아무 아이, 아이: 자기 것만 |
| `study_update_task` | 제목·과목·날짜 수정 | 부모만 |
| `study_set_task_status` | 완료 요청 / 확인 완료 / 되돌리기 | 부모: 모두, 아이: 자기 것 + `verified` 불가 |
| `study_delete_task` | 삭제 | 부모만 |

- **실시간**: `tasks` · `family_members` · `families` 를 `supabase_realtime` publication 에 넣고
  앱이 `postgres_changes` 를 구독합니다. 아이가 완료 요청을 누르면 부모 폰에 **새로고침 없이** 반영됩니다.
  - 삭제까지 실시간으로 보내려면 두 테이블에 `replica identity full` 이 필요합니다(schema.sql 에 포함).
  - 앱을 다시 열거나 화면에 돌아오면 최신 목록을 한 번 받아 와서, 백그라운드 중 놓친 변경도 맞춥니다.
- 앱은 화면을 먼저 바꾸고(낙관적 반영) RPC 결과를 기다립니다. 서버가 거부하면 원래 상태로 되돌리고 이유를 보여 줍니다.

> 가족 링크(`#as=...`)를 아는 사람은 그 사람 시점으로 열 수 있습니다. 링크를 공개된 곳에 올리지 마세요.
> 필요하면 부모 확인에 PIN 을 붙일 수 있습니다(현재 미구현, `study_set_task_status` 에 인자 하나만 추가하면 됩니다).

### 데이터 모델

```
families(id text, name)
  └ family_members(id text, family_id, name, role['parent'|'child'], grade?, emoji, color, presets)
      └ tasks(id text, family_id, member_id, title, subject, due_date, status, note?, created_by, verified_by?, verified_at?)
```

- 아이디는 사람이 읽을 수 있는 text 입니다(`fam_our_home`, `mem_dad`, `t_mem_child1_2026-11-23_0`).
  그래서 링크(`#as=mem_dad`)와 시드 데이터가 그대로 맞물립니다.
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
    TaskCard.tsx          항목 카드 (역할별 버튼)
    StatusBadge.tsx       상태 배지
    AddTaskSheet.tsx      추가/수정 시트
    ProfileSheet.tsx      역할 전환 시트
    Sheet.tsx             바텀시트 공통
    icons.tsx             인라인 SVG 아이콘
  lib/
    types.ts              도메인 타입
    date.ts               로컬 날짜 유틸 (월요일 시작)
    seed.ts               샘플 가족/이번 주 숙제
    store.ts              상태 전이·권한 검사·localStorage
    storage.ts            StorageAdapter (local | supabase), 변경 1건 단위 저장 타입
    supabase.ts           Supabase 클라이언트 · 행 매핑 · RPC 쓰기 · Realtime 구독
    study-context.tsx     React 상태/액션 훅 (낙관적 반영 + 실시간 병합)
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

- `npx tsc --noEmit` — 타입 오류 0
- `npm run build` — 성공 (`dist/` 생성, `setup.html` 자동 생성)
- `python3 scripts/verify-sync.py` — 390×844 헤드리스 Chrome, 15개 검사 전부 통과
  - SQL 실행 전(실제 Supabase 표 없음): 앱 정상 로드 · `가족 동기화 준비 중` 안내 · 샘플 폴백 · JS 오류 0 ·
    항목 추가와 새로고침 유지 · `#as=mem_child1` 아이 시점 · 아이에게 삭제 버튼 없음
  - SQL 실행 후 모양(모의 REST): 클라우드 숙제 표시 · `가족과 실시간 동기화 중` ·
    확인 완료/삭제/완료 요청이 각각 `study_*` RPC 로 전송(`p_actor_id` 포함) · 서버 거부 시 토스트 + 원상 복구
- `supabase/schema.sql` — 로컬 PostgreSQL(PGlite)에서 25개 검사 전부 통과
  - 시드(가족 1 · 구성원 4 · 이번 주 숙제 39개) · 두 번 실행해도 중복 없음 · Realtime publication 3개 테이블
  - anon: 읽기 허용 / 직접 INSERT·UPDATE·DELETE 차단
  - 아이: 자기 숙제 추가·완료 요청 가능, 남의 숙제 추가·수정·삭제·자기 확인 완료 차단
  - 부모: 확인 완료(verified_by 기록)·되돌리기·수정·삭제 가능, 없는 사용자 거부
- Realtime: publishable 키로 WebSocket 구독 `SUBSCRIBED` 확인 (로그인·JWT 없이 동작)
- **라이브 실시간 동기화 검증** (`python3 scripts/verify-live-sync.py`, 실제 사이트 + 실제 DB, 브라우저 두 개)
  - 부모(`#as=mem_dad`)가 둘째 숙제 추가 → 둘째(`#as=mem_child2`) 화면에 새로고침 없이 등장
  - 둘째 완료 요청 → 부모 화면에 즉시 `확인 대기`
  - 부모 확인 완료 → 둘째 화면에 즉시 `부모 확인 완료`
  - 부모 삭제 → 둘째 화면에서 즉시 사라짐 (`replica identity full` 적용 후)
  - 테스트 항목은 자동 삭제, 숙제 수 39개 원복 확인
- `python3 scripts/capture.py` — 화면 흐름 스모크 테스트(부모/아이 시점, 추가·수정·삭제, 확인 완료)
- 역할 링크: `#as=mem_dad` · `#as=mem_mom` · `#as=mem_child1` · `#as=mem_child2` 모두 해당 시점으로 전환

스크린샷: `/workspace/downloads/study_app_parent.png`, `/workspace/downloads/study_app_child.png`
(전체 화면: `..._parent_full.png`, `..._child_full.png`)

## 9. 다음에 붙이면 좋은 것

- 부모에게 확인 대기 알림(Web Push / 카카오 알림톡)
- 매일 반복 숙제 템플릿(요일별 자동 생성)
- 주간 완료율 리포트, 아이별 보상(스티커)
- 가족 초대 링크(부모가 자녀 계정 연결)
