create table public.finance_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
create table public.finance_transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 entry_date date not null,
 kind text not null check (kind in ('income','expense')),
 category text not null,
 description text not null default '',
 amount numeric(14,2) not null check(amount>0),
 created_at timestamptz not null default now()
);
create index finance_transactions_user_date on public.finance_transactions(user_id,entry_date);
alter table public.finance_state enable row level security;
alter table public.finance_transactions enable row level security;
revoke all on public.finance_state, public.finance_transactions from anon, authenticated;
grant select, insert, update, delete on public.finance_state, public.finance_transactions to authenticated;
create policy finance_state_owner on public.finance_state for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy finance_transactions_owner on public.finance_transactions for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create function public.save_finance_state(p_payload jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.finance_state;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid state'; end if;
 if p_expected_revision=0 then
  insert into public.finance_state(user_id,payload) values(auth.uid(),p_payload) returning * into r;
 else
  update public.finance_state set payload=p_payload, revision=revision+1, updated_at=now()
  where user_id=auth.uid() and revision=p_expected_revision returning * into r;
  if not found then raise exception 'Data changed on another device. Reload before editing.'; end if;
 end if;
 return jsonb_build_object('revision',r.revision,'updatedAt',r.updated_at);
end $$;
revoke all on function public.save_finance_state(jsonb,bigint) from public, anon;
grant execute on function public.save_finance_state(jsonb,bigint) to authenticated;
