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
  study_year text,
  registered_role public.team_role,
  registration_completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists study_year text;
alter table public.profiles
  add column if not exists registered_role public.team_role;
alter table public.profiles
  add column if not exists registration_completed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_study_year_check;
alter table public.profiles
  add constraint profiles_study_year_check
  check (
    study_year is null
    or study_year in ('year_1', 'year_2', 'year_3', 'year_4', 'masters', 'phd')
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

create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
as $$
declare
  approved_count integer;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'approved'
     and old.team_id = new.team_id then
    return new;
  end if;

  select count(*)
    into approved_count
  from public.team_memberships
  where team_id = new.team_id
    and status = 'approved';

  if approved_count >= 15 then
    raise exception 'team_member_limit_reached';
  end if;

  return new;
end;
$$;

create or replace function public.transfer_team_parent(
  p_team_id uuid,
  p_current_parent_id uuid,
  p_new_parent_membership_id uuid
)
returns void
language plpgsql
security definer
as $$
declare
  current_parent_membership public.team_memberships%rowtype;
  new_parent_membership public.team_memberships%rowtype;
begin
  select *
    into current_parent_membership
  from public.team_memberships
  where team_id = p_team_id
    and user_id = p_current_parent_id
    and role = 'parent'
    and status = 'approved'
  for update;

  if not found then
    raise exception 'parent_transfer_failed';
  end if;

  select *
    into new_parent_membership
  from public.team_memberships
  where id = p_new_parent_membership_id
    and team_id = p_team_id
    and status = 'approved'
  for update;

  if not found then
    raise exception 'parent_transfer_failed';
  end if;

  if new_parent_membership.role <> 'parent' then
    update public.team_memberships
    set role = 'parent',
        reviewed_by = p_current_parent_id,
        reviewed_at = timezone('utc', now())
    where id = new_parent_membership.id;
  end if;

  update public.teams
  set created_by = new_parent_membership.user_id
  where id = p_team_id;
end;
$$;

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

drop trigger if exists enforce_team_member_limit on public.team_memberships;
create trigger enforce_team_member_limit
before insert or update on public.team_memberships
for each row
execute procedure public.enforce_team_member_limit();

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.teams from anon, authenticated;
revoke all on public.team_memberships from anon, authenticated;

create table if not exists public.ctf_member_solves (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_number smallint not null check (challenge_number between 1 and 6),
  solved_at timestamptz not null default timezone('utc', now()),
  unique (team_id, user_id, challenge_number)
);

create table if not exists public.ctf_team_checkpoints (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  challenge_number smallint not null check (challenge_number between 1 and 6),
  reached_by uuid references public.profiles (id) on delete set null,
  reached_at timestamptz not null default timezone('utc', now()),
  unique (team_id, challenge_number)
);

create table if not exists public.ctf_user_solves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_number smallint not null check (challenge_number between 1 and 6),
  solved_at timestamptz not null default timezone('utc', now()),
  unique (user_id, challenge_number)
);

alter table public.ctf_member_solves
  drop constraint if exists ctf_member_solves_challenge_number_check;
alter table public.ctf_member_solves
  add constraint ctf_member_solves_challenge_number_check
  check (challenge_number between 1 and 6);

alter table public.ctf_team_checkpoints
  drop constraint if exists ctf_team_checkpoints_challenge_number_check;
alter table public.ctf_team_checkpoints
  add constraint ctf_team_checkpoints_challenge_number_check
  check (challenge_number between 1 and 6);

alter table public.ctf_user_solves
  drop constraint if exists ctf_user_solves_challenge_number_check;
alter table public.ctf_user_solves
  add constraint ctf_user_solves_challenge_number_check
  check (challenge_number between 1 and 6);

create index if not exists ctf_member_solves_team_user_idx
  on public.ctf_member_solves (team_id, user_id, challenge_number);
create index if not exists ctf_team_checkpoints_rank_idx
  on public.ctf_team_checkpoints (challenge_number desc, reached_at asc);
create index if not exists ctf_user_solves_user_challenge_idx
  on public.ctf_user_solves (user_id, challenge_number);
create index if not exists ctf_user_solves_rank_idx
  on public.ctf_user_solves (challenge_number desc, solved_at asc);

insert into public.ctf_user_solves (user_id, challenge_number, solved_at)
select distinct on (user_id, challenge_number)
  user_id,
  challenge_number,
  solved_at
from public.ctf_member_solves
order by user_id, challenge_number, solved_at asc
on conflict (user_id, challenge_number) do nothing;

alter table public.ctf_member_solves enable row level security;
alter table public.ctf_team_checkpoints enable row level security;
alter table public.ctf_user_solves enable row level security;

revoke all on public.ctf_member_solves from anon, authenticated;
revoke all on public.ctf_team_checkpoints from anon, authenticated;
revoke all on public.ctf_user_solves from anon, authenticated;
