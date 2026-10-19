begin;

do $migration$
declare
  v_definition text;
  v_old_check constant text := $old$if v_user_id is null or public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can reopen submissions.' using errcode = '42501';
  end if;$old$;
  v_new_check constant text := $new$if v_user_id is null or coalesce(public.current_user_role_canonical(), '') not in ('super_user', 'developer') then
    raise exception 'Only super users and developers can reopen submissions.' using errcode = '42501';
  end if;$new$;
begin
  v_definition := pg_get_functiondef(
    'public.reopen_assessment_submission(text,text,smallint,integer,text,text)'::regprocedure
  );
  if strpos(v_definition, v_old_check) = 0 then
    raise exception 'Could not find the admin-only authorization check in reopen_assessment_submission.';
  end if;

  execute replace(v_definition, v_old_check, v_new_check);
end;
$migration$;

commit;
