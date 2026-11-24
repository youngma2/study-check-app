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
Supabase 를 붙이면 **DB RLS + 트리거**가 한 번 더 막습니다(3중 방어).

## 4. 화면 구성

- **주간 달력 스트립**: 월~일, 이전/다음 주, `오늘` 버튼. 날짜별 진행률 막대(확인 대기/진행 중/모두 확인).
- **날짜 요약**: 전체·확인 완료 수, 확인 대기 수, 진행률 링.
- **아이별 체크리스트**: 상태 배지(할 일 / 확인 대기 / 부모 확인 완료), 확인 대기 항목이 위로 정렬.
- **추가/수정 시트**: 아이 선택, 과목, 제목(+자주 쓰는 항목 프리셋), 날짜.
- **역할 전환 시트**: 부모/아이 목록, 저장 상태 표시.

## 5. Supabase(클라우드) 연결

1. Supabase 프로젝트 생성 → **SQL Editor** 에서 [`supabase/schema.sql`](supabase/schema.sql) 전체 실행
2. **Authentication → Providers → Email** 활성화 (매직링크)
3. 프로젝트 URL / anon key 를 `.env.local` 에 넣기 (`.env.example` 복사)
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. 앱 첫 로그인 후 가족 만들기:
   ```sql
   select public.create_family('우리 가족 공부방', '아빠');
   ```
   이후 가족 구성원은 부모 계정에서 `family_members` 에 추가합니다(또는 앱의 초대 기능을 붙이면 됩니다).
5. 다시 `npm run dev` → 헤더 프로필 시트에 `Supabase와 동기화됨` 이 표시됩니다.

> 로그인 화면은 아직 앱에 넣지 않았습니다. Supabase Auth UI 를 붙이는 지점은 `src/lib/supabase.ts` 의 `createSupabaseClient()` 하나입니다.
> 설정이 없으면 앱은 조용히 localStorage 모드로 동작합니다.

### 데이터 모델

```
families(id, name)
  └ family_members(id, family_id, user_id?, name, role['parent'|'child'], grade?, emoji, color, presets)
      └ tasks(id, family_id, member_id, title, subject, due_date, status, note?, created_by, verified_by?, verified_at?)
```

- 모든 행에 `family_id` 가 있어 가족이 늘어나도 그대로 확장됩니다(멀티테넌트).
- `supabase/schema.sql` 의 RLS 가 `family_id` 단위로 읽기/쓰기를 제한합니다.
- `StorageAdapter`(`src/lib/storage.ts`)만 갈아끼우면 저장소가 바뀝니다. Supabase 어댑터는 스냅샷 동기화(upsert + 사라진 행 삭제) 방식입니다.

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
    storage.ts            StorageAdapter (local | supabase)
    supabase.ts           Supabase 클라이언트 + 행 매핑
    study-context.tsx     React 상태/액션 훅
    theme.ts, cx.ts       색상 테마·className 유틸
supabase/schema.sql       테이블 + RLS + 트리거 + create_family()
public/manifest.json      PWA 매니페스트
public/sw.js              서비스 워커(앱 셸 캐시·오프라인 폴백)
public/icons/             앱 아이콘(192/512/maskable/apple)
```

## 7. 배포

정적 호스팅이면 그대로 됩니다. `npm run build` → `dist/` 업로드 (Vercel/Netlify/Cloudflare Pages).

- 라이브: **https://youngma2.github.io/study-check-app/** (GitHub Pages, `gh-pages` 브랜치)
- HTTPS + `manifest.json` + `sw.js`(서비스 워커)가 갖춰져 있어 Chrome/Android 에서 **앱처럼 설치**할 수 있습니다.
  주소창 오른쪽 설치 아이콘 또는 메뉴 → `앱 설치`. (iOS: 공유 → 홈 화면에 추가)
- 서비스 워커는 **네트워크 우선**이라 새 배포가 바로 반영되고, 네트워크가 없을 때만 캐시된 앱 셸을 씁니다.

## 8. 검증 기록

- `npx tsc --noEmit` — 타입 오류 0
- `npm run build` — 성공 (`dist/` 생성)
- `python3 scripts/capture.py` — 390×844 모바일 뷰포트에서 아래를 자동 확인
  - 부모 시점: 확인 완료·수정·삭제 버튼 노출, 확인 완료 처리, 다음 주/오늘 이동, 항목 추가·새로고침 유지·삭제
  - 아이 시점: 삭제/확인 완료 버튼 0개, 완료 요청 → 확인 대기 전이, 자기 항목 추가
  - manifest 링크 존재
- PWA 설치 조건 확인 (390×844 헤드리스 Chrome, 라이브 URL)
  - `sw.js` HTTP 200 · 서비스 워커 등록·활성(`scope=/study-check-app/`) · 오프라인 새로고침 시 앱 셸 표시
  - manifest `display: standalone`, `start_url: "./"`, `scope: "./"`, 아이콘 192/512/maskable 모두 200
- 역할 링크: `#as=mem_dad` · `#as=mem_mom` · `#as=mem_child1` · `#as=mem_child2` 모두 해당 시점으로 전환

스크린샷: `/workspace/downloads/study_app_parent.png`, `/workspace/downloads/study_app_child.png`
(전체 화면: `..._parent_full.png`, `..._child_full.png`)

## 9. 다음에 붙이면 좋은 것

- 부모에게 확인 대기 알림(Web Push / 카카오 알림톡)
- 매일 반복 숙제 템플릿(요일별 자동 생성)
- 주간 완료율 리포트, 아이별 보상(스티커)
- 가족 초대 링크(부모가 자녀 계정 연결)
