create extension if not exists pgcrypto;

do $$
begin
  create type public.team_role as enum ('parent', 'child');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.membership_status as enum ('pending', 'approved', 'declined');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.team_role not null,
  status public.membership_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

create index if not exists team_memberships_team_id_idx on public.team_memberships (team_id);
create index if not exists team_memberships_status_idx on public.team_memberships (status);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at
before update on public.teams
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_team_memberships_updated_at on public.team_memberships;
create trigger set_team_memberships_updated_at
before update on public.team_memberships
for each row
execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.teams from anon, authenticated;
revoke all on public.team_memberships from anon, authenticated;
