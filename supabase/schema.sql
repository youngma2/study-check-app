-- ============================================================================
-- 공부 체크 (Study Check) — Supabase schema
-- 가족 단위 멀티테넌트 + 역할별 권한(부모/아이)을 RLS 로 강제합니다.
--
-- 적용 방법
--   1) Supabase Dashboard → SQL Editor 에서 이 파일 전체를 실행
--   2) Project Settings → API 의 URL / anon key 를 .env.local 에 넣기
--      VITE_SUPABASE_URL=...
--      VITE_SUPABASE_ANON_KEY=...
--   3) 앱에서 로그인(매직링크) 후, 아래 create_family() 로 가족을 만들면
--      이후 모든 읽기/쓰기가 RLS 로 보호됩니다.
--
-- 권한 요약
--   부모: 항목 추가/수정/삭제, 확인 완료(verified), 되돌리기
--   아이: 항목 추가(자기 것만), 완료 요청(todo → pending_verification)
--         삭제 불가 / 스스로 'verified' 로 올릴 수 없음
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 가족 구성원. role 이 'parent' | 'child' 두 가지뿐이라 권한 판정이 단순합니다.
create table if not exists public.family_members (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  name       text not null check (length(btrim(name)) between 1 and 30),
  role       text not null check (role in ('parent', 'child')),
  grade      text,
  emoji      text not null default '🙂',
  color      text not null default 'sky' check (color in ('sky', 'violet', 'rose', 'amber')),
  presets    jsonb not null default '[]'::jsonb, -- [{ "title": "...", "subject": "math" }]
  created_at timestamptz not null default now(),
  constraint family_members_user_unique unique (family_id, user_id)
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  member_id   uuid not null references public.family_members (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 120),
  subject     text not null default 'etc',
  due_date    date not null,
  status      text not null default 'todo'
              check (status in ('todo', 'pending_verification', 'verified')),
  note        text,
  created_by  uuid references public.family_members (id) on delete set null,
  verified_by uuid references public.family_members (id) on delete set null,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_family_due_idx on public.tasks (family_id, due_date);
create index if not exists tasks_member_due_idx on public.tasks (member_id, due_date);
create index if not exists tasks_pending_idx
  on public.tasks (family_id, due_date) where status = 'pending_verification';
create index if not exists family_members_family_idx on public.family_members (family_id);
create index if not exists family_members_user_idx on public.family_members (user_id);

-- ----------------------------------------------------------------------------
-- 2. 권한 판정 헬퍼 (security definer 로 RLS 재귀를 피합니다)
-- ----------------------------------------------------------------------------

create or replace function public.current_member_id(p_family_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.family_members
  where family_id = p_family_id
    and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_parent(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = auth.uid() and role = 'parent'
  );
$$;

-- 가족을 처음 만든 사람이 부모로 합류할 수 있도록, 아직 멤버가 없는 가족인지 확인
create or replace function public.family_is_empty(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.family_members where family_id = p_family_id);
$$;

-- ----------------------------------------------------------------------------
-- 3. 쓰기 가드 트리거 (RLS 로 표현하기 어려운 규칙을 한 번 더 강제)
-- ----------------------------------------------------------------------------

create or replace function public.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.title := btrim(new.title);

  if tg_op = 'UPDATE' and new.member_id <> old.member_id and not public.is_parent(new.family_id) then
    raise exception '숙제를 다른 사람에게 옮길 수 없습니다.' using errcode = '42501';
  end if;

  -- 같은 가족 구성원에게만 배정할 수 있습니다.
  if not exists (
    select 1 from public.family_members m
    where m.id = new.member_id and m.family_id = new.family_id
  ) then
    raise exception '같은 가족 구성원에게만 배정할 수 있습니다.' using errcode = '42501';
  end if;

  if new.status = 'verified' then
    if new.verified_by is null then
      new.verified_by := public.current_member_id(new.family_id);
    end if;

    if not exists (
      select 1 from public.family_members m
      where m.id = new.verified_by
        and m.family_id = new.family_id
        and m.role = 'parent'
    ) then
      raise exception '확인 완료는 부모만 할 수 있습니다.' using errcode = '42501';
    end if;

    new.verified_at := coalesce(new.verified_at, now());
  else
    -- 되돌리거나 다시 요청하면 확인 기록은 지웁니다.
    new.verified_by := null;
    new.verified_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
before insert or update on public.tasks
for each row execute function public.tasks_before_write();

create or replace function public.members_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.family_id <> old.family_id then
      raise exception '가족 이동은 지원하지 않습니다.' using errcode = '42501';
    end if;
    -- 아이가 스스로 role 을 parent 로 올리는 것을 막습니다.
    if new.role <> old.role and not public.is_parent(old.family_id) then
      raise exception '역할은 부모만 바꿀 수 있습니다.' using errcode = '42501';
    end if;
    -- 아이가 자기 행의 user_id 를 다른 사람으로 바꿔치기하지 못하게 합니다.
    if new.user_id is distinct from old.user_id and not public.is_parent(old.family_id) then
      raise exception '계정 연결은 부모만 할 수 있습니다.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists members_before_write on public.family_members;
create trigger members_before_write
before insert or update on public.family_members
for each row execute function public.members_before_write();

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------

alter table public.families        enable row level security;
alter table public.family_members  enable row level security;
alter table public.tasks           enable row level security;

-- families --------------------------------------------------------------
drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select to authenticated
  using (public.is_family_member(id));

drop policy if exists families_insert on public.families;
create policy families_insert on public.families
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists families_update on public.families;
create policy families_update on public.families
  for update to authenticated
  using (public.is_parent(id))
  with check (public.is_parent(id));

drop policy if exists families_delete on public.families;
create policy families_delete on public.families
  for delete to authenticated
  using (public.is_parent(id));

-- family_members --------------------------------------------------------
drop policy if exists members_select on public.family_members;
create policy members_select on public.family_members
  for select to authenticated
  using (public.is_family_member(family_id) or user_id = auth.uid());

-- 부모는 가족을 초대/추가할 수 있고, 가족이 비어 있으면 창시자가 첫 부모로 들어갈 수 있습니다.
drop policy if exists members_insert on public.family_members;
create policy members_insert on public.family_members
  for insert to authenticated
  with check (
    public.is_parent(family_id)
    or (user_id = auth.uid() and public.family_is_empty(family_id))
  );

drop policy if exists members_update on public.family_members;
create policy members_update on public.family_members
  for update to authenticated
  using (public.is_parent(family_id) or user_id = auth.uid())
  with check (public.is_parent(family_id) or user_id = auth.uid());

drop policy if exists members_delete on public.family_members;
create policy members_delete on public.family_members
  for delete to authenticated
  using (public.is_parent(family_id));

-- tasks -----------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_family_member(family_id));

-- 아이는 자기 몫으로만 추가할 수 있습니다.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.is_family_member(family_id)
    and (
      public.is_parent(family_id)
      or member_id = public.current_member_id(family_id)
    )
    and (created_by is null or created_by = public.current_member_id(family_id))
  );

/*
 * 수정 규칙
 *  - 부모: 모든 항목, 모든 상태
 *  - 아이: 자기 항목만, 그리고 'verified' 로는 절대 올릴 수 없음
 *    (WITH CHECK 가 새 행의 상태를 검사하므로 아이의 자가 승인을 원천 차단)
 */
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    public.is_family_member(family_id)
    and (public.is_parent(family_id) or member_id = public.current_member_id(family_id))
  )
  with check (
    public.is_family_member(family_id)
    and (
      public.is_parent(family_id)
      or (
        member_id = public.current_member_id(family_id)
        and status <> 'verified'
      )
    )
  );

-- 삭제는 부모만.
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_parent(family_id));

-- ----------------------------------------------------------------------------
-- 5. 가족 만들기 RPC (온보딩 한 번에 처리)
-- ----------------------------------------------------------------------------

create or replace function public.create_family(
  p_family_name text,
  p_display_name text default '아빠'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  insert into public.families (name, created_by)
  values (btrim(p_family_name), auth.uid())
  returning id into v_family_id;

  insert into public.family_members (family_id, user_id, name, role)
  values (v_family_id, auth.uid(), btrim(p_display_name), 'parent');

  return v_family_id;
end;
$$;

revoke all on function public.create_family(text, text) from public;
grant execute on function public.create_family(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 샘플 (필요할 때만 주석을 풀어 실행)
-- ----------------------------------------------------------------------------
-- select public.create_family('우리 가족 공부방', '아빠');
--
-- with fam as (select id from public.families where name = '우리 가족 공부방' limit 1)
-- insert into public.family_members (family_id, name, role, grade, emoji, color)
-- select fam.id, v.name, v.role, v.grade, v.emoji, v.color
-- from fam, (values
--   ('엄마', 'parent', null,  '👩🏻', 'violet'),
--   ('첫째', 'child',  '중1',  '🌸', 'rose'),
--   ('둘째', 'child',  '초4',  '⚡', 'amber')
-- ) as v(name, role, grade, emoji, color);
