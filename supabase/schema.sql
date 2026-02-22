-- =====================================================
-- AXIS: Supabase complete schema (idempotent)
-- Run in Supabase SQL Editor as project owner.
-- =====================================================

begin;

-- ---------- Extensions ----------
create extension if not exists pgcrypto;

-- ---------- Utilities ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Tables ----------
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint songs_title_artist_unique unique (title, artist)
);

create table if not exists public.recommendation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  input_favorites text[] not null default '{}',
  input_age int,
  input_job text,
  input_mood text,
  input_note text,
  model_name text,
  mode text not null,
  request_payload jsonb,
  created_at timestamptz not null default now(),
  constraint recommendation_logs_age_check
    check (input_age is null or (input_age >= 0 and input_age <= 120)),
  constraint recommendation_logs_mode_check
    check (mode in ('ai', 'local', 'local_fallback'))
);

create table if not exists public.recommendation_items (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.recommendation_logs(id) on delete cascade,
  rank_no int not null,
  title text not null,
  artist text not null,
  reason text,
  score numeric,
  created_at timestamptz not null default now(),
  constraint recommendation_items_rank_positive check (rank_no > 0),
  constraint recommendation_items_score_range check (score is null or (score >= 0 and score <= 10)),
  constraint recommendation_items_log_rank_unique unique (log_id, rank_no)
);

-- ---------- Indexes ----------
create index if not exists idx_songs_is_active on public.songs (is_active);
create index if not exists idx_songs_tags_gin on public.songs using gin (tags);
create index if not exists idx_recommendation_logs_created_at on public.recommendation_logs (created_at desc);
create index if not exists idx_recommendation_logs_user_id on public.recommendation_logs (user_id);
create index if not exists idx_recommendation_items_log_id on public.recommendation_items (log_id);

-- ---------- Triggers ----------
drop trigger if exists trg_songs_updated_at on public.songs;
create trigger trg_songs_updated_at
before update on public.songs
for each row
execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.songs enable row level security;
alter table public.recommendation_logs enable row level security;
alter table public.recommendation_items enable row level security;

-- Remove old policies if re-running.
drop policy if exists songs_read_active on public.songs;
drop policy if exists songs_all_service_role on public.songs;
drop policy if exists logs_insert_anon on public.recommendation_logs;
drop policy if exists logs_select_own on public.recommendation_logs;
drop policy if exists logs_select_anon on public.recommendation_logs;
drop policy if exists logs_all_service_role on public.recommendation_logs;
drop policy if exists items_insert_anon on public.recommendation_items;
drop policy if exists items_select_from_readable_logs on public.recommendation_items;
drop policy if exists items_all_service_role on public.recommendation_items;

-- songs: everyone can read active songs.
create policy songs_read_active
  on public.songs
  for select
  to anon, authenticated
  using (is_active = true);

-- songs: service_role full control.
create policy songs_all_service_role
  on public.songs
  for all
  to service_role
  using (true)
  with check (true);

-- logs: demo compatibility (anon insert allowed for browser app).
create policy logs_insert_anon
  on public.recommendation_logs
  for insert
  to anon, authenticated
  with check (true);

-- logs: authenticated users can read only own logs (when user_id is set).
create policy logs_select_own
  on public.recommendation_logs
  for select
  to authenticated
  using (user_id = auth.uid());

-- logs: optional anon read (set false by default for safety).
create policy logs_select_anon
  on public.recommendation_logs
  for select
  to anon
  using (false);

-- logs: service_role full control.
create policy logs_all_service_role
  on public.recommendation_logs
  for all
  to service_role
  using (true)
  with check (true);

-- items: demo compatibility (anon insert allowed).
create policy items_insert_anon
  on public.recommendation_items
  for insert
  to anon, authenticated
  with check (true);

-- items: can read items only when parent log is readable.
create policy items_select_from_readable_logs
  on public.recommendation_items
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.recommendation_logs rl
      where rl.id = recommendation_items.log_id
        and (
          auth.role() = 'anon' and false
          or auth.role() = 'authenticated' and rl.user_id = auth.uid()
        )
    )
  );

-- items: service_role full control.
create policy items_all_service_role
  on public.recommendation_items
  for all
  to service_role
  using (true)
  with check (true);

-- ---------- Grants ----------
grant usage on schema public to anon, authenticated;

grant select on public.songs to anon, authenticated;
grant insert on public.recommendation_logs to anon, authenticated;
grant insert on public.recommendation_items to anon, authenticated;

grant all privileges on public.songs to service_role;
grant all privileges on public.recommendation_logs to service_role;
grant all privileges on public.recommendation_items to service_role;

-- ---------- Seed (idempotent) ----------
insert into public.songs (title, artist, tags, source)
values
  ('群青', 'YOASOBI', '{jpop,upbeat,focus}', 'seed'),
  ('Lemon', '米津玄師', '{jpop,healing,nostalgic}', 'seed'),
  ('Pretender', 'Official髭男dism', '{jpop,nostalgic}', 'seed'),
  ('怪獣の花唄', 'Vaundy', '{jpop,happy}', 'seed'),
  ('Lo-fi Study Beats', 'Various Artists', '{focus,relax}', 'seed')
on conflict (title, artist) do update
set tags = excluded.tags,
    is_active = true,
    source = excluded.source,
    updated_at = now();

commit;
