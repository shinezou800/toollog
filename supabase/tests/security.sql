-- Real PostgreSQL permission/transaction tests. Entire suite rolls back.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
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
  if not failed then raise exception 'Unauthorized statement succeeded: %', statement; end if;
end;
$$;

select pg_temp.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.tools'::regclass,'public.trials'::regclass,'toollog_private.control'::regclass)), 'all application tables force RLS');

set local role anon;
select pg_temp.denied('select * from public.tools');
select pg_temp.denied('select * from public.trials');
select pg_temp.denied('insert into public.tools(id) values (''x'')');
select pg_temp.denied('update public.tools set name=''x''');
select pg_temp.denied('delete from public.tools');
select pg_temp.denied('insert into public.trials(id) values (''x'')');
select pg_temp.denied('update public.trials set notes=''x''');
select pg_temp.denied('delete from public.trials');
select pg_temp.denied('select public.toollog_load()');
select pg_temp.denied('select public.toollog_save(''[]'',0)');
select pg_temp.denied('select * from toollog_private.control');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.assert(not public.toollog_is_admin(),'a signed-in second user is not admin');
select pg_temp.assert((select count(*)=0 from public.tools),'second user cannot read tools');
select pg_temp.assert((select count(*)=0 from public.trials),'second user cannot read trials');
select pg_temp.denied('select public.toollog_load()','ADMIN_ONLY');
select pg_temp.denied('select public.toollog_save(''[]'',0)','ADMIN_ONLY');
select pg_temp.denied('update toollog_private.control set admin_id=auth.uid()');
select pg_temp.denied('insert into public.tools(id) values (''x'')');
select pg_temp.denied('update public.tools set name=''x''');
select pg_temp.denied('delete from public.tools');
select pg_temp.denied('insert into public.trials(id) values (''x'')');
select pg_temp.denied('update public.trials set notes=''x''');
select pg_temp.denied('delete from public.trials');

set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.assert(public.toollog_is_admin(),'exact bound user is admin');
select pg_temp.denied('update public.tools set name=''direct write''');
select pg_temp.denied('select public.toollog_save(''[]'',0,true)','IMPORT_LOCKED');
select pg_temp.assert((public.toollog_load()->>'revision')::int=0,'initial revision');

select public.toollog_save($json$[{"id":"tool-1","name":"合成工具","description":"","url":"https://example.com","category":"效率办公","status":"待试用","updatedAt":"2026-11-21T00:00:00.000Z","trials":[{"id":"trial-1","date":"2026-11-21","environment":"  Safari  ","verdict":"继续观察","notes":"\n  第一行 🧪\n第二行  \n"}]}]$json$,0);
select pg_temp.assert((public.toollog_load()->>'revision')::int=1,'save increments revision');
select pg_temp.assert((select notes=E'\n  第一行 🧪\n第二行  \n' from public.trials where id='trial-1'),'original whitespace and Unicode survive');
select pg_temp.denied('select public.toollog_save(''[]'',0)','STALE_REVISION');
select pg_temp.denied('select public.toollog_save(''[]'',1)','DELETION_NOT_SUPPORTED');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,trials,0,date}','"2026-02-30"'),1)$sql$);
select pg_temp.assert((public.toollog_load()->>'revision')::int=1,'failed transaction never increments revision');
select pg_temp.assert((select date='2026-11-21' from public.trials where id='trial-1'),'invalid date did not partially save');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,url}','"https://user:password@example.com"'),1)$sql$);
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,trials}','[]'),1)$sql$,'DELETION_NOT_SUPPORTED');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,trials,0,notes}','"  \n  "'),1)$sql$);
select pg_temp.assert((public.toollog_load()->>'revision')::int=1,'every rejected save leaves library unchanged');

set local request.jwt.claims='{"is_anonymous":true}';
select pg_temp.assert(not public.toollog_is_admin(),'anonymous Auth sessions cannot operate even with matching UID');
set local request.jwt.claims='{}';
reset role;
update toollog_private.control set import_enabled=true where singleton;
set local role authenticated;
select pg_temp.assert((public.toollog_save(public.toollog_load()->'tools',1,true)->>'revision')::int=2,'explicitly unlocked import works');
select pg_temp.assert((public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,updatedAt}','"2026-11-18T08:00:00Z"'),2)->'tools'->0->>'updatedAt')='2026-11-18T08:00:00Z','legacy example timestamps without milliseconds save and round-trip exactly');

select pg_temp.assert(jsonb_array_length(public.toollog_save(
  (public.toollog_load()->'tools') || (
    select jsonb_agg(jsonb_build_object(
      'id','category-' || n,'name','合成分类工具 ' || n,'description','','url','',
      'category',category,'status',status,'updatedAt','2026-11-21T00:00:00Z','trials','[]'::jsonb
    )) from (values (1,'AI 编程','试用中'),(2,'AI 助手','已试用'),(3,'效率工具','试用中')) as options(n,category,status)
  ),3
)->'tools')=4,'new categories and tried status save without dropping existing tools');
select pg_temp.assert((select category='AI 助手' and status='已试用' from public.tools where id='category-2'),'new option text round-trips exactly');
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,category}','"invalid"'),4)$sql$);
select pg_temp.denied($sql$select public.toollog_save(jsonb_set(public.toollog_load()->'tools','{0,status}','"invalid"'),4)$sql$);
select pg_temp.assert((public.toollog_load()->>'revision')::int=4,'unknown options still reject atomically');

set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.assert((select count(*)=0 from public.tools),'second user still cannot read populated tools');
select pg_temp.assert((select count(*)=0 from public.trials),'second user still cannot read populated notes');
select pg_temp.denied('select public.toollog_load()','ADMIN_ONLY');
set local request.jwt.claim.sub='';
select pg_temp.denied('select public.toollog_load()','ADMIN_ONLY');
reset role;
rollback;
\echo 'PASS: RLS, anonymous/second-user denial, admin, CAS, validation, rollback and migration gate'
