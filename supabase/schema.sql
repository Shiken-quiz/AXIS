-- Supabase SQL schema for AI music recommendation app

create extension if not exists pgcrypto;

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendation_logs (
  id uuid primary key default gen_random_uuid(),
  input_favorites text[] not null default '{}',
  input_age int,
  input_job text,
  input_mood text,
  input_note text,
  model_name text,
  mode text not null,
  recommendation_count int not null default 0,
  created_at timestamptz not null default now()
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
  unique(log_id, rank_no)
);

create index if not exists idx_songs_active on public.songs(is_active);
create index if not exists idx_logs_created_at on public.recommendation_logs(created_at desc);
create index if not exists idx_items_log_id on public.recommendation_items(log_id);

alter table public.songs enable row level security;
alter table public.recommendation_logs enable row level security;
alter table public.recommendation_items enable row level security;

-- demo app assumes public anon read/write. tighten this in production.
drop policy if exists songs_select_all on public.songs;
create policy songs_select_all on public.songs for select to anon using (true);

drop policy if exists logs_insert_all on public.recommendation_logs;
create policy logs_insert_all on public.recommendation_logs for insert to anon with check (true);

drop policy if exists items_insert_all on public.recommendation_items;
create policy items_insert_all on public.recommendation_items for insert to anon with check (true);

insert into public.songs (title, artist, tags)
values
  ('群青', 'YOASOBI', '{jpop,upbeat,focus}'),
  ('Lemon', '米津玄師', '{jpop,healing,nostalgic}'),
  ('Pretender', 'Official髭男dism', '{jpop,nostalgic}'),
  ('怪獣の花唄', 'Vaundy', '{jpop,happy}'),
  ('Lo-fi Study Beats', 'Various Artists', '{focus,relax}')
on conflict do nothing;
