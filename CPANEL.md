# cPanel deployment

BusinessOS is one Node.js process: the API serves `/api/v1` and the built React
application (`dist`) from the same HTTPS origin. On cPanel this process runs under
Passenger ("Setup Node.js App" / "Web Apps"), so there is one origin, one session
cookie and no CORS configuration.

The server keeps its workspace data in PostgreSQL and its sessions, login throttling
and rate limits in Redis, so cPanel alone is not enough. cPanel hosts the Node process;
PostgreSQL and Redis come from cPanel itself when the host offers them, or from a
managed provider over TLS. Most shared cPanel hosts do not offer Redis, and many do not
offer PostgreSQL either; the recommended layout is therefore cPanel for the Node
process plus managed PostgreSQL and Redis.

Everything below is written for the cPanel user, without SSH: dependency installation
and builds happen through **Setup Node.js App > Run JS script**, which runs the helpers
in `scripts/`.

## 1. Requirements checklist

| Requirement | Why it is needed | Where to check it in cPanel |
| --- | --- | --- |
| Node.js **22.18 or newer** (24 recommended) | The repository runs its TypeScript server directly; Node strips the types at startup from 22.18. Older versions abort with `unsupported_node_version`. | Setup Node.js App > Node.js version |
| Passenger support (`mod_passenger` / "Web Apps") | Runs the long-lived API process and reverse-binds its socket. | Presence of "Setup Node.js App" or "Web Apps" |
| Valid TLS certificate | `NODE_ENV=production` requires `COOKIE_SECURE=true` and HTTPS origins; login cookies are `Secure`. | SSL/TLS Status (AutoSSL) |
| PostgreSQL 13 or newer | Workspace, audit, journal, module and finance tables (42 migrations). | PostgreSQL Databases, or a managed provider |
| A PostgreSQL role that is **not** a superuser and has **no** `BYPASSRLS` | The API refuses to start with an administrator role because tenant row security would be meaningless. | Query below |
| Redis 6 or newer with `EVAL` support | Sessions, login throttling, rate limits. | Redis feature, or a managed provider |
| Outbound access to your database hosts | The Node process connects out to PostgreSQL/Redis (TLS on 5432/6379 or provider ports). | Ask your host; some block outbound ports |

Run this once against your database to confirm the role is acceptable:

```sql
SELECT current_user AS role, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
```

Both attributes must be `false`. On a managed provider, create a dedicated role when the
default one is an administrator:

```sql
CREATE ROLE businessos_app LOGIN PASSWORD 'use-a-long-random-password';
ALTER ROLE businessos_app NOSUPERUSER NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO businessos_app;
```

Run the migrations **as that role** (the application does not run migrations at startup,
and the tables must be owned by the role that serves the API so `FORCE ROW LEVEL SECURITY`
stays effective).

## 2. Directory layout (do not expose the source or `.env`)

| Purpose | Path | Notes |
| --- | --- | --- |
| Application root | `/home/<user>/businessos` | Holds `app.cjs`, `server/`, `src/`, `dist/`, `scripts/`, `node_modules/`, optional `.env`. Keep it **outside** `public_html`. |
| Document root | `/home/<user>/businessos/public_html` | Empty folder used only so Passenger can claim the whole URL. |

If the domain's document root is the application root itself, Apache can serve `.env`,
`server/*.ts`, `package-lock.json` and `node_modules` to anyone. Never do that. If your
host forces the document root to be the account's `public_html`, keep the application
somewhere else (`/home/<user>/businessos`) and point the application URL at the domain.

## 3. Get the code onto the account

### Option A - cPanel Git Version Control (recommended)

1. cPanel > Git Version Control > Create.
2. Clone URL: `https://github.com/subodhkumar86/BUSINESSOS.git`
3. Path: `businessos` (this becomes `/home/<user>/businessos`).
4. Branch: `main`. Create.
5. For later releases use **Update from Remote** on the same page, then repeat sections 5, 6 and 7 (build, migrate, restart and verify).

The helpers referenced below must exist in the branch you clone. From your workstation, commit
and push `app.cjs`, `CPANEL.md`, `cpanel.env.example` and `scripts/cpanel-*.cjs` (they are new
files, and `scripts/cpanel-build.cjs` / `scripts/cpanel-migrate.cjs` were never committed
before), otherwise `Run JS script` will not find them:

```powershell
git add app.cjs CPANEL.md cpanel.env.example scripts/cpanel-build.cjs scripts/cpanel-migrate.cjs scripts/cpanel-seed.cjs scripts/cpanel-doctor.cjs
git commit -m "Add cPanel Passenger deployment"
git push origin main
```

### Option B - upload a prepared bundle

Build locally, then upload only what the runtime needs (leave `node_modules` out; the
build helper installs it on the server):

| Path | Needed at runtime |
| --- | --- |
| `app.cjs`, `package.json`, `package-lock.json` | Yes |
| `server/` (including `server/migrations/*.sql`) | Yes |
| `src/` (the server imports `src/domain.ts`, `src/inventory.ts`, `src/reporting.ts`, `src/types.ts`) | Yes |
| `scripts/migrate.ts`, `scripts/cpanel-*.cjs` | Yes |
| `dist/` (Vite build) | Yes, unless you build on the server |
| `node_modules/`, `tests/`, `playwright.config.ts`, `compose*.yaml`, `Dockerfile` | No |

```powershell
npm.cmd ci
npm.cmd run build
Compress-Archive -Path app.cjs,package.json,package-lock.json,server,src,scripts,dist -DestinationPath businessos-cpanel.zip
```

Upload the archive with File Manager **into `/home/<user>/businessos`** and choose
Extract, then delete the archive.

## 4. Create the Node.js application

In **cPanel > Setup Node.js App > Create Application** (or **Web Apps**) use exactly these
values:

| Field | Value |
| --- | --- |
| Node.js version | `24.x`, or `22.x` when the installed build is 22.18 or newer |
| Application mode | `Production` |
| Application root | `businessos` (that is `/home/<user>/businessos`) |
| Application URL | `demo.businessos.swad.cloud` with base path `/` (your real domain) |
| Application startup file | `app.cjs` |

`app.cjs` is the Passenger entry point. It pins the working directory to the application
root, loads `.env` when present, verifies that the selected Node version can run
TypeScript, defaults `NODE_ENV=production` for Passenger runs, and then imports
`server/index.ts`. Passenger ignores the port passed to `listen()` and reverse-binds its
own socket, so **do not set `PORT` or `API_HOST`** in the environment variables.

### Environment variables

Add these in the application's **Environment variables** section (or place the same values
in `/home/<user>/businessos/.env`, copied from `cpanel.env.example`; cPanel environment
variables take precedence over the file):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Managed PostgreSQL URL, for example `postgresql://businessos_app:...@db.example.com:5432/businessos?sslmode=require` |
| `REDIS_URL` | Managed Redis URL with TLS, for example `rediss://default:...@redis.example.com:6379` |
| `APP_ORIGIN` | `https://demo.businessos.swad.cloud` - exact origin, HTTPS, **no trailing slash**, no path. Comma-separate additional origins (for example a staging domain). |
| `COOKIE_SECURE` | `true` (required in production) |
| `COOKIE_SAME_SITE` | `strict` (use `none` only for a split deployment where the SPA is on another domain) |
| `DEEPSEEK_API_KEY` | Optional, server-side only, enables `/api/v1/ai/ask` enrichment |
| `TENANT_CONNECTOR_ENCRYPTION_KEY` | Optional, needed only when tenants store provider credentials in Settings. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

The startup validation rejects a production process with a non-HTTPS `APP_ORIGIN`, a
missing `COOKIE_SECURE=true`, or an origin containing a path, query or credentials.

## 5. Install dependencies and build the SPA

cPanel installs dependencies with `NODE_ENV=production`, which skips devDependencies.
Vite, TypeScript and Tailwind are devDependencies, so run the project helper instead of
relying only on **Run NPM Install**:

**Run JS script > `scripts/cpanel-build.cjs`**

It runs `npm install --include=dev` and then `npm run build` (type check + Vite build),
and reports `Build finished. dist/index.html should now exist.`

## 6. Apply the database migrations (before the first sign-in)

**Run JS script > `scripts/cpanel-migrate.cjs`**

It runs `npm run db:migrate` against `DATABASE_URL` and applies the 42 versioned
migrations in `server/migrations/`. The API deliberately never migrates on startup; it
refuses to serve requests until migration `003_stock_ledger.sql` is present.

## 7. Restart and verify

1. **Restart** the application in Setup Node.js App.
2. Open `https://<your-domain>/api/v1/health`. It must return
   `{"ok":true,"database":"postgresql","sessions":"redis"}`.
   A `500` with `Service unavailable. Check PostgreSQL and Redis.` means one of the two
   connections is failing - see section 11.
3. **Run JS script > `scripts/cpanel-doctor.cjs`** for a full report: Node version, SPA
   build, environment values (masked), PostgreSQL role attributes, migration count and a
   Redis `PING`.
4. Open `https://<your-domain>/` and register the tenant owner, or sign in with an account
   you created. Registration is rate limited to 20 attempts per minute per IP.
5. Confirm the session cookie is `Secure; HttpOnly; SameSite=Strict` in your browser's
   developer tools. If the cookie is missing, HTTPS is not active for the domain.

If `/` returns the default cPanel page, a `403`, or a directory listing, see
section 12 ("The default page or 403 appears instead of the application").

## 8. Optional: load the documented demo tenants

**Run JS script > `scripts/cpanel-seed.cjs`**

This runs `npm run db:seed-demo` and creates the three documented demo workspaces with one
account per role (`DemoBusinessOS!2026` / `DemoRoleBusinessOS!2026`). Run it only on a demo
or staging account: it writes sample financial data. Change `DEMO_PASSWORD` and
`DEMO_ROLE_PASSWORD` in the environment variables first if the workspace is reachable from
the internet.

## 9. Updating a live deployment

1. cPanel > Git Version Control > **Update from Remote** (or upload the new files).
2. **Run JS script > `scripts/cpanel-build.cjs`** to refresh dependencies and the SPA.
3. **Run JS script > `scripts/cpanel-migrate.cjs`** for any new migrations.
4. **Restart** the application and re-check `/api/v1/health`.

There is no zero-downtime restart on cPanel: requests during a restart briefly return
`503`/`500`. If the host supports it, run step 4 outside business hours.

## 10. Alternative: let Apache/LiteSpeed serve the SPA

If you prefer static files to be served by the web server instead of the Node process, put
the Vite build in the document root and mount only the API on the Node application
(Application URL base path `/api`). BusinessOS routes on the full path (`/api/v1/...`),
which is what Passenger passes through. Add this to the document root's `.htaccess`
**below** the Passenger block that cPanel writes, so deep links such as `/invoices` still
load the SPA:

```apache
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/api/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

Copy the contents of `dist/` (not the folder) into the document root after every build,
then keep `https://<domain>` in `APP_ORIGIN` (the API and SPA stay on one origin, so
`COOKIE_SAME_SITE=strict` remains correct).

## 11. CloudLinux + LiteSpeed shared hosts (verified on a live cPanel account)

Most cPanel accounts with Node.js support run **CloudLinux's Node.js Selector on LiteSpeed (LSWS)**, not Phusion Passenger on Apache. Behaviour differs in four ways that matter:

| Behaviour | Consequence |
| --- | --- |
| LiteSpeed loads the startup file with `require()` (`/usr/local/lsws/fcgi-bin/lsnode.js`) | A startup file that is ESM with top-level await fails with `ERR_REQUIRE_ASYNC_MODULE`. **Always point Application startup file at `app.cjs`**, never at `server/index.ts` (the API entry point awaits `createApp`). |
| The Node binary comes from a per-application virtualenv: `~/nodevenv/<domain>/<version>/bin/node`, referenced by `PassengerNodejs` in the host-written block | Choose the Node version in the Node.js screen (24 is what the Docker and CI images use). Confirm the version by reading `.htaccess` in the application URL's document root. |
| Dependencies are not installed automatically | Run **Run NPM Install** in the Node.js App screen (or `scripts/cpanel-build.cjs`). Without `node_modules`, startup fails with `Cannot find package 'pg'`. |
| The Passenger block is written to the **Application URL's** document root, which may differ from the application root | If you pick the wrong Application URL, the app is served on the wrong domain and your real domain returns 404. Read the host-written `.htaccess` to see which domain currently owns the app. |

Two things to check on such a host:

```bash
# Which domain and startup file currently own the app?
cat ~/<application-url-document-root>/.htaccess   # look for PassengerAppRoot / PassengerStartupFile / PassengerNodejs
# The exact startup error
cat ~/<application-root>/stderr.log
```

`stderr.log` in the application root is the fastest diagnosis: it holds the last startup failure (missing modules, invalid environment values, `ERR_REQUIRE_ASYNC_MODULE`).

Environment values on these hosts come from the Node.js screen and are injected for the app and for `Run JS script`. `app.cjs` additionally loads `<app root>/.env` **without overriding** injected values, so an existing `.env` keeps working, and a host-provided `PORT` still wins over `PORT` in the file.

### Watch out: the document root is the application root

CloudLinux accounts commonly create subdomains whose document root equals the application root (for example `/home/<user>/demo.businessos.swad.cloud`). Because the web server serves static files and directory listings before any request reaches Node:

- `https://<domain>/package.json`, `/server/app.ts`, `/src/App.tsx`, `/stderr.log`, `/businessos_deploy.zip` and every migration `.sql` become publicly downloadable.
- `https://<domain>/` shows "Index of /" when there is no `index.html`.
- `.env` is usually blocked by a server-wide rule (HTTP `403`), but never rely on that.

Fix it by either changing the subdomain's document root to a subfolder of the application root (`.../public`, which already holds only `favicon.svg` and `icons.svg`), or by adding the hardening `.htaccess` from section 16. Verify afterwards:

```bash
curl -o /dev/null -s -w '%{http_code}\n' https://<domain>/server/app.ts   # expect 404
curl -o /dev/null -s -w '%{http_code}\n' https://<domain>/                # expect the app, not "Index of /"
```

## 12. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `unsupported_node_version` in the log, or the app aborts immediately | The selected Node.js build is older than 22.18. Pick `24.x`, or a `22.x` build that is 22.18 or newer, and restart. |
| `Set DATABASE_URL, REDIS_URL and APP_ORIGIN in .env` on startup | The variables are missing. Add them in the application's Environment variables section (or `.env`), then restart. |
| `Production requires COOKIE_SECURE=true`, "APP_ORIGIN values must use HTTPS", or "APP_ORIGIN must contain comma-separated absolute origins only" | Fix the values: `COOKIE_SECURE=true`, `https://` origins, no trailing slash, no path, no credentials inside the URL. |
| `API requires a non-superuser PostgreSQL role without BYPASSRLS` | The `DATABASE_URL` role is an administrator. Create a normal login role (section 1) and run the migrations with it. |
| `Database migrations are pending. Run npm run db:migrate.` | Run `scripts/cpanel-migrate.cjs`, then restart. |
| Sign-in succeeds but later requests return `403 Session verification failed` | HTTPS is not active or the browser is not sending the `Secure` cookie. Enable AutoSSL and force HTTPS for the domain. |
| `403 Request origin is not allowed` | `APP_ORIGIN` does not match the browser origin exactly. Add the scheme (`https://`) and the exact host, and comma-separate extra origins. |
| `500 Service unavailable. Check PostgreSQL and Redis.` | Outbound connection failure, wrong credentials, or missing TLS (`?sslmode=require` for PostgreSQL, `rediss://` for Redis). Run `scripts/cpanel-doctor.cjs`. |
| `npm run build` fails with "vite: not found" or "tsc: not found" | Dependencies were installed without devDependencies. Use `scripts/cpanel-build.cjs`, which passes `--include=dev`. |
| The build is killed (memory or timeout) on the host | Build locally (`npm.cmd ci && npm.cmd run build`) and upload `dist/` instead of building on the server. |
| `Error: http.Server.listen() was called more than once` | Something started a second HTTP listener. BusinessOS starts exactly one; remove any extra proxy code you added to `app.cjs`. |
| Passenger reports "startup file ... not found" | Set Application startup file to `app.cjs` and confirm the file exists in the application root. |
| `ERR_REQUIRE_ASYNC_MODULE: require() cannot be used on an ESM graph with top-level await` | The host loads the startup file with `require()` (LiteSpeed/`lsnode.js`). Set Application startup file to `app.cjs`; never use `server/index.ts` directly. |
| `Cannot find package 'pg'`, `'redis'` or `'zod'` in `stderr.log` | `node_modules` has not been installed. Run **Run NPM Install** in the Node.js App screen (or `scripts/cpanel-build.cjs`), then restart. |
| HTTP `503` from the host on the app URL | The application process failed to start. Read `<app root>/stderr.log`, fix the cause, then **Restart**. |
| `/server/app.ts`, `/package.json`, `/stderr.log` download and `/` shows "Index of /" | The application root is also the document root. Move the document root to `public`, or add the hardening `.htaccess` from section 16. |
| The app answers on the wrong domain (or your domain returns `404` while another domain returns `503`) | The Application URL in the Node.js screen does not match your domain. Edit it (or delete and re-create the application) so the Application URL is the domain in `APP_ORIGIN`. |
| The default page or `403` appears instead of the application | Remove any `index.html`/`index.php` left by cPanel in the document root (a `DirectoryIndex` file shadows Passenger), and confirm the `.htaccess` cPanel wrote contains `PassengerAppRoot` pointing at the application root and `PassengerStartupFile app.cjs`. |
| The process goes idle and the next request is slow | Passenger idles application processes out. Raise the application's idle timeout, or accept the cold start. |
| Where are the logs? | The app writes structured JSON log lines to stdout/stderr. cPanel's Node.js app screen and `/home/<user>/businessos/stderr.log` hold the startup errors. |

## 13. Security checklist before going live

- [ ] HTTPS active, HTTP redirects to HTTPS, `COOKIE_SECURE=true`, `APP_ORIGIN` contains HTTPS origins only.
- [ ] Application root is outside the document root, and `.env` (if used) is `chmod 600`.
- [ ] `DATABASE_URL` uses a dedicated non-superuser role, and the migrations ran as that role.
- [ ] `REDIS_URL` uses TLS and is not reachable without credentials.
- [ ] Demo seeding was **not** run on a workspace with real data, or the demo passwords were changed.
- [ ] `TENANT_CONNECTOR_ENCRYPTION_KEY` is set when tenants store provider credentials.
- [ ] PostgreSQL backups (provider snapshots or `pg_dump`) and cPanel account backups are scheduled, and a restore has been tested once.
- [ ] `GET /api/v1/health` is monitored (uptime monitor, or a cPanel cron job using `curl`).

## 14. cPanel limitations to plan around

- Passenger runs the process, so there is no separate background worker. Queue-style work needs a cPanel cron job that calls your own endpoint or script.
- The API never applies migrations at startup; migrations stay an explicit deployment step.
- Shared-hosting resource limits (LVE) apply to CPU, memory and entry processes, so long-running exports or reports may be killed. Keep `dist` small and do not run Playwright or the PostgreSQL/Redis integration suite on the host.
- Bank feeds, live payments, e-mail/SMS/WhatsApp delivery and AI providers are **not** configured by this repository. Messages stay in the audited outbox until an adapter exists and has been reviewed, exactly as documented in [PRODUCTION.md](PRODUCTION.md).
- Some cPanel hosts block outbound ports. If PostgreSQL or Redis cannot be reached, ask the host to allow outbound `5432`/`6379` (or whatever ports your managed providers expose).

## 15. Files this deployment adds

| File | Purpose |
| --- | --- |
| `app.cjs` | Passenger startup file. Loads `.env`, checks the Node version, defaults `NODE_ENV=production` under Passenger, then imports `server/index.ts`. |
| `cpanel.env.example` | Template for the environment variables shown in section 4. |
| `scripts/cpanel-build.cjs` | `npm install --include=dev` plus `npm run build`. |
| `scripts/cpanel-migrate.cjs` | Applies the versioned PostgreSQL migrations. |
| `scripts/cpanel-seed.cjs` | Optional: loads the documented demo tenants. |
| `scripts/cpanel-doctor.cjs` | Read-only diagnostics: Node version, build, environment, database role, migrations, Redis. |

Nothing in the existing Docker, Render or Vercel path changes: `npm run start:api` still
runs `server/index.ts` directly, and `app.cjs` is only used when cPanel/Passenger starts
the application.

## 16. Appendix: hardening when the application root must be the document root

Some accounts cannot move the application out of `public_html`. In that case add the
block below **above** the Passenger directives that cPanel writes into
`public_html/.htaccess` (keep those lines intact), then confirm that
`https://<domain>/.env` and `https://<domain>/server/app.ts` both return `404`:

```apache
# 1. Never list directory contents.
Options -Indexes
IndexIgnore *

# 2. Block direct downloads of secrets, source and dependencies.
RedirectMatch 404 (?i)/(\.env(\..*)?|\.git(/|$)|node_modules(/|$)|server(/|$)|src(/|$)|scripts(/|$)|tests(/|$)|package(-lock)?\.json|tsconfig\.json|vite\.config\.ts|compose.*\.yaml|Dockerfile|.*\.(log|sql|zip|md|ts|tsx)$)
```

Keep the `PassengerAppRoot` / `PassengerBaseURI` / `PassengerNodejs` / `PassengerAppType` / `PassengerStartupFile` lines that cPanel writes **below** this block; the Node.js screen rewrites its own block and leaves other content in the file alone.

Also create the `.env` file with permissions `600` (File Manager > Permissions) so it is not readable by other accounts on the server, delete deployment archives (`*.zip`) and `stderr.log` once the app starts, and verify with the two `curl` commands in section 11.
## 17. Push to live (GitHub → cPanel)

Once this one-time setup is done, **`git push` is the deployment**. No SSH, no local build, no File Manager uploads.

```
git push origin main
  └─ GitHub Actions: "Deploy to cPanel"        .github/workflows/deploy-cpanel.yml
       └─ cPanel API: VersionControlDeployment::create
            └─ cPanel pulls the branch (git pull --ff-only)
                 └─ .cpanel.yml tasks run on the server:
                      npm install --include=dev  →  npm run build  →  npm run db:migrate
                      →  touch tmp/restart.txt
                           └─ https://demo.businessos.swad.cloud serves the new build
```

### One-time setup

1. **Push the deployment files** (they are part of this repository): `app.cjs`, `.cpanel.yml`, `.github/workflows/deploy-cpanel.yml`, `scripts/cpanel-*.cjs`, `public/.htaccess`.
2. **Create the cPanel-managed repository** — cPanel > Git Version Control > Create:
   - Clone URL `https://github.com/subodhkumar86/BUSINESSOS.git`, path `businessos`, branch `main`.
   - Equivalent API call (used when the repository does not exist yet):
     ```bash
     curl -H "Authorization: cpanel <user>:<api-token>" \
       "https://<cpanel-host>:2083/execute/VersionControl/create?name=businessos&type=git&repository_root=/home/<user>/businessos&source_repository%5Bremote_name%5D=origin&source_repository%5Burl%5D=https://github.com/subodhkumar86/BUSINESSOS.git"
     ```
3. **Point the domain and the Node.js application at the repository**:
   - cPanel > Domains > `demo.businessos.swad.cloud` > Document Root = `/home/<user>/businessos/public`
     (the application root stays one level above the document root, so source, `.env` and `node_modules` are never web-reachable)
   - cPanel > Setup Node.js App > BusinessOS > **Edit**: Application root `businessos`, Application URL `demo.businessos.swad.cloud`, **Application startup file `app.cjs`**, Node.js 24, mode Production > Save.
4. **Secrets**: copy the `.env` file into the repository root (`/home/<user>/businessos/.env`, never committed) and create these GitHub secrets (Settings > Secrets and variables > Actions):
   | Secret | Value |
   | --- | --- |
   | `CPANEL_HOST` | `business122.web-hosting.com` |
   | `CPANEL_USER` | cPanel username |
   | `CPANEL_TOKEN` | API token from cPanel > Security > Manage API Tokens (create a dedicated one, for example `github-deploy`) |
5. **First deployment**: cPanel > Git Version Control > **Deploy HEAD Commit** (or push a commit). This installs dependencies, builds the SPA and applies the migrations on the server in one step. Watch progress in **Last Deployment** and in `~/.cpanel/logs/vc_<timestamp>_git_deploy.log`.

Without the three secrets the workflow prints a notice and exits successfully, so pushes never look broken.

### What each kind of change does

| Change | On deploy |
| --- | --- |
| `src/**` (SPA) | Rebuilt; browsers pick up the new hashed assets, no restart required |
| `server/**`, `scripts/**` | Rebuilt and applied by the restart (`tmp/restart.txt`) |
| `server/migrations/*.sql` | Applied by `npm run db:migrate` (idempotent) |
| `.env` values | Change them on the server (they are not in Git), then restart the application |
| `package.json` dependencies | Installed by `npm install --include=dev` |

### Optional safety net: scheduled deployment

If a webhook or Actions run is ever missed, add a cron job (cPanel > Cron Jobs, every 5 minutes) with the command from the cPanel documentation:

```bash
/usr/local/cpanel/bin/uapi VersionControlDeployment create repository_root=/home/<user>/businessos
```

### Deployment troubleshooting

| Symptom | Fix |
| --- | --- |
| Deployment refused: "clean working tree" required | The server copy has uncommitted tracked changes (for example a file edited through File Manager). Restore it with `git checkout -- <file>` over SSH, or commit it. |
| Deployment refused: not a fast-forward | The remote branch was rewritten. Pull/merge on the server or push a merge commit. |
| `npm: command not found` in the deployment log | The `NODEBIN=$(ls -d /home/<user>/nodevenv/*/*/bin ...)` line matched nothing: create the Node.js application first, then deploy. |
| Deploy succeeds but the site shows old server behaviour | The restart did not reach the process. Click **Restart** in Setup Node.js App once, and confirm `tmp/restart.txt` exists in the application root. |
| Build killed (memory/timeout) | Build in GitHub Actions instead and upload `dist/`, keeping the deploy tasks to `npm run db:migrate` and the restart. |