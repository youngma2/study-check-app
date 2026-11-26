-- ============================================================================
-- 8. 🐣 쪼꼬 명의 자동 알림 — 티어 승급 · 부재중 전화 등
--
--   가족 알림판(`family_notes`)에 앱·자동화가 올리는 글은 '아빠' 가 아니라 '쪼꼬' 이름으로
--   보여야 합니다(영민님 지시, 2026-11-26).
--
--   · 글쓴이(`author_id`)는 그대로 부모로 둡니다 — 그래야 폰 푸시가 모든 가족 폰
--     (아이 폰 포함)으로 갑니다. 화면 표시만 `author_kind = 'jjokko'` 로 바꿉니다.
--   · 앱은 `author_kind` 를 읽어 '🐣 쪼꼬' 로 그리고, 본문 앞의 `🐣 쪼꼬:` 는 덜어냅니다.
--   · 여러 번 실행해도 안전합니다(표·제약·트리거·RPC 모두 if not exists / create or replace).
-- ============================================================================

-- 8-1. 표시용 열: 'member'(가족이 쓴 글) | 'jjokko'(쪼꼬가 올린 자동 알림)
alter table public.family_notes
  add column if not exists author_kind text not null default 'member';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'family_notes_author_kind_chk'
       and conrelid = 'public.family_notes'::regclass
  ) then
    alter table public.family_notes
      add constraint family_notes_author_kind_chk check (author_kind in ('member', 'jjokko'));
  end if;
end;
$$;

-- 8-2. 예전 방식(본문이 '🐣 쪼꼬: …' 로 시작)으로 올린 글도 자동으로 쪼꼬 글로.
--      (다른 자동화·지난 스크립트가 study_add_note 로 올려도 그대로 동작합니다)
create or replace function public.study_note_before_insert_jjokko()
returns trigger
language plpgsql
as $$
declare
  v_prefix   constant text := '^\s*(?:🐣\s*)?쪼꼬\s*[:：]\s*';
  v_body     text := btrim(coalesce(new.content, ''));
  v_stripped text;
begin
  if new.author_kind = 'member' and v_body ~ v_prefix then
    v_stripped := btrim(regexp_replace(v_body, v_prefix, ''));
    -- 접두사만 있던 글은 지우지 않습니다(본문 1자 이상 규칙 유지).
    if v_stripped <> '' then
      new.author_kind := 'jjokko';
      new.content := left(v_stripped, 300);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists study_note_before_insert_jjokko on public.family_notes;
create trigger study_note_before_insert_jjokko
  before insert on public.family_notes
  for each row execute function public.study_note_before_insert_jjokko();

-- 8-3. 쪼꼬 명의로 한마디 남기기 — 부재중 전화·통화 결과처럼 쪼꼬가 남기는 글.
--      p_actor_id 는 가족 확인용(보통 부모 id). 화면에는 '🐣 쪼꼬' 로 보입니다.
create or replace function public.study_add_jjokko_note(
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

  -- 본문 앞에 '🐣 쪼꼬:' 를 붙여 넘겨도 한 번 더 덜어 냅니다(트리거와 같은 규칙).
  v_content := btrim(regexp_replace(v_content, '^\s*(?:🐣\s*)?쪼꼬\s*[:：]\s*', ''));

  if v_content = '' then
    raise exception '남길 말을 적어 주세요.' using errcode = '22023';
  end if;
  if length(v_content) > 300 then
    raise exception '한마디는 300자까지 적을 수 있습니다.' using errcode = '22023';
  end if;

  insert into public.family_notes (id, family_id, author_id, author_kind, content)
  values (
    coalesce(nullif(btrim(p_id), ''), 'n_' || replace(gen_random_uuid()::text, '-', '')),
    v_actor.family_id,
    v_actor.id,
    'jjokko',
    v_content
  )
  returning * into v_note;

  return v_note;
end;
$$;

revoke all on function public.study_add_jjokko_note(text, text, text) from public;
grant execute on function public.study_add_jjokko_note(text, text, text) to anon, authenticated;

-- 8-4. 티어 승급 축하 한마디도 쪼꼬 명의로.
--      (7번 study_tier_promotion 과 같은 함수이고, 한마디를 넣을 때 author_kind = 'jjokko' 만 더합니다)
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
  --   글쓴이(author_id)는 부모로 둡니다 — 아이 기기에서 승급이 잡혀도 그 아이 폰에도 알림이 가도록.
  --   화면에는 '아빠' 가 아니라 '🐣 쪼꼬' 로 보이게 author_kind = 'jjokko' (supabase/notes-jjokko.sql).
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

    insert into public.family_notes (id, family_id, author_id, author_kind, content)
    values (v_note_id, v_actor.family_id, v_author, 'jjokko', left(v_content, 300))
    on conflict (id) do nothing;
    v_noted := found;
  end if;

  return jsonb_build_object('created', true, 'noted', v_noted, 'event', to_jsonb(v_event));
end;
$$;

-- 8-5. 이미 올라간 자동 알림도 쪼꼬 명의로 정리 (오늘 티어 승급·부재중 전화 글 포함)
update public.family_notes
   set author_kind = 'jjokko'
 where author_kind is distinct from 'jjokko'
   and (
     content ~ '^\s*(?:🐣\s*)?쪼꼬\s*[:：]'
     or id ~ '^n_[0-9]{4}-[0-9]{2}-[0-9]{2}_tier_'
   );

update public.family_notes
   set content = left(btrim(regexp_replace(content, '^\s*(?:🐣\s*)?쪼꼬\s*[:：]\s*', '')), 300)
 where author_kind = 'jjokko'
   and content ~ '^\s*(?:🐣\s*)?쪼꼬\s*[:：]'
   and btrim(regexp_replace(content, '^\s*(?:🐣\s*)?쪼꼬\s*[:：]\s*', '')) <> '';

notify pgrst, 'reload schema';
