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
  add column if not exists child_focus text;

alter table public.profiles
  drop constraint if exists profiles_study_year_check;
alter table public.profiles
  add constraint profiles_study_year_check
  check (
    study_year is null
    or study_year in ('year_1', 'year_2', 'year_3', 'year_4', 'masters', 'phd')
  );

alter table public.profiles
  drop constraint if exists profiles_child_focus_check;
alter table public.profiles
  add constraint profiles_child_focus_check
  check (
    child_focus is null
    or child_focus in ('hunter', 'hacker')
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

create table if not exists public.child_pool_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  focus text not null check (focus in ('hunter', 'hacker')),
  status text not null default 'open' check (status in ('open', 'matched', 'withdrawn')),
  team_id uuid references public.teams (id) on delete set null,
  matched_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.parent_registration_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  child_user_id uuid not null references public.profiles (id) on delete cascade,
  child_name text not null,
  parent_email text not null,
  child_focus text not null check (child_focus in ('hunter', 'hacker')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'cancelled')),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_team_id uuid references public.teams (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
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

drop trigger if exists set_child_pool_entries_updated_at on public.child_pool_entries;
create trigger set_child_pool_entries_updated_at
before update on public.child_pool_entries
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_parent_registration_invites_updated_at on public.parent_registration_invites;
create trigger set_parent_registration_invites_updated_at
before update on public.parent_registration_invites
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
alter table public.child_pool_entries enable row level security;
alter table public.parent_registration_invites enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.teams from anon, authenticated;
revoke all on public.team_memberships from anon, authenticated;
revoke all on public.child_pool_entries from anon, authenticated;
revoke all on public.parent_registration_invites from anon, authenticated;

create index if not exists child_pool_entries_status_idx on public.child_pool_entries (status, focus, created_at);
create index if not exists parent_registration_invites_status_idx on public.parent_registration_invites (status, parent_email, created_at);

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

create table if not exists public.ctf_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_number smallint not null check (challenge_number between 1 and 6),
  created_at timestamptz not null default timezone('utc', now())
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

alter table public.ctf_submission_attempts
  drop constraint if exists ctf_submission_attempts_challenge_number_check;
alter table public.ctf_submission_attempts
  add constraint ctf_submission_attempts_challenge_number_check
  check (challenge_number between 1 and 6);

create index if not exists ctf_member_solves_team_user_idx
  on public.ctf_member_solves (team_id, user_id, challenge_number);
create index if not exists ctf_team_checkpoints_rank_idx
  on public.ctf_team_checkpoints (challenge_number desc, reached_at asc);
create index if not exists ctf_user_solves_user_challenge_idx
  on public.ctf_user_solves (user_id, challenge_number);
create index if not exists ctf_user_solves_rank_idx
  on public.ctf_user_solves (challenge_number desc, solved_at asc);
create index if not exists ctf_submission_attempts_user_challenge_created_idx
  on public.ctf_submission_attempts (user_id, challenge_number, created_at desc);

create or replace function public.record_ctf_submission_attempt(
  p_user_id uuid,
  p_challenge_number smallint,
  p_window_seconds integer default 60,
  p_max_attempts integer default 5
)
returns void
language plpgsql
security definer
as $$
declare
  attempt_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'ctf_submission_attempt_user_required';
  end if;

  if p_challenge_number is null or p_challenge_number < 1 or p_challenge_number > 6 then
    raise exception 'ctf_submission_attempt_challenge_invalid';
  end if;

  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'ctf_submission_attempt_window_invalid';
  end if;

  if p_max_attempts is null or p_max_attempts <= 0 then
    raise exception 'ctf_submission_attempt_max_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext(format('ctf_submission_attempt:%s:%s', p_user_id, p_challenge_number)));

  select count(*)
    into attempt_count
  from public.ctf_submission_attempts
  where user_id = p_user_id
    and challenge_number = p_challenge_number
    and created_at >= timezone('utc', now()) - make_interval(secs => p_window_seconds);

  if attempt_count >= p_max_attempts then
    raise exception 'ctf_submission_rate_limited';
  end if;

  insert into public.ctf_submission_attempts (user_id, challenge_number)
  values (p_user_id, p_challenge_number);
end;
$$;

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
alter table public.ctf_submission_attempts enable row level security;

revoke all on public.ctf_member_solves from anon, authenticated;
revoke all on public.ctf_team_checkpoints from anon, authenticated;
revoke all on public.ctf_user_solves from anon, authenticated;
revoke all on public.ctf_submission_attempts from anon, authenticated;
revoke all on function public.record_ctf_submission_attempt(uuid, smallint, integer, integer) from public, anon, authenticated;
grant execute on function public.record_ctf_submission_attempt(uuid, smallint, integer, integer) to service_role;

create table if not exists public.secret_keyring_claims (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'R2FzdGVy==',
  agreed_to_terms boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists secret_keyring_claims_email_idx
  on public.secret_keyring_claims (lower(email));

create index if not exists secret_keyring_claims_created_at_idx
  on public.secret_keyring_claims (created_at asc);

create or replace function public.claim_secret_keyring(
  p_email text,
  p_source text default 'R2FzdGVy=='
)
returns table (
  claim_id uuid,
  email text,
  source text,
  total integer,
  claimed integer,
  remaining integer
)
language plpgsql
security definer
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_source text := trim(coalesce(p_source, ''));
  inventory_total integer := 20;
  current_claimed integer := 0;
  inserted_claim public.secret_keyring_claims%rowtype;
begin
  if normalized_email = '' then
    raise exception 'secret_keyring_email_required';
  end if;

  if normalized_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$' then
    raise exception 'secret_keyring_email_invalid';
  end if;

  if normalized_source = '' then
    normalized_source := 'R2FzdGVy==';
  end if;

  perform pg_advisory_xact_lock(20260310);

  if exists (
    select 1
    from public.secret_keyring_claims
    where lower(public.secret_keyring_claims.email) = normalized_email
  ) then
    raise exception 'secret_keyring_already_claimed';
  end if;

  select count(*)
    into current_claimed
  from public.secret_keyring_claims;

  if current_claimed >= inventory_total then
    raise exception 'secret_keyring_sold_out';
  end if;

  insert into public.secret_keyring_claims (email, source, agreed_to_terms)
  values (normalized_email, normalized_source, true)
  returning *
    into inserted_claim;

  current_claimed := current_claimed + 1;

  return query
  select
    inserted_claim.id,
    inserted_claim.email,
    inserted_claim.source,
    inventory_total,
    current_claimed,
    greatest(inventory_total - current_claimed, 0);
end;
$$;

alter table public.secret_keyring_claims enable row level security;

revoke all on public.secret_keyring_claims from anon, authenticated;
revoke all on function public.claim_secret_keyring(text, text) from public, anon, authenticated;
grant execute on function public.claim_secret_keyring(text, text) to service_role;
