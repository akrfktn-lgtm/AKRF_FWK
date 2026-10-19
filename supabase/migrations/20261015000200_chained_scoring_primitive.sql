begin;

create or replace function public.chained_percentage_score(
  p_numerator numeric,
  p_denominator numeric,
  p_max_score numeric,
  p_direction text,
  p_thresholds jsonb
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_percentage numeric;
  v_threshold_score numeric;
begin
  if p_direction is null or p_direction not in ('higher-is-better', 'lower-is-better')
    or p_numerator is null or p_numerator < 0
    or p_denominator is null or p_denominator <= 0
    or p_max_score is null or p_max_score <= 0 then
    return 0;
  end if;

  v_percentage := p_numerator / p_denominator * 100;
  if jsonb_array_length(coalesce(p_thresholds, '[]'::jsonb)) > 0 then
    select nullif(item.value ->> 'score', '')::numeric into v_threshold_score
    from jsonb_array_elements(p_thresholds) with ordinality as item(value, ordinal)
    where v_percentage >= coalesce(nullif(item.value ->> 'min', '')::numeric, 0)
      and (nullif(item.value ->> 'max', '') is null
        or v_percentage <= (item.value ->> 'max')::numeric)
    order by item.ordinal
    limit 1;
    return least(greatest(coalesce(v_threshold_score, 0), 0), 100) / 100 * p_max_score;
  end if;

  if p_direction = 'lower-is-better' then
    v_percentage := 100 - v_percentage;
  end if;
  return least(greatest(v_percentage, 0), 100) / 100 * p_max_score;
end;
$$;

revoke all on function public.chained_percentage_score(numeric, numeric, numeric, text, jsonb)
  from public, anon;
grant execute on function public.chained_percentage_score(numeric, numeric, numeric, text, jsonb)
  to authenticated;

commit;
