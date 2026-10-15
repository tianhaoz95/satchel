-- Satchel portal schema. The portal only knows accounts, node names/subdomains and token HASHES.
-- Nothing from a user's vault ever reaches this database.

create table public.reserved_subdomains (name text primary key);
insert into public.reserved_subdomains(name) values
  ('www'),('api'),('app'),('relay'),('tunnel'),('admin'),('docs'),('status'),('mail'),('portal'),('auth'),('satchel'),('support'),('help'),('blog');

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  subdomain text not null unique check (subdomain ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$'),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- written by the relay (service role) only
  online boolean not null default false,
  last_seen_at timestamptz,
  reported_name text
);
create index nodes_user_idx on public.nodes(user_id);

-- Guard rails: reserved names, per-user limit, and user_id can't be spoofed.
create function public.nodes_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from reserved_subdomains r where r.name = new.subdomain) then
    raise exception 'subdomain is reserved' using errcode = '23505';
  end if;
  if (select count(*) from nodes n where n.user_id = auth.uid() and n.revoked_at is null) >= 5 then
    raise exception 'node limit reached (5)';
  end if;
  new.user_id := auth.uid();
  new.online := false;
  new.last_seen_at := null;
  new.reported_name := null;
  return new;
end $$;
create trigger nodes_before_insert before insert on public.nodes
  for each row when (auth.uid() is not null) execute function public.nodes_before_insert();

alter table public.nodes enable row level security;
create policy "owners read their nodes" on public.nodes for select using (user_id = auth.uid());
create policy "owners create nodes" on public.nodes for insert with check (user_id = auth.uid());
create policy "owners update their nodes" on public.nodes for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Column-level privileges: users may only rename or revoke; status columns belong to the relay.
revoke all on public.nodes from anon, authenticated;
grant select on public.nodes to authenticated;
grant insert (name, subdomain, token_sha256) on public.nodes to authenticated;
grant update (name, revoked_at) on public.nodes to authenticated;
revoke all on public.reserved_subdomains from anon, authenticated;

create function public.rotate_node_token(node_id uuid, new_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad hash'; end if;
  update nodes set token_sha256 = new_hash
   where id = node_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'node not found'; end if;
end $$;
revoke all on function public.rotate_node_token(uuid, text) from public, anon;
grant execute on function public.rotate_node_token(uuid, text) to authenticated;

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Live online status in the portal.
alter publication supabase_realtime add table public.nodes;
