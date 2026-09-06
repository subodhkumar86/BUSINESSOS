# Production deployment

BusinessOS requires managed PostgreSQL and Redis, an HTTPS reverse proxy or platform ingress, and a secret manager before it is exposed publicly.

1. Provision PostgreSQL and Redis. Create a non-superuser PostgreSQL application role without `BYPASSRLS`.
2. Copy `.env.production.example` values into your host's secret manager. Use real TLS connection URLs; do not use the local Compose credentials.
3. Run migrations as a one-off deployment step: `npm run db:migrate` with the production `DATABASE_URL`.
4. Build and run the API using `docker compose --env-file .env.production -f compose.production.yaml up -d --build`.
5. Put the API behind TLS at `https://api.example.com` and serve the web build at the origin in `APP_ORIGIN`. Do not expose PostgreSQL or Redis publicly.
6. Confirm `GET /api/v1/health`, session cookies marked `Secure`, backup/restore, log retention, alerting, and a rollback procedure before launch.

The production process rejects insecure cookies and non-HTTPS application origins. Provider credentials for bank feeds, payments, documents, notifications, and AI are not configured by this repository; add them only through your secret manager after the corresponding adapter has been implemented and reviewed.

## Render deployment

Deploy BusinessOS as one Docker **Web Service** so the React application and API share one HTTPS origin and session cookie.

1. Create Render Postgres and Render Key Value in the same Render region as the web service. Use their internal connection URLs.
2. Create a Web Service from the `main` branch of this repository. Choose the Docker runtime; the repository `Dockerfile` builds the frontend and starts the API.
3. In the service Environment page, set `NODE_ENV=production`, `DATABASE_URL` to the internal Postgres URL, `REDIS_URL` to the internal Key Value URL, `APP_ORIGIN` to the final `https://<service>.onrender.com` or custom-domain URL, and `COOKIE_SECURE=true`. Do not set local `.env` values in Render.
4. Set the health check path to `/api/v1/health`. Render provides `PORT`; do not hard-code a public port.
5. Before the first live deploy, run `npm run db:migrate` from a trusted machine using Render Postgres's external URL, or from a one-off Render job using its internal URL. The image includes this migration script but the API intentionally never applies migrations on startup.
6. Open the service URL, register an owner or run the demo seed from a controlled one-off job, and verify the health check, login, and audit log.

Use a non-superuser PostgreSQL role without `BYPASSRLS` for `DATABASE_URL`. Render provides managed TLS for web services; attach a custom domain only after updating `APP_ORIGIN` and redeploying.

## Vercel frontend + Render API

For a split deployment, Vercel hosts the Vite frontend and Render hosts only the API. The API accepts credentialed CORS requests only from the configured Vercel origin; it never uses wildcard CORS.

1. In Render, deploy the Docker web service as above, but set `APP_ORIGIN` to your production Vercel URL (for example, `https://businessos.vercel.app`), `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=none`. Keep the Render service publicly reachable and set its health check path to `/api/v1/health`.
2. In Vercel, import the same GitHub repository and use the `main` branch. The included `vercel.json` runs `npm run build` and publishes `dist`.
3. In Vercel Project Settings > Environment Variables, set `VITE_API_URL` to your Render API origin only (for example, `https://businessos-api.onrender.com`). Do not include `/api/v1`, a trailing slash, or any secret in this value. Apply it to Production; add the corresponding preview origin to Render's `APP_ORIGIN` only if preview logins are needed.
4. Deploy Render first, run the migrations, then deploy Vercel. After a Vercel environment-variable change, redeploy the frontend because Vite substitutes `VITE_*` values during its build.
5. Verify a browser login from the Vercel URL, then confirm the response has `Access-Control-Allow-Origin` equal to the Vercel origin, `Access-Control-Allow-Credentials: true`, and a `Secure; SameSite=None` session cookie.

For long-term production, use custom domains such as `app.example.com` (Vercel) and `api.example.com` (Render), list `https://app.example.com` as `APP_ORIGIN`, and keep HTTPS enabled everywhere.
