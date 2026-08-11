-- OoFR cloud snapshot storage.
-- Run this in Supabase SQL Editor before enabling sync.

create table if not exists public.oofr_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.oofr_user_data enable row level security;

drop policy if exists "Users can read their OoFR data" on public.oofr_user_data;
create policy "Users can read their OoFR data"
  on public.oofr_user_data for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their OoFR data" on public.oofr_user_data;
create policy "Users can insert their OoFR data"
  on public.oofr_user_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their OoFR data" on public.oofr_user_data;
create policy "Users can update their OoFR data"
  on public.oofr_user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
