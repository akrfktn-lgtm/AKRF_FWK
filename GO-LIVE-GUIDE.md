# Panduan A–Z: VS Code → GitHub → Netlify

Panduan ini untuk membawa aplikasi AKRF FELDA Wilayah Kuantan daripada workspace tempatan ke GitHub dan Netlify, termasuk persediaan Supabase Auth serta keselamatan sebelum go-live.

> **Status sekarang: staging dahulu.** Aplikasi kini menggunakan Supabase Auth, RPC untuk penghantaran tervalidasi, tugasan juri di pangkalan data, penghantaran terkunci/audit, serta view SQL untuk skor dan laporan. Jangan masukkan data rasmi sehingga skrip SQL tunggal diuji pada staging dan polisi akses disahkan.

## A. Kenal pasti apa yang sedang dideploy

Struktur semasa ialah Next.js 15 App Router. `src/app/page.tsx` mengurus pintu masuk sesi dan memaparkan workspace penilaian; UI khusus domain dikelompokkan di `src/features/` (assessment, auth, admin, juror dan reports). Primitive UI bersama berada di `src/components/ui/`, manakala helper workflow dan data dikongsi berada di `src/lib/`. Skema dan semua fungsi/view SQL aktif berada dalam `supabase/app-schema.sql`. `supabase/schema.sql` ialah fail legacy dan jangan dijalankan. `package-lock.json` tersedia untuk install yang konsisten. Netlify menyokong Next.js App Router melalui adapter rasmi tanpa perlu menetapkan folder output statik.

Jawapan, konfigurasi dan skor rasmi disimpan atau dikira di Supabase. Browser memaparkan hasil SQL dan jawapan terperinci; ia bukan sumber pengiraan skor rasmi.

## B. Keperluan komputer

- VS Code dan Git untuk Windows.
- Node.js `20.9` atau lebih baharu.
- Akaun GitHub dengan kebenaran membuat repository.
- Akaun Netlify yang boleh menyambung ke GitHub.
- Akaun Supabase untuk projek staging dan production.
- Domain syarikat/organisasi jika mahu URL sendiri.

Semak versi dalam terminal PowerShell:

```powershell
node --version
git --version
npm --version
```

## C. Jalankan dan semak secara lokal

Dari terminal berfolder `D:\AKRF FWK`:

```powershell
npm ci
npm run dev
```

Buka `http://localhost:3000`. Sebelum perubahan dihantar:

```powershell
npx eslint src/app/page.tsx src/features
npm run build
```

Tutup `npm run dev` sebelum menjalankan production build. Next.js dev dan build berkongsi `.next`; menjalankan kedua-duanya serentak boleh merosakkan manifest dev.

## D. Tentukan data dan environment

Bila integrasi Supabase dibuat, browser hanya boleh menerima URL projek dan **publishable key**. Kunci publishable memang public; keselamatan mesti datang daripada Auth, grants dan RLS.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

`SUPABASE_SERVICE_ROLE_KEY` digunakan hanya oleh API pengurusan peranan di server untuk membaca alamat e-mel Auth dan mengemas kini profil bagi Developer yang disahkan. Ia memintas RLS: simpan hanya dalam persekitaran server rahsia (termasuk Netlify), jangan tambah awalan `NEXT_PUBLIC_*`, dan jangan dedahkan dalam kod frontend, GitHub, isu, screenshot atau log.

## E. Pastikan fail rahsia diabaikan Git

Fail `.gitignore` di root mengabaikan `.env*`, `.next`, `node_modules` dan output lokal. Simpan nilai sebenar dalam `.env.local` sahaja. Jangan tambah `.env.local` ke Git.

Sebelum commit, semak:

```powershell
git status --short
```

Jika rahsia pernah masuk commit, padamkannya daripada penggunaan dengan **rotate/revoke dahulu**. Memadam fail dalam commit baharu tidak mengeluarkan secret daripada Git history.

## F. Buat repository GitHub

Semakan workspace mendapati folder ini **belum mempunyai `.git` dan belum ada remote**. Buat repository baru yang kosong di GitHub. Jangan pilih pilihan untuk tambah README, license atau `.gitignore` di GitHub jika mahu push sejarah tempatan tanpa konflik.

Kemudian, dari root projek:

```powershell
git init
git branch -M main
git add .
git diff --cached --check
git status --short
git commit -m "Initial AKRF application"
git remote add origin https://github.com/<ORG-ATAU-USER>/<NAMA-REPO>.git
git push -u origin main
```

Ganti placeholder dengan URL repo sendiri. Sahkan `git status --short` tidak menunjukkan `.env.local`, `node_modules` atau `.next`. Jangan masukkan token/password GitHub dalam URL remote atau dokumen.

## G. Aliran kerja sync harian

1. Tarik perubahan terkini sebelum mula: `git pull --rebase origin main`.
2. Buat branch kerja: `git switch -c feat/nama-perubahan`.
3. Semak aplikasi dan build; periksa `git diff` dan `git status`.
4. Stage fail yang dimaksudkan sahaja: `git add <fail>`.
5. Semak kandungan staged: `git diff --cached`.
6. Commit: `git commit -m "Terangkan perubahan"`.
7. Push branch: `git push -u origin feat/nama-perubahan`.
8. Buka Pull Request di GitHub, semak deploy preview, kemudian merge selepas semua pemeriksaan lulus.

Untuk sync cepat seorang developer, push `main` boleh digunakan, tetapi pull request + checks lebih sesuai untuk branch production.

## H. Lindungi GitHub

- Hidupkan 2FA/passkey pada akaun GitHub.
- Beri akses repo mengikut keperluan minimum; jangan kongsi akaun.
- Lindungi `main`: wajib Pull Request, sekurang-kurangnya seorang reviewer jika pasukan membenarkan, status checks berjaya, perbualan selesai, tiada force-push atau delete.
- Wajibkan review pemilik kod untuk perubahan auth, SQL dan RLS jika ada lebih daripada seorang maintainer.
- Hidupkan secret scanning/push protection jika pelan GitHub menyokongnya.
- Jangan masukkan data sebenar peserta/juri ke issue, PR, fixture atau screenshot awam.

## I. Asingkan projek Supabase

Wujudkan sekurang-kurangnya dua projek: `staging` dan `production`. Asingkan URL, keys, pengguna ujian dan data. Jangan uji migration eksperimen terus pada pangkalan data production.

Aktifkan backup/PITR mengikut pelan dan keperluan organisasi. Hadkan pemilik projek Supabase kepada akaun pentadbir yang dilindungi MFA.

## J. Pasang skema SQL tunggal

Untuk projek Supabase **baharu**, buka **SQL Editor → New query** dan jalankan hanya `supabase/app-schema.sql`. Fail itu mengandungi skema, seed awal, polisi, RPC dan view laporan/ranking. `supabase/schema.sql` ialah legacy dan jangan dijalankan.

Untuk projek sedia ada, buat dan sahkan backup dahulu. Uji [`supabase/app-schema.sql`](supabase/app-schema.sql) yang telah menggabungkan migrasi penamaan semula Sub-section kepada Topic dengan skema semasa. Skrip mengekalkan ID serta jawapan sedia ada, tidak menetapkan Sub-topic atau Additional Topic rekaan pada soalan lama, dan menambah lapisan Additional Topic pilihan. Skema turut menambah `questions.objective_options`; RPC submit dan view skor mengesahkan pilihan tunggal serta menggunakan markah pilihan yang dipilih bagi Fasa 1 dan Fasa 2. RPC, polisi dan view turut dikemas kini. Semak upsert seed terhadap konfigurasi projek sebelum menjalankannya pada staging; jangan jalankan pada production sehingga migrasi dan pemulihan backup disahkan.

Soalan objektif dikonfigurasi di Tetapan Soalan dengan sekurang-kurangnya dua pilihan berlabel dan markah masing-masing. Markah maksimum soalan ditetapkan kepada markah pilihan tertinggi. Import CSV menggunakan lajur `Objective Options` dalam bentuk JSON array, contohnya `[{"id":"a","label":"Pilihan A","score":2},{"id":"b","label":"Pilihan B","score":5}]`.

Jalankan skrip pada staging dahulu. Ia menyemai konfigurasi awal dan boleh mengemas kini seed rancangan/soalan; jangan jalankan semula pada production berisi konfigurasi sebenar tanpa backup serta pelan upgrade yang disemak. Jangan reset pangkalan data production untuk membaiki pemasangan.

## K. Sediakan Supabase Auth

Untuk admin dan juri gunakan akaun Supabase Auth individu, sebaiknya e-mel organisasi + kata laluan dan pengesahan e-mel. Matikan pendaftaran awam jika akaun hanya dicipta oleh pentadbir. Buat akaun melalui jemputan/proses terkawal; jangan kongsi satu akaun admin atau juri.

Tetapkan Site URL kepada domain production. Tambah redirect URL yang tepat untuk production dan localhost; tambah preview URL Netlify yang diperlukan dengan corak sesempit mungkin. Jangan benarkan redirect wildcard terbuka. Konfigurasikan SMTP tersuai sebelum bergantung kepada e-mel production; servis e-mel ujian mempunyai had.

Sediakan aliran log masuk, log keluar, pautan reset password, pengesahan e-mel, expired-session dan halaman akses ditolak. Jangan tunjuk sama ada sesuatu e-mel wujud ketika reset password.

## L. Peranan dan tugasan juri mengikut Seksyen

Simpan peranan dalam jadual server-owned, contohnya `public.user_roles(user_id, role)` dengan role `admin` dan `juror`. Jangan gunakan `user_metadata` yang boleh diubah pengguna sebagai sumber authorization. Cipta/ubah peranan hanya melalui proses admin yang dilindungi atau migration/service operasi terkawal.

Admin boleh menguruskan tugasan juri mengikut Seksyen melalui konfigurasi aplikasi; tugasan adalah pilihan dan Seksyen boleh dibiarkan tanpa juri. Tugasan Seksyen terpakai kepada semua Topik dalam Seksyen tersebut; RPC dan pangkalan data mengesahkan tugasan sebelum juri menghantar markah. Juri tanpa tugasan masih boleh melihat dashboard dan laporan, tetapi tidak boleh menghantar penilaian Fasa 2. Topik tanpa juri tidak menghalang Fasa 2 daripada lengkap; semua juri yang ditugaskan perlu menghantar penilaian. Skor akhir bagi soalan ialah purata markah semua juri yang telah menghantar penilaian.

## M. Sambungkan Supabase kepada Next.js

Untuk Next.js server-side session gunakan `@supabase/ssr` bersama `@supabase/supabase-js`, dengan client browser dan server yang berasingan. Next.js projek ini ialah versi 15, jadi ikut arahan semasa Supabase untuk middleware pada Next.js 15, bukan contoh `proxy.ts` khusus Next.js 16.

Buat client berasingan bagi setiap request server, urus session melalui cookies dan refresh token middleware. Untuk keputusan authorization server, sahkan identiti menggunakan `supabase.auth.getClaims()` atau `getUser()`; jangan mempercayai objek `getSession()` sahaja daripada cookie. Letakkan pemeriksaan role pada server action/route dan database, bukan sekadar sembunyikan menu UI.

## N. Lindungi login dan sesi

- Semua route/action yang membaca atau menulis data peribadi mesti memeriksa sesi dan role di server.
- Gunakan cookies SSR Supabase dengan tetapan secure/HTTP-only/same-site yang disyorkan package.
- Jangan cache respons authenticated merentas pengguna/CDN; hormati cache headers daripada auth middleware.
- Tambah had cubaan/rate limit dan CAPTCHA bagi endpoint awam berisiko; jangan bergantung pada validasi borang browser sahaja.
- Paparkan mesej ralat generik untuk login gagal dan reset password.
- Admin patut mempunyai MFA; gunakan MFA untuk akaun berhak tinggi jika polisi organisasi memerlukannya.

## O. Tetapkan matriks akses sebelum menulis policy

Tulis jadual keputusan akses yang dipersetujui pemilik sistem. Baseline yang disyorkan:

| Data/tindakan | Pelawat `anon` | Juri `authenticated` | Admin |
|---|---|---|---|
| Baca senarai rancangan/blok aktif, seksyen, topik, soalan aktif | Baca sahaja jika benar-benar public | Baca | Baca/urus |
| Hantar Fasa 1 | Terhad melalui RPC validasi; atau login jika perlu audit identiti | Ikut polisi operasi | Boleh semak |
| Baca jawapan/assessment individu | Tidak | Hanya rekod yang diperlukan untuk penugasan | Akses audit terkawal |
| Hantar Fasa 2 | Tidak | Hanya topik yang ditugaskan dan selepas Fasa 1 lengkap | Tidak patut menyamar sebagai juri |
| Ubah soalan/pemberat/pengguna/role | Tidak | Tidak | Hanya admin yang sah |

Jika penilaian kendiri perlu anonymous, jangan dedahkan senarai atau jawapan blok lain. Gunakan RPC server/database untuk create submission sahaja, hadkan payload dan rate-limit.

## P. RLS: jangan guna policy demo sebagai polisi production

`app-schema.sql` mengaktifkan RLS, mengehadkan pengurusan konfigurasi kepada admin dan mengarahkan penghantaran melalui RPC. RPC/view ialah sempadan keselamatan penting; uji akses menggunakan `anon`, pengguna awam, juri dan admin pada staging. Pastikan grants view dan polisi RLS sepadan dengan keperluan organisasi sebelum menggunakan data sebenar.

Sebelum live:

1. Semak grants dan revoke operasi yang tidak diperlukan untuk `anon` dan `authenticated`.
2. Beri hanya `SELECT` untuk lookup table yang memang public.
3. Tukar submit Fasa 1 terus ke table kepada RPC terkawal jika public; sahkan block, soalan aktif, nilai baseline dan had data di server.
4. Juri hanya boleh melihat/menulis rekod yang dibenarkan; semak role serta mapping `juror_topics` dalam policy/RPC.
5. Admin boleh mengurus tetapan hanya selepas role disahkan server-side/database.
6. Uji `SELECT`, `INSERT`, `UPDATE`, `DELETE` secara berasingan untuk anon, juri, juri lain, admin dan pengguna tanpa assignment.
7. Tetapkan view score/leaderboard dengan `security_invoker = true` jika sesuai dan uji aksesnya; atau revoke akses view kepada client roles.
8. Index semua foreign key dan kolum yang digunakan policy.

Jangan cipta `SECURITY DEFINER` secara sambil lewa. Letakkan fungsi sebegitu di schema bukan-exposed, tetapkan `search_path = ''`, kelayakkan nama objek, revoke execute daripada `public` dan beri execute minimum.

## Q. Grain penilaian

`answers` menyimpan satu rekod bagi soalan, manakala `assessment_submissions` mengunci penghantaran mengikut fasa, juri dan topik. Tetapan `topics.block_based` menentukan sama ada penghantaran itu khusus kepada blok atau dikongsi merentas semua blok dalam rancangan; topik yang dikongsi disalin ke rekod blok supaya status lengkap dan laporan kekal konsisten. Skema memindahkan nilai lama `sections.block_based` ke setiap topik sekali sahaja. `assessor_slot` ialah pengenal dalaman juri bagi mengekalkan rekod sedia ada; ia bukan peranan atau slot yang perlu ditetapkan admin. `submit_assessment` mendapatkan identiti melalui `auth.uid()` dan mengesahkan tugasan Topik sebelum menulis jawapan.

## R. RPC transaksi dan pengiraan markah

RPC `submit_assessment` menyimpan satu kumpulan soalan dan status lengkap secara atomik. Ia:

- Memeriksa sesi, role, assignment PIC, block aktif dan prerequisite Fasa 1.
- Mengesahkan semua soalan bagi topik itu; nilai integer/range, quantitative baseline/verified count dan grade 1–5.
- Menghalang soalan luar seksyen/topik daripada masuk ke submission.
- Menulis jawapan dan submitted timestamp bersama-sama; rollback seluruh transaksi jika satu item tidak sah.
- Mengira skor daripada data database/config, bukan skor total yang dipercayai daripada browser.
- Mencegah perubahan selepas lock/finalize mengikut polisi audit.

Status lengkap serta markah rasmi datang daripada database. RPC `reopen_assessment_submission` hanya boleh digunakan oleh Super User atau Developer, memerlukan sebab dan menyimpan snapshot audit.

## S. Cipta akaun dan tetapan tempatan

Salin `.env.example` kepada `.env.local` dan isi URL serta anon/publishable key Supabase staging. Jangan simpan secret sebenar dalam `.env.example`.

```powershell
Copy-Item .env.example .env.local
```

`.env.local` tidak boleh commit. Jangan tambah service-role atau secret key ke source code atau pemboleh ubah `NEXT_PUBLIC_*`.

## T. Sambungkan repo ke Netlify

1. Push kod yang telah diluluskan ke GitHub.
2. Di Netlify pilih **Add new site → Import an existing project**.
3. Beri Netlify akses hanya kepada repo AKRF yang diperlukan.
4. Pilih branch production `main`.
5. Build command: `npm run build`.
6. Jangan set publish directory kepada `out` untuk aplikasi Next.js App Router/SSR ini; biarkan Netlify mengesan Next.js adapter secara automatik.
7. Jangan pin plugin adapter lama melainkan ada sebab keserasian yang diuji.

Netlify akan membuat Deploy Preview bagi Pull Request dan deploy production selepas perubahan masuk branch production, tertakluk kepada konfigurasi repo.

## U. Masukkan environment variables Netlify

Di Site configuration → Environment variables, masukkan nilai berasingan mengikut konteks:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Secret server sahaja jika reka bentuk benar-benar memerlukannya, contohnya `SUPABASE_SECRET_KEY` — **jangan expose ke browser**.

Masukkan secrets melalui UI/CLI/API Netlify, bukan `netlify.toml` atau Git. Netlify build tidak membaca `.env.local` daripada komputer developer. Selepas mengubah env vars, trigger deploy baharu. Gunakan project/key staging pada Deploy Preview dan production project/key pada production context.

## V. Deploy preview dan uji sebelum production

Setiap Pull Request patut menghasilkan preview. Uji sekurang-kurangnya:

- Login sah, login gagal, logout, refresh session dan reset password.
- Tanpa login: tiada akses admin/juri atau data assessment peribadi.
- Juri A tidak boleh membaca/menulis assignment Juri B melalui URL/API/SQL client.
- Juri tanpa assignment ditolak oleh server/RLS, bukan hanya UI.
- Admin boleh urus data, juri/pelawat tidak boleh.
- Fasa 2 ditolak apabila Fasa 1 belum lengkap.
- Kuantitatif dan skor tetap betul, duplicate submission ditangani, setiap topik tersimpan berasingan.
- RLS tests lulus terhadap staging dan tiada secret dalam deploy logs/bundle.

Jangan gunakan data peserta sebenar di preview awam; guna data sintetik.

## W. Domain dan URL Auth

Tambah domain di Netlify dan sahkan DNS mengikut arahan dashboard. Aktifkan HTTPS/sertifikat, set domain canonical dan semak redirect HTTP→HTTPS. Kemas kini Supabase Site URL, Auth redirect URLs, e-mel confirmation/reset templates, CORS/allowed origins jika dikonfigurasi.

Uji pautan confirmation/reset dari e-mel pada domain sebenar serta mobile. Elakkan open redirect: hanya benarkan laluan/domain yang diluluskan.

## X. Operasi, log dan backup

Sebelum launch, tetapkan pemilik on-call dan cara lapor insiden. Pantau Netlify deploy/function logs dan Supabase Auth/Postgres logs tanpa merekod password, token, payload peribadi atau full PII.

Uji proses backup dan restore pada staging. Tetapkan tempoh simpanan, siapa boleh eksport data, proses tutup akaun juri, dan prosedur revoke session/credential. Dokumentasikan rollback deploy Netlify dan forward-fix migration database; rollback code tidak semestinya rollback schema/data.

## Y. Selepas setiap release

Pantau error rate, Auth sign-in, submission gagal, masa respons RPC, penggunaan database dan aduan pengguna. Bandingkan skor sample yang dikira manual dengan sistem. Sediakan cara menghentikan sementara submission jika terdapat keputusan skor atau kebocoran yang mencurigakan.

## Z. Gate Go-Live: semua mesti ditanda

 - [ ] Production dan staging Supabase dipisahkan; `app-schema.sql` diuji pada staging dan boleh diaudit.
- [ ] Signup, email confirmation, password reset, MFA/2FA admin dan recovery diuji.
- [ ] Setiap admin/juri mempunyai akaun individu; role tidak boleh diubah sendiri.
- [ ] Mapping PIC jika perlu dikuatkuasakan berada di database/server, bukan client.
- [ ] Penghantaran dan skor rasmi datang daripada database/RPC/view SQL.
- [ ] Grants, RLS, views dan RPC diuji untuk anon, juri tanpa assignment, juror lain dan admin.
- [ ] Fasa 1 prerequisite, had angka, skor dan uniqueness diperiksa secara atomik di database.
- [ ] Netlify env vars betul mengikut deploy context; tiada secret dalam browser bundle.
- [ ] Deploy Preview, domain, HTTPS, Auth redirect dan e-mel diuji.
- [ ] Backup/restore, log/alert, owner operasi dan prosedur rollback diketahui.
- [ ] Pemilik data/organisasi meluluskan retention, privacy notice dan go-live.

**Jangan tandakan go-live jika mana-mana item keselamatan utama di atas belum selesai.** Membuat deploy berjaya tidak bermaksud sistem sudah selamat menerima penilaian sebenar.

## Rujukan rasmi

- [Next.js on Netlify](https://docs.netlify.com/frameworks/next-js/overview/)
- [Netlify environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/)
- [Supabase Auth SSR dengan Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase password Auth](https://supabase.com/docs/guides/auth/passwords)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning)
