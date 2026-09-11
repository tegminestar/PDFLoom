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

-- v2: multi-field placement, signing order, decline reasons, and reusable
-- templates. All additive — an already-issued signer link with only the
-- legacy page_number/rect_* columns set (no signature_request_fields rows)
-- keeps working unchanged; the API synthesizes one 'signature' field from
-- those columns when a signer has none in the new table.
alter table public.signature_request_signers alter column page_number drop not null;
alter table public.signature_request_signers alter column rect_x drop not null;
alter table public.signature_request_signers alter column rect_y drop not null;
alter table public.signature_request_signers alter column rect_width drop not null;
alter table public.signature_request_signers alter column rect_height drop not null;

-- A signer's own captured initials image, separate from signature_data_url
-- — one asset per type per signer, stamped into every field of that type
-- they own (e.g. initials on every page + one full signature), rather than
-- a separate image per field.
alter table public.signature_request_signers add column if not exists initials_data_url text;

-- Signing order for sequential mode (signature_requests.signing_mode
-- below); 0-based, ignored entirely in parallel mode (today's behavior).
alter table public.signature_request_signers add column if not exists order_index int not null default 0;

-- Decline flow: status already allowed 'declined' but nothing ever set it
-- or recorded why.
alter table public.signature_request_signers add column if not exists decline_reason text;
alter table public.signature_request_signers add column if not exists declined_at timestamptz;

-- One row per placed field (signature / initials / date) per signer, per
-- page — replaces the one-rect-per-signer model above. Same no-RLS-policy
-- shape as the tables above: only apps/api's service-role key ever touches
-- this table.
create table if not exists public.signature_request_fields (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.signature_requests(id) on delete cascade,
  signer_id uuid not null references public.signature_request_signers(id) on delete cascade,
  field_type text not null default 'signature' check (field_type in ('signature', 'initials', 'date')),
  page_number int not null,
  rect_x double precision not null,
  rect_y double precision not null,
  rect_width double precision not null,
  rect_height double precision not null,
  created_at timestamptz not null default now()
);
alter table public.signature_request_fields enable row level security;

create index if not exists signature_request_fields_signer_id_idx
  on public.signature_request_fields (signer_id);
create index if not exists signature_request_fields_request_id_idx
  on public.signature_request_fields (request_id);

-- Reusable e-sign templates: a template stores role LABELS ("Landlord",
-- "Tenant 1") and field layout, never real emails — sending from a
-- template asks for fresh emails per role every time. Same
-- signature-requests storage bucket, under templates/<id>/document.pdf —
-- no new bucket or infra.
create table if not exists public.signature_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  original_filename text not null,
  storage_path text not null,
  signing_mode text not null default 'parallel' check (signing_mode in ('parallel', 'sequential')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.signature_templates enable row level security;
create index if not exists signature_templates_owner_id_idx on public.signature_templates (owner_id);

-- A role is a placeholder signer ("Landlord", "Tenant 1"), never a real
-- email. order_index only matters when the template's signing_mode is
-- 'sequential'.
create table if not exists public.signature_template_roles (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.signature_templates(id) on delete cascade,
  role_label text not null,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.signature_template_roles enable row level security;
create index if not exists signature_template_roles_template_id_idx
  on public.signature_template_roles (template_id);

create table if not exists public.signature_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.signature_templates(id) on delete cascade,
  role_id uuid not null references public.signature_template_roles(id) on delete cascade,
  field_type text not null default 'signature' check (field_type in ('signature', 'initials', 'date')),
  page_number int not null,
  rect_x double precision not null,
  rect_y double precision not null,
  rect_width double precision not null,
  rect_height double precision not null,
  created_at timestamptz not null default now()
);
alter table public.signature_template_fields enable row level security;
create index if not exists signature_template_fields_role_id_idx
  on public.signature_template_fields (role_id);

-- signature_requests v2 columns. signing_mode mirrors the template's own
-- field of the same name; void_reason/voided_at mirror decline_reason/
-- declined_at above (the 'voided' status already existed with nothing
-- that ever set it); completed_pdf_hash is a SHA-256 of the final baked
-- document, surfaced on the completion certificate and the owner status
-- page as a tamper-evidence aid (same honesty framing as
-- placeSignedTimestamp's existing integrityHashHex, extended to the
-- multi-party completion certificate). template_id is nullable and
-- ON DELETE SET NULL — deleting a template must never affect requests
-- already sent from it.
alter table public.signature_requests add column if not exists signing_mode text not null default 'parallel';
alter table public.signature_requests drop constraint if exists signature_requests_signing_mode_check;
alter table public.signature_requests add constraint signature_requests_signing_mode_check
  check (signing_mode in ('parallel', 'sequential'));
alter table public.signature_requests add column if not exists void_reason text;
alter table public.signature_requests add column if not exists voided_at timestamptz;
alter table public.signature_requests add column if not exists completed_pdf_hash text;
alter table public.signature_requests add column if not exists template_id uuid
  references public.signature_templates(id) on delete set null;

-- v3: the name a signer sees identifying who sent them the document (e.g.
-- "Jane Doe via PDFLoom") -- shown in the automated notification email
-- (see apps/api/src/routes/signatureRequests.ts's Resend integration) and
-- on the completion certificate. Nullable: falls back to the owner's
-- account email when not provided.
alter table public.signature_requests add column if not exists sender_name text;

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

-- Mirrors what submitFeedback (apps/api/src/routes/feedback.ts) already
-- emails via FormSubmit — this is purely an additional copy so the owner
-- dashboard has something to show, not a replacement for the email, which
-- keeps working exactly as before. Same no-RLS-policy shape as the tables
-- above: only apps/api's service-role key ever touches it.
create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  category text,
  message text not null,
  reply_to text,
  page text,
  created_at timestamptz not null default now()
);
alter table public.feedback_submissions enable row level security;

create index if not exists feedback_submissions_created_at_idx
  on public.feedback_submissions (created_at);

-- Lets the owner (ANALYTICS_OWNER_EMAIL) grant other accounts read-only
-- access to /analytics without sharing the owner's own credentials. Role
-- changes, Pro overrides, and account deletion from the dashboard all stay
-- restricted to ANALYTICS_OWNER_EMAIL itself (apps/api/src/routes/analytics.ts's
-- checkOwnerAuth) even for an 'admin' account, so promoting someone to
-- 'admin' can only ever grant visibility, never the ability to grant more
-- access, override billing, or delete accounts.
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));
