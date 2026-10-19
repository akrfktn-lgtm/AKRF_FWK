begin;

update public.questions
set is_survey = true,
    max_score = 0,
    total_count = null,
    note_prompt = '',
    scoring_parent_code = null,
    scoring_direction = null,
    percentage_thresholds = '[]'::jsonb
where question_type = 'quantitative';

do $migration$
declare
  v_definition text;
  v_branch_marker constant text := 'elsif v_question.question_type = ''quantitative'' then';
  v_next_marker constant text := 'elsif v_question.question_type = ''subjective_single'' then';
  v_branch_start integer;
  v_next_start integer;
begin
  v_definition := pg_get_functiondef(
    'public.submit_assessment(text,text,smallint,integer,text,jsonb)'::regprocedure
  );
  v_branch_start := strpos(v_definition, v_branch_marker);
  if v_branch_start = 0 then
    raise exception 'Could not find the quantitative validation branch in submit_assessment.';
  end if;
  v_next_start := strpos(
    substr(v_definition, v_branch_start + length(v_branch_marker)),
    v_next_marker
  );
  if v_next_start = 0 then
    raise exception 'Could not find the next question branch in submit_assessment.';
  end if;
  v_next_start := v_branch_start + length(v_branch_marker) + v_next_start - 1;

  v_definition := substr(v_definition, 1, v_branch_start - 1)
    || 'elsif v_question.question_type = ''quantitative'' then
      if v_answer is null or v_answer !~ ''^[0-9]+$'' then
        raise exception ''Enter a non-negative whole number for question %.'', v_question.code using errcode = ''22023'';
      end if;
      v_question_score := 0;
    elsif v_question.question_type = ''subjective_single'' then'
    || substr(v_definition, v_next_start + length(v_next_marker));

  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_block record;
begin
  for v_block in
    select distinct ranch_name, block_number
    from public.assessment_submissions
    where phase = 2
  loop
    perform public.refresh_assessment_section_scores(v_block.ranch_name, v_block.block_number);
  end loop;
end;
$migration$;

commit;
