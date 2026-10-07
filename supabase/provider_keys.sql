-- NEXUS Phase 14: user-supplied provider API keys (BYOK)
-- Run ONCE in Supabase Dashboard → SQL Editor.

create table if not exists public.provider_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'gemini')),
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- Row Level Security: each user may only ever touch their own rows. This is
-- enforced by Postgres itself via the user JWT the server forwards on every
-- request — the anon key alone grants access to nothing here.
alter table public.provider_keys enable row level security;

create policy "users manage own provider keys"
  on public.provider_keys
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
