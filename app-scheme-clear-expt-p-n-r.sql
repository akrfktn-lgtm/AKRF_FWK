-- DESTRUCTIVE RESET: back up the database before running this script.
-- Clears all assessment data, including sections, while preserving public.ranches and public.profiles.
-- Tables, views, functions, Auth users, ranch records, and profile records are preserved.
-- If a table outside public references a table being cleared, the transaction is aborted.

begin;

do $$
declare
  remaining_tables oid[];
  table_to_clear oid;
  table_schema text;
  table_name text;
begin
  select array_agg(table_row.oid order by table_row.relname)
  into remaining_tables
  from pg_class table_row
  join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relkind in ('r', 'p')
    and table_row.relname not in ('ranches', 'profiles');

  if remaining_tables is null then
    raise exception 'No public tables found to clear.';
  end if;

  while cardinality(remaining_tables) > 0 loop
    select candidate.table_oid
    into table_to_clear
    from unnest(remaining_tables) as candidate(table_oid)
    where not exists (
      select 1
      from pg_constraint foreign_key
      where foreign_key.contype = 'f'
        and foreign_key.confrelid = candidate.table_oid
        and foreign_key.conrelid = any(remaining_tables)
        and foreign_key.conrelid <> foreign_key.confrelid
    )
    order by candidate.table_oid::regclass::text
    limit 1;

    if table_to_clear is null then
      raise exception 'Cyclic foreign-key dependency found among public tables; reset was aborted.';
    end if;

    select schema_row.nspname, table_row.relname
    into table_schema, table_name
    from pg_class table_row
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where table_row.oid = table_to_clear;

    execute format('delete from %I.%I', table_schema, table_name);
    remaining_tables := array_remove(remaining_tables, table_to_clear);
  end loop;
end;
$$;

commit;
