-- ============================================================================
-- 9. ⚙️ 가족 설정 — 기본 공부 목록 · 🔥 버스트 타임 · ⑤ 연속 보너스 · 타이머 기록
--
--   부모(관리자) 화면의 [옵션] 에서 정하는 값들을 가족이 함께 쓰는 한 줄로 둡니다.
--   · presets      — 학기중·방학·시험기간 프리셋별 아이·요일별 기본 숙제 목록
--   · activePreset — 지금 쓰는 프리셋
--   · burst        — 🔥 버스트 타임(경험치 2배)이 켜져 있는지
--   · burstWindows — 켜 둔 시간대들. 그때 완료한 항목은 끈 뒤에도 2배로 남습니다.
--   · streakBonuses — ⑤ 3·7·14·30일 연속 달성 보너스 XP
--   · timeUsage    — 뽑기 시간을 나눠 쓴 기록(타이머)
--
--   · 읽기는 열려 있고(아이 폰도 버스트 타임 배너를 봐야 하므로), 쓰기는 아래 RPC 로만 합니다.
--   · 앱은 이 표가 없어도 에러 없이 이 기기(localStorage) 저장으로 계속 동작합니다.
--     가족 폰이 같은 설정을 함께 쓰려면 이 파일(또는 schema.sql 전체)을 한 번 실행하세요.
--   · 여러 번 실행해도 안전합니다(if not exists / create or replace).
-- ============================================================================

create table if not exists public.family_app_settings (
  family_id  text primary key references public.families (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.family_app_settings enable row level security;

drop policy if exists study_read_app_settings on public.family_app_settings;
create policy study_read_app_settings on public.family_app_settings
  for select to anon, authenticated using (true);

grant select on public.family_app_settings to anon, authenticated;
revoke insert, update, delete on public.family_app_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 가족 설정 저장 — 부모 + 부모 관리 PIN 이 있어야 합니다.
-- ---------------------------------------------------------------------------
create or replace function public.study_set_app_settings(
  p_actor_id text,
  p_settings jsonb,
  p_pin      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.family_members;
  v_row   public.family_app_settings;
begin
  select * into v_actor from public.family_members where id = p_actor_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' using errcode = '42501';
  end if;
  if v_actor.role <> 'parent' then
    raise exception '가족 설정은 부모님만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if not public.study_pin_is_valid(v_actor.family_id, p_pin) then
    raise exception '부모 관리 PIN이 필요합니다. 앱에서 관리 잠금을 풀고 다시 시도해 주세요.' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception '설정 값이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if length(p_settings::text) > 60000 then
    raise exception '설정이 너무 큽니다.' using errcode = '22023';
  end if;

  insert into public.family_app_settings (family_id, settings, updated_at)
  values (v_actor.family_id, p_settings, now())
  on conflict (family_id) do update
     set settings = excluded.settings,
         updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.study_set_app_settings(text, jsonb, text) from public;
grant execute on function public.study_set_app_settings(text, jsonb, text) to anon, authenticated;

-- 다른 폰에서 버스트 타임·기본 목록이 바뀌면 바로 반영(Realtime)
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.family_app_settings';
  exception
    when duplicate_object then null;
  end;
end;
$$;

notify pgrst, 'reload schema';
