-- LEGACY ONLY: Do not run this file. Use app-schema.sql for the current application.
create extension if not exists pgcrypto;
/*
This legacy schema is superseded by app-schema.sql. Run that file for the current application.
  code text primary key,
  section text not null check (section in ('Ladang', 'Kampung', 'Masjid', 'Keceriaan')),
  subsection_id text not null,
  subsection_name text not null,
  prompt text not null,
  question_type text not null check (question_type in ('qualitative', 'quantitative')),
  max_score numeric(7,2) not null check (max_score > 0),
  total_count integer check (total_count is null or total_count > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
create type public.assessment_phase as enum ('self', 'field');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'awam' check (role in ('awam', 'juri', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_code text not null references public.questions(code) on update cascade on delete restrict,
  ranch_name text not null,
  block_number varchar(3) not null check (block_number ~ '^[A-Za-z0-9]{1,3}$'),
  phase smallint not null check (phase in (1, 2)),
  assessor_slot smallint not null default 1 check (assessor_slot in (1, 2)),
  response jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (user_id, ranch_name, block_number, phase, assessor_slot, question_code)
);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles as p where p.id = auth.uid()
$$;

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
alter table public.questions enable row level security;
alter table public.answers enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Authenticated users can read active questions" on public.questions;
create policy "Authenticated users can read active questions" on public.questions
  for select to authenticated using (active or public.current_user_role() = 'admin');

drop policy if exists "Admins can manage questions" on public.questions;
create policy "Admins can manage questions" on public.questions
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "Users can read their own answers" on public.answers;
create policy "Users can read their own answers" on public.answers
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own answers" on public.answers;
create policy "Users can insert their own answers" on public.answers
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own answers" on public.answers;
create policy "Users can update their own answers" on public.answers
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own answers" on public.answers;
create policy "Users can delete their own answers" on public.answers
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.profiles, public.questions, public.answers from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.answers to authenticated;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

insert into public.questions (code, section, subsection_id, subsection_name, prompt, question_type, max_score, total_count, sort_order)
values
  ('L1', 'Ladang', 'ladang-1', 'Pengurusan tanaman', 'Kawasan tanaman diurus dengan kemas dan bebas daripada rumpai berlebihan', 'qualitative', 10, null, 1),
  ('L2', 'Ladang', 'ladang-2', 'Infrastruktur ladang', 'Jalan ladang berada dalam keadaan baik dan selamat dilalui', 'qualitative', 10, null, 2),
  ('L3', 'Ladang', 'ladang-3', 'Produktiviti', 'Pokok sawit yang telah matang', 'quantitative', 15, 100, 3),
  ('K1', 'Kampung', 'kampung-1', 'Kebersihan persekitaran', 'Persekitaran rumah dan halaman penduduk bersih serta terurus', 'qualitative', 10, null, 1),
  ('K2', 'Kampung', 'kampung-2', 'Kemudahan awam', 'Kemudahan awam diselenggara dan boleh digunakan', 'qualitative', 10, null, 2),
  ('K3', 'Kampung', 'kampung-3', 'Saliran', 'Rumah dengan sistem saliran yang berfungsi', 'quantitative', 15, 50, 3),
  ('M1', 'Masjid', 'masjid-1', 'Kebersihan masjid', 'Ruang solat, tempat wuduk dan tandas berada dalam keadaan bersih', 'qualitative', 15, null, 1),
  ('M2', 'Masjid', 'masjid-2', 'Pengimarahan', 'Program pengimarahan masjid dilaksanakan secara berkala', 'qualitative', 10, null, 2),
  ('M3', 'Masjid', 'masjid-3', 'Kehadiran jemaah', 'Jemaah yang hadir untuk solat Subuh pada hari penilaian', 'quantitative', 10, 100, 3),
  ('C1', 'Keceriaan', 'keceriaan-1', 'Identiti rancangan', 'Pintu masuk rancangan mempunyai identiti dan landskap yang menarik', 'qualitative', 15, null, 1),
  ('C2', 'Keceriaan', 'keceriaan-2', 'Landskap', 'Laluan utama dihiasi dengan tanaman yang diselenggara', 'qualitative', 10, null, 2),
  ('C3', 'Keceriaan', 'keceriaan-3', 'Pencahayaan', 'Lampu jalan yang berfungsi di kawasan kampung', 'quantitative', 10, 50, 3)
on conflict (code) do update set
  section = excluded.section,
  subsection_id = excluded.subsection_id,
  subsection_name = excluded.subsection_name,
  prompt = excluded.prompt,
  question_type = excluded.question_type,
  max_score = excluded.max_score,
  total_count = excluded.total_count,
  sort_order = excluded.sort_order,
  active = true;

create table public.ranches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_name text not null default '',
  mosque_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.assessment_blocks (
  id uuid primary key default gen_random_uuid(),
  ranch_id uuid not null references public.ranches(id) on delete cascade,
  block_number varchar(3) not null check (block_number ~ '^[A-Za-z0-9]{1,3}$'),
  created_at timestamptz not null default now(),
  unique (ranch_id, block_number)
);

create table public.assessment_subsections (
  id text primary key,
  section public.akrf_section not null,
  name text not null,
  sort_order integer not null default 0,
  unique (id, section)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  section public.akrf_section not null,
  subsection_id text not null,
  code text not null unique,
  prompt text not null,
  question_type text not null check (question_type in ('qualitative', 'quantitative')),
  max_score numeric(7,2) not null check (max_score >= 0),
  total_count integer check (total_count is null or total_count > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  foreign key (subsection_id, section)
    references public.assessment_subsections(id, section)
    on delete restrict
);

create table public.section_settings (
  section public.akrf_section primary key,
  weight numeric(5,2) not null check (weight >= 0 and weight <= 100)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.assessment_blocks(id) on delete cascade,
  phase public.assessment_phase not null,
  section public.akrf_section not null,
  assessor_id uuid references auth.users(id),
  mosque_chairman text,
  imam_name text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (block_id, phase, section, assessor_id)
);

create table public.assessment_answers (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  yes_no boolean,
  grade integer check (grade between 1 and 5),
  baseline_count integer check (baseline_count is null or baseline_count >= 0),
  verified_count integer check (verified_count is null or verified_count >= 0),
  unique (assessment_id, question_id)
);

create or replace view public.block_section_scores as
select
  a.block_id,
  a.section,
  a.assessor_id,
  a.phase,
  sum(case
    when q.question_type = 'qualitative' and a.phase = 'field' then
      case when ans.yes_no is true then coalesce(ans.grade, 0)::numeric / 5 * q.max_score else 0 end
    when q.question_type = 'quantitative' and a.phase = 'field' then
      case when q.total_count > 0 then least(coalesce(ans.verified_count, 0), q.total_count)::numeric / q.total_count * q.max_score else 0 end
    when q.question_type = 'qualitative' and a.phase = 'self' then
      case when ans.yes_no is true then q.max_score else 0 end
    else 0
  end) as score,
  sum(q.max_score) as max_score
from public.assessments a
join public.assessment_answers ans on ans.assessment_id = a.id
join public.questions q on q.id = ans.question_id
group by a.block_id, a.section, a.assessor_id, a.phase;

create or replace view public.block_leaderboard as
with section_scores as (
  select block_id, section, avg(score / nullif(max_score, 0) * 100) as normalized_score
  from public.block_section_scores
  where phase = 'field'
  group by block_id, section
), block_scores as (
  select block_id, sum(section_scores.normalized_score * section_settings.weight / 100) as weighted_score
  from section_scores
  join public.section_settings using (section)
  group by block_id
)
select b.id as block_id, r.name as ranch_name, b.block_number, block_scores.weighted_score
from block_scores
join public.assessment_blocks b on b.id = block_scores.block_id
join public.ranches r on r.id = b.ranch_id;

alter table public.ranches enable row level security;
alter table public.assessment_blocks enable row level security;
alter table public.questions enable row level security;
alter table public.assessment_subsections enable row level security;
alter table public.section_settings enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_answers enable row level security;

create policy "Ranches are readable by everyone" on public.ranches for select using (true);
create policy "Blocks are readable by everyone" on public.assessment_blocks for select using (true);
create policy "Questions are readable by everyone" on public.questions for select using (active = true);
create policy "Subsections are readable by everyone" on public.assessment_subsections for select using (true);
create policy "Section weights are readable by everyone" on public.section_settings for select using (true);
create policy "Self assessments can be submitted publicly" on public.assessments for insert with check (phase = 'self' and assessor_id is null);
create policy "Self assessment answers can be submitted publicly" on public.assessment_answers for insert with check (
  exists (select 1 from public.assessments a where a.id = assessment_id and a.phase = 'self' and a.assessor_id is null)
);
create policy "Authenticated jurors can read assessments" on public.assessments for select to authenticated using (true);
create policy "Authenticated jurors can submit field assessments" on public.assessments for insert to authenticated with check (phase = 'field' and assessor_id = auth.uid());
create policy "Authenticated jurors can read answers" on public.assessment_answers for select to authenticated using (true);
create policy "Authenticated jurors can submit field answers" on public.assessment_answers for insert to authenticated with check (
  exists (select 1 from public.assessments a where a.id = assessment_id and a.phase = 'field' and a.assessor_id = auth.uid())
);

-- Production deployment should add role-scoped admin policies and an RPC that atomically
-- verifies phase-one completion and quantitative limits before accepting phase-two answers.
*/