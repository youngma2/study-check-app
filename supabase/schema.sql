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
--   · 항목 추가/완료 요청/확인 완료가 폰끼리 실시간으로 반영됩니다(새로고침 없음).
--
-- 권한 (앱 + DB 이중으로 막습니다)
--   부모(아빠·엄마): 추가·수정·삭제·확인 완료
--   아이(첫째·둘째): 자기 숙제 추가, 완료 요청/요청 취소만. 삭제·수정·확인 완료 불가
--
-- 구조
--   families ─┬─ family_members
--             └─ tasks
--   읽기는 누구나(가족 링크를 아는 기기), 쓰기는 아래 RPC 로만 가능하게 해 두고
--   RPC 안에서 역할(parent/child)을 검사합니다.
-- ============================================================================

-- (식별자 생성은 PostgreSQL 13+ 기본 함수인 gen_random_uuid() 를 씁니다.)

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
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_family_due_idx on public.tasks (family_id, due_date);
create index if not exists tasks_member_due_idx on public.tasks (member_id, due_date);
create index if not exists tasks_pending_idx
  on public.tasks (family_id, due_date) where status = 'pending_verification';
create index if not exists family_members_family_idx on public.family_members (family_id);

-- Realtime 삭제 이벤트: RLS + family_id 필터를 쓰려면 예전 행 전체가 필요합니다.
-- (기본 replica identity 는 기본키만 보내서 DELETE 가 구독자에게 전달되지 않습니다.)
alter table public.tasks          replica identity full;
alter table public.family_members replica identity full;

-- ----------------------------------------------------------------------------
-- 2. RLS — 읽기는 열고, 직접 쓰기는 막습니다(쓰기는 3번의 RPC 로만).
-- ----------------------------------------------------------------------------

alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.tasks          enable row level security;

drop policy if exists study_read_families on public.families;
create policy study_read_families on public.families
  for select to anon, authenticated using (true);

drop policy if exists study_read_members on public.family_members;
create policy study_read_members on public.family_members
  for select to anon, authenticated using (true);

drop policy if exists study_read_tasks on public.tasks;
create policy study_read_tasks on public.tasks
  for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.families, public.family_members, public.tasks to anon, authenticated;
revoke insert, update, delete on public.families, public.family_members, public.tasks
  from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC — 앱이 쓰는 유일한 쓰기 통로. actor(누가)를 받아 역할을 검사합니다.
-- ----------------------------------------------------------------------------

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

-- 상태 변경: 부모는 모두, 아이는 자기 것만 그리고 '확인 완료'는 불가.
create or replace function public.study_set_task_status(
  p_actor_id text,
  p_task_id  text,
  p_status   text
)
returns public.tasks
language plpgsql
security definer
set search_path = public
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

  if p_status = 'verified' then
    if v_actor.role <> 'parent' then
      raise exception '확인 완료는 부모님만 할 수 있습니다.' using errcode = '42501';
    end if;
    if v_task.status = 'verified' then
      return v_task;
    end if;
    update public.tasks
       set status = 'verified', verified_by = v_actor.id, verified_at = now(), updated_at = now()
     where id = v_task.id
    returning * into v_task;
  else
    if v_actor.role <> 'parent' and v_task.member_id <> v_actor.id then
      raise exception '내 공부만 바꿀 수 있습니다.' using errcode = '42501';
    end if;
    if v_task.status = p_status then
      return v_task;
    end if;
    update public.tasks
       set status = p_status, verified_by = null, verified_at = null, updated_at = now()
     where id = v_task.id
    returning * into v_task;
  end if;

  return v_task;
end;
$$;

-- 삭제: 부모만.
create or replace function public.study_delete_task(
  p_actor_id text,
  p_task_id  text
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
  if v_actor.role <> 'parent' then
    raise exception '아이는 항목을 삭제할 수 없습니다. 부모님께 알려 주세요.' using errcode = '42501';
  end if;

  delete from public.tasks where id = p_task_id and family_id = v_actor.family_id;
end;
$$;

revoke all on function public.study_add_task(text, text, text, text, date, text, text) from public;
revoke all on function public.study_update_task(text, text, text, text, date, text) from public;
revoke all on function public.study_set_task_status(text, text, text) from public;
revoke all on function public.study_delete_task(text, text) from public;

grant execute on function public.study_add_task(text, text, text, text, date, text, text) to anon, authenticated;
grant execute on function public.study_update_task(text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.study_set_task_status(text, text, text) to anon, authenticated;
grant execute on function public.study_delete_task(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Realtime — 이 세 테이블의 변경이 폰으로 즉시 전달되게 합니다.
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
  foreach t in array array['families', 'family_members', 'tasks'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null; -- 이미 들어 있으면 그냥 넘어갑니다.
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. 우리 가족 공부방 + 이번 주 샘플 (여러 번 실행해도 중복·덮어쓰기 없음)
-- ----------------------------------------------------------------------------

insert into public.families (id, name)
values ('fam_our_home', '우리 가족 공부방')
on conflict (id) do nothing;

insert into public.family_members (id, family_id, name, role, grade, emoji, color, presets)
values
  ('mem_dad',    'fam_our_home', '아빠', 'parent', null,  '👨🏻', 'sky',    '[]'::jsonb),
  ('mem_mom',    'fam_our_home', '엄마', 'parent', null,  '👩🏻', 'violet', '[]'::jsonb),
  ('mem_child1', 'fam_our_home', '첫째', 'child',  '중1', '🌸',   'rose',   '[
     {"title": "아라온 인강 듣기", "subject": "english"},
     {"title": "스픽 10분 말하기", "subject": "english"},
     {"title": "신문 쓰기", "subject": "korean"},
     {"title": "수학 문제집 2쪽", "subject": "math"}
   ]'::jsonb),
  ('mem_child2', 'fam_our_home', '둘째', 'child',  '초4', '⚡',   'amber',  '[
     {"title": "온리원 강의 듣기", "subject": "etc"},
     {"title": "스픽 10분 말하기", "subject": "english"},
     {"title": "문제집 2장 풀기", "subject": "math"},
     {"title": "책 읽기 20분", "subject": "reading"}
   ]'::jsonb)
on conflict (id) do nothing;

-- 이번 주(월~일) 샘플 숙제. 날짜는 한국 시간 기준 이번 주 월요일부터 채웁니다.
with plan (member_id, idx, title, subject, days) as (
  values
    ('mem_child1', 0, '아라온 인강 듣기',   'english', array[0, 1, 2, 3, 4]),
    ('mem_child1', 1, '스픽 10분 말하기',   'english', array[0, 1, 2, 3, 4, 5]),
    ('mem_child1', 2, '신문 쓰기',          'korean',  array[0, 2, 4]),
    ('mem_child1', 3, '수학 문제집 2쪽',    'math',    array[1, 3]),
    ('mem_child2', 0, '온리원 강의 듣기',   'etc',     array[0, 1, 2, 3, 4]),
    ('mem_child2', 1, '스픽 10분 말하기',   'english', array[0, 1, 2, 3, 4, 5]),
    ('mem_child2', 2, '문제집 2장 풀기',    'math',    array[0, 1, 2, 3, 4]),
    ('mem_child2', 3, '책 읽기 20분',       'reading', array[0, 1, 2, 3, 4, 5, 6])
),
days as (
  select (date_trunc('week', (now() at time zone 'Asia/Seoul'))::date + g) as day
  from generate_series(0, 6) as g
)
insert into public.tasks (id, family_id, member_id, title, subject, due_date, status, created_by, created_at, updated_at)
select
  't_' || p.member_id || '_' || to_char(d.day, 'YYYY-MM-DD') || '_' || p.idx,
  'fam_our_home',
  p.member_id,
  p.title,
  p.subject,
  d.day::date,
  'todo',
  p.member_id,
  (d.day::date + time '08:10') at time zone 'Asia/Seoul' + (p.idx * interval '1 minute'),
  (d.day::date + time '08:10') at time zone 'Asia/Seoul' + (p.idx * interval '1 minute')
from plan p
join days d on (extract(isodow from d.day)::int - 1) = any (p.days)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
