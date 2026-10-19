# AKRF FELDA Wilayah Kuantan

Next.js application for AKRF self-assessments, field assessments, monitoring, rankings, and printable reports.

## Requirements

- Node.js 20.9 or newer
- A Supabase project with email/password authentication enabled

## Frontend structure

- `src/app/page.tsx` handles the authenticated entry point and renders the assessment workspace.
- `src/features/assessment/` contains the assessment workspace and assessment-specific fields.
- `src/features/auth/`, `admin/`, `juror/`, and `reports/` group their UI by domain.
- `src/components/ui/` contains shared UI primitives; `src/lib/` contains shared Supabase, workflow, scoring, CSV, financial, and report utilities.

## Local setup

1. Install dependencies with `npm install`.
2. Create a new Supabase project, run [`supabase/app-schema.sql`](supabase/app-schema.sql), then run [`supabase/migrations/20261020000100_atomic_configuration_and_versions.sql`](supabase/migrations/20261020000100_atomic_configuration_and_versions.sql) in the Supabase Dashboard SQL Editor. [`supabase/schema.sql`](supabase/schema.sql) is legacy and must not be run.
3. Copy `.env.example` to `.env.local` and enter the Supabase URL, public anon key, and server-only service-role key for Developer role management. See [GO-LIVE-GUIDE-EN.md](GO-LIVE-GUIDE-EN.md) for the exact dashboard locations and security requirements.
4. Start the app with `npm run dev`, then open http://localhost:3000.

The app requires a signed-in Supabase user. New accounts receive a `profiles` row with the `awam` role. Developers can manage other users' roles from **Konfigurasi → Pengurusan Peranan**. The service-role key is used only by the server API and must never be exposed to the browser.

## Supabase data model

- `profiles`: user display name and server-managed role, keyed by the Supabase Auth user ID.
- `ranches`: active ranch names with their manager and mosque name.
- `sections`: section names and weights.
- `topics`: the former subsection level, with topic names, section mapping, Topic-level marks, order, and `block_based` setting.
- `subtopics`: optional grouping headings inside a Topic. Sub-topics do not have scoring fields.
- `additional_topics`: optional grouping headings inside a Sub-topic. Questions may also remain directly under their Sub-topic.
- `questions`: shared active question catalogue; every Question belongs to one Topic and may optionally belong to a Sub-topic, then an Additional Topic under that Sub-topic. Subjective questions accept multiple text answers in Fasa 1 and are manually marked in Fasa 2. Admins can manage the complete assessment configuration from the app.
- `answers`: one row per user, ranch/block, phase, internal assessor identifier, and question. It stores the profile name of the recorder and the phase-one supervisor name; writes go through the validated `submit_assessment` RPC.
- `juror_topic_assignments`: optional admin-managed juror assignments expanded across every topic in an assigned section. Topics without assignments are excluded from phase-two completion; unassigned jurors can view dashboards and reports but cannot submit phase-two assessments.
- `assessment_submissions` and `assessment_submission_events`: per-Topic submission locks, revisions, reopen reasons, and audit snapshots. Block-based topics are submitted separately per block; topics with `block_based = false` are assessed once and shared across the ranch's blocks.
- `assessment_configuration_versions` and `assessment_configuration_state`: immutable snapshots of admin-managed question, topic, section, and financial configuration. Each submitted assessment and its audit events record the version used; optimistic version checks prevent a stale admin form from overwriting a newer configuration.
- `assessment_section_scores`: server-calculated average of assigned juror scores and block section scores.
- `assessment_phase_block_scores`, `assessment_phase_block_totals`, `assessment_question_scores`, `assessment_ranch_scores`, and `assessment_regional_scores`: SQL-computed per-question percentages, per-phase report values, weighted block totals, ranch averages, and regional averages.

When multiple active ranches have the same non-empty `mosque_name` (case-insensitive, with surrounding and repeated whitespace normalized), Masjid submissions in both phases are also shared across their known blocks. New blocks inherit shared-topic submissions when their first assessment is saved. The schema migrates the former section-level block setting to topics once; apply the updated `supabase/app-schema.sql` before using topic-level settings. Previously submitted records remain locked until a Super User or Developer reopens the shared topic with a reason.

Ranches, sections, topics, questions, weights, answers, ranking scores, and report totals are stored or calculated in Supabase. Client code formats SQL results and displays answer details; it does not calculate assessment scores. The versioned question-score report view uses the question configuration snapshot associated with each submission.

Admin question configuration saves, question CSV imports, financial line-item changes, and financial threshold replacements use database RPCs so each operation is atomic and revalidated at the database boundary. Direct authenticated table writes for those configuration tables are revoked; apply the hardening migration before deploying the updated frontend. Large answer, submission, and question-score query results are fetched in bounded pages rather than relying on the Supabase default row limit.

Admins can choose an icon when generating a section preset; the icon is saved with the section configuration. They can add an optional Additional Topic under a Sub-topic, and leave questions directly under the Sub-topic when no extra grouping is needed. Objective questions accept one selected option and award that option's configured marks; the highest option mark is the question maximum. The same option IDs, labels, and marks are available in CSV import/export. Admins can also permanently delete all assessment sections and their related Topics, Sub-topics, Additional Topics, questions, answers, assignments, submissions, and audit history from the configuration page. Apply the updated `supabase/app-schema.sql` to the Supabase project before using these features. To clear all assessment data while preserving ranches and profiles, back up the database and run [`app-scheme-clear-expt-p-n-r.sql`](app-scheme-clear-expt-p-n-r.sql) manually in the Supabase SQL Editor.

Quantitative questions now record non-negative whole-number answers for reference only. They do not use a total/denominator, earn marks, or affect section weights; Phase 2 shows the Phase 1 answer read-only. Existing quantitative answers are retained, while their old total/parent scoring settings are cleared by the latest SQL migration.

For an existing deployment, take and verify a database backup, then test the unified [`supabase/app-schema.sql`](supabase/app-schema.sql) on staging and apply [`supabase/migrations/20261020000100_atomic_configuration_and_versions.sql`](supabase/migrations/20261020000100_atomic_configuration_and_versions.sql). The unified schema renames legacy subsection tables and columns to Topics, removes the obsolete juror-slot constraint left by that rename, and applies the core schema, policies, RPCs, and report views. If applying incremental changes instead, apply the numbered migrations in order, including [`20261019000100_allow_super_user_reopen_submissions.sql`](supabase/migrations/20261019000100_allow_super_user_reopen_submissions.sql), then the new hardening migration. Review schema seed upserts against the live configuration before applying; do not treat the full schema as a data-reset script. The migration has not been applied to a live Supabase project by this change; validate it against a staging database before production rollout.

## Validation

```bash
npx eslint src/app/page.tsx src/features src/lib/supabase.ts
npm test
npm run build
```

See [GO-LIVE-GUIDE-EN.md](GO-LIVE-GUIDE-EN.md) before deploying or entering real assessment data. The anon key is intended for browser use; never put a Supabase service-role or secret key in a `NEXT_PUBLIC_*` variable or client code.