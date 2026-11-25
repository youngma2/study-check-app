-- ============================================================================
-- 공부 체크 (Study Check) — Supabase 스키마 · 가족 실시간 동기화
--
-- 실행 방법
--   Supabase Dashboard → SQL Editor → 아래 전체를 붙여넣고 [Run] 한 번.
--   여러 번 실행해도 안전합니다(이미 있는 행은 건드리지 않습니다).
--
-- 실행하면 바로 되는 것
--   · 우리 가족 공부방(아빠·엄마·첫째·둘째)과 이번 주 샘플 숙제가 들어갑니다.
--   · 아래 링크를 각자 폰에서 열면 로그인 없이 바로 그 사람 시점으로 열립니다.
--       아빠   https://youngma2.github.io/study-check-app/#as=mem_dad
--       엄마   https://youngma2.github.io/study-check-app/#as=mem_mom
--       첫째   https://youngma2.github.io/study-check-app/#as=mem_child1
--       둘째   https://youngma2.github.io/study-check-app/#as=mem_child2
--   · 숙제 체크(완료)·추가·삭제가 폰끼리 실시간으로 반영됩니다(새로고침 없음).
--   · 💬 우리 가족 한마디 — 아빠·엄마·아이 누구나 일정이나 전할 말을 남기고,
--     새 글은 다른 폰에 바로 뜨며 앱 위쪽에 알림 배너로 나타납니다.
--
-- 권한 (앱 + DB 이중으로 막습니다)
--   부모(아빠·엄마): 추가·수정·삭제·완료 되돌리기 — 부모 관리 PIN 필요
--   아이(첫째·둘째): 자기 숙제 추가, 자기 숙제 완료 체크(시간 기록). 삭제·수정·되돌리기 불가
--
-- 부모 관리 PIN
--   · 4자리 PIN 은 이 파일에 적지 않습니다(공개 저장소). 아래 5번 주석을 보고
--     `study_set_parent_pin` 으로 한 번만 정하면 됩니다.
--   · 저장은 public.family_secrets 에 bcrypt 해시(crypt + gen_salt('bf'))로만 하고,
--     RLS 정책을 하나도 만들지 않아 anon 키로는 읽을 수 없습니다.
--
-- 구조
--   families ─┬─ family_members
--             ├─ tasks
--             ├─ family_notes (💬 우리 가족 한마디 — 부모·아이 누구나 남기는 알림판)
--             ├─ family_secrets (부모 관리 PIN 해시 · 앱에서 직접 읽지 않음)
--             ├─ push_subscriptions (🔔 기기별 백그라운드 알림 구독 · 앱에서 직접 읽지 않음)
--             └─ push_config (🔔 알림 함수 주소·VAPID 공개키 — 공개키 한 줄만 앱이 읽음)
--   읽기는 누구나(가족 링크를 아는 기기), 쓰기는 아래 RPC 로만 가능하게 해 두고
--   RPC 안에서 역할(parent/child)과 PIN 을 검사합니다.
-- ============================================================================

-- (식별자 생성은 PostgreSQL 13+ 기본 함수인 gen_random_uuid() 를 씁니다.)

-- ----------------------------------------------------------------------------
-- 0. 확장 — PIN 해시용 pgcrypto (bcrypt)
--    (extensions 스키마는 Supabase 에 이미 있습니다. 스키마를 새로 만들지 않습니다.)
-- ----------------------------------------------------------------------------

do $$
begin
  -- Supabase 는 보통 extensions 스키마에 이미 들어 있습니다(그러면 그냥 넘어갑니다).
  -- (스키마 생성 권한이 없는 환경도 있어 `create schema` 는 시도하지 않습니다.)
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception
    when others then
      begin
        create extension if not exists pgcrypto;
      exception
        when others then
          -- 로컬 테스트용 PostgreSQL 에 pgcrypto 가 없어도 나머지 스키마는 그대로 만듭니다.
          raise notice 'pgcrypto 확장을 설치하지 못했습니다: %', sqlerrm;
      end;
  end;
end;
$$;

-- 🔔 백그라운드 알림 트리거가 Edge Function 을 부를 때 쓰는 pg_net.
--   (확장 자체가 `net` 스키마를 만들기 때문에, 등록 위치와 상관없이 net.http_post 로 부릅니다.)
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception
    when others then
      begin
        create extension if not exists pg_net;
      exception
        when others then
          raise notice 'pg_net 확장을 켜지 못했습니다(백그라운드 알림만 꺼집니다): %', sqlerrm;
      end;
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.families (
  id         text primary key,
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.family_members (
  id         text primary key,
  family_id  text not null references public.families (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 30),
  role       text not null check (role in ('parent', 'child')),
  grade      text,
  emoji      text not null default '🙂',
  color      text not null default 'sky' check (color in ('sky', 'violet', 'rose', 'amber')),
  presets    jsonb not null default '[]'::jsonb, -- [{ "title": "...", "subject": "math" }]
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id          text primary key,
  family_id   text not null references public.families (id) on delete cascade,
  member_id   text not null references public.family_members (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 120),
  subject     text not null default 'etc',
  due_date    date not null,
  status      text not null default 'todo'
              check (status in ('todo', 'pending_verification', 'verified')),
  note        text,
  created_by  text references public.family_members (id) on delete set null,
  verified_by text references public.family_members (id) on delete set null,
  verified_at timestamptz, -- 완료 체크한 시각 (앱이 '오후 8:42 완료' 로 보여 줍니다)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 부모 관리 PIN 해시. 앱은 이 표를 직접 읽지 않고 RPC(study_verify_parent_pin)로만 확인합니다.
create table if not exists public.family_secrets (
  family_id       text primary key references public.families (id) on delete cascade,
  parent_pin_hash text not null,
  updated_at      timestamptz not null default now()
);

-- 💬 우리 가족 한마디 — 가족 알림판. 부모·아이 누구나 짧은 글을 남깁니다.
create table if not exists public.family_notes (
  id         text primary key,
  family_id  text not null references public.families (id) on delete cascade,
  author_id  text not null references public.family_members (id) on delete cascade,
  content    text not null check (length(btrim(content)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists tasks_family_due_idx on public.tasks (family_id, due_date);
create index if not exists tasks_member_due_idx on public.tasks (member_id, due_date);
create index if not exists tasks_pending_idx
  on public.tasks (family_id, due_date) where status = 'pending_verification';
create index if not exists family_members_family_idx on public.family_members (family_id);
create index if not exists family_notes_family_created_idx
  on public.family_notes (family_id, created_at desc);

-- Realtime 삭제 이벤트: RLS + family_id 필터를 쓰려면 예전 행 전체가 필요합니다.
-- (기본 replica identity 는 기본키만 보내서 DELETE 가 구독자에게 전달되지 않습니다.)
alter table public.tasks          replica identity full;
alter table public.family_members replica identity full;
alter table public.family_notes   replica identity full;

-- ----------------------------------------------------------------------------
-- 2. RLS — 읽기는 열고, 직접 쓰기는 막습니다(쓰기는 3번의 RPC 로만).
--    family_secrets 는 정책을 하나도 만들지 않습니다 → anon 은 읽을 수 없습니다.
-- ----------------------------------------------------------------------------

alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.tasks          enable row level security;
alter table public.family_notes   enable row level security;
alter table public.family_secrets enable row level security;

drop policy if exists study_read_families on public.families;
create policy study_read_families on public.families
  for select to anon, authenticated using (true);

drop policy if exists study_read_members on public.family_members;
create policy study_read_members on public.family_members
  for select to anon, authenticated using (true);

drop policy if exists study_read_tasks on public.tasks;
create policy study_read_tasks on public.tasks
  for select to anon, authenticated using (true);

drop policy if exists study_read_notes on public.family_notes;
create policy study_read_notes on public.family_notes
  for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.families, public.family_members, public.tasks, public.family_notes to anon, authenticated;
revoke insert, update, delete on public.families, public.family_members, public.tasks, public.family_notes
  from anon, authenticated;

-- PIN 해시 표: 권한 자체를 회수합니다(정책도 없음). RPC 안에서만 쓰입니다.
revoke all on public.family_secrets from anon, authenticated;
revoke all on public.family_secrets from public;

-- ----------------------------------------------------------------------------
-- 3. RPC — 앱이 쓰는 유일한 쓰기 통로. actor(누가)를 받아 역할을 검사합니다.
-- ----------------------------------------------------------------------------

-- PIN 일치 여부(내부용). anon 에게는 열지 않고, 아래 RPC 들이 security definer 로 부릅니다.
create or replace function public.study_pin_is_valid(p_family_id text, p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.family_secrets s
     where s.family_id = p_family_id
       and p_pin is not null
       and btrim(p_pin) <> ''
       and crypt(btrim(p_pin), s.parent_pin_hash) = s.parent_pin_hash
  );
$$;

-- 부모 관리 PIN 확인. 맞으면 true, 틀리면 false.
-- 아직 PIN 을 정하지 않았으면 안내 문구와 함께 오류를 냅니다(앱이 그대로 보여 줍니다).
create or replace function public.study_verify_parent_pin(p_family_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select parent_pin_hash into v_hash
    from public.family_secrets
   where family_id = p_family_id;

  if v_hash is null then
    raise exception '부모 관리 PIN이 아직 설정되지 않았어요. Supabase SQL Editor에서 PIN 설정 SQL을 한 번 실행해 주세요.'
      using errcode = 'P0002';
  end if;

  if p_pin is null or btrim(p_pin) = '' then
    return false;
  end if;

  return crypt(btrim(p_pin), v_hash) = v_hash;
end;
$$;

-- 부모 관리 PIN 정하기/바꾸기.
--   · 처음 정할 때:   study_set_parent_pin('fam_our_home', '새PIN')
--   · 나중에 바꿀 때: study_set_parent_pin('fam_our_home', '새PIN', '지금PIN')
create or replace function public.study_set_parent_pin(
  p_family_id  text,
  p_new_pin    text,
  p_current_pin text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new  text := btrim(coalesce(p_new_pin, ''));
  v_hash text;
begin
  if v_new !~ '^[0-9]{4}$' then
    raise exception '부모 관리 PIN은 숫자 4자리로 정해 주세요.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.families where id = p_family_id) then
    raise exception '가족을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select parent_pin_hash into v_hash
    from public.family_secrets
   where family_id = p_family_id;

  -- 이미 정해져 있으면 지금 쓰는 PIN 을 알아야 바꿀 수 있습니다.
  if v_hash is not null then
    if p_current_pin is null or crypt(btrim(p_current_pin), v_hash) <> v_hash then
      raise exception '지금 쓰는 부모 관리 PIN이 맞지 않습니다.' using errcode = '42501';
    end if;
  end if;

  insert into public.family_secrets (family_id, parent_pin_hash, updated_at)
  values (p_family_id, crypt(v_new, gen_salt('bf')), now())
  on conflict (family_id) do update
    set parent_pin_hash = excluded.parent_pin_hash,
        updated_at      = now();

  return true;
end;
$$;

-- 공부 항목 추가: 부모는 아무 아이에게나, 아이는 자기 것만.
create or replace function public.study_add_task(
  p_actor_id  text,
  p_member_id text,
  p_title     text,
  p_subject   text,
  p_due_date  date,
  p_note      text default null,
  p_id        text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  public.family_members;
  v_target public.family_members;
  v_task   public.tasks;
  v_title  text := btrim(coalesce(p_title, ''));
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  select * into v_target
  from public.family_members
  where id = p_member_id and family_id = v_actor.family_id;
  if not found then
    raise exception '같은 가족 구성원에게만 추가할 수 있습니다.' using errcode = '42501';
  end if;

  if v_actor.role <> 'parent' and v_actor.id <> v_target.id then
    raise exception '내 공부만 추가할 수 있습니다.' using errcode = '42501';
  end if;

  if v_title = '' then
    raise exception '무엇을 공부하는지 적어 주세요.' using errcode = '22023';
  end if;

  insert into public.tasks (id, family_id, member_id, title, subject, due_date, status, note, created_by)
  values (
    coalesce(nullif(btrim(p_id), ''), 't_' || replace(gen_random_uuid()::text, '-', '')),
    v_actor.family_id,
    v_target.id,
    v_title,
    coalesce(nullif(btrim(p_subject), ''), 'etc'),
    p_due_date,
    'todo',
    nullif(btrim(p_note), ''),
    v_actor.id
  )
  returning * into v_task;

  return v_task;
end;
$$;

-- 공부 항목 수정: 부모만.
create or replace function public.study_update_task(
  p_actor_id text,
  p_task_id  text,
  p_title    text,
  p_subject  text,
  p_due_date date,
  p_note     text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.family_members;
  v_task  public.tasks;
  v_title text := btrim(coalesce(p_title, ''));
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '항목 수정은 부모님만 할 수 있습니다.' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id and family_id = v_actor.family_id;
  if not found then
    raise exception '항목을 찾을 수 없습니다. 새로고침해 주세요.' using errcode = 'P0002';
  end if;
  if v_title = '' then
    raise exception '항목 이름을 비워 둘 수 없습니다.' using errcode = '22023';
  end if;

  update public.tasks
     set title      = v_title,
         subject    = coalesce(nullif(btrim(p_subject), ''), subject),
         due_date   = p_due_date,
         note       = nullif(btrim(p_note), ''),
         updated_at = now()
   where id = v_task.id
  returning * into v_task;

  return v_task;
end;
$$;

-- 예전 3-인자 버전이 남아 있으면 PIN 없이 호출될 수 있으므로 먼저 지웁니다.
drop function if exists public.study_set_task_status(text, text, text);

-- 상태 변경: 완료 체크는 아이도 자기 숙제에 할 수 있고(시각 기록), 되돌리기는 부모 + PIN.
create or replace function public.study_set_task_status(
  p_actor_id text,
  p_task_id  text,
  p_status   text,
  p_pin      text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.family_members;
  v_task  public.tasks;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id and family_id = v_actor.family_id;
  if not found then
    raise exception '항목을 찾을 수 없습니다. 새로고침해 주세요.' using errcode = 'P0002';
  end if;

  if p_status not in ('todo', 'pending_verification', 'verified') then
    raise exception '알 수 없는 상태입니다.' using errcode = '22023';
  end if;

  if v_task.status = p_status then
    return v_task;
  end if;

  -- 완료 체크: 아이도 자기 숙제는 스스로 완료할 수 있습니다. 완료한 시각을 그대로 기록합니다.
  if p_status = 'verified' then
    if v_actor.role <> 'parent' and v_task.member_id <> v_actor.id then
      raise exception '내 숙제만 완료할 수 있습니다.' using errcode = '42501';
    end if;

    update public.tasks
       set status = 'verified', verified_by = v_actor.id, verified_at = now(), updated_at = now()
     where id = v_task.id
    returning * into v_task;

    return v_task;
  end if;

  -- 여기부터는 완료를 푸는 쪽(되돌리기 / 요청 취소)
  if v_task.status = 'verified' then
    if v_actor.role <> 'parent' then
      raise exception '완료를 되돌리는 건 부모님만 할 수 있습니다.' using errcode = '42501';
    end if;
    if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
      raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
    end if;
  elsif v_actor.role <> 'parent' and v_task.member_id <> v_actor.id then
    raise exception '내 공부만 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  update public.tasks
     set status = p_status, verified_by = null, verified_at = null, updated_at = now()
   where id = v_task.id
  returning * into v_task;

  return v_task;
end;
$$;

-- 삭제: 부모 + 부모 관리 PIN.
drop function if exists public.study_delete_task(text, text);

create or replace function public.study_delete_task(
  p_actor_id text,
  p_task_id  text,
  p_pin      text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.family_members;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '아이는 항목을 삭제할 수 없습니다. 부모님께 알려 주세요.' using errcode = '42501';
  end if;

  if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
    raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
  end if;

  delete from public.tasks where id = p_task_id and family_id = v_actor.family_id;
end;
$$;

-- 구성원 이름 바꾸기: 부모 + 부모 관리 PIN. (아이디는 그대로라 링크·숙제가 유지됩니다)
create or replace function public.study_rename_member(
  p_actor_id  text,
  p_member_id text,
  p_name      text,
  p_pin       text default null
)
returns public.family_members
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor  public.family_members;
  v_member public.family_members;
  v_name   text := btrim(coalesce(p_name, ''));
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '이름 바꾸기는 부모님만 할 수 있습니다.' using errcode = '42501';
  end if;
  if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
    raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
  end if;

  select * into v_member
    from public.family_members
   where id = p_member_id and family_id = v_actor.family_id;
  if not found then
    raise exception '같은 가족 구성원의 이름만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 30 then
    raise exception '이름은 1~30자로 적어 주세요.' using errcode = '22023';
  end if;

  update public.family_members
     set name = v_name
   where id = v_member.id
  returning * into v_member;

  return v_member;
end;
$$;

-- 구성원 '빠른 추가' 항목(presets) 바꾸기: 부모 + 부모 관리 PIN.
--   presets 는 [{ "title": "...", "subject": "math" }] 모양의 JSON 배열입니다.
--   예) select public.study_update_member_presets('mem_dad', 'mem_child2', '[{"title":"책 읽기 30분","subject":"reading"}]'::jsonb, '네자리PIN');
create or replace function public.study_update_member_presets(
  p_actor_id  text,
  p_member_id text,
  p_presets   jsonb,
  p_pin       text default null
)
returns public.family_members
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor  public.family_members;
  v_member public.family_members;
  v_item   jsonb;
  v_title  text;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '빠른 추가 항목은 부모님만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
    raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
  end if;

  select * into v_member
    from public.family_members
   where id = p_member_id and family_id = v_actor.family_id;
  if not found then
    raise exception '같은 가족 구성원의 빠른 추가 항목만 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  if p_presets is null or jsonb_typeof(p_presets) <> 'array' then
    raise exception '빠른 추가 항목은 배열(JSON array)로 보내 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_presets) > 30 then
    raise exception '빠른 추가 항목은 30개까지 넣을 수 있습니다.' using errcode = '22023';
  end if;

  -- 각 항목이 { "title": "...", "subject": "..." } 모양인지 확인합니다.
  for v_item in select * from jsonb_array_elements(p_presets) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(btrim(v_item ->> 'title'), '') = '' then
      raise exception '빠른 추가 항목은 {"title": "...", "subject": "..."} 모양이어야 합니다.' using errcode = '22023';
    end if;
    v_title := btrim(v_item ->> 'title');
    if length(v_title) > 120 then
      raise exception '항목 이름은 120자까지 적을 수 있습니다.' using errcode = '22023';
    end if;
  end loop;

  update public.family_members
     set presets = p_presets
   where id = v_member.id
  returning * into v_member;

  return v_member;
end;
$$;

-- 💬 우리 가족 한마디 남기기: 가족이면 누구나(부모·아이) 쓸 수 있습니다.
create or replace function public.study_add_note(
  p_actor_id text,
  p_content  text,
  p_id       text default null
)
returns public.family_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   public.family_members;
  v_note    public.family_notes;
  v_content text := btrim(coalesce(p_content, ''));
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  if v_content = '' then
    raise exception '남길 말을 적어 주세요.' using errcode = '22023';
  end if;
  if length(v_content) > 300 then
    raise exception '한마디는 300자까지 적을 수 있습니다.' using errcode = '22023';
  end if;

  insert into public.family_notes (id, family_id, author_id, content)
  values (
    coalesce(nullif(btrim(p_id), ''), 'n_' || replace(gen_random_uuid()::text, '-', '')),
    v_actor.family_id,
    v_actor.id,
    v_content
  )
  returning * into v_note;

  return v_note;
end;
$$;

-- 💬 우리 가족 한마디 지우기: 내가 쓴 글은 누구나, 남의 글은 부모가 PIN 을 넣고.
drop function if exists public.study_delete_note(text, text);

create or replace function public.study_delete_note(
  p_actor_id text,
  p_note_id  text,
  p_pin      text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.family_members;
  v_note  public.family_notes;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  select * into v_note
    from public.family_notes
   where id = p_note_id and family_id = v_actor.family_id;
  if not found then
    raise exception '한마디를 찾을 수 없습니다. 새로고침해 주세요.' using errcode = 'P0002';
  end if;

  if v_note.author_id <> v_actor.id then
    if v_actor.role <> 'parent' then
      raise exception '내가 쓴 한마디만 지울 수 있습니다.' using errcode = '42501';
    end if;
    if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
      raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
    end if;
  end if;

  delete from public.family_notes where id = v_note.id;
end;
$$;

revoke all on function public.study_add_task(text, text, text, text, date, text, text) from public;
revoke all on function public.study_update_task(text, text, text, text, date, text) from public;
revoke all on function public.study_set_task_status(text, text, text, text) from public;
revoke all on function public.study_delete_task(text, text, text) from public;
revoke all on function public.study_verify_parent_pin(text, text) from public;
revoke all on function public.study_set_parent_pin(text, text, text) from public;
revoke all on function public.study_rename_member(text, text, text, text) from public;
revoke all on function public.study_update_member_presets(text, text, jsonb, text) from public;
revoke all on function public.study_add_note(text, text, text) from public;
revoke all on function public.study_delete_note(text, text, text) from public;
-- 내부용: anon/authenticated 에게 열지 않습니다.
revoke all on function public.study_pin_is_valid(text, text) from public, anon, authenticated;

grant execute on function public.study_add_task(text, text, text, text, date, text, text) to anon, authenticated;
grant execute on function public.study_update_task(text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.study_set_task_status(text, text, text, text) to anon, authenticated;
grant execute on function public.study_delete_task(text, text, text) to anon, authenticated;
grant execute on function public.study_verify_parent_pin(text, text) to anon, authenticated;
grant execute on function public.study_set_parent_pin(text, text, text) to anon, authenticated;
grant execute on function public.study_rename_member(text, text, text, text) to anon, authenticated;
grant execute on function public.study_update_member_presets(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.study_add_note(text, text, text) to anon, authenticated;
grant execute on function public.study_delete_note(text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3b. 🔔 백그라운드 알림(Web Push)  — 앱을 완전히 닫아 둬도 새 한마디가 폰 알림으로 옵니다.
--
--   흐름:  study_add_note → family_notes INSERT
--          → 트리거가 pg_net 으로 Edge Function(send-note-push)을 부름
--          → 함수가 가족의 구독(push_subscriptions)에게 VAPID 서명 + AES-128-GCM 암호화로 push 발송
--
--   · 비밀값은 이 파일에 없습니다. 함수가 처음 불릴 때 VAPID 키를 스스로 만들어
--     push_config 에 넣습니다(공개키만 앱이 읽고, 개인키는 service_role 만 읽습니다).
--   · Edge Functions 무료 쿼터(월 50만 회)로 충분합니다. 한마디 1건 = 호출 1회.
--   · pg_net 이 없거나 함수가 아직 없으면 알림만 조용히 건너뜁니다(한마디 저장은 그대로).
-- ----------------------------------------------------------------------------

-- 알림 설정·키 보관. 앱(anon)은 'vapid_public_key' 한 줄만 읽을 수 있습니다.
create table if not exists public.push_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- 기기별 push 구독. 읽기·쓰기 모두 RPC/서버(service_role)로만 합니다.
create table if not exists public.push_subscriptions (
  endpoint     text primary key,          -- push 서비스가 준 이 기기의 주소
  family_id    text not null references public.families (id) on delete cascade,
  member_id    text not null references public.family_members (id) on delete cascade,
  p256dh       text not null,             -- 기기 공개키(base64url)
  auth         text not null,             -- 인증 비밀값(base64url)
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_family_idx
  on public.push_subscriptions (family_id);

-- 한마디마다 알림을 한 번만 보내기 위한 표시.
-- (트리거가 두 번 불리거나 같은 요청이 반복돼도 두 번 울리지 않습니다.)
alter table public.family_notes add column if not exists push_sent_at timestamptz;

alter table public.push_config        enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists study_read_push_public on public.push_config;
create policy study_read_push_public on public.push_config
  for select to anon, authenticated using (key = 'vapid_public_key');

grant select on public.push_config to anon, authenticated;
revoke insert, update, delete on public.push_config from anon, authenticated;

-- 구독 표는 anon 에게 아예 열지 않습니다(정책도 없음).
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_subscriptions from public;

-- 알림 함수(service_role)는 아래 표들을 읽고 씁니다. (프로젝트 기본 권한이 있어도 한 번 더 명시)
--   · push_config / push_subscriptions : VAPID 키·구독 읽기/쓰기
--   · family_notes                    : 새 글 읽기 + push_sent_at 표시(UPDATE)
--   · family_members / families / tasks : 글쓴이 이름·가족 정보 읽기
--   (2026-11-25: service_role 에 SELECT/UPDATE 가 없어 함수가 403 42501 로 실패했습니다.
--    한마디 저장은 되지만 알림만 안 가는 상태였으니 이 GRANT 를 빼지 마세요.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.push_config, public.push_subscriptions to service_role';
    execute 'grant select on public.families, public.family_members, public.tasks, public.family_notes to service_role';
    execute 'grant update on public.family_notes to service_role';
  end if;
end;
$$;

-- 프로젝트 주소·공개키(브라우저 번들에도 들어가는 공개 값)는 트리거가 읽습니다.
insert into public.push_config (key, value)
values
  ('function_url',    'https://trhcatbuoslyjdhezobz.supabase.co/functions/v1/send-note-push'),
  ('publishable_key', 'sb_publishable_fPzIYHLYLbVmsPB6tLaUNw_z6sAnxbj')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- 트리거 → 함수 호출을 확인하는 비밀값. 이 파일에서 무작위로 한 번만 만듭니다.
insert into public.push_config (key, value)
select 'hook_secret',
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
on conflict (key) do nothing;

-- 이 기기를 알림 대상으로 등록합니다. (앱이 '알림 켜기'에서 한 번 부릅니다)
create or replace function public.study_register_push(
  p_actor_id    text,
  p_endpoint    text,
  p_p256dh      text,
  p_auth        text,
  p_user_agent  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.family_members;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_endpoint, ''))) < 10 or length(p_endpoint) > 1500 then
    raise exception '알림 주소가 올바르지 않습니다.' using errcode = '22023';
  end if;
  if coalesce(p_p256dh, '') = '' or length(p_p256dh) > 200
     or coalesce(p_auth, '') = '' or length(p_auth) > 100 then
    raise exception '알림 키가 올바르지 않습니다.' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (endpoint, family_id, member_id, p256dh, auth, user_agent)
  values (p_endpoint, v_actor.family_id, v_actor.id, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set family_id    = excluded.family_id,
        member_id    = excluded.member_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = coalesce(excluded.user_agent, public.push_subscriptions.user_agent),
        last_seen_at = now();

  -- 오래 조용했던 기기 정리(푸시 서비스가 410 을 주기도 전에).
  delete from public.push_subscriptions where last_seen_at < now() - interval '120 days';
end;
$$;

-- 이 기기를 알림 대상에서 뺍니다(같은 가족의 기기만).
create or replace function public.study_delete_push(
  p_actor_id text,
  p_endpoint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.family_members;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    return;
  end if;

  delete from public.push_subscriptions
   where endpoint = p_endpoint and family_id = v_actor.family_id;
end;
$$;

-- 새 한마디 → Edge Function 호출. 실패해도 한마디 저장은 막지 않습니다.
create or replace function public.study_push_note_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url  text;
  v_key  text;
  v_hook text;
begin
  select value into v_url  from public.push_config where key = 'function_url';
  select value into v_key  from public.push_config where key = 'publishable_key';
  select value into v_hook from public.push_config where key = 'hook_secret';

  if coalesce(v_url, '') = '' or coalesce(v_hook, '') = '' then
    return new;  -- 알림 설정 전
  end if;

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('note_id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', coalesce(v_key, ''),
        'x-study-hook', v_hook
      ),
      -- 첫 호출은 함수가 깨어나는 데 몇 초 걸립니다(그래도 응답을 기다리지 않고 큐에 들어갑니다).
      timeout_milliseconds := 10000
    );
  exception
    when others then
      -- pg_net 미설치·일시 오류: 알림만 건너뜁니다.
      null;
  end;

  return new;
end;
$$;

drop trigger if exists study_push_note_alert on public.family_notes;
create trigger study_push_note_alert
  after insert on public.family_notes
  for each row execute function public.study_push_note_alert();

revoke all on function public.study_register_push(text, text, text, text, text) from public;
revoke all on function public.study_delete_push(text, text) from public;
revoke all on function public.study_push_note_alert() from public;
grant execute on function public.study_register_push(text, text, text, text, text) to anon, authenticated;
grant execute on function public.study_delete_push(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Realtime — 이 테이블들의 변경이 폰으로 즉시 전달되게 합니다.
--    (family_secrets 는 실시간 대상이 아닙니다.)
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['families', 'family_members', 'tasks', 'family_notes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null; -- 이미 들어 있으면 그냥 넘어갑니다.
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. 우리 가족 공부방 · 구성원 (여러 번 실행해도 중복·덮어쓰기 없음)
-- ----------------------------------------------------------------------------

insert into public.families (id, name)
values ('fam_our_home', '우리 가족 공부방')
on conflict (id) do nothing;

insert into public.family_members (id, family_id, name, role, grade, emoji, color, presets)
values
  ('mem_dad',    'fam_our_home', '아빠', 'parent', null,  '👨🏻', 'sky',    '[]'::jsonb),
  ('mem_mom',    'fam_our_home', '엄마', 'parent', null,  '👩🏻', 'violet', '[]'::jsonb),
  ('mem_child1', 'fam_our_home', '첫째', 'child',  '중1', '🌸',   'rose',   '[
     {"title": "스픽 30분", "subject": "english"},
     {"title": "타자 연습 20분", "subject": "etc"},
     {"title": "영어 단어 5개 외우기", "subject": "english"},
     {"title": "책 읽기 30분", "subject": "reading"},
     {"title": "문제집과 오답 노트", "subject": "math"},
     {"title": "독서록 (아빠 검사)", "subject": "reading"}
   ]'::jsonb),
  ('mem_child2', 'fam_our_home', '둘째', 'child',  '초4', '⚡',   'amber',  '[
     {"title": "온리원", "subject": "etc"},
     {"title": "스픽 30분", "subject": "english"},
     {"title": "문제집과 오답 노트", "subject": "math"},
     {"title": "신문 요약", "subject": "korean"},
     {"title": "책 읽기 30분", "subject": "reading"},
     {"title": "타자 연습 20분", "subject": "etc"}
   ]'::jsonb)
on conflict (id) do nothing;

-- (샘플 숙제 블록은 없앴습니다 — 예전 임시 데모 항목이 다시 들어가지 않도록.
--  새 가족의 공부 항목은 앱의 '+ 추가' 나 '기본 목록'으로 넣습니다.)

-- ----------------------------------------------------------------------------
-- 6. 부모 관리 PIN 정하기 (한 번만)
--
--   PIN 숫자는 이 공개 파일에 적지 않습니다. SQL Editor 에서 아래처럼 한 번 실행하세요.
--     select public.study_set_parent_pin('fam_our_home', '네자리PIN');
--   나중에 바꿀 때는 지금 쓰는 PIN 을 세 번째 인자로 넘깁니다.
--     select public.study_set_parent_pin('fam_our_home', '새PIN', '지금PIN');
--   (아직 정하지 않으면 앱의 부모 화면이 "PIN이 아직 설정되지 않았어요" 라고 안내합니다.)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 7. 🏆 월간 시즌 티어 · 🎁 보상 뽑기 상자
--
--   아이가 그 달에 부모 확인 완료(verified)한 공부로 XP 를 모아 6단계 티어를 오릅니다.
--   큰 티어(브론즈→실버, 실버→골드 …)로 올라갈 때만 🎁 뽑기 상자가 하나 열리고,
--   세부 단계(III→II→I)는 배지·경험치 표시만 바뀝니다.
--   승급한 순간 가족 알림판에 축하 한마디가 올라가 폰 푸시로 알려 줍니다
--   (기존 study_push_note_alert 트리거를 그대로 씁니다 — 중복 발송 없음).
--
--   · XP·티어·연속 100% 계산은 앱(src/lib/season.ts)이 합니다.
--   · 이 표는 '이미 알린 승급'의 기억입니다. 그래서 폰이 여러 대여도 같은 승급을
--     두 번 알리지 않고(같은 id 는 한 번만), 상자를 연 기록도 폰끼리 함께 봅니다.
--   · 쓰기는 아래 RPC 로만 합니다(표 직접 쓰기는 RLS 로 막혀 있습니다).
-- ============================================================================

create table if not exists public.family_tier_events (
  id          text primary key,
  family_id   text not null references public.families (id) on delete cascade,
  member_id   text not null references public.family_members (id) on delete cascade,
  season      text not null check (season ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tier        text not null check (tier in ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master')),
  tier_rank   smallint not null check (tier_rank between 1 and 6),
  level       smallint not null check (level between 0 and 15),
  division    smallint not null check (division between 0 and 3),
  -- 큰 티어 승급일 때 뽑힌 게임 시간(분). 세부 단계 승급은 null
  box_minutes integer check (box_minutes between 1 and 120),
  created_at  timestamptz not null default now(),
  opened_at   timestamptz,
  used_at     timestamptz,
  used_by     text references public.family_members (id) on delete set null
);

create index if not exists family_tier_events_member_idx
  on public.family_tier_events (member_id, season, level);

-- 보상 뽑기 설정(상자에서 나올 수 있는 게임 시간·알림 켜기) — 가족마다 한 줄
create table if not exists public.family_reward_settings (
  family_id   text primary key references public.families (id) on delete cascade,
  pool        integer[] not null default '{5,10,15,20}',
  notify_box  boolean not null default true,
  notify_step boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.family_tier_events   enable row level security;
alter table public.family_reward_settings enable row level security;

drop policy if exists study_read_tier_events on public.family_tier_events;
create policy study_read_tier_events on public.family_tier_events
  for select to anon, authenticated using (true);

drop policy if exists study_read_reward_settings on public.family_reward_settings;
create policy study_read_reward_settings on public.family_reward_settings
  for select to anon, authenticated using (true);

grant select on public.family_tier_events, public.family_reward_settings to anon, authenticated;
revoke insert, update, delete on public.family_tier_events, public.family_reward_settings
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 승급 한 칸 기록 + (큰 티어면) 상자 + 축하 한마디(→ 폰 푸시)
--   같은 칸은 한 번만 만들어지므로, 폰 여러 대에서 동시에 불러도 알림은 한 번입니다.
-- ---------------------------------------------------------------------------
create or replace function public.study_tier_promotion(
  p_actor_id text,
  p_member_id text,
  p_season    text,
  p_level     integer,
  p_notify    boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     public.family_members;
  v_member    public.family_members;
  v_rank      integer;
  v_div       integer;
  v_tier      text;
  v_event     public.family_tier_events;
  v_settings  public.family_reward_settings;
  v_pool      integer[];
  v_minutes   integer;
  v_id        text;
  v_today     text;
  v_note_id   text;
  v_author    text;
  v_title     text;
  v_div_text  text;
  v_last      text;
  v_josa      text;
  v_content   text;
  v_noted     boolean := false;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  select * into v_member
    from public.family_members
   where id = p_member_id and family_id = v_actor.family_id;
  if not found then
    raise exception '같은 가족 구성원의 티어만 기록할 수 있습니다.' using errcode = '42501';
  end if;
  if v_member.role <> 'child' then
    raise exception '티어는 아이에게만 있습니다.' using errcode = '22023';
  end if;

  if p_season is null or p_season !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception '시즌은 YYYY-MM 형식이어야 합니다.' using errcode = '22023';
  end if;
  if p_level is null or p_level < 0 or p_level > 15 then
    raise exception '티어 단계는 0~15 사이여야 합니다.' using errcode = '22023';
  end if;

  if p_level = 0 then
    -- 0 칸(브론즈 III)은 모두의 시작 칸이라 승급이 아닙니다.
    return jsonb_build_object('created', false, 'noted', false, 'event', null);
  end if;

  v_rank := (p_level / 3) + 1;
  if v_rank > 6 then
    v_rank := 6;
  end if;
  v_div := case when v_rank >= 6 then 0 else 3 - (p_level % 3) end;
  v_tier := (array['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'])[v_rank];
  v_id := 'ev_' || p_member_id || '_' || p_season || '_' || p_level::text;

  select * into v_event from public.family_tier_events where id = v_id;
  if found then
    return jsonb_build_object('created', false, 'noted', false, 'event', to_jsonb(v_event));
  end if;

  -- 큰 티어가 바뀔 때(실버 III·골드 III·플래티넘 III·다이아 III·마스터)만 상자 하나.
  -- 세부 단계(III→II→I)는 기록만 남기고 상자는 없습니다.
  if v_rank >= 2 and (p_level % 3) = 0 then
    select * into v_settings from public.family_reward_settings where family_id = v_actor.family_id;
    v_pool := coalesce(nullif(v_settings.pool, '{}'::integer[]), array[5, 10, 15, 20]);

    with candidates as (
      select value,
             case when v_rank >= 4 then ord * ord else ord end as weight
        from unnest(v_pool) with ordinality as t(value, ord)
       where value between 1 and 120
    )
    select value into v_minutes
      from candidates
     order by -ln(1 - random()) / weight
     limit 1;
  end if;

  insert into public.family_tier_events
    (id, family_id, member_id, season, tier, tier_rank, level, division, box_minutes)
  values
    (v_id, v_actor.family_id, v_member.id, p_season, v_tier, v_rank, p_level, v_div, v_minutes)
  on conflict (id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select * into v_event from public.family_tier_events where id = v_id;
    return jsonb_build_object('created', false, 'noted', false, 'event', to_jsonb(v_event));
  end if;

  -- 승급 알림: 가족 알림판에 축하 한마디 → 기존 트리거가 폰 푸시를 보냅니다.
  --   쓴 사람은 부모로 둡니다. 아이 기기에서 승급이 잡혀도 그 아이 폰에도 알림이 가도록.
  if p_notify then
    if v_actor.role = 'parent' then
      v_author := v_actor.id;
    else
      select id into v_author
        from public.family_members
       where family_id = v_actor.family_id and role = 'parent'
       order by created_at, id
       limit 1;
      v_author := coalesce(v_author, v_actor.id);
    end if;

    v_today := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
    v_note_id := 'n_' || v_today || '_tier_' || p_member_id || '_' || p_season || '_' || p_level::text;

    v_title := case v_rank
                 when 1 then '브론즈' when 2 then '실버' when 3 then '골드'
                 when 4 then '플래티넘' when 5 then '다이아' else '마스터' end;
    v_div_text := case v_div when 3 then ' III' when 2 then ' II' when 1 then ' I' else '' end;

    v_last := right(v_member.name, 1);
    if v_last ~ '[가-힣]' and (ascii(v_last) - 44032) % 28 = 0 then
      v_josa := '가';
    else
      v_josa := '이가';
    end if;

    v_content := '🎉 ' || v_member.name || v_josa || ' [' || v_title || v_div_text || '] 티어로 승급했어요!'
      || case when v_minutes is not null then ' 🎁 뽑기 상자가 열렸어요!' else '' end;

    insert into public.family_notes (id, family_id, author_id, content)
    values (v_note_id, v_actor.family_id, v_author, left(v_content, 300))
    on conflict (id) do nothing;
    v_noted := found;
  end if;

  return jsonb_build_object('created', true, 'noted', v_noted, 'event', to_jsonb(v_event));
end;
$$;

-- ---------------------------------------------------------------------------
-- 🎁 상자 열기 — 자기 상자(또는 부모).
-- ---------------------------------------------------------------------------
create or replace function public.study_open_reward(
  p_actor_id text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.family_members;
  v_event public.family_tier_events;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;

  select * into v_event
    from public.family_tier_events
   where id = p_event_id and family_id = v_actor.family_id;
  if not found then
    raise exception '상자를 찾지 못했습니다. 새로고침해 주세요.' using errcode = 'P0002';
  end if;
  if v_event.member_id <> v_actor.id and v_actor.role <> 'parent' then
    raise exception '내 상자만 열 수 있습니다.' using errcode = '42501';
  end if;
  if v_event.box_minutes is null then
    raise exception '이번 승급에는 뽑기 상자가 없습니다.' using errcode = '22023';
  end if;

  update public.family_tier_events
     set opened_at = coalesce(opened_at, now())
   where id = v_event.id
  returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

-- ---------------------------------------------------------------------------
-- ✅ 보상 사용 완료 — 부모 + 부모 관리 PIN.
-- ---------------------------------------------------------------------------
create or replace function public.study_use_reward(
  p_actor_id text,
  p_event_id text,
  p_pin      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.family_members;
  v_event public.family_tier_events;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '보상 사용 처리는 부모님만 할 수 있습니다.' using errcode = '42501';
  end if;
  if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
    raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
  end if;

  select * into v_event
    from public.family_tier_events
   where id = p_event_id and family_id = v_actor.family_id;
  if not found then
    raise exception '보상을 찾지 못했습니다. 새로고침해 주세요.' using errcode = 'P0002';
  end if;

  update public.family_tier_events
     set used_at = now(), used_by = v_actor.id
   where id = v_event.id
  returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

-- ---------------------------------------------------------------------------
-- ⚙️ 보상 설정(보상 풀·알림) — 부모 + 부모 관리 PIN.
-- ---------------------------------------------------------------------------
create or replace function public.study_set_reward_settings(
  p_actor_id   text,
  p_pool       integer[],
  p_notify_box boolean,
  p_notify_step boolean,
  p_pin        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor  public.family_members;
  v_pool   integer[];
  v_values integer[];
  v_row    public.family_reward_settings;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '보상 설정은 부모님만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
    raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
  end if;

  select coalesce(array_agg(value order by ord), array[]::integer[])
    into v_values
    from unnest(coalesce(p_pool, array[]::integer[])) with ordinality as t(value, ord)
   where value between 1 and 120;

  if coalesce(array_length(v_values, 1), 0) = 0 then
    v_values := array[5, 10, 15, 20];
  end if;
  v_pool := v_values[1:6];

  insert into public.family_reward_settings (family_id, pool, notify_box, notify_step, updated_at)
  values (v_actor.family_id, v_pool, coalesce(p_notify_box, true), coalesce(p_notify_step, true), now())
  on conflict (family_id) do update
     set pool = excluded.pool,
         notify_box = excluded.notify_box,
         notify_step = excluded.notify_step,
         updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.study_tier_promotion(text, text, text, integer, boolean) from public;
revoke all on function public.study_open_reward(text, text) from public;
revoke all on function public.study_use_reward(text, text, text) from public;
revoke all on function public.study_set_reward_settings(text, integer[], boolean, boolean, text) from public;

grant execute on function public.study_tier_promotion(text, text, text, integer, boolean) to anon, authenticated;
grant execute on function public.study_open_reward(text, text) to anon, authenticated;
grant execute on function public.study_use_reward(text, text, text) to anon, authenticated;
grant execute on function public.study_set_reward_settings(text, integer[], boolean, boolean, text) to anon, authenticated;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.family_tier_events';
  exception
    when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.family_reward_settings';
  exception
    when duplicate_object then null;
  end;
end;
$$;

notify pgrst, 'reload schema';
