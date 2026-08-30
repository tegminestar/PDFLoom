-- Run once in the Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
-- Creates the entitlement table the API functions read/write, and wires it
-- to auto-create a row whenever a new user signs up.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_pro boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A signed-in user can read their own row (to show/hide the Pro badge) but
-- can never write is_pro themselves — only the service-role key (used
-- exclusively by the Azure Function webhook handler, never shipped to the
-- browser) can write, since only Stripe's webhook is a trustworthy source
-- of "did this subscription actually get paid for."
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Auto-create a profiles row (is_pro defaults to false) the moment someone
-- signs up, so createCheckoutSession/the client never has to handle a
-- missing row as a special case.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
