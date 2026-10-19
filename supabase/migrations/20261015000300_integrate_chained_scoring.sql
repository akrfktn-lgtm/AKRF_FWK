begin;

-- Keep phase-two section totals, submission validation, and score readers aligned.
create or replace function public.refresh_assessment_section_scores(p_ranch_name text, p_block_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section record;
  v_question record;
  v_answers jsonb;
  v_baseline jsonb;
  v_parent_answer jsonb;
  v_score numeric;
  v_maximum numeric;
  v_combined_earned numeric;
  v_section_maximum numeric;
  v_slot_earned numeric[];
  v_slot_maximum numeric[];
  v_slot_count integer;
  v_question_earned numeric;
  v_range_score numeric;
  v_question_count integer;
  v_slot integer;
begin
  for v_section in select code from public.sections where active loop
    select greatest(coalesce(max(assignment.assessor_slot), 0), 2) into v_slot_count
    from public.juror_topic_assignments assignment
    join public.topics topic on topic.id = assignment.topic_id
    where topic.active and topic.section_code = v_section.code;
    v_slot_earned := array_fill(0::numeric, array[v_slot_count]);
    v_slot_maximum := array_fill(0::numeric, array[v_slot_count]);
    v_combined_earned := 0;
    select coalesce(sum(coalesce(sub.max_marks, qm.total)), 0) into v_section_maximum
      from public.topics sub
      cross join lateral (
        select coalesce(sum(max_score), 0) as total
        from public.questions where active and topic_id = sub.id
          and question_type <> 'subjective_single' and not is_survey
      ) qm
      where sub.active and sub.section_code = v_section.code
        and exists (
          select 1 from public.questions scored_question
          where scored_question.topic_id = sub.id and scored_question.active
            and not scored_question.is_survey and scored_question.question_type <> 'subjective_single'
        );

    for v_question in
      select q.code, q.question_type, q.max_score, q.is_survey, q.total_count, q.topic_id, q.score_ranges, q.objective_options,
        q.scoring_parent_code, q.scoring_direction, q.percentage_thresholds,
        coalesce(sub.max_marks, qm.total) / nullif(qm.total, 0) as factor
      from public.questions q
      join public.topics sub on sub.id = q.topic_id and sub.active
      cross join lateral (
        select sum(max_score) as total from public.questions where active and topic_id = q.topic_id
          and question_type <> 'subjective_single' and not is_survey
      ) qm
      where q.active and q.section = v_section.code and not q.is_survey
    loop
      v_question_earned := 0;
      v_question_count := 0;
      for v_slot in
        select assignment.assessor_slot
        from public.juror_topic_assignments assignment
        where assignment.topic_id = v_question.topic_id
        order by assignment.assessor_slot
      loop
        v_answers := null;
        select a.response into v_answers
        from public.answers a
        join public.assessment_submissions s
          on s.user_id = a.user_id and s.ranch_name = a.ranch_name
         and s.block_number = a.block_number and s.phase = a.phase
         and s.assessor_slot = a.assessor_slot and s.topic_id = v_question.topic_id
         and s.status = 'submitted'
        where a.ranch_name = p_ranch_name and a.block_number = p_block_number
          and a.phase = 2 and a.assessor_slot = v_slot and a.question_code = v_question.code
        order by a.submitted_at desc limit 1;
        if v_answers is null or v_question.question_type = 'subjective_single' or v_question.is_survey then continue; end if;

        v_score := 0;
        if v_question.question_type = 'objective' then
          select nullif(option.value ->> 'score', '')::numeric into v_score
          from jsonb_array_elements(v_question.objective_options) as option(value)
          where option.value ->> 'id' = v_answers ->> v_question.code
          limit 1;
          v_score := coalesce(v_score, 0);
        elsif v_question.question_type = 'quantitative' then
          v_baseline := null;
          select a.response into v_baseline
          from public.answers a
          join public.assessment_submissions s
            on s.user_id = a.user_id and s.ranch_name = a.ranch_name
           and s.block_number = a.block_number and s.phase = a.phase
           and s.assessor_slot = a.assessor_slot and s.topic_id = v_question.topic_id
           and s.status = 'submitted'
          where a.ranch_name = p_ranch_name and a.block_number = p_block_number
            and a.phase = 1 and a.question_code = v_question.code
          order by a.submitted_at desc limit 1;
          v_maximum := coalesce(nullif(v_baseline ->> (v_question.code || '-target'), '')::numeric, v_question.total_count, 1);
          v_score := least(coalesce(nullif(v_answers ->> v_question.code, '')::numeric, 0), v_maximum) / v_maximum * v_question.max_score;
          if v_question.scoring_parent_code is not null then
            v_parent_answer := null;
            select a.response into v_parent_answer
            from public.answers a
            join public.assessment_submissions s
              on s.user_id = a.user_id and s.ranch_name = a.ranch_name
             and s.block_number = a.block_number and s.phase = a.phase
             and s.assessor_slot = a.assessor_slot and s.topic_id = v_question.topic_id
             and s.status = 'submitted'
            where a.ranch_name = p_ranch_name and a.block_number = p_block_number
              and a.phase = 1 and a.assessor_slot = 1
              and a.question_code = v_question.scoring_parent_code
            order by a.submitted_at desc limit 1;
            v_score := public.chained_percentage_score(
              nullif(v_answers ->> v_question.code, '')::numeric,
              nullif(v_parent_answer ->> v_question.scoring_parent_code, '')::numeric,
              v_question.max_score, v_question.scoring_direction, v_question.percentage_thresholds
            );
          end if;
        elsif v_question.question_type in ('subjective', 'dynamic_table') then
          v_score := least(greatest(coalesce(nullif(v_answers ->> v_question.code, '')::numeric, 0), 0), v_question.max_score);
        elsif v_question.question_type in ('qualitative_no_grade', 'qualitative_note_only') then
          v_score := case when v_answers ->> (v_question.code || '-yn') = 'Ya' then v_question.max_score else 0 end;
        elsif v_question.question_type = 'qualitative_range' then
          v_range_score := null;
          if v_answers ->> (v_question.code || '-yn') = 'Ya' then
            select nullif(band.range_value ->> 'score', '')::numeric into v_range_score
            from jsonb_array_elements(v_question.score_ranges) as band(range_value)
            where (v_answers ->> v_question.code)::numeric >= (band.range_value ->> 'min')::numeric
              and ((band.range_value ->> 'max') is null or (v_answers ->> v_question.code)::numeric <= (band.range_value ->> 'max')::numeric)
            limit 1;
          end if;
          v_score := coalesce(v_range_score, 0) / 5 * v_question.max_score;
        else
          v_score := case when v_answers ->> (v_question.code || '-yn') = 'Ya'
            then coalesce(nullif(v_answers ->> v_question.code, '')::numeric, 0) / 5 * v_question.max_score
            else 0 end;
        end if;
        v_slot_earned[v_slot] := coalesce(v_slot_earned[v_slot], 0) + v_score * coalesce(v_question.factor, 0);
        v_slot_maximum[v_slot] := coalesce(v_slot_maximum[v_slot], 0) + v_question.max_score * coalesce(v_question.factor, 0);
        v_question_earned := v_question_earned + v_score * coalesce(v_question.factor, 0);
        v_question_count := v_question_count + 1;
      end loop;
      if v_question_count > 0 then
        v_combined_earned := v_combined_earned + v_question_earned / v_question_count;
      end if;
    end loop;

    insert into public.assessment_section_scores (
      ranch_name, block_number, section_code, jury_1_score, jury_2_score, section_score, updated_at
    ) values (
      p_ranch_name, p_block_number, v_section.code,
      case when v_slot_maximum[1] > 0 then round(v_slot_earned[1] / v_slot_maximum[1] * 100, 2) else null end,
      case when v_slot_maximum[2] > 0 then round(v_slot_earned[2] / v_slot_maximum[2] * 100, 2) else null end,
      case when v_section_maximum > 0 then round(v_combined_earned / v_section_maximum * 100, 2) else 0 end,
      now()
    ) on conflict (ranch_name, block_number, section_code) do update set
      jury_1_score = excluded.jury_1_score,
      jury_2_score = excluded.jury_2_score,
      section_score = excluded.section_score,
      updated_at = excluded.updated_at;
  end loop;
end;
$$;

create or replace function public.submit_assessment(
  p_ranch_name text,
  p_block_number text,
  p_phase smallint,
  p_assessor_slot integer,
  p_topic_id text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_question record;
  v_answer text;
  v_yes_no text;
  v_quant_target numeric;
  v_weighted_max numeric;
  v_baseline jsonb;
  v_parent_response jsonb;
  v_response jsonb;
  v_table jsonb;
  v_question_count integer := 0;
  v_score numeric := 0;
  v_maximum numeric := 0;
  v_question_score numeric;
  v_status text;
  v_submission_id uuid;
  v_revision integer;
  v_range_score numeric;
  v_objective_score numeric;
  v_financial jsonb;
  v_phase_one_sections integer;
  v_required_sections integer;
  v_section_code text;
  v_topic_block_based boolean;
  v_mosque_key text;
  v_is_shared_masjid boolean := false;
  v_target record;
begin
  if v_user_id is null then raise exception 'Sign in is required.' using errcode = '42501'; end if;
  select public.current_user_role_canonical() into v_role;
  if v_role is null or p_ranch_name is null or p_topic_id is null or p_answers is null
    or p_phase is null or p_assessor_slot is null or p_phase not in (1, 2) or p_assessor_slot < 1
    or (p_phase = 1 and p_assessor_slot <> 1)
    or p_block_number is null or p_block_number !~ '^[A-Za-z0-9]{1,3}$'
    or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Invalid assessment submission.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ranches where name = p_ranch_name and active) then
    raise exception 'Ranch is not active.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.topics where id = p_topic_id and active) then
    raise exception 'topic is not active.' using errcode = '22023';
  end if;
  select section_code, block_based into v_section_code, v_topic_block_based
  from public.topics where id = p_topic_id;
  if v_section_code = 'Masjid' then
    select lower(regexp_replace(btrim(mosque_name), '\s+', ' ', 'g'))
    into v_mosque_key from public.ranches where name = p_ranch_name and active;
    v_is_shared_masjid := coalesce(v_mosque_key, '') <> '' and (
      select count(*) from public.ranches
      where active and lower(regexp_replace(btrim(mosque_name), '\s+', ' ', 'g')) = v_mosque_key
    ) > 1;
  end if;
  if p_phase = 1 and v_role not in ('rancangan', 'developer') then
    raise exception 'Only public users can submit phase one.' using errcode = '42501';
  end if;
  if p_phase = 2 and v_role not in ('juri', 'super_user', 'developer') then
    raise exception 'Only jurors can submit phase two.' using errcode = '42501';
  end if;
  if p_phase = 2 and v_role <> 'developer' and not exists (
    select 1 from public.juror_topic_assignments
    where user_id = v_user_id and topic_id = p_topic_id and assessor_slot = p_assessor_slot
  ) then
    raise exception 'You are not assigned to this topic.' using errcode = '42501';
  end if;
  if p_phase = 2 then
    select count(distinct topic_id) into v_required_sections from public.questions where active;
    select count(distinct topic_id) into v_phase_one_sections
    from public.assessment_submissions
    where ranch_name = p_ranch_name and block_number = p_block_number
      and phase = 1 and status = 'submitted';
    if v_required_sections = 0 or v_phase_one_sections < v_required_sections then
      raise exception 'Phase one must be completed before phase two.' using errcode = '22023';
    end if;
  end if;

  if v_is_shared_masjid then
    perform pg_advisory_xact_lock(hashtextextended('mosque:' || v_mosque_key || ':sync', 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    case when not v_topic_block_based then p_ranch_name || ':shared'
      when v_is_shared_masjid then 'mosque:' || v_mosque_key
      else p_ranch_name || ':' || p_block_number end
    || ':' || p_phase || ':' || p_assessor_slot || ':' || p_topic_id, 0
  ));
  if not v_topic_block_based and exists (
    select 1 from public.assessment_submissions submission
    where submission.ranch_name = p_ranch_name and submission.phase = p_phase
      and submission.assessor_slot = p_assessor_slot and submission.topic_id = p_topic_id
      and submission.status = 'submitted'
  ) then
    raise exception 'This shared ranch topic was already submitted. Ask an admin to reopen it.' using errcode = '55000';
  end if;
  if v_is_shared_masjid and exists (
    select 1 from public.assessment_submissions submission
    join public.ranches ranch on ranch.name = submission.ranch_name and ranch.active
    join public.topics topic on topic.id = submission.topic_id
    where lower(regexp_replace(btrim(ranch.mosque_name), '\s+', ' ', 'g')) = v_mosque_key
      and topic.section_code = 'Masjid'
      and submission.phase = p_phase and submission.assessor_slot = p_assessor_slot
      and submission.topic_id = p_topic_id and submission.status = 'submitted'
  ) then
    raise exception 'This shared mosque topic was already submitted. Ask an admin to reopen it.' using errcode = '55000';
  end if;
  select id, status, revision into v_submission_id, v_status, v_revision
  from public.assessment_submissions
  where ranch_name = p_ranch_name and block_number = p_block_number and phase = p_phase
    and assessor_slot = p_assessor_slot and topic_id = p_topic_id
  for update;
  if found and v_status = 'submitted' then
    raise exception 'This topic was already submitted. Ask an admin to reopen it.' using errcode = '55000';
  end if;

  for v_question in
    select code, question_type, max_score, is_survey, is_locked, total_count, topic_id, score_ranges, objective_options, table_columns, table_rows,
      scoring_parent_code, scoring_direction, percentage_thresholds
    from public.questions where active and topic_id = p_topic_id
  loop
    v_question_count := v_question_count + 1;
    v_answer := p_answers ->> v_question.code;
    v_yes_no := p_answers ->> (v_question.code || '-yn');
    v_question_score := 0;
    if v_question.is_locked then
      continue;
    end if;
    if v_question.is_survey and p_phase = 2 then
      continue;
    end if;
    if v_question.question_type in ('qualitative_with_note', 'qualitative_note_only')
      and length(coalesce(p_answers ->> (v_question.code || '-note'), '')) > 5000 then
      raise exception 'The optional note must not exceed 5000 characters for question %.', v_question.code using errcode = '22023';
    end if;
    if v_question.question_type = 'objective' then
      v_objective_score := null;
      if v_answer is not null then
        select nullif(option.value ->> 'score', '')::numeric into v_objective_score
        from jsonb_array_elements(v_question.objective_options) as option(value)
        where option.value ->> 'id' = v_answer
        limit 1;
      end if;
      if v_objective_score is null or v_objective_score < 0 or (not v_question.is_survey and v_objective_score > v_question.max_score) then
        raise exception 'Choose one configured answer for objective question %.', v_question.code using errcode = '22023';
      end if;
      v_question_score := v_objective_score;
    elsif v_question.question_type = 'quantitative' then
      if v_question.scoring_parent_code is not null then
        if p_phase = 1 then
          v_parent_response := p_answers;
        else
          v_parent_response := null;
          select answer.response into v_parent_response
          from public.answers answer
          join public.assessment_submissions submission
            on submission.user_id = answer.user_id and submission.ranch_name = answer.ranch_name
           and submission.block_number = answer.block_number and submission.phase = answer.phase
           and submission.assessor_slot = answer.assessor_slot and submission.topic_id = v_question.topic_id
           and submission.status = 'submitted'
          where answer.ranch_name = p_ranch_name and answer.block_number = p_block_number
            and answer.phase = 1 and answer.assessor_slot = 1
            and answer.question_code = v_question.scoring_parent_code
          order by answer.submitted_at desc limit 1;
        end if;
        v_quant_target := nullif(v_parent_response ->> v_question.scoring_parent_code, '')::numeric;
      elsif p_phase = 1 then
        v_quant_target := nullif(p_answers ->> (v_question.code || '-target'), '')::numeric;
      else
        v_baseline := null;
        select a.response into v_baseline
        from public.answers a
        join public.assessment_submissions s
          on s.user_id = a.user_id and s.ranch_name = a.ranch_name and s.block_number = a.block_number
         and s.phase = 1 and s.assessor_slot = 1 and s.topic_id = v_question.topic_id and s.status = 'submitted'
        where a.ranch_name = p_ranch_name and a.block_number = p_block_number and a.question_code = v_question.code
        order by a.submitted_at desc limit 1;
        v_quant_target := coalesce(nullif(v_baseline ->> (v_question.code || '-target'), '')::numeric, v_question.total_count);
      end if;
      if v_quant_target is null
        or (v_question.scoring_parent_code is null and v_quant_target < 1)
        or (v_question.scoring_parent_code is not null and v_quant_target < 0)
        or v_quant_target <> trunc(v_quant_target)
        or v_answer is null or v_answer !~ '^[0-9]+$' or v_answer::numeric > v_quant_target then
        raise exception 'Invalid quantitative answer for question %.', v_question.code using errcode = '22023';
      end if;
      if v_question.scoring_parent_code is not null then
        v_question_score := public.chained_percentage_score(
          v_answer::numeric,
          nullif(v_parent_response ->> v_question.scoring_parent_code, '')::numeric,
          v_question.max_score, v_question.scoring_direction, v_question.percentage_thresholds
        );
      else
        v_question_score := least(v_answer::numeric, v_quant_target) / v_quant_target * v_question.max_score;
      end if;
    elsif v_question.question_type = 'subjective_single' then
      if p_phase = 1 and (nullif(btrim(v_answer), '') is null or length(v_answer) > 500) then
        raise exception 'Enter one short answer (up to 500 characters) for question %.', v_question.code using errcode = '22023';
      end if;
    elsif v_question.question_type in ('subjective', 'dynamic_table') then
      if p_phase = 1 then
        if v_question.question_type = 'dynamic_table' then
          if nullif(btrim(v_answer), '') is null or length(v_answer) > 30000 then
            raise exception 'Enter table data (up to 30000 characters) for question %.', v_question.code using errcode = '22023';
          end if;
          begin
            v_table := v_answer::jsonb;
          exception when others then
            raise exception 'Enter a valid table for question %.', v_question.code using errcode = '22023';
          end;
          if jsonb_typeof(v_table) is distinct from 'object'
            or jsonb_typeof(v_table -> 'columns') is distinct from 'array'
            or jsonb_typeof(v_table -> 'rows') is distinct from 'array' then
            raise exception 'Enter a table with columns and rows for question %.', v_question.code using errcode = '22023';
          end if;
          if v_table -> 'columns' ->> 0 <> 'No.'
            or jsonb_array_length(v_table -> 'columns') <> jsonb_array_length(v_question.table_columns) + 1
            or jsonb_array_length(v_table -> 'rows') <> v_question.table_rows then
            raise exception 'The table must match the configured columns and row count for question %.', v_question.code using errcode = '22023';
          end if;
          if exists (
            select 1 from jsonb_array_elements(v_table -> 'rows') as table_row(row_value)
            where jsonb_typeof(table_row.row_value) is distinct from 'array'
          ) then
            raise exception 'Each table row must be a list of cells for question %.', v_question.code using errcode = '22023';
          end if;
          if exists (
            select 1 from jsonb_array_elements(v_table -> 'rows') as table_row(row_value)
            where jsonb_array_length(table_row.row_value) <> jsonb_array_length(v_table -> 'columns') - 1
          ) then
            raise exception 'Each table row must match the configured columns for question %.', v_question.code using errcode = '22023';
          end if;
          if not exists (
            select 1 from jsonb_array_elements(v_table -> 'rows') as table_row(row_value)
            cross join lateral jsonb_array_elements_text(table_row.row_value) as cell(value)
            where nullif(btrim(cell.value), '') is not null
          ) then
            raise exception 'Fill at least one table cell for question %.', v_question.code using errcode = '22023';
          end if;
        elsif nullif(btrim(v_answer), '') is null or length(v_answer) > 5000 then
          raise exception 'Enter one or more answers (up to 5000 characters) for question %.', v_question.code using errcode = '22023';
        end if;
      else
        if v_answer is null or v_answer !~ '^[0-9]+(\.[0-9]{1,2})?$' or v_answer::numeric > v_question.max_score then
          raise exception 'Enter a manual score between 0 and the maximum for question %.', v_question.code using errcode = '22023';
        end if;
        v_question_score := v_answer::numeric;
      end if;
    elsif v_question.question_type = 'auto_calculated_financial' then
      v_financial := public.financial_response(v_question.code, p_answers);
      v_question_score := (v_financial ->> v_question.code)::numeric / 5 * v_question.max_score;
    elsif v_question.question_type in ('qualitative', 'qualitative_no_grade', 'qualitative_with_note', 'qualitative_note_only', 'qualitative_range') then
      if v_yes_no is null or v_yes_no not in ('Ya', 'Tidak') then
        raise exception 'Choose Ya or Tidak for question %.', v_question.code using errcode = '22023';
      end if;
      if v_yes_no = 'Ya' then
        if v_question.question_type in ('qualitative', 'qualitative_with_note') then
          if v_answer !~ '^[1-5]$' then
            raise exception 'Choose a grade from 1 to 5 for question %.', v_question.code using errcode = '22023';
          end if;
          v_question_score := v_answer::numeric / 5 * v_question.max_score;
        elsif v_question.question_type = 'qualitative_range' then
          if v_answer is null or v_answer !~ '^[0-9]+$' then
            raise exception 'Enter an integer quantity for question %.', v_question.code using errcode = '22023';
          end if;
          v_range_score := null;
          select nullif(band.range_value ->> 'score', '')::numeric into v_range_score
          from jsonb_array_elements(v_question.score_ranges) as band(range_value)
          where v_answer::numeric >= (band.range_value ->> 'min')::numeric
            and ((band.range_value ->> 'max') is null or v_answer::numeric <= (band.range_value ->> 'max')::numeric)
          limit 1;
          if v_range_score is null or v_range_score < 1 or v_range_score > 5 then
            raise exception 'Quantity does not match a configured scoring range for question %.', v_question.code using errcode = '22023';
          end if;
          v_question_score := v_range_score / 5 * v_question.max_score;
        else
          v_question_score := v_question.max_score;
        end if;
      end if;
    elsif p_phase = 1 then
      if v_answer is null or v_answer not in ('Ya', 'Tidak') then
        raise exception 'Choose Ya or Tidak for question %.', v_question.code using errcode = '22023';
      end if;
      if v_answer = 'Ya' then v_question_score := v_question.max_score; end if;
    end if;
    if v_question.question_type <> 'subjective_single' and not v_question.is_survey then
      v_maximum := v_maximum + v_question.max_score;
    end if;
    if v_question.is_survey then v_question_score := 0; end if;
    v_response := '{}'::jsonb;
    if p_answers ? v_question.code then v_response := v_response || jsonb_build_object(v_question.code, p_answers -> v_question.code); end if;
    if p_answers ? (v_question.code || '-yn') then v_response := v_response || jsonb_build_object(v_question.code || '-yn', p_answers -> (v_question.code || '-yn')); end if;
    if p_answers ? (v_question.code || '-target') then v_response := v_response || jsonb_build_object(v_question.code || '-target', p_answers -> (v_question.code || '-target')); end if;
    if p_answers ? (v_question.code || '-note') then v_response := v_response || jsonb_build_object(v_question.code || '-note', p_answers -> (v_question.code || '-note')); end if;
    if v_question.question_type = 'auto_calculated_financial' then v_response := v_financial; end if;
    if p_answers ? 'mosque-name' then v_response := v_response || jsonb_build_object('mosque-name', p_answers -> 'mosque-name'); end if;
    if p_answers ? 'mosque-chairman' then v_response := v_response || jsonb_build_object('mosque-chairman', p_answers -> 'mosque-chairman'); end if;
    if p_answers ? 'mosque-imam' then v_response := v_response || jsonb_build_object('mosque-imam', p_answers -> 'mosque-imam'); end if;

    insert into public.answers (
      user_id, question_code, ranch_name, block_number, phase, assessor_slot,
      recorder_name, response, submitted_at
    ) values (
      v_user_id, v_question.code, p_ranch_name, p_block_number, p_phase, p_assessor_slot,
      coalesce((select full_name from public.profiles where id = v_user_id), ''),
      v_response, now()
    ) on conflict (user_id, ranch_name, block_number, phase, assessor_slot, question_code)
      do update set recorder_name = excluded.recorder_name,
        response = excluded.response, submitted_at = excluded.submitted_at;
    v_score := v_score + v_question_score;
  end loop;
  if v_question_count = 0 then raise exception 'No active questions in this topic.' using errcode = '22023'; end if;

  -- Question marks are only a ratio: earned / question total * Topic marks (e.g. 80 / 120 * 8).
  select case when v_maximum > 0 then coalesce(max_marks, v_maximum) else 0 end
  into v_weighted_max from public.topics where id = p_topic_id;
  v_score := case when v_maximum > 0 then v_score / v_maximum * v_weighted_max else 0 end;
  v_maximum := v_weighted_max;

  insert into public.assessment_submissions (
    user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status, revision,
    score_marks, maximum_marks, submitted_at
  ) values (
    v_user_id, p_ranch_name, p_block_number, p_phase, p_assessor_slot, p_topic_id, 'submitted', 1,
    v_score, v_maximum, now()
  ) on conflict (ranch_name, block_number, phase, assessor_slot, topic_id)
    do update set user_id = excluded.user_id, status = 'submitted',
      revision = assessment_submissions.revision + 1,
      score_marks = excluded.score_marks, maximum_marks = excluded.maximum_marks,
      submitted_at = excluded.submitted_at
    returning id, revision into v_submission_id, v_revision;

  insert into public.assessment_submission_events (submission_id, actor_id, event_type, snapshot)
  values (v_submission_id, v_user_id, 'submitted', jsonb_build_object(
    'answers', p_answers, 'score_marks', v_score, 'maximum_marks', v_maximum, 'revision', v_revision
  ));
  if not v_topic_block_based then
    for v_target in
      select distinct answer.block_number
      from public.answers answer
      where answer.ranch_name = p_ranch_name
        and exists (
          select 1 from public.questions question
          where question.code = answer.question_code
            and question.topic_id <> p_topic_id
        )
      union
      select p_block_number
    loop
      if v_target.block_number = p_block_number then
        continue;
      end if;
      delete from public.answers
      where ranch_name = p_ranch_name and block_number = v_target.block_number
        and phase = p_phase and assessor_slot = p_assessor_slot
        and question_code in (select code from public.questions where topic_id = p_topic_id);
      insert into public.answers (
        user_id, question_code, ranch_name, block_number, phase, assessor_slot,
        recorder_name, response, submitted_at
      )
      select v_user_id, source_answer.question_code, p_ranch_name, v_target.block_number,
        p_phase, p_assessor_slot, source_answer.recorder_name, source_answer.response, source_answer.submitted_at
      from public.answers source_answer
      where source_answer.user_id = v_user_id and source_answer.ranch_name = p_ranch_name
        and source_answer.block_number = p_block_number and source_answer.phase = p_phase
        and source_answer.assessor_slot = p_assessor_slot
        and source_answer.question_code in (select code from public.questions where topic_id = p_topic_id);
      insert into public.assessment_submissions (
        user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status, revision,
        score_marks, maximum_marks, submitted_at
      ) values (
        v_user_id, p_ranch_name, v_target.block_number, p_phase, p_assessor_slot,
        p_topic_id, 'submitted', 1, v_score, v_maximum, now()
      ) on conflict (ranch_name, block_number, phase, assessor_slot, topic_id)
        do update set user_id = excluded.user_id, status = 'submitted',
          revision = assessment_submissions.revision + 1,
          score_marks = excluded.score_marks, maximum_marks = excluded.maximum_marks,
          submitted_at = excluded.submitted_at;
      insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
      select submission.id, v_user_id, 'submitted', 'Synchronized from the shared ranch topic',
        jsonb_build_object('answers', p_answers, 'score_marks', v_score,
          'maximum_marks', v_maximum, 'revision', submission.revision)
      from public.assessment_submissions submission
      where submission.ranch_name = p_ranch_name and submission.block_number = v_target.block_number
        and submission.phase = p_phase and submission.assessor_slot = p_assessor_slot
        and submission.topic_id = p_topic_id;
      if p_phase = 2 then
        perform public.refresh_assessment_section_scores(p_ranch_name, v_target.block_number);
      end if;
    end loop;
  end if;
  if v_is_shared_masjid then
    for v_target in
      select distinct ranch_name, block_number
      from (
        select ranch.name as ranch_name,
          coalesce(blocks.block_number, p_block_number) as block_number
        from public.ranches ranch
        left join lateral (
          select distinct answer.block_number
          from public.answers answer
          where answer.ranch_name = ranch.name
            and exists (
              select 1 from public.questions question
              where question.code = answer.question_code and question.section <> 'Masjid'
            )
        ) blocks on true
        where ranch.active
          and lower(regexp_replace(btrim(ranch.mosque_name), '\s+', ' ', 'g')) = v_mosque_key
        union all
        select p_ranch_name, p_block_number
      ) targets
    loop
      if v_target.ranch_name = p_ranch_name
        and (v_target.block_number = p_block_number or not v_topic_block_based) then
        continue;
      end if;
      delete from public.answers
      where ranch_name = v_target.ranch_name and block_number = v_target.block_number
        and phase = p_phase and assessor_slot = p_assessor_slot
        and question_code in (select code from public.questions where section = 'Masjid' and topic_id = p_topic_id);
      insert into public.answers (
        user_id, question_code, ranch_name, block_number, phase, assessor_slot,
        recorder_name, response, submitted_at
      )
      select v_user_id, source_answer.question_code, v_target.ranch_name, v_target.block_number,
        p_phase, p_assessor_slot, source_answer.recorder_name, source_answer.response, source_answer.submitted_at
      from public.answers source_answer
      where source_answer.user_id = v_user_id and source_answer.ranch_name = p_ranch_name
        and source_answer.block_number = p_block_number and source_answer.phase = p_phase
        and source_answer.assessor_slot = p_assessor_slot
        and source_answer.question_code in (
          select code from public.questions where section = 'Masjid' and topic_id = p_topic_id
        );
      insert into public.assessment_submissions (
        user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status, revision,
        score_marks, maximum_marks, submitted_at
      ) values (
        v_user_id, v_target.ranch_name, v_target.block_number, p_phase, p_assessor_slot,
        p_topic_id, 'submitted', 1, v_score, v_maximum, now()
      ) on conflict (ranch_name, block_number, phase, assessor_slot, topic_id)
        do update set user_id = excluded.user_id, status = 'submitted',
          revision = assessment_submissions.revision + 1,
          score_marks = excluded.score_marks, maximum_marks = excluded.maximum_marks,
          submitted_at = excluded.submitted_at;
      insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
      select submission.id, v_user_id, 'submitted', 'Synchronized from the shared mosque assessment',
        jsonb_build_object('answers', p_answers, 'score_marks', v_score,
          'maximum_marks', v_maximum, 'revision', submission.revision)
      from public.assessment_submissions submission
      where submission.ranch_name = v_target.ranch_name and submission.block_number = v_target.block_number
        and submission.phase = p_phase and submission.assessor_slot = p_assessor_slot
        and submission.topic_id = p_topic_id;
      if p_phase = 2 then
        perform public.refresh_assessment_section_scores(v_target.ranch_name, v_target.block_number);
      end if;
    end loop;
  elsif v_section_code <> 'Masjid' then
    perform public.sync_shared_masjid_assessments_to_block(p_ranch_name, p_block_number);
  end if;
  if p_phase = 2 and not v_is_shared_masjid then
    perform public.refresh_assessment_section_scores(p_ranch_name, p_block_number);
  end if;
  perform public.sync_shared_ranch_topics_to_block(p_ranch_name, p_block_number);
  return jsonb_build_object(
    'submission_id', v_submission_id, 'revision', v_revision, 'score_marks', v_score,
    'maximum_marks', v_maximum, 'section_percent', case when v_maximum > 0 then round(v_score / v_maximum * 100, 2) else 0 end
  );
end;
$$;

create or replace view public.assessment_phase_one_block_scores as
with topic_scores as (
select
  a.ranch_name,
  a.block_number,
  q.section as section_code,
  q.topic_id,
  coalesce(sum(case
      when q.question_type = 'objective' then
        (select nullif(option.value ->> 'score', '')::numeric
          from jsonb_array_elements(q.objective_options) as option(value)
          where option.value ->> 'id' = a.response ->> q.code
          limit 1)
      when q.question_type = 'quantitative' then
        case when q.scoring_parent_code is not null then public.chained_percentage_score(
          nullif(a.response ->> q.code, '')::numeric,
          nullif(parent_answer.response ->> q.scoring_parent_code, '')::numeric,
          q.max_score, q.scoring_direction, q.percentage_thresholds
        ) else
        least(coalesce(nullif(a.response ->> q.code, '')::numeric, 0),
          coalesce(nullif(a.response ->> (q.code || '-target'), '')::numeric, q.total_count, 1))
        / coalesce(nullif(a.response ->> (q.code || '-target'), '')::numeric, q.total_count, 1) * q.max_score
        end
      when q.question_type in ('qualitative', 'qualitative_with_note', 'auto_calculated_financial') and a.response ->> (q.code || '-yn') = 'Ya'
        then (a.response ->> q.code)::numeric / 5 * q.max_score
      when q.question_type = 'qualitative_range' and a.response ->> (q.code || '-yn') = 'Ya'
        then (select (band.range_value ->> 'score')::numeric / 5 * q.max_score
          from jsonb_array_elements(q.score_ranges) as band(range_value)
          where (a.response ->> q.code)::numeric >= (band.range_value ->> 'min')::numeric
            and ((band.range_value ->> 'max') is null or (a.response ->> q.code)::numeric <= (band.range_value ->> 'max')::numeric)
          limit 1)
      when coalesce(a.response ->> (q.code || '-yn'), a.response ->> q.code) = 'Ya' then q.max_score
      else 0
    end), 0) as earned,
  sum(case when q.question_type = 'subjective_single' then 0 else q.max_score end) as question_max
from public.assessment_submissions s
join public.answers a
  on a.user_id = s.user_id and a.ranch_name = s.ranch_name and a.block_number = s.block_number
 and a.phase = s.phase and a.assessor_slot = s.assessor_slot
join public.questions q on q.code = a.question_code and q.active and not q.is_survey
  and q.question_type not in ('subjective', 'subjective_single', 'dynamic_table')
left join lateral (
  select parent.response
  from public.answers parent
  where parent.user_id = a.user_id and parent.ranch_name = a.ranch_name
    and parent.block_number = a.block_number and parent.phase = a.phase
    and parent.assessor_slot = a.assessor_slot and parent.question_code = q.scoring_parent_code
  order by parent.submitted_at desc
  limit 1
) parent_answer on true
where s.phase = 1 and s.status = 'submitted' and s.topic_id = q.topic_id
group by a.ranch_name, a.block_number, q.section, q.topic_id
)
-- Zero-mark topics add nothing; sections are summed from topics.
-- Any block with a submission counts; topics not yet assessed score 0.
select
  1::smallint as phase,
  b.ranch_name,
  b.block_number,
  sec.code as section_code,
  coalesce(round(
    sum(case when ss.question_max > 0 then ss.earned / ss.question_max * coalesce(sub.max_marks, ss.question_max) else 0 end)
      / nullif(sum(coalesce(sub.max_marks, ss.question_max, 0)), 0) * 100,
    2
  ), 0) as section_score,
  null::numeric as jury_1_score,
  null::numeric as jury_2_score
from (select distinct ranch_name, block_number from topic_scores) b
cross join public.sections sec
left join public.topics sub on sub.section_code = sec.code and sub.active and exists (
  select 1 from public.questions scored_question
  where scored_question.topic_id = sub.id and scored_question.active
    and not scored_question.is_survey and scored_question.question_type <> 'subjective_single'
)
left join topic_scores ss
  on ss.topic_id = sub.id and ss.ranch_name = b.ranch_name and ss.block_number = b.block_number
where sec.active
group by b.ranch_name, b.block_number, sec.code;

create or replace view public.assessment_question_scores as
with baseline_answers as (
  select distinct on (answer.ranch_name, answer.block_number, answer.question_code)
    answer.ranch_name, answer.block_number, answer.question_code, answer.response
  from public.answers answer
  join public.assessment_submissions submission
    on submission.user_id = answer.user_id and submission.ranch_name = answer.ranch_name
   and submission.block_number = answer.block_number and submission.phase = 1
   and submission.assessor_slot = 1 and submission.status = 'submitted'
  where answer.phase = 1
  order by answer.ranch_name, answer.block_number, answer.question_code, answer.submitted_at desc
), submitted_answers as (
  select
    answer.user_id,
    answer.ranch_name,
    answer.block_number,
    answer.phase,
    answer.assessor_slot,
    answer.question_code,
    answer.response,
    question.question_type,
    question.is_survey,
    question.max_score,
    question.total_count,
    question.score_ranges,
    question.objective_options,
    question.scoring_parent_code,
    question.scoring_direction,
    question.percentage_thresholds,
    question.code,
    baseline.response as baseline_response,
    parent_baseline.response as baseline_parent_response
  from public.answers answer
  join public.questions question on question.code = answer.question_code and question.active
  join public.assessment_submissions submission
    on submission.user_id = answer.user_id and submission.ranch_name = answer.ranch_name
   and submission.block_number = answer.block_number and submission.phase = answer.phase
   and submission.assessor_slot = answer.assessor_slot and submission.topic_id = question.topic_id
   and submission.status = 'submitted'
  left join baseline_answers baseline
    on baseline.ranch_name = answer.ranch_name and baseline.block_number = answer.block_number
   and baseline.question_code = answer.question_code
  left join baseline_answers parent_baseline
    on parent_baseline.ranch_name = answer.ranch_name and parent_baseline.block_number = answer.block_number
   and parent_baseline.question_code = question.scoring_parent_code
  where answer.phase in (1, 2)
    and (answer.phase = 1 or exists (
      select 1 from public.juror_topic_assignments assignment
      where assignment.user_id = answer.user_id
        and assignment.topic_id = question.topic_id
        and assignment.assessor_slot = answer.assessor_slot
    ))
), scored_answers as (
  select
    user_id, ranch_name, block_number, phase, assessor_slot, question_code, question_type,
    max_score,
    objective_options,
    case
      when is_survey or question_type = 'subjective_single' then null::numeric
      when question_type in ('subjective', 'dynamic_table') and phase = 1 then null::numeric
      when question_type in ('subjective', 'dynamic_table') and phase = 2 then least(greatest((response ->> code)::numeric, 0), max_score)
      when question_type = 'objective' then
        (select nullif(option.value ->> 'score', '')::numeric
          from jsonb_array_elements(objective_options) as option(value)
          where option.value ->> 'id' = response ->> code
          limit 1)
      when question_type = 'quantitative' and scoring_parent_code is not null then
        public.chained_percentage_score(
          nullif(response ->> code, '')::numeric,
          nullif(baseline_parent_response ->> scoring_parent_code, '')::numeric,
          max_score, scoring_direction, percentage_thresholds
        )
      when question_type = 'quantitative' then
        least((response ->> code)::numeric,
          coalesce(nullif(case when phase = 1 then response ->> (code || '-target') else baseline_response ->> (code || '-target') end, '')::numeric, total_count, 1))
        / coalesce(nullif(case when phase = 1 then response ->> (code || '-target') else baseline_response ->> (code || '-target') end, '')::numeric, total_count, 1) * max_score
      when phase = 1 and question_type in ('qualitative', 'qualitative_with_note', 'auto_calculated_financial') then
        case when response ->> (code || '-yn') = 'Ya' then (response ->> code)::numeric / 5 * max_score else 0 end
      when phase = 1 and question_type = 'qualitative_range' and response ->> (code || '-yn') = 'Ya' then
        (select (band.range_value ->> 'score')::numeric / 5 * max_score
          from jsonb_array_elements(score_ranges) as band(range_value)
          where (response ->> code)::numeric >= (band.range_value ->> 'min')::numeric
            and ((band.range_value ->> 'max') is null or (response ->> code)::numeric <= (band.range_value ->> 'max')::numeric)
          limit 1)
      when phase = 1 then case when coalesce(response ->> (code || '-yn'), response ->> code) = 'Ya' then max_score else 0 end
      when question_type in ('qualitative_no_grade', 'qualitative_note_only') then case when response ->> (code || '-yn') = 'Ya' then max_score else 0 end
      when question_type = 'qualitative_range' and response ->> (code || '-yn') = 'Ya'
        then (select (band.range_value ->> 'score')::numeric / 5 * max_score
          from jsonb_array_elements(score_ranges) as band(range_value)
          where (response ->> code)::numeric >= (band.range_value ->> 'min')::numeric
            and ((band.range_value ->> 'max') is null or (response ->> code)::numeric <= (band.range_value ->> 'max')::numeric)
          limit 1)
      when response ->> (code || '-yn') = 'Ya' then (response ->> code)::numeric / 5 * max_score
      else 0
    end as score_marks
  from submitted_answers
)
select
  phase, ranch_name, block_number, question_code, assessor_slot, question_type,
  score_marks,
  max_score,
  case when score_marks is null then null else round(score_marks / nullif(max_score, 0) * 100, 2) end as score_percent
from scored_answers;

do $$
declare
  v_block record;
begin
  for v_block in
    select distinct ranch_name, block_number
    from public.assessment_submissions
    where phase = 2 and status = 'submitted'
  loop
    perform public.refresh_assessment_section_scores(v_block.ranch_name, v_block.block_number);
  end loop;
end;
$$;

commit;