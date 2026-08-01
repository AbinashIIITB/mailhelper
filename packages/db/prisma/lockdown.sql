-- Revoke Supabase's public API roles from the application tables.
--
-- Supabase exposes the `public` schema through PostgREST and grants the `anon`
-- and `authenticated` roles access to tables created there. The anon key is
-- designed to be published in client-side code, so those grants make every row
-- world-readable. Mail Helper never uses the Data API — it talks to Postgres
-- directly through Prisma as the table owner — so these roles need no access
-- at all.
--
-- Re-run after any `prisma db push` that recreates tables:
--   npm run db:lockdown

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- Stop future Prisma-created tables from inheriting the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Defence in depth: RLS with no policies denies every non-owner role. Prisma
-- connects as the table owner, which bypasses RLS, so the app is unaffected.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmtpConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recipient" ENABLE ROW LEVEL SECURITY;
