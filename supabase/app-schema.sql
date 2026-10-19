create extension if not exists pgcrypto;

-- Upgrade legacy subsection naming before creating or updating the current schema.
do $$
begin
  if to_regclass('public.subsections') is not null and to_regclass('public.topics') is not null then
    raise exception 'Both public.subsections and public.topics exist; resolve the duplicate data before migrating.';
  end if;
  if to_regclass('public.subsections') is not null then
    alter table public.subsections rename to topics;
  end if;
  if to_regclass('public.juror_subsection_assignments') is not null
     and to_regclass('public.juror_topic_assignments') is not null then
    raise exception 'Both juror assignment tables exist; resolve the duplicate data before migrating.';
  end if;
  if to_regclass('public.juror_subsection_assignments') is not null then
    alter table public.juror_subsection_assignments rename to juror_topic_assignments;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'subsection_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'topic_id') then
    alter table public.questions rename column subsection_id to topic_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'subsection_name')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'topic_name') then
    alter table public.questions rename column subsection_name to topic_name;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'juror_topic_assignments' and column_name = 'subsection_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'juror_topic_assignments' and column_name = 'topic_id') then
    alter table public.juror_topic_assignments rename column subsection_id to topic_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'assessment_submissions' and column_name = 'subsection_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'assessment_submissions' and column_name = 'topic_id') then
    alter table public.assessment_submissions rename column subsection_id to topic_id;
  end if;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'rancangan' check (role in ('rancangan', 'juri', 'super_user', 'developer')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'rancangan';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles alter column role set default 'rancangan';
alter table public.profiles add constraint profiles_role_check
  check (role in ('rancangan', 'juri', 'super_user', 'developer')) not valid;
update public.profiles
set role = case role when 'awam' then 'rancangan' when 'admin' then 'developer' else role end
where role in ('awam', 'admin');

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p.role
    when 'rancangan' then 'awam'
    when 'developer' then 'admin'
    when 'super_user' then 'juri'
    else p.role
  end
  from public.profiles as p where p.id = auth.uid()
$$;

create or replace function public.current_user_role_canonical()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p.role
    when 'awam' then 'rancangan'
    when 'admin' then 'developer'
    else p.role
  end
  from public.profiles as p where p.id = auth.uid()
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;
revoke all on function public.current_user_role_canonical() from public, anon;
grant execute on function public.current_user_role_canonical() to authenticated;

create table if not exists public.ranches (
  name text primary key,
  manager_name text not null default '',
  mosque_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ranches add column if not exists mosque_name text not null default '';

create table if not exists public.sections (
  code text primary key,
  name text not null,
  weight numeric(5,2) not null check (weight >= 0 and weight <= 100),
  guidance_note text not null default '',
  block_based boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.sections add column if not exists guidance_note text not null default '';
alter table public.sections add column if not exists icon_code text not null default '';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sections' and column_name = 'block_based'
  ) then
    alter table public.sections add column block_based boolean not null default true;
  end if;
end;
$$;

create table if not exists public.topics (
  id text primary key,
  section_code text not null references public.sections(code) on update cascade on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  block_based boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, section_code)
);

alter table public.topics add column if not exists max_marks numeric(7,2) check (max_marks is null or max_marks >= 0);
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'topics' and column_name = 'block_based'
  ) then
    alter table public.topics add column block_based boolean not null default true;
  end if;
end;
$$;
comment on column public.topics.max_marks is 'Topic marks (default 0 = survey only). Section weightage is derived from these.';
comment on column public.topics.block_based is 'When false, this topic is assessed once per ranch and shared across its blocks.';
alter table public.topics alter column max_marks set default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.topics'::regclass and conname = 'topics_id_section_code_key'
  ) then
    alter table public.topics
      add constraint topics_id_section_code_key unique (id, section_code);
  end if;
end;
$$;

create table if not exists public.subtopics (
  id text primary key,
  topic_id text not null references public.topics(id) on update cascade on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, topic_id)
);

create table if not exists public.additional_topics (
  id text primary key,
  subtopic_id text not null references public.subtopics(id) on update cascade on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, subtopic_id)
);

create table if not exists public.questions (
  code text primary key,
  section text not null,
  topic_id text not null,
  subtopic_id text,
  additional_topic_id text,
  topic_name text not null,
  prompt text not null,
  question_type text not null check (question_type in ('qualitative', 'qualitative_no_grade', 'qualitative_with_note', 'qualitative_note_only', 'qualitative_range', 'objective', 'dynamic_table', 'quantitative', 'subjective', 'subjective_single', 'auto_calculated_financial')),
  max_score numeric(7,2) not null check (max_score >= 0),
  is_survey boolean not null default false,
  is_locked boolean not null default false,
  total_count integer check (total_count is null or total_count > 0),
  note_prompt text not null default '',
  score_ranges jsonb not null default '[]'::jsonb,
  scoring_parent_code text references public.questions(code) on update cascade on delete set null,
  scoring_direction text check (scoring_direction is null or scoring_direction in ('higher-is-better', 'lower-is-better')),
  percentage_thresholds jsonb not null default '[]'::jsonb,
  objective_options jsonb not null default '[]'::jsonb,
  table_instruction text not null default '',
  table_columns jsonb not null default '["Maklumat"]'::jsonb,
  sort_order integer not null default 0,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.questions drop constraint if exists questions_section_check;
alter table public.questions drop constraint if exists questions_section_fkey;
alter table public.questions add constraint questions_section_fkey
  foreign key (section) references public.sections(code) on update cascade on delete restrict;
alter table public.questions add column if not exists subtopic_id text;
alter table public.questions add column if not exists additional_topic_id text;
alter table public.questions add column if not exists objective_options jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists is_survey boolean not null default false;
alter table public.questions add column if not exists is_locked boolean not null default false;
alter table public.questions drop constraint if exists questions_max_score_check;
alter table public.questions add constraint questions_max_score_check check (max_score >= 0);
alter table public.questions drop constraint if exists questions_survey_max_score_check;
alter table public.questions add constraint questions_survey_max_score_check
  check (not is_survey or max_score = 0) not valid;
alter table public.questions drop constraint if exists questions_question_type_check;
alter table public.questions add constraint questions_question_type_check
  check (question_type in ('qualitative', 'qualitative_no_grade', 'qualitative_with_note', 'qualitative_note_only', 'qualitative_range', 'objective', 'dynamic_table', 'quantitative', 'subjective', 'subjective_single', 'auto_calculated_financial'));
alter table public.questions drop constraint if exists questions_objective_options_array_check;
alter table public.questions add constraint questions_objective_options_array_check
  check (jsonb_typeof(objective_options) = 'array');
alter table public.questions add column if not exists display_order integer not null default 0;
alter table public.questions drop constraint if exists questions_topic_section_fkey;
alter table public.questions add constraint questions_topic_section_fkey
  foreign key (topic_id, section) references public.topics(id, section_code) on update cascade on delete restrict;
alter table public.questions drop constraint if exists questions_subtopic_topic_fkey;
alter table public.questions add constraint questions_subtopic_topic_fkey
  foreign key (subtopic_id, topic_id) references public.subtopics(id, topic_id) on update cascade on delete restrict;
alter table public.questions drop constraint if exists questions_additional_topic_subtopic_fkey;
alter table public.questions add constraint questions_additional_topic_subtopic_fkey
  foreign key (additional_topic_id, subtopic_id) references public.additional_topics(id, subtopic_id) on update cascade on delete restrict;

alter table public.questions drop constraint if exists questions_question_type_check;
alter table public.questions add constraint questions_question_type_check
  check (question_type in ('qualitative', 'qualitative_no_grade', 'qualitative_with_note', 'qualitative_note_only', 'qualitative_range', 'objective', 'dynamic_table', 'quantitative', 'subjective', 'subjective_single', 'auto_calculated_financial'));
alter table public.questions add column if not exists note_prompt text not null default '';
alter table public.questions add column if not exists score_ranges jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists scoring_parent_code text references public.questions(code) on update cascade on delete set null;
alter table public.questions add column if not exists scoring_direction text;
alter table public.questions drop constraint if exists questions_scoring_direction_check;
alter table public.questions add constraint questions_scoring_direction_check
  check (scoring_direction is null or scoring_direction in ('higher-is-better', 'lower-is-better'));
alter table public.questions add column if not exists percentage_thresholds jsonb not null default '[]'::jsonb;
alter table public.questions drop constraint if exists questions_percentage_thresholds_check;
alter table public.questions add constraint questions_percentage_thresholds_check
  check (jsonb_typeof(percentage_thresholds) = 'array');
alter table public.questions add column if not exists table_instruction text not null default '';
alter table public.questions add column if not exists table_columns jsonb not null default '["Maklumat"]'::jsonb;
alter table public.questions add column if not exists table_rows integer not null default 2;
alter table public.questions drop constraint if exists questions_table_rows_check;
alter table public.questions add constraint questions_table_rows_check check (table_rows between 1 and 50);
alter table public.questions drop constraint if exists questions_table_columns_check;
alter table public.questions add constraint questions_table_columns_check
  check (jsonb_typeof(table_columns) = 'array');
alter table public.questions drop constraint if exists questions_score_ranges_check;
alter table public.questions add constraint questions_score_ranges_check
  check (jsonb_typeof(score_ranges) = 'array');

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

-- Child CURRENCY_RM inputs of an AUTO_CALCULATED_FINANCIAL question.
create table if not exists public.financial_line_items (
  id uuid primary key default gen_random_uuid(),
  question_code text not null references public.questions(code) on update cascade on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 200),
  kind text not null check (kind in ('income', 'expense')),
  input_type text not null default 'currency_rm' check (input_type = 'currency_rm'),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Admin-configured utilization brackets: min_percent <= utilization < max_percent (null max = open-ended).
create table if not exists public.financial_score_thresholds (
  id uuid primary key default gen_random_uuid(),
  min_percent numeric(7,2) not null check (min_percent >= 0),
  max_percent numeric(7,2),
  score smallint not null check (score between 1 and 5),
  check (max_percent is null or max_percent > min_percent)
);

alter table public.financial_line_items enable row level security;
alter table public.financial_score_thresholds enable row level security;

drop policy if exists "Authenticated users can read financial line items" on public.financial_line_items;
create policy "Authenticated users can read financial line items" on public.financial_line_items
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));
drop policy if exists "Admins can manage financial line items" on public.financial_line_items;
create policy "Admins can manage financial line items" on public.financial_line_items
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authenticated users can read financial thresholds" on public.financial_score_thresholds;
create policy "Authenticated users can read financial thresholds" on public.financial_score_thresholds
  for select to authenticated using (true);
drop policy if exists "Admins can manage financial thresholds" on public.financial_score_thresholds;
create policy "Admins can manage financial thresholds" on public.financial_score_thresholds
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

revoke all on public.financial_line_items, public.financial_score_thresholds from anon;
grant select, insert, update, delete on public.financial_line_items, public.financial_score_thresholds to authenticated;

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_code text not null references public.questions(code) on update cascade on delete restrict,
  ranch_name text not null references public.ranches(name) on update cascade on delete restrict,
  block_number varchar(3) not null check (block_number ~ '^[A-Za-z0-9]{1,3}$'),
  phase smallint not null check (phase in (1, 2)),
  assessor_slot integer not null default 1 check (assessor_slot > 0),
  recorder_name text not null default '',
  response jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (user_id, ranch_name, block_number, phase, assessor_slot, question_code)
);

alter table public.answers add column if not exists phase smallint not null default 1;
alter table public.answers drop constraint if exists answers_phase_check;
alter table public.answers add constraint answers_phase_check
  check (phase in (1, 2)) not valid;

drop view if exists public.assessment_regional_scores;
drop view if exists public.assessment_ranch_scores;
drop view if exists public.assessment_phase_block_totals;
drop view if exists public.assessment_phase_block_scores;
drop view if exists public.assessment_phase_one_block_scores;
drop view if exists public.assessment_phase_two_block_scores;
drop view if exists public.assessment_question_scores;

alter table public.answers alter column assessor_slot type integer using assessor_slot::integer;
alter table public.answers drop constraint if exists answers_assessor_slot_check;
alter table public.answers drop constraint if exists answers_assessor_slot_positive;
alter table public.answers add constraint answers_assessor_slot_positive check (assessor_slot > 0);

alter table public.answers add column if not exists recorder_name text not null default '';

create or replace function public.unlock_question(p_question_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if auth.uid() is null or v_role not in ('super_user', 'developer') then
    raise exception 'Only super users and developers can unlock questions.' using errcode = '42501';
  end if;
  update public.questions set is_locked = false
  where code = p_question_code and active and is_locked;
  if not found then
    raise exception 'The active question is not locked.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.unlock_question(text) from public, anon;
grant execute on function public.unlock_question(text) to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.ranches enable row level security;
alter table public.sections enable row level security;
alter table public.topics enable row level security;
alter table public.subtopics enable row level security;
alter table public.additional_topics enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Authenticated users can read active ranches" on public.ranches;
create policy "Authenticated users can read active ranches" on public.ranches
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Admins can manage ranches" on public.ranches;
create policy "Admins can manage ranches" on public.ranches
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authenticated users can read active sections" on public.sections;
create policy "Authenticated users can read active sections" on public.sections
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Admins can manage sections" on public.sections;
create policy "Admins can manage sections" on public.sections
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authenticated users can read active subsections" on public.topics;
drop policy if exists "Admins can manage subsections" on public.topics;
drop policy if exists "Authenticated users can read active topics" on public.topics;
create policy "Authenticated users can read active topics" on public.topics
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Admins can manage topics" on public.topics;
create policy "Admins can manage topics" on public.topics
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authenticated users can read active subtopics" on public.subtopics;
create policy "Authenticated users can read active subtopics" on public.subtopics
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Admins can manage subtopics" on public.subtopics;
create policy "Admins can manage subtopics" on public.subtopics
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authenticated users can read active additional topics" on public.additional_topics;
create policy "Authenticated users can read active additional topics" on public.additional_topics
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Admins can manage additional topics" on public.additional_topics;
create policy "Admins can manage additional topics" on public.additional_topics
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authenticated users can read active questions" on public.questions;
create policy "Authenticated users can read active questions" on public.questions
  for select to authenticated using (active or public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Admins can manage questions" on public.questions;
create policy "Admins can manage questions" on public.questions
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Users can read their own answers" on public.answers;
create policy "Users can read their own answers" on public.answers
  for select to authenticated using (
    user_id = (select auth.uid())
    or public.current_user_role_canonical() in ('super_user', 'developer')
    or (phase = 1 and public.current_user_role_canonical() = 'juri')
  );

drop policy if exists "Users can insert their own answers" on public.answers;
create policy "Users can insert their own answers" on public.answers
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and (
      (phase = 1 and public.current_user_role_canonical() in ('rancangan', 'developer'))
      or (phase = 2 and public.current_user_role_canonical() in ('juri', 'super_user', 'developer'))
    )
    and exists (
      select 1 from public.questions question
      where question.code = question_code
        and not question.is_locked
        and (phase <> 2 or not question.is_survey)
    )
  );

drop policy if exists "Users can update their own answers" on public.answers;
create policy "Users can update their own answers" on public.answers
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (
      (phase = 1 and public.current_user_role_canonical() in ('rancangan', 'developer'))
      or (phase = 2 and public.current_user_role_canonical() in ('juri', 'super_user', 'developer'))
    )
    and exists (
      select 1 from public.questions question
      where question.code = question_code
        and not question.is_locked
        and (phase <> 2 or not question.is_survey)
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      (phase = 1 and public.current_user_role_canonical() in ('rancangan', 'developer'))
      or (phase = 2 and public.current_user_role_canonical() in ('juri', 'super_user', 'developer'))
    )
    and exists (
      select 1 from public.questions question
      where question.code = question_code
        and not question.is_locked
        and (phase <> 2 or not question.is_survey)
    )
  );

revoke all on public.profiles, public.ranches, public.sections, public.topics, public.subtopics, public.additional_topics, public.questions, public.answers from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.ranches to authenticated;
grant select, insert, update, delete on public.sections, public.topics, public.subtopics, public.additional_topics to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update on public.answers to authenticated;
create table if not exists public.juror_topic_assignments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id text not null references public.topics(id) on update cascade on delete cascade,
  assessor_slot integer not null check (assessor_slot > 0),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

alter table public.juror_topic_assignments alter column assessor_slot type integer using assessor_slot::integer;
alter table public.juror_topic_assignments drop constraint if exists juror_topic_assignments_assessor_slot_check;
alter table public.juror_topic_assignments drop constraint if exists juror_topic_assignments_assessor_slot_positive;
alter table public.juror_topic_assignments drop constraint if exists juror_subsection_assignments_subsection_id_assessor_slot_key;
alter table public.juror_topic_assignments drop constraint if exists juror_topic_assignments_topic_id_assessor_slot_key;
alter table public.juror_topic_assignments add constraint juror_topic_assignments_assessor_slot_positive check (assessor_slot > 0);

create table if not exists public.assessment_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  ranch_name text not null references public.ranches(name),
  block_number varchar(3) not null check (block_number ~ '^[A-Za-z0-9]{1,3}$'),
  phase smallint not null check (phase in (1, 2)),
  assessor_slot integer not null check (assessor_slot > 0),
  topic_id text not null references public.topics(id),
  status text not null default 'submitted' check (status in ('submitted', 'reopened')),
  revision integer not null default 1 check (revision > 0),
  score_marks numeric(9,2) not null default 0,
  maximum_marks numeric(9,2) not null default 0,
  submitted_at timestamptz not null default now(),
  unique (ranch_name, block_number, phase, assessor_slot, topic_id)
);

alter table public.assessment_submissions add column if not exists phase smallint not null default 1;
alter table public.assessment_submissions drop constraint if exists assessment_submissions_phase_check;
alter table public.assessment_submissions add constraint assessment_submissions_phase_check
  check (phase in (1, 2)) not valid;

alter table public.assessment_submissions alter column assessor_slot type integer using assessor_slot::integer;
alter table public.assessment_submissions drop constraint if exists assessment_submissions_assessor_slot_check;
alter table public.assessment_submissions drop constraint if exists assessment_submissions_assessor_slot_positive;
alter table public.assessment_submissions add constraint assessment_submissions_assessor_slot_positive check (assessor_slot > 0);

create table if not exists public.assessment_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assessment_submissions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in ('submitted', 'reopened')),
  reason text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_section_scores (
  ranch_name text not null references public.ranches(name) on delete cascade,
  block_number varchar(3) not null,
  section_code text not null references public.sections(code),
  jury_1_score numeric(7,2),
  jury_2_score numeric(7,2),
  section_score numeric(7,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ranch_name, block_number, section_code)
);

drop policy if exists "Admins can read profiles for assignments" on public.profiles;
create policy "Admins can read profiles for assignments" on public.profiles
  for select to authenticated using (public.current_user_role_canonical() in ('super_user', 'developer'));

alter table public.juror_topic_assignments enable row level security;
alter table public.assessment_submissions enable row level security;
alter table public.assessment_submission_events enable row level security;
alter table public.assessment_section_scores enable row level security;

drop policy if exists "Jurors can read their assignments" on public.juror_topic_assignments;
create policy "Jurors can read their assignments" on public.juror_topic_assignments
  for select to authenticated using (
    user_id = (select auth.uid()) or public.current_user_role_canonical() in ('super_user', 'developer')
  );
drop policy if exists "Admins can manage juror assignments" on public.juror_topic_assignments;
create policy "Admins can manage juror assignments" on public.juror_topic_assignments
  for all to authenticated
  using (public.current_user_role_canonical() in ('super_user', 'developer'))
  with check (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Authorized users can read submission status" on public.assessment_submissions;
create policy "Authorized users can read submission status" on public.assessment_submissions
  for select to authenticated using (
    user_id = (select auth.uid())
    or public.current_user_role_canonical() in ('super_user', 'developer')
    or (public.current_user_role_canonical() = 'juri' and phase in (1, 2))
  );

drop policy if exists "Admins can read submission audit" on public.assessment_submission_events;
create policy "Admins can read submission audit" on public.assessment_submission_events
  for select to authenticated using (public.current_user_role_canonical() in ('super_user', 'developer'));

drop policy if exists "Jurors and admins can read assessment scores" on public.assessment_section_scores;
create policy "Jurors and admins can read assessment scores" on public.assessment_section_scores
  for select to authenticated using (public.current_user_role_canonical() in ('juri', 'super_user', 'developer'));

drop policy if exists "Users can delete their own answers" on public.answers;

revoke all on public.assessment_submissions, public.assessment_submission_events, public.assessment_section_scores from anon, authenticated;
grant select on public.assessment_submissions, public.assessment_section_scores to authenticated;
grant select on public.assessment_submission_events to authenticated;
revoke insert, update, delete on public.answers from authenticated;
grant select on public.answers to authenticated;
grant select, insert, update, delete on public.juror_topic_assignments to authenticated;

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

create or replace function public.sync_shared_masjid_assessments_to_block(
  p_ranch_name text,
  p_block_number text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mosque_key text;
  v_source record;
begin
  select lower(regexp_replace(btrim(mosque_name), '\s+', ' ', 'g'))
  into v_mosque_key
  from public.ranches
  where name = p_ranch_name and active;

  if v_mosque_key is null or v_mosque_key = '' or (
    select count(*) from public.ranches
    where active and lower(regexp_replace(btrim(mosque_name), '\s+', ' ', 'g')) = v_mosque_key
  ) < 2 then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mosque:' || v_mosque_key || ':sync', 0));

  for v_source in
    select distinct on (submission.phase, submission.assessor_slot, submission.topic_id)
      submission.id, submission.user_id, submission.ranch_name, submission.block_number,
      submission.phase, submission.assessor_slot, submission.topic_id,
      submission.status, submission.revision, submission.score_marks,
      submission.maximum_marks, submission.submitted_at
    from public.assessment_submissions submission
    join public.ranches ranch on ranch.name = submission.ranch_name and ranch.active
    join public.topics topic on topic.id = submission.topic_id
    where lower(regexp_replace(btrim(ranch.mosque_name), '\s+', ' ', 'g')) = v_mosque_key
      and topic.section_code = 'Masjid'
    order by submission.phase, submission.assessor_slot, submission.topic_id,
      submission.submitted_at desc
  loop
    if v_source.ranch_name = p_ranch_name and v_source.block_number = p_block_number then
      continue;
    end if;

    delete from public.answers
    where ranch_name = p_ranch_name and block_number = p_block_number
      and phase = v_source.phase and assessor_slot = v_source.assessor_slot
      and question_code in (
        select code from public.questions where section = 'Masjid' and topic_id = v_source.topic_id
      );
    insert into public.answers (
      user_id, question_code, ranch_name, block_number, phase, assessor_slot,
      recorder_name, response, submitted_at
    )
    select source_answer.user_id, source_answer.question_code, p_ranch_name, p_block_number,
      source_answer.phase, source_answer.assessor_slot, source_answer.recorder_name,
      source_answer.response, source_answer.submitted_at
    from public.answers source_answer
    where source_answer.user_id = v_source.user_id
      and source_answer.ranch_name = v_source.ranch_name
      and source_answer.block_number = v_source.block_number
      and source_answer.phase = v_source.phase
      and source_answer.assessor_slot = v_source.assessor_slot
      and source_answer.question_code in (
        select code from public.questions where section = 'Masjid' and topic_id = v_source.topic_id
      );

    insert into public.assessment_submissions (
      user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status,
      revision, score_marks, maximum_marks, submitted_at
    ) values (
      v_source.user_id, p_ranch_name, p_block_number, v_source.phase, v_source.assessor_slot,
      v_source.topic_id, v_source.status, v_source.revision, v_source.score_marks,
      v_source.maximum_marks, v_source.submitted_at
    ) on conflict (ranch_name, block_number, phase, assessor_slot, topic_id)
      do update set user_id = excluded.user_id, status = excluded.status,
        revision = excluded.revision, score_marks = excluded.score_marks,
        maximum_marks = excluded.maximum_marks, submitted_at = excluded.submitted_at;
    insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
    select submission.id, v_source.user_id,
      case when v_source.status = 'submitted' then 'submitted' else 'reopened' end,
      'Synchronized from the shared mosque assessment',
      coalesce(jsonb_object_agg(answer.question_code, answer.response), '{}'::jsonb)
    from public.assessment_submissions submission
    left join public.answers answer
      on answer.user_id = v_source.user_id and answer.ranch_name = p_ranch_name
      and answer.block_number = p_block_number and answer.phase = v_source.phase
      and answer.assessor_slot = v_source.assessor_slot
      and answer.question_code in (
        select code from public.questions where section = 'Masjid' and topic_id = v_source.topic_id
      )
    where submission.ranch_name = p_ranch_name and submission.block_number = p_block_number
      and submission.phase = v_source.phase and submission.assessor_slot = v_source.assessor_slot
      and submission.topic_id = v_source.topic_id
    group by submission.id;
    if v_source.phase = 2 then
      perform public.refresh_assessment_section_scores(p_ranch_name, p_block_number);
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_shared_masjid_assessments_to_block(text, text) from public, anon, authenticated;

create or replace function public.sync_shared_ranch_topics_to_block(
  p_ranch_name text,
  p_block_number text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source record;
begin
  for v_source in
    select distinct on (submission.phase, submission.assessor_slot, submission.topic_id)
      submission.id, submission.user_id, submission.block_number, submission.phase,
      submission.assessor_slot, submission.topic_id, submission.status, submission.revision,
      submission.score_marks, submission.maximum_marks, submission.submitted_at
    from public.assessment_submissions submission
    join public.topics topic on topic.id = submission.topic_id
    where submission.ranch_name = p_ranch_name
      and submission.block_number <> p_block_number
      and topic.block_based = false
    order by submission.phase, submission.assessor_slot, submission.topic_id,
      submission.submitted_at desc
  loop
    if exists (
      select 1 from public.assessment_submissions target
      where target.ranch_name = p_ranch_name and target.block_number = p_block_number
        and target.phase = v_source.phase and target.assessor_slot = v_source.assessor_slot
        and target.topic_id = v_source.topic_id
    ) then
      continue;
    end if;

    insert into public.answers (
      user_id, question_code, ranch_name, block_number, phase, assessor_slot,
      recorder_name, response, submitted_at
    )
    select source_answer.user_id, source_answer.question_code, p_ranch_name, p_block_number,
      source_answer.phase, source_answer.assessor_slot, source_answer.recorder_name,
      source_answer.response, source_answer.submitted_at
    from public.answers source_answer
    where source_answer.user_id = v_source.user_id
      and source_answer.ranch_name = p_ranch_name
      and source_answer.block_number = v_source.block_number
      and source_answer.phase = v_source.phase
      and source_answer.assessor_slot = v_source.assessor_slot
      and source_answer.question_code in (
        select question.code from public.questions question
        where question.topic_id = v_source.topic_id
      );
    insert into public.assessment_submissions (
      user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status,
      revision, score_marks, maximum_marks, submitted_at
    ) values (
      v_source.user_id, p_ranch_name, p_block_number, v_source.phase,
      v_source.assessor_slot, v_source.topic_id, v_source.status, v_source.revision,
      v_source.score_marks, v_source.maximum_marks, v_source.submitted_at
    ) on conflict (ranch_name, block_number, phase, assessor_slot, topic_id) do nothing;
    insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
    select target.id, v_source.user_id,
      case when v_source.status = 'submitted' then 'submitted' else 'reopened' end,
      'Synchronized from the shared ranch topic',
      coalesce(jsonb_object_agg(answer.question_code, answer.response), '{}'::jsonb)
    from public.assessment_submissions target
    left join public.answers answer
      on answer.user_id = v_source.user_id and answer.ranch_name = p_ranch_name
      and answer.block_number = p_block_number and answer.phase = v_source.phase
      and answer.assessor_slot = v_source.assessor_slot
      and answer.question_code in (
        select question.code from public.questions question
        where question.topic_id = v_source.topic_id
      )
    where target.ranch_name = p_ranch_name and target.block_number = p_block_number
      and target.phase = v_source.phase and target.assessor_slot = v_source.assessor_slot
      and target.topic_id = v_source.topic_id
    group by target.id;
    if v_source.phase = 2 then
      perform public.refresh_assessment_section_scores(p_ranch_name, p_block_number);
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_shared_ranch_topics_to_block(text, text) from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_assessment'
      and 'p_subsection_id' = any(p.proargnames)
  ) then
    drop function public.submit_assessment(text, text, smallint, smallint, text, jsonb);
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reopen_assessment_submission'
      and 'p_subsection_id' = any(p.proargnames)
  ) then
    drop function public.reopen_assessment_submission(text, text, smallint, smallint, text, text);
  end if;
end;
$$;

drop function if exists public.submit_assessment(text, text, smallint, smallint, text, jsonb, text);
drop function if exists public.submit_assessment(text, text, smallint, smallint, text, jsonb);
drop function if exists public.reopen_assessment_submission(text, text, smallint, smallint, text, text);

-- Server-side source of truth for the financial question: totals, utilization %, mapped 1-5 score and the response payload to store.
create or replace function public.financial_response(p_question_code text, p_answers jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item record;
  v_value text;
  v_income numeric := 0;
  v_expense numeric := 0;
  v_count integer := 0;
  v_percent numeric;
  v_score smallint;
  v_response jsonb := '{}'::jsonb;
begin
  for v_item in
    select id, kind from public.financial_line_items
    where active and question_code = p_question_code order by sort_order, created_at
  loop
    v_count := v_count + 1;
    v_value := coalesce(nullif(btrim(p_answers ->> (p_question_code || '-item-' || v_item.id::text)), ''), '0');
    if v_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
      raise exception 'Enter a valid RM amount for question %.', p_question_code using errcode = '22023';
    end if;
    if v_item.kind = 'income' then v_income := v_income + v_value::numeric; else v_expense := v_expense + v_value::numeric; end if;
    v_response := v_response || jsonb_build_object(p_question_code || '-item-' || v_item.id::text, v_value);
  end loop;
  if v_count = 0 then
    raise exception 'Question % has no financial line items configured.', p_question_code using errcode = '22023';
  end if;
  v_percent := case when v_income > 0 then round(v_expense / v_income * 100, 2) else 0 end;
  select score into v_score from public.financial_score_thresholds
  where v_percent >= min_percent and (max_percent is null or v_percent < max_percent)
  order by min_percent desc limit 1;
  if v_score is null then
    raise exception 'No financial score threshold matches % percent.', v_percent using errcode = '22023';
  end if;
  return v_response || jsonb_build_object(
    p_question_code, v_score::text,
    p_question_code || '-yn', 'Ya',
    p_question_code || '-income', v_income::text,
    p_question_code || '-expense', v_expense::text,
    p_question_code || '-utilization', v_percent::text
  );
end;
$$;

revoke all on function public.financial_response(text, jsonb) from public, anon;
grant execute on function public.financial_response(text, jsonb) to authenticated;

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

create or replace function public.reopen_assessment_submission(
  p_ranch_name text,
  p_block_number text,
  p_phase smallint,
  p_assessor_slot integer,
  p_topic_id text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_submission public.assessment_submissions%rowtype;
  v_followup public.assessment_submissions%rowtype;
  v_snapshot jsonb;
  v_mosque_key text;
  v_topic_block_based boolean;
  v_target record;
begin
  if v_user_id is null or coalesce(public.current_user_role_canonical(), '') not in ('super_user', 'developer') then
    raise exception 'Only super users and developers can reopen submissions.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Provide a reopening reason of at least 10 characters.' using errcode = '22023';
  end if;
  select block_based into v_topic_block_based from public.topics where id = p_topic_id;
  if exists (select 1 from public.topics where id = p_topic_id and section_code = 'Masjid') then
    select lower(regexp_replace(btrim(ranch.mosque_name), '\s+', ' ', 'g'))
    into v_mosque_key
    from public.ranches ranch
    where ranch.name = p_ranch_name and ranch.active;
    if coalesce(v_mosque_key, '') = '' or (
      select count(*) from public.ranches
      where active and lower(regexp_replace(btrim(mosque_name), '\s+', ' ', 'g')) = v_mosque_key
    ) < 2 then
      v_mosque_key := null;
    end if;
  end if;
  if v_mosque_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('mosque:' || v_mosque_key || ':sync', 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    case when not v_topic_block_based then p_ranch_name || ':shared'
      when v_mosque_key is not null then 'mosque:' || v_mosque_key
      else p_ranch_name || ':' || p_block_number end
    || ':' || p_phase || ':' || p_assessor_slot || ':' || p_topic_id, 0
  ));
  select * into v_submission from public.assessment_submissions
  where ranch_name = p_ranch_name and block_number = p_block_number and phase = p_phase
    and assessor_slot = p_assessor_slot and topic_id = p_topic_id
  for update;
  if not found or v_submission.status <> 'submitted' then
    raise exception 'No submitted assessment found to reopen.' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_object_agg(question_code, response), '{}'::jsonb) into v_snapshot
  from public.answers
  where user_id = v_submission.user_id and ranch_name = p_ranch_name and block_number = p_block_number
    and phase = p_phase and assessor_slot = p_assessor_slot
    and question_code in (select code from public.questions where topic_id = p_topic_id);
  insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
  values (v_submission.id, v_user_id, 'reopened', btrim(p_reason), jsonb_build_object(
    'answers', v_snapshot, 'revision', v_submission.revision,
    'score_marks', v_submission.score_marks, 'maximum_marks', v_submission.maximum_marks
  ));
  update public.assessment_submissions set status = 'reopened' where id = v_submission.id;
  if p_phase = 2 and not v_topic_block_based then
    for v_followup in
      select * from public.assessment_submissions
      where ranch_name = p_ranch_name and topic_id = p_topic_id
        and phase = p_phase and status = 'submitted' and id <> v_submission.id
      for update
    loop
      select coalesce(jsonb_object_agg(question_code, response), '{}'::jsonb) into v_snapshot
      from public.answers
      where user_id = v_followup.user_id and ranch_name = p_ranch_name
        and block_number = v_followup.block_number and phase = p_phase
        and assessor_slot = v_followup.assessor_slot
        and question_code in (select code from public.questions where topic_id = p_topic_id);
      insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
      values (v_followup.id, v_user_id, 'reopened', 'Topik kongsi rancangan dibuka semula: ' || btrim(p_reason),
        jsonb_build_object('answers', v_snapshot, 'revision', v_followup.revision,
          'score_marks', v_followup.score_marks, 'maximum_marks', v_followup.maximum_marks));
      update public.assessment_submissions set status = 'reopened' where id = v_followup.id;
    end loop;
  end if;
  if p_phase = 1 then
    for v_followup in select * from public.assessment_submissions submission
      where submission.ranch_name = p_ranch_name and submission.topic_id = p_topic_id
        and submission.status = 'submitted'
        and ((submission.block_number = p_block_number and submission.phase = 2)
          or (not v_topic_block_based and submission.phase in (1, 2)))
      for update
    loop
      select coalesce(jsonb_object_agg(question_code, response), '{}'::jsonb) into v_snapshot
      from public.answers
      where user_id = v_followup.user_id and ranch_name = p_ranch_name and block_number = v_followup.block_number
        and phase = v_followup.phase and assessor_slot = v_followup.assessor_slot
        and question_code in (select code from public.questions where topic_id = p_topic_id);
      insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
      values (v_followup.id, v_user_id, 'reopened',
        case when v_followup.phase = 2 then 'Baseline Fasa 1 dibuka semula: ' else 'Topik kongsi rancangan dibuka semula: ' end || btrim(p_reason), jsonb_build_object(
        'answers', v_snapshot, 'revision', v_followup.revision,
        'score_marks', v_followup.score_marks, 'maximum_marks', v_followup.maximum_marks
      ));
      update public.assessment_submissions set status = 'reopened' where id = v_followup.id;
    end loop;
  end if;
  if v_mosque_key is not null then
    for v_followup in
      select submission.*
      from public.assessment_submissions submission
      join public.ranches ranch on ranch.name = submission.ranch_name and ranch.active
      join public.topics topic on topic.id = submission.topic_id
      where lower(regexp_replace(btrim(ranch.mosque_name), '\s+', ' ', 'g')) = v_mosque_key
        and topic.section_code = 'Masjid'
        and submission.topic_id = p_topic_id
        and (submission.phase = p_phase or (p_phase = 1 and submission.phase = 2))
        and submission.status = 'submitted' and submission.id <> v_submission.id
      for update of submission
    loop
      select coalesce(jsonb_object_agg(question_code, response), '{}'::jsonb) into v_snapshot
      from public.answers
      where user_id = v_followup.user_id and ranch_name = v_followup.ranch_name
        and block_number = v_followup.block_number and phase = v_followup.phase
        and assessor_slot = v_followup.assessor_slot
        and question_code in (select code from public.questions where topic_id = p_topic_id);
      insert into public.assessment_submission_events (submission_id, actor_id, event_type, reason, snapshot)
      values (v_followup.id, v_user_id, 'reopened',
        case when v_followup.phase = 2 then 'Baseline Fasa 1 dibuka semula: ' else 'Penilaian masjid bersama dibuka semula: ' end || btrim(p_reason),
        jsonb_build_object('answers', v_snapshot, 'revision', v_followup.revision,
          'score_marks', v_followup.score_marks, 'maximum_marks', v_followup.maximum_marks));
      update public.assessment_submissions set status = 'reopened' where id = v_followup.id;
    end loop;
    for v_target in
      select distinct submission.ranch_name, submission.block_number
      from public.assessment_submissions submission
      join public.ranches ranch on ranch.name = submission.ranch_name and ranch.active
      where lower(regexp_replace(btrim(ranch.mosque_name), '\s+', ' ', 'g')) = v_mosque_key
    loop
      perform public.refresh_assessment_section_scores(v_target.ranch_name, v_target.block_number);
    end loop;
  elsif not v_topic_block_based then
    for v_target in
      select distinct submission.ranch_name, submission.block_number
      from public.assessment_submissions submission
      where submission.ranch_name = p_ranch_name and submission.topic_id = p_topic_id
    loop
      perform public.refresh_assessment_section_scores(v_target.ranch_name, v_target.block_number);
    end loop;
  else
    perform public.refresh_assessment_section_scores(p_ranch_name, p_block_number);
  end if;
end;
$$;

create or replace function public.save_juror_assignments(p_assignments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment jsonb;
  v_user_id uuid;
  v_topic_id text;
  v_slot integer;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can manage juror assignments.' using errcode = '42501';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be an array.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('juror-topic-assignments', 0));
  if exists (
    select 1 from jsonb_array_elements(p_assignments) as items(value)
    where jsonb_typeof(items.value) <> 'object'
      or nullif(items.value ->> 'user_id', '') is null
      or (items.value ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or nullif(items.value ->> 'topic_id', '') is null
  ) then
    raise exception 'Each assignment must specify a valid juror and topic.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) as items(value)
    where not exists (
      select 1 from public.profiles profile
      where profile.id = (items.value ->> 'user_id')::uuid and profile.role in ('juri', 'super_user')
    ) or not exists (
      select 1 from public.topics topic
      where topic.id = items.value ->> 'topic_id' and topic.active
    )
  ) then
    raise exception 'An assignment references an invalid juror or topic.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) as items(value)
    group by items.value ->> 'user_id', items.value ->> 'topic_id'
    having count(*) > 1
  ) then
    raise exception 'A juror can only be assigned once to each topic.' using errcode = '22023';
  end if;
  for v_assignment in select value from jsonb_array_elements(p_assignments)
  loop
    v_user_id := nullif(v_assignment ->> 'user_id', '')::uuid;
    v_topic_id := nullif(v_assignment ->> 'topic_id', '');
    select assessor_slot into v_slot
    from public.juror_topic_assignments
    where user_id = v_user_id and topic_id = v_topic_id;
    if found then
      update public.juror_topic_assignments
      set assigned_by = auth.uid(), assigned_at = now()
      where user_id = v_user_id and topic_id = v_topic_id;
    else
      select submission.assessor_slot into v_slot
      from public.assessment_submissions submission
      where submission.user_id = v_user_id and submission.topic_id = v_topic_id
      order by submission.submitted_at desc
      limit 1;
      if not found then
        select coalesce(max(used.assessor_slot), 0) + 1 into v_slot
        from (
          select assignment.assessor_slot
          from public.juror_topic_assignments assignment
          where assignment.topic_id = v_topic_id
          union all
          select submission.assessor_slot
          from public.assessment_submissions submission
          where submission.topic_id = v_topic_id
        ) used;
      end if;
      insert into public.juror_topic_assignments (user_id, topic_id, assessor_slot, assigned_by)
      values (v_user_id, v_topic_id, v_slot, auth.uid());
    end if;
  end loop;
  delete from public.juror_topic_assignments assignment
  where not exists (
    select 1 from jsonb_array_elements(p_assignments) as items(value)
    where items.value ->> 'user_id' = assignment.user_id::text
      and items.value ->> 'topic_id' = assignment.topic_id
  );
  for v_assignment in
    select distinct jsonb_build_object('ranch_name', submission.ranch_name, 'block_number', submission.block_number)
    from public.assessment_submissions submission
    where submission.phase = 2 and submission.status = 'submitted'
  loop
    perform public.refresh_assessment_section_scores(
      v_assignment ->> 'ranch_name',
      v_assignment ->> 'block_number'
    );
  end loop;
end;
$$;

do $backfill_scores$
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
$backfill_scores$;

revoke all on function public.refresh_assessment_section_scores(text, text) from public, anon, authenticated;
revoke all on function public.submit_assessment(text, text, smallint, integer, text, jsonb) from public, anon;
revoke all on function public.reopen_assessment_submission(text, text, smallint, integer, text, text) from public, anon;
revoke all on function public.save_juror_assignments(jsonb) from public, anon;
grant execute on function public.submit_assessment(text, text, smallint, integer, text, jsonb) to authenticated;
grant execute on function public.reopen_assessment_submission(text, text, smallint, integer, text, text) to authenticated;
grant execute on function public.save_juror_assignments(jsonb) to authenticated;

create or replace function public.delete_all_sections()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can delete all sections.' using errcode = '42501';
  end if;

  delete from public.assessment_submission_events event
  using public.assessment_submissions submission
  join public.topics topic on topic.id = submission.topic_id
  join public.sections section on section.code = topic.section_code
  where event.submission_id = submission.id;

  delete from public.assessment_submissions submission
  using public.topics topic
  join public.sections section on section.code = topic.section_code
  where submission.topic_id = topic.id;

  delete from public.assessment_section_scores score
  using public.sections section
  where score.section_code = section.code;

  delete from public.answers answer
  using public.questions question
  join public.sections section on section.code = question.section
  where answer.question_code = question.code;

  delete from public.juror_topic_assignments assignment
  using public.topics topic
  join public.sections section on section.code = topic.section_code
  where assignment.topic_id = topic.id;

  delete from public.financial_line_items item
  using public.questions question
  join public.sections section on section.code = question.section
  where item.question_code = question.code;

  delete from public.questions question
  using public.sections section
  where question.section = section.code;

  delete from public.additional_topics additional_topic
  using public.subtopics subtopic
  join public.topics topic on topic.id = subtopic.topic_id
  join public.sections section on section.code = topic.section_code
  where additional_topic.subtopic_id = subtopic.id;

  delete from public.subtopics subtopic
  using public.topics topic
  join public.sections section on section.code = topic.section_code
  where subtopic.topic_id = topic.id;

  delete from public.topics topic
  using public.sections section
  where topic.section_code = section.code;

  delete from public.sections;
end;
$$;

revoke all on function public.delete_all_sections() from public, anon;
grant execute on function public.delete_all_sections() to authenticated;

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

create or replace view public.assessment_phase_two_block_scores as
with started_blocks as (
  select distinct submission.ranch_name, submission.block_number
  from public.assessment_submissions submission
  where submission.phase = 2 and submission.status = 'submitted'
)
select
  2::smallint as phase,
  score.ranch_name,
  score.block_number,
  score.section_code,
  score.section_score,
  score.jury_1_score,
  score.jury_2_score
from public.assessment_section_scores score
join started_blocks started using (ranch_name, block_number);

create or replace view public.assessment_phase_block_scores as
select phase, ranch_name, block_number, section_code, section_score, jury_1_score, jury_2_score
from public.assessment_phase_one_block_scores
union all
select phase, ranch_name, block_number, section_code, section_score, jury_1_score, jury_2_score
from public.assessment_phase_two_block_scores;

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

create or replace view public.assessment_phase_block_totals as
select
  block.phase,
  block.ranch_name,
  block.block_number,
  coalesce(max(block.section_score) filter (where block.section_code = 'Ladang'), 0) as ladang_score,
  coalesce(max(block.section_score) filter (where block.section_code = 'Kampung'), 0) as kampung_score,
  coalesce(max(block.section_score) filter (where block.section_code = 'Masjid'), 0) as masjid_score,
  coalesce(max(block.section_score) filter (where block.section_code = 'Keceriaan'), 0) as keceriaan_score,
  round(coalesce(sum(block.section_score * section.weight / 100), 0), 2) as overall_score,
  coalesce(jsonb_object_agg(block.section_code, block.section_score), '{}'::jsonb) as section_scores
from public.assessment_phase_block_scores block
join public.sections section on section.code = block.section_code and section.active
group by block.phase, block.ranch_name, block.block_number;

-- Scores are 0-100 percentages. Weights are applied once to each block; ranch
-- ranking is the average of its eligible blocks, so block count cannot inflate rank.
create or replace view public.assessment_ranch_scores as
with phase_one_block_totals as (
  select * from public.assessment_phase_block_totals where phase = 1
), phase_two_block_totals as (
  select * from public.assessment_phase_block_totals where phase = 2
), current_block_totals as (
  select
    0::smallint as phase,
    phase_one.ranch_name,
    phase_one.block_number,
    coalesce(phase_two.ladang_score, phase_one.ladang_score) as ladang_score,
    coalesce(phase_two.kampung_score, phase_one.kampung_score) as kampung_score,
    coalesce(phase_two.masjid_score, phase_one.masjid_score) as masjid_score,
    coalesce(phase_two.keceriaan_score, phase_one.keceriaan_score) as keceriaan_score,
    coalesce(phase_two.overall_score, phase_one.overall_score) as overall_score,
    phase_two.block_number is not null as phase_two_complete,
    coalesce(phase_one.section_scores, '{}'::jsonb) || coalesce(phase_two.section_scores, '{}'::jsonb) as section_scores
  from phase_one_block_totals phase_one
  left join phase_two_block_totals phase_two
    on phase_two.ranch_name = phase_one.ranch_name
   and phase_two.block_number = phase_one.block_number
), score_rows as (
  select 0::smallint as phase, ranch_name, block_number, ladang_score, kampung_score,
    masjid_score, keceriaan_score, overall_score, phase_two_complete,
    section_scores
  from current_block_totals
  union all
  select 1::smallint, phase_one.ranch_name, phase_one.block_number, phase_one.ladang_score,
    phase_one.kampung_score, phase_one.masjid_score, phase_one.keceriaan_score,
    phase_one.overall_score, phase_two.block_number is not null, phase_one.section_scores || coalesce(phase_two.section_scores, '{}'::jsonb)
  from phase_one_block_totals phase_one
  left join phase_two_block_totals phase_two
    on phase_two.ranch_name = phase_one.ranch_name
   and phase_two.block_number = phase_one.block_number
  union all
  select 2::smallint, ranch_name, block_number, ladang_score, kampung_score,
    masjid_score, keceriaan_score, overall_score, true, section_scores
  from phase_two_block_totals
), ranch_averages as (
  select
    phase,
    ranch_name,
    count(*)::integer as block_count,
    count(*) filter (where phase_two_complete)::integer as phase2_block_count,
    round(avg(ladang_score), 2) as ladang_score,
    round(avg(kampung_score), 2) as kampung_score,
    round(avg(masjid_score), 2) as masjid_score,
    round(avg(keceriaan_score), 2) as keceriaan_score,
    round(avg(overall_score), 2) as overall_score,
    (
      select jsonb_object_agg(section.code, section_average.score)
      from public.sections section
      cross join lateral (
        select round(avg(nullif(score_row.section_scores ->> section.code, '')::numeric), 2) as score
        from score_rows score_row
        where score_row.phase = score_rows.phase and score_row.ranch_name = score_rows.ranch_name
      ) section_average
      where section.active
    ) as section_scores
  from score_rows
  group by score_rows.phase, score_rows.ranch_name
)
select
  phase,
  ranch_name,
  block_count,
  ladang_score,
  kampung_score,
  masjid_score,
  keceriaan_score,
  overall_score,
  phase2_block_count,
  row_number() over (partition by phase order by overall_score desc, ranch_name asc)::integer as ranking_position,
  section_scores
from ranch_averages;

create or replace view public.assessment_regional_scores as
select
  phase,
  round(sum(overall_score * block_count) / nullif(sum(block_count), 0), 2) as average_score,
  sum(block_count)::integer as block_count
from public.assessment_ranch_scores
group by phase;

grant select on public.assessment_phase_one_block_scores,
  public.assessment_phase_two_block_scores,
  public.assessment_phase_block_scores,
  public.assessment_question_scores,
  public.assessment_phase_block_totals,
  public.assessment_ranch_scores,
  public.assessment_regional_scores to authenticated;

do $quantitative_reference_only$
declare
  v_definition text;
  v_branch_marker constant text := 'elsif v_question.question_type = ''quantitative'' then';
  v_next_marker constant text := 'elsif v_question.question_type = ''subjective_single'' then';
  v_branch_start integer;
  v_next_start integer;
begin
  update public.questions
  set is_survey = true,
      max_score = 0,
      total_count = null,
      note_prompt = '',
      scoring_parent_code = null,
      scoring_direction = null,
      percentage_thresholds = '[]'::jsonb
  where question_type = 'quantitative';

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
$quantitative_reference_only$;

do $refresh_quantitative_reference_scores$
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
$refresh_quantitative_reference_scores$;