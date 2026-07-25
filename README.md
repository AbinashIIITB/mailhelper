# Mail Helper

Free personalized bulk email (mail-merge) for small orgs. Write one template
with `{{ blanks }}`, upload a spreadsheet of recipients, and Mail Helper sends
each person their **own** email from your Gmail — marks, credentials, invoices,
anything that shouldn't be shared in a group.

## How it works

- Sign up, then connect the Gmail you want to send from (via a Google **App
  Password** — stored AES-256-GCM encrypted).
- Create a campaign: a subject + body template using `{{ column }}` placeholders.
- Add recipients by **CSV upload**, **paste from a sheet**, or **manual entry**.
  Column headers become the placeholder values (one column must be `email`).
- Hit send. A background worker sends each personalized email through your Gmail,
  **throttled** to respect Gmail's limits, with retries and per-recipient status.

## Architecture (Turborepo)

| Package | Role |
| --- | --- |
| `apps/web` | Next.js UI + API routes. Enqueues send jobs (the **producer**). |
| `apps/worker` | Long-running BullMQ **consumer** that actually sends mail. |
| `packages/db` | Prisma schema + client (Postgres). |
| `packages/core` | AES-256-GCM crypto, template merge, Gmail SMTP, zod schemas. |
| `packages/queue` | BullMQ queue + Redis connection (shared by producer & consumer). |

Auth is next-auth v5 (credentials). Sends are queued in Redis and processed by
the worker with a rate limiter (~1/1.2s) plus a per-user daily cap
(`DAILY_SEND_LIMIT`, default 450) to stay under Gmail's ~500/day free limit.

## Local setup

```bash
# 1. Start Postgres + Redis (host ports 55432 / 6380 to avoid clashing with
#    any native Postgres/Redis on the default ports)
docker compose up -d

# 2. Install deps
npm install

# 3. Create env files (copy .env.example and fill in secrets)
#    - apps/web/.env.local   (DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, AUTH_SECRET)
#    - apps/worker/.env      (DATABASE_URL, REDIS_URL, ENCRYPTION_KEY)
#    Generate secrets:  openssl rand -hex 32   /   openssl rand -base64 32

# 4. Push the schema
npm run db:push

# 5. Run web + worker together
npm run dev
```

Web runs on http://localhost:3000. The worker prints `[worker] ready` once
connected to Redis.

## Sending for real

To actually send, connect a Gmail with **2-Step Verification on** and a
16-character **App Password** (https://myaccount.google.com/apppasswords) in
**Settings**. Mail Helper verifies the credentials before saving.
