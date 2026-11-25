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
