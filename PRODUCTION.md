# Production deployment

BusinessOS requires managed PostgreSQL and Redis, an HTTPS reverse proxy or platform ingress, and a secret manager before it is exposed publicly.

1. Provision PostgreSQL and Redis. Create a non-superuser PostgreSQL application role without `BYPASSRLS`.
2. Copy `.env.production.example` values into your host's secret manager. Use real TLS connection URLs; do not use the local Compose credentials.
3. Run migrations as a one-off deployment step: `npm run db:migrate` with the production `DATABASE_URL`.
4. Build and run the API using `docker compose --env-file .env.production -f compose.production.yaml up -d --build`.
5. Put the API behind TLS at `https://api.example.com` and serve the web build at the origin in `APP_ORIGIN`. Do not expose PostgreSQL or Redis publicly.
6. Confirm `GET /api/v1/health`, session cookies marked `Secure`, backup/restore, log retention, alerting, and a rollback procedure before launch.

The production process rejects insecure cookies and non-HTTPS application origins. Provider credentials for bank feeds, payments, documents, notifications, and AI are not configured by this repository; add them only through your secret manager after the corresponding adapter has been implemented and reviewed.
