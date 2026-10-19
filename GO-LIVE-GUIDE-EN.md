# AKRF Go-Live Guide

This guide covers Supabase setup, local configuration, and Netlify deployment for the current application. Do not use real assessment data until the production security checks below have been completed.

## 1. Create a Supabase project

Create separate Supabase projects for staging and production. For a new project, open **SQL Editor → New query**, paste [`supabase/app-schema.sql`](supabase/app-schema.sql), review it, and run this single script. [`supabase/schema.sql`](supabase/schema.sql) is legacy and must not be run.

The script creates the core assessment tables, enables row-level security, creates profiles on signup, seeds the initial ranch/question configuration, and includes server-side validation, juror assignments, locked submissions, audit history, SQL scoring, ranking, and report views. It is intended for a new/empty project. Do not run the full seed script on a live database without a verified backup and reviewed upgrade plan, because its seed statements may update ranches, sections, topics, and questions.

For an existing deployment, first make and verify a database backup. Test the unified [`supabase/app-schema.sql`](supabase/app-schema.sql) on staging. It renames the existing subsection tables and columns to Topics before applying the current schema, keeps IDs, leaves migrated Questions without artificial Sub-topics or Additional Topics, adds the optional Additional Topic level, and migrates the former section-level block setting to each Topic once. It also adds `questions.objective_options`; the submission RPC and scoring views validate single-choice answers and use the selected option's configured marks in both phases. `topics.block_based` now controls whether a Topic is assessed per block or once and shared across all blocks in a ranch. Review its seed upserts against the live configuration; do not apply it to production until the migration and backup restore have been verified.

Configure objective questions in Question Settings with at least two labeled options and a mark value for each. The question maximum is derived from the highest option mark. CSV import/export uses an `Objective Options` JSON array, for example `[{"id":"a","label":"Option A","score":2},{"id":"b","label":"Option B","score":5}]`.

In **Authentication → Providers → Email**, enable email/password sign-in. Configure email confirmation and password policy for your organization. In **Authentication → URL Configuration**, set the Site URL and exact redirect URLs for localhost and your deployed domain.

## 2. Configure the local application

Open **Project Settings → API** (sometimes shown as **Project Settings → API Keys**). Copy:

- **Project URL** into `NEXT_PUBLIC_SUPABASE_URL`
- The **anon / publishable public key** into `NEXT_PUBLIC_SUPABASE_ANON_KEY`

In the project root, copy `.env.example` to `.env.local` and replace the example values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Restart the dev server after changing environment variables. `.env.local` is local-only and must not be committed. The public anon/publishable key is designed for browser use; RLS is required. `SUPABASE_SERVICE_ROLE_KEY` is used only by the server-side Developer role-management API to read Auth email addresses and update profiles. It bypasses RLS: keep it in server environment settings only, never prefix it with `NEXT_PUBLIC_`, and never expose it in client code, logs, or Git.

```powershell
npm install
npm run dev
```

Open http://localhost:3000, create a test account, and verify that its profile is created. For email-confirmation projects, confirm the email before signing in.

## 3. Assign trusted roles

Every new profile starts as `awam` (mapped to the Rancangan role). For the first trusted Developer account, set its role once from the Supabase SQL Editor, replacing the email address:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'admin@example.com');
```

After that, a Developer can manage the Rancangan, Juri, Super User, and Developer roles under **Konfigurasi → Pengurusan Peranan**. The API validates the signed-in user's Developer role and prevents changing the caller's own role. Use individual accounts; do not share credentials. After the workflow migration, open **Konfigurasi → Tugasan juri mengikut Seksyen** and assign one or more juror accounts to each section. Every topic in a section inherits that section's juror assignment. The assignment is checked by the server RPC. Submitted topics are locked; a Super User or Developer can reopen one with a reason, and the old answer snapshot and reason are retained in the audit table.

## 4. Deploy to Netlify

1. Push the reviewed repository to GitHub. Check that `.env.local`, `.next`, and `node_modules` are not tracked.
2. In Netlify, choose **Add new site → Import an existing project**, select the repository, and use `main` as the production branch.
3. Set the build command to `npm run build`. Let Netlify detect the Next.js framework; do not set a static publish directory for this App Router application.
4. In **Site configuration → Environment variables**, add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for the appropriate deploy context. Mark the service-role value as secret if the platform supports it.
5. Use staging project values for Deploy Previews and production values for the production deploy. Trigger a new deploy after changing variables.
6. Add the Netlify domain to Supabase Auth's allowed redirect URLs. Add the custom domain and HTTPS before using it for production sign-in.

The project URL, public anon key, and server-only service-role key are entered in `.env.local` for local development and Netlify's **Site configuration → Environment variables** for hosted deployments. Do not put actual keys in this guide or `.env.example`.

## 5. Test before launch

- Run `npx eslint src/app/page.tsx src/features src/lib/supabase.ts`, `npm test`, and `npm run build`.
- Create two test users. Confirm each user sees their own profile and answers, and cannot read another user's phase-two answers through the API.
- Confirm jurors can read the phase-one baseline required for verification, but cannot insert or update answers with another user's ID.
- Confirm only an `admin` can insert, update, or archive questions.
- Confirm only an `admin` can change section weights, sections, and topics.
- Confirm authenticated users can read active ranch records and only admins can edit the ranch directory.
- Verify question edits, answer updates, duplicate submissions, quantitative bounds, and sign-out against staging.
- Verify unassigned jurors can view dashboards and reports but are rejected from phase-two submission, sections may have no assigned jurors, and all assigned jurors must submit before phase two is complete. Also verify scores average submitted juror assessments, duplicate submissions stay locked, admin reopening requires a reason, and correction revisions appear in the audit table.
- Compare SQL block totals, ranch averages, report summaries, and rankings for both phases using synthetic blocks with different completion counts.
- Inspect browser bundles and deployment logs to ensure no service-role or secret key is present.
- Use synthetic data in staging and Deploy Previews.

## 6. Production limitations

RLS protects profile and answer ownership, and restricts question management to admins. Submission validation, phase completion, section-based juror assignments, average juror scores, weighted totals, and ranch/regional averages run through database RPCs and views. The browser only formats these SQL results and renders answer details. Ranch and topic configuration still needs an operational migration/backup plan. Test policies with `anon`, ordinary users, jurors, and admins before using official records.

Keep staging and production separate, apply reviewed migrations, take backups, and document a restore procedure. A successful Netlify deploy alone is not a security sign-off.