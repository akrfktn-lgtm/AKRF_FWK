begin;

alter table public.questions
  add column if not exists scoring_parent_code text,
  add column if not exists scoring_direction text,
  add column if not exists percentage_thresholds jsonb not null default '[]'::jsonb;

alter table public.questions
  drop constraint if exists questions_scoring_parent_code_fkey,
  add constraint questions_scoring_parent_code_fkey
    foreign key (scoring_parent_code) references public.questions(code)
    on update cascade on delete set null;

alter table public.questions
  drop constraint if exists questions_scoring_direction_check,
  add constraint questions_scoring_direction_check
    check (scoring_direction is null or scoring_direction in ('higher-is-better', 'lower-is-better')) not valid;

alter table public.questions
  validate constraint questions_scoring_direction_check;

update public.questions
set percentage_thresholds = '[]'::jsonb
where percentage_thresholds is null
   or jsonb_typeof(percentage_thresholds) <> 'array';

alter table public.questions
  alter column percentage_thresholds set default '[]'::jsonb,
  alter column percentage_thresholds set not null;

alter table public.questions
  drop constraint if exists questions_percentage_thresholds_check;

alter table public.questions
  add constraint questions_percentage_thresholds_check
  check (jsonb_typeof(percentage_thresholds) = 'array') not valid;

alter table public.questions
  validate constraint questions_percentage_thresholds_check;

comment on column public.questions.percentage_thresholds is
  'Optional ordered percentage bands for chained quantitative scoring. Each band awards score percent of max_score.';
comment on column public.questions.scoring_parent_code is
  'Optional question code whose phase-one response is the denominator for chained quantitative scoring.';
comment on column public.questions.scoring_direction is
  'Scoring direction for chained quantitative questions: higher-is-better or lower-is-better.';

commit;
