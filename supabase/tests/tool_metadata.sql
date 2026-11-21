-- Local PostgreSQL ONLY. Requires bootstrap, base migration, and the metadata
-- migration draft in that order. Entire test transaction rolls back.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
update toollog_private.control set admin_id='11111111-1111-4111-8111-111111111111' where singleton;

create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end;
$$;
create function pg_temp.denied(statement text, expected text default null) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute statement; exception when others then
    failed := true;
    if expected is not null and position(expected in sqlerrm)=0 then raise exception 'Wrong error: %', sqlerrm; end if;
  end;
  if not failed then raise exception 'Invalid statement succeeded: %', statement; end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select public.toollog_save($json$[
  {"id":"tool-meta","name":"Metadata test","description":"","url":"https://example.com",
   "category":"效率办公","status":"试用中","updatedAt":"2026-11-21T00:00:00Z",
   "freeQuota":"每月 100 次","cardRequired":false,"cost":"$12 / 月",
   "expiresOn":"2026-12-31","rating":4,
   "trials":[{"id":"trial-meta","date":"2026-11-21","environment":"local","verdict":"继续观察","notes":"synthetic"}]}
]$json$,0);
select pg_temp.assert((public.toollog_load()->'tools'->0->>'freeQuota')='每月 100 次','free quota round-trips');
select pg_temp.assert((public.toollog_load()->'tools'->0->>'cardRequired')='false','false card requirement is not confused with unknown');
select pg_temp.assert((public.toollog_load()->'tools'->0->>'cost')='$12 / 月','cost round-trips');
select pg_temp.assert((public.toollog_load()->'tools'->0->>'expiresOn')='2026-12-31','expiration date round-trips as ISO date');
select pg_temp.assert((public.toollog_load()->'tools'->0->>'rating')='4','rating round-trips');

-- A pre-migration client omits all new keys; editing old fields must not erase metadata.
select public.toollog_save($json$[
  {"id":"tool-meta","name":"Metadata test","description":"edited by old client","url":"https://example.com",
   "category":"效率办公","status":"试用中","updatedAt":"2026-11-21T00:01:00Z",
   "trials":[{"id":"trial-meta","date":"2026-11-21","environment":"local","verdict":"继续观察","notes":"synthetic"}]}
]$json$,1);
select pg_temp.assert((select free_quota='每月 100 次' and card_required is false
  and cost='$12 / 月' and expires_on='2026-12-31'::date and rating=4
  from public.tools where id='tool-meta'),'legacy save preserves all omitted metadata');
select pg_temp.assert((select description='edited by old client' from public.tools where id='tool-meta'),'legacy client still edits existing fields');

-- A new client sends explicit null to clear values, distinct from a missing key.
select public.toollog_save($json$[
  {"id":"tool-meta","name":"Metadata test","description":"edited by old client","url":"https://example.com",
   "category":"效率办公","status":"试用中","updatedAt":"2026-11-21T00:02:00Z",
   "freeQuota":null,"cardRequired":null,"cost":null,"expiresOn":null,"rating":null,
   "trials":[{"id":"trial-meta","date":"2026-11-21","environment":"local","verdict":"继续观察","notes":"synthetic"}]}
]$json$,2);
select pg_temp.assert((select free_quota is null from public.tools where id='tool-meta'),'explicit JSON null clears free quota');
select pg_temp.assert((select card_required is null from public.tools where id='tool-meta'),'explicit JSON null clears card requirement');
select pg_temp.assert((select cost is null from public.tools where id='tool-meta'),'explicit JSON null clears cost');
select pg_temp.assert((select expires_on is null from public.tools where id='tool-meta'),'explicit JSON null clears expiration date');
select pg_temp.assert((select rating is null from public.tools where id='tool-meta'),'explicit JSON null clears rating');
select pg_temp.assert((public.toollog_load()->>'revision')::int=3,'successful metadata saves increment revision');

select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,rating}','0'::jsonb),3)$sql$,'INVALID_FIELD');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,rating}','4.5'::jsonb),3)$sql$,'INVALID_FIELD');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,cardRequired}','"yes"'::jsonb),3)$sql$,'INVALID_FIELD');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,expiresOn}','"2026-02-30"'::jsonb),3)$sql$,'INVALID_DATE');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,freeQuota}',to_jsonb(repeat('x',201))),3)$sql$,'INVALID_FIELD');
select pg_temp.assert((public.toollog_load()->>'revision')::int=3,'invalid metadata leaves revision unchanged');
select pg_temp.assert((select count(*)=1 from public.tools where id='tool-meta'),'invalid metadata does not partially alter tools');

reset role;
rollback;
\echo 'PASS: metadata validation, round-trip, legacy save preservation, explicit clearing and rollback'
