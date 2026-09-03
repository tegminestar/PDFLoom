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

-- Multi-party signing: a signed-in user (the "owner") uploads a document and
-- lists one or more signers by email; each signer gets an unguessable link
-- (access_token) requiring no account of their own. This is the one feature
-- in the product where a document is intentionally stored server-side —
-- everywhere else stays 100% client-side. See SECURITY.md / the landing
-- page FAQ for the disclosure copy this is paired with.
--
-- No RLS policies are defined on either table below — deliberately. Owners
-- and signers both go through apps/api (using the service-role key, which
-- bypasses RLS) rather than querying these tables directly from the
-- browser, since signers don't have a Supabase Auth session to key a policy
-- off of. Leaving RLS enabled with zero policies means the anon/authenticated
-- keys can't read or write these tables at all — only the service-role key
-- (never shipped to the browser) can.
create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'voided')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.signature_requests enable row level security;

create table if not exists public.signature_request_signers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.signature_requests(id) on delete cascade,
  email text not null,
  name text,
  access_token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'signed', 'declined')),
  -- Where this signer's signature gets placed, in PDF points (bottom-left
  -- origin) — set by the owner when creating the request, the same
  -- coordinate convention EditOverlay/SignaturePlaceOverlay already use.
  page_number int not null,
  rect_x double precision not null,
  rect_y double precision not null,
  rect_width double precision not null,
  rect_height double precision not null,
  signature_data_url text,
  signed_at timestamptz,
  signed_ip text,
  created_at timestamptz not null default now()
);
alter table public.signature_request_signers enable row level security;

create index if not exists signature_request_signers_request_id_idx
  on public.signature_request_signers (request_id);

-- Self-hosted analytics — replaces the paid Plausible Cloud script. Every
-- row is one beacon from trackEvent() (apps/web/src/app/analytics.ts),
-- enriched server-side (apps/api/src/routes/analytics.ts) from the
-- request's User-Agent and IP — the client never sends device/geo data
-- itself. Only the /api/analytics/summary route (gated to one owner email
-- via ANALYTICS_OWNER_EMAIL, checked against a verified Supabase session)
-- reads this table, and only apps/api's service-role key ever touches it —
-- same no-RLS-policy shape as signature_requests above, for the same reason.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  path text,
  referrer text,
  device text,
  browser text,
  os text,
  country text,
  city text,
  created_at timestamptz not null default now()
);
alter table public.analytics_events enable row level security;

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at);
create index if not exists analytics_events_event_name_idx
  on public.analytics_events (event_name);
