-- Single-admin deployment; no signup trigger and no client-writeable allowlist.
begin;
create schema if not exists toollog_private;
revoke all on schema toollog_private from public, anon, authenticated;

create table toollog_private.control (
  singleton boolean primary key default true check (singleton),
  admin_id uuid unique references auth.users(id) on delete restrict,
  revision bigint not null default 0 check (revision >= 0),
  import_enabled boolean not null default false
);
insert into toollog_private.control(singleton) values (true);

create table public.tools (
  id text primary key check (length(id) between 1 and 128),
  name text not null check (length(btrim(name, E' \n\r\t')) between 1 and 80),
  description text not null check (length(description) <= 500),
  url text not null check (length(url) <= 2048 and (url = '' or
    (url ~* '^https?://[^[:space:]/@?#]+([/?#][^[:space:]]*)?$'))),
  category text not null check (category in ('效率办公','开发工具','设计创作','AI 工具','生活实用','其他','AI 编程','AI 助手','效率工具')),
  status text not null check (status in ('待试用','试用中','常用','已归档','已试用')),
  -- Preserve timestamp spelling in old exports (including omitted fractional
  -- seconds), rather than silently changing imported metadata on read-back.
  updated_at text not null check (isfinite(updated_at::timestamptz))
);
create table public.trials (
  -- Legacy backups only require trial IDs unique within their parent tool.
  tool_id text not null references public.tools(id) on delete restrict,
  id text not null check (length(id) between 1 and 128),
  date date not null check (date between '0001-01-01' and '9999-12-31'),
  environment text not null check (length(environment) <= 100),
  verdict text not null check (verdict in ('值得推荐','继续观察','暂不适合')),
  notes text not null check (length(notes) <= 5000 and length(btrim(notes, E' \n\r\t')) > 0),
  primary key(tool_id,id)
);

-- Enable AND force RLS on every application table, including internal control.
alter table public.tools enable row level security;
alter table public.tools force row level security;
alter table public.trials enable row level security;
alter table public.trials force row level security;
alter table toollog_private.control enable row level security;
alter table toollog_private.control force row level security;
revoke all on public.tools, public.trials, toollog_private.control from public, anon, authenticated;

create function public.toollog_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from toollog_private.control where admin_id = auth.uid()
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);
$$;
revoke all on function public.toollog_is_admin() from public, anon, authenticated;
grant execute on function public.toollog_is_admin() to authenticated;
grant select on public.tools, public.trials to authenticated;
create policy admin_read_tools on public.tools for select to authenticated
  using ((select public.toollog_is_admin()));
create policy admin_read_trials on public.trials for select to authenticated
  using ((select public.toollog_is_admin()));
-- No direct INSERT/UPDATE/DELETE grants or policies. All writes pass through the
-- guarded RPC below, which serializes the entire single-admin library revision.

create function toollog_private.snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version',1,'revision', c.revision,
    'importEnabled', c.import_enabled, 'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,
        'description',t.description,'url',t.url,'category',t.category,
        'status',t.status,'updatedAt',t.updated_at,
        'trials',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,
          'date',r.date::text,'environment',r.environment,'verdict',r.verdict,
          'notes',r.notes) order by r.id) from public.trials r where r.tool_id=t.id),'[]'::jsonb))
        order by t.id) from public.tools t),'[]'::jsonb))
  from toollog_private.control c;
$$;
revoke all on function toollog_private.snapshot() from public, anon, authenticated;

create function public.toollog_load() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.toollog_is_admin() then raise exception 'ADMIN_ONLY' using errcode='42501'; end if;
  -- One MVCC statement keeps rows and revision from the same committed snapshot.
  return toollog_private.snapshot();
end;
$$;
revoke all on function public.toollog_load() from public, anon, authenticated;
grant execute on function public.toollog_load() to authenticated;

create function public.toollog_save(p_tools jsonb, p_revision bigint, p_import boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c toollog_private.control%rowtype;
  t jsonb;
  r jsonb;
  field text;
begin
  if not public.toollog_is_admin() then raise exception 'ADMIN_ONLY' using errcode='42501'; end if;
  select * into c from toollog_private.control for update;
  if c.admin_id is distinct from auth.uid() then raise exception 'ADMIN_ONLY' using errcode='42501'; end if;
  if p_revision is null or p_revision <> c.revision then raise exception 'STALE_REVISION' using errcode='40001'; end if;
  if p_import is null or (p_import and not c.import_enabled) then raise exception 'IMPORT_LOCKED' using errcode='42501'; end if;
  if p_tools is null or jsonb_typeof(p_tools) <> 'array' then raise exception 'INVALID_BACKUP'; end if;
  if jsonb_array_length(p_tools)>1000 or octet_length(p_tools::text)>2000000 then raise exception 'LIBRARY_LIMIT'; end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_tools)) then raise exception 'DUPLICATE_ID'; end if;
  -- This MVP has no delete feature: even an accidental incomplete snapshot must
  -- not silently remove previously persisted tools or notes.
  if exists(select 1 from public.tools old where not exists(
    select 1 from jsonb_array_elements(p_tools) x where x->>'id'=old.id)) then raise exception 'DELETION_NOT_SUPPORTED'; end if;

  for t in select value from jsonb_array_elements(p_tools) loop
    foreach field in array array['id','name','description','url','category','status','updatedAt'] loop
      if jsonb_typeof(t->field) is distinct from 'string' then raise exception 'INVALID_FIELD'; end if;
    end loop;
    if jsonb_typeof(t->'trials') is distinct from 'array' then raise exception 'INVALID_TRIALS'; end if;
    if jsonb_array_length(t->'trials')>1000 or (t->>'updatedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_FIELD'; end if;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(t->'trials')) then raise exception 'DUPLICATE_ID'; end if;
    if exists(select 1 from public.trials old where old.tool_id=t->>'id' and not exists(
      select 1 from jsonb_array_elements(t->'trials') x where x->>'id'=old.id)) then raise exception 'DELETION_NOT_SUPPORTED'; end if;
    insert into public.tools(id,name,description,url,category,status,updated_at)
      values(t->>'id',t->>'name',t->>'description',t->>'url',t->>'category',t->>'status',t->>'updatedAt')
      on conflict(id) do update set name=excluded.name, description=excluded.description,
        url=excluded.url,category=excluded.category,status=excluded.status,updated_at=excluded.updated_at;
    for r in select value from jsonb_array_elements(t->'trials') loop
      foreach field in array array['id','date','environment','verdict','notes'] loop
        if jsonb_typeof(r->field) is distinct from 'string' then raise exception 'INVALID_FIELD'; end if;
      end loop;
      if (r->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_DATE'; end if;
      insert into public.trials(tool_id,id,date,environment,verdict,notes)
        values(t->>'id',r->>'id',(r->>'date')::date,r->>'environment',r->>'verdict',r->>'notes')
        on conflict(tool_id,id) do update set date=excluded.date, environment=excluded.environment,
          verdict=excluded.verdict, notes=excluded.notes;
    end loop;
  end loop;
  update toollog_private.control set revision=revision+1 where singleton;
  return toollog_private.snapshot();
end;
$$;
revoke all on function public.toollog_save(jsonb,bigint,boolean) from public, anon, authenticated;
grant execute on function public.toollog_save(jsonb,bigint,boolean) to authenticated;
comment on table toollog_private.control is 'Only trusted SQL management can bind ONE admin or unlock imports after explicit owner approval. No automatic signup allowlisting.';
commit;
