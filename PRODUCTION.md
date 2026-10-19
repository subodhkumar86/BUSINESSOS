# One Vercel deployment

The repository root is the single Next.js app for `https://businessos-topaz.vercel.app`. It serves the React UI at `/`, `/login`, `/app/*` and other workspace routes, plus the backend at `/api/v1/*` on that same domain.

## Existing Vercel project settings

In Settings > Build and Deployment:

| Setting | Value |
| --- | --- |
| Root Directory | `.` (repository root) |
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` (remove any old `dist` override) |
| Node.js | 24.x |

`vercel.json` sets the Next.js framework, build and output defaults. Remove stale Vite settings or API rewrites from the Vercel dashboard before redeploying. Both surfaces use the same domain and cookies. Do not create a second backend Vercel project.

## Environment variables

Add these server-side values to the Vercel project:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The supplied MongoDB Atlas connection string, stored as a Vercel secret environment value |
| `MONGODB_DB` | `business` |
| `APP_ORIGIN` | `https://businessos-topaz.vercel.app` |
| `COOKIE_SECURE` | `true` |

`MONGODB_URI` is supported for compatibility and takes precedence if present. Remove an old value or point it at the same cluster. When `MONGODB_DB` is absent, the database name from the connection URI is used.

For multiple trusted aliases, separate origins with commas. Preview deployments need their exact origin included in their preview-scoped `APP_ORIGIN`. Do not expose MongoDB credentials with a public environment-variable prefix or commit them to the repository. Local credentials are kept in gitignored `.env`; `.vercelignore` excludes local environment files from deployment uploads.

Configure Atlas network access for the deployment and use a dedicated application database user. MongoDB must support transactions; a standalone server is insufficient.

Before registrations are enabled, run `npm run db:migrate` once from a trusted environment using the same MongoDB variables. This creates indexes and default subscription plans. It is idempotent and does not overwrite existing plans. Database setup is not performed during the Vercel build.

Redeploy, then verify `/api/v1/health` returns `ok: true` and `/login` loads on the same hostname. The code is prepared for this deployment; local configuration changes do not update the Vercel dashboard or publish a deployment automatically.

Next.js/Vercel reference: [project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Next.js SPA integration](https://nextjs.org/docs/app/guides/single-page-applications).
