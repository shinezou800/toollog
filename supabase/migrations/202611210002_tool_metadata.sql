-- DRAFT ONLY: review with the owner before applying to any Supabase project.
-- This migration has not been run against the hosted Toollog project.
-- It only adds nullable metadata columns and replaces the existing snapshot/save
-- RPCs. Missing keys from old clients preserve existing metadata on updates;
-- explicit JSON null clears a value.
begin;

alter table public.tools
  add column free_quota text check (free_quota is null or length(free_quota) <= 200),
  add column card_required boolean,
  add column cost text check (cost is null or length(cost) <= 200),
  add column expires_on date check (
    expires_on is null or expires_on between '0001-01-01'::date and '9999-12-31'::date
  ),
  add column rating smallint check (rating is null or rating between 1 and 5);

create or replace function toollog_private.snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version',1,'revision', c.revision,
    'importEnabled', c.import_enabled, 'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,
        'description',t.description,'url',t.url,'category',t.category,
        'status',t.status,'updatedAt',t.updated_at,
        'freeQuota',t.free_quota,'cardRequired',t.card_required,
        'cost',t.cost,'expiresOn',t.expires_on::text,'rating',t.rating,
        'trials',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,
          'date',r.date::text,'environment',r.environment,'verdict',r.verdict,
          'notes',r.notes) order by r.id) from public.trials r where r.tool_id=t.id),'[]'::jsonb))
        order by t.id) from public.tools t),'[]'::jsonb))
  from toollog_private.control c;
$$;
revoke all on function toollog_private.snapshot() from public, anon, authenticated;

create or replace function public.toollog_save(p_tools jsonb, p_revision bigint, p_import boolean default false) returns jsonb
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

    if t ? 'freeQuota' and jsonb_typeof(t->'freeQuota') is distinct from 'string'
      and jsonb_typeof(t->'freeQuota') is distinct from 'null' then raise exception 'INVALID_FIELD'; end if;
    if jsonb_typeof(t->'freeQuota')='string' and length(t->>'freeQuota')>200 then raise exception 'INVALID_FIELD'; end if;
    if t ? 'cardRequired' and jsonb_typeof(t->'cardRequired') is distinct from 'boolean'
      and jsonb_typeof(t->'cardRequired') is distinct from 'null' then raise exception 'INVALID_FIELD'; end if;
    if t ? 'cost' and jsonb_typeof(t->'cost') is distinct from 'string'
      and jsonb_typeof(t->'cost') is distinct from 'null' then raise exception 'INVALID_FIELD'; end if;
    if jsonb_typeof(t->'cost')='string' and length(t->>'cost')>200 then raise exception 'INVALID_FIELD'; end if;
    if t ? 'expiresOn' and jsonb_typeof(t->'expiresOn') is distinct from 'string'
      and jsonb_typeof(t->'expiresOn') is distinct from 'null' then raise exception 'INVALID_DATE'; end if;
    if jsonb_typeof(t->'expiresOn')='string' then
      if (t->>'expiresOn') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_DATE'; end if;
      begin
        perform (t->>'expiresOn')::date;
      exception when others then
        raise exception 'INVALID_DATE';
      end;
    end if;
    if t ? 'rating' and jsonb_typeof(t->'rating') is distinct from 'number'
      and jsonb_typeof(t->'rating') is distinct from 'null' then raise exception 'INVALID_FIELD'; end if;
    if jsonb_typeof(t->'rating')='number' and (
      (t->>'rating')::numeric <> trunc((t->>'rating')::numeric) or
      (t->>'rating')::numeric < 1 or (t->>'rating')::numeric > 5
    ) then raise exception 'INVALID_FIELD'; end if;

    insert into public.tools as existing(
      id,name,description,url,category,status,updated_at,
      free_quota,card_required,cost,expires_on,rating
    ) values(
      t->>'id',t->>'name',t->>'description',t->>'url',t->>'category',t->>'status',t->>'updatedAt',
      case when jsonb_typeof(t->'freeQuota')='string' then t->>'freeQuota' else null end,
      case when jsonb_typeof(t->'cardRequired')='boolean' then (t->>'cardRequired')::boolean else null end,
      case when jsonb_typeof(t->'cost')='string' then t->>'cost' else null end,
      case when jsonb_typeof(t->'expiresOn')='string' then (t->>'expiresOn')::date else null end,
      case when jsonb_typeof(t->'rating')='number' then (t->>'rating')::smallint else null end
    ) on conflict(id) do update set
      name=excluded.name, description=excluded.description,
      url=excluded.url,category=excluded.category,status=excluded.status,updated_at=excluded.updated_at,
      free_quota=case when t ? 'freeQuota' then excluded.free_quota else existing.free_quota end,
      card_required=case when t ? 'cardRequired' then excluded.card_required else existing.card_required end,
      cost=case when t ? 'cost' then excluded.cost else existing.cost end,
      expires_on=case when t ? 'expiresOn' then excluded.expires_on else existing.expires_on end,
      rating=case when t ? 'rating' then excluded.rating else existing.rating end;

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

comment on column public.tools.free_quota is 'Optional user-maintained free usage allowance; not independently verified.';
comment on column public.tools.card_required is 'Optional user-maintained indication whether a payment card is required.';
comment on column public.tools.cost is 'Optional user-maintained cost note; not independently verified.';
comment on column public.tools.expires_on is 'Optional user-maintained expiration date.';
comment on column public.tools.rating is 'Optional personal rating from 1 to 5.';

commit;
