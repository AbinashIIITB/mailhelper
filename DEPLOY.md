# Deploying Mail Helper

Four free accounts, no credit card, no payment verification. Sign in to all of
them with GitHub.

| Piece | Host | Free tier |
| --- | --- | --- |
| `apps/web` (Next.js) | **Vercel** Hobby | no card |
| `apps/worker` (BullMQ) | **Render** free web service | no card, 750 instance-hours/mo |
| Postgres | **Supabase** free | no card, 500 MB, 2 projects |
| Redis | **Upstash** free | no card, 256 MB / 500k commands per month |

Supabase does not offer Redis, so the BullMQ queue still needs Upstash — the
two are separate accounts.

> Free tiers change. Each of these required no card at the time of writing —
> if a signup ever asks for one, see [Alternatives](#alternatives) below.

Total cost: **$0**. No GitHub Student Pack needed, though there is a student
option in [Alternatives](#alternatives) if you want a worker that never sleeps.

---

## 1. Generate your secrets

Run this once and keep the output somewhere safe — you'll paste these into
three dashboards:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "AUTH_SECRET=$(openssl rand -base64 32)"
```

`ENCRYPTION_KEY` **must be identical** in the web app and the worker. The web
app encrypts the user's Gmail app password with it; the worker decrypts it to
send. Different keys means every send fails. Changing it later makes already
saved Gmail connections unreadable — users would have to re-enter them.

## 2. Postgres — Supabase

1. Sign up at [supabase.com](https://supabase.com) with GitHub.
2. **New Project** → name `mailhelper`, pick the region closest to you, and save
   the database password it generates.
3. **Connect** (top bar) → **ORMs** → **Prisma**. Copy the two URLs it shows:

   | Env var | Supabase calls it | Port |
   | --- | --- | --- |
   | `DATABASE_URL` | Transaction pooler | `6543` |
   | `DIRECT_URL` | Session pooler | `5432` |

   Both are on the same `...pooler.supabase.com` host. `DATABASE_URL` must keep
   its `?pgbouncer=true&connection_limit=1` query string.

Why two: Vercel opens a fresh connection on every cold start, so the app has to
go through the transaction pooler or it will exhaust Postgres' connection
limit. But schema changes can't run through a transaction pooler, so
`prisma db push` uses the session pooler instead.

> Use the **session pooler** for `DIRECT_URL`, not the "direct connection"
> string (`db.<ref>.supabase.co`). Direct connections are IPv6-only, and most
> home and campus networks can't reach them.

## 3. Redis — Upstash

1. Sign up at [upstash.com](https://upstash.com) with GitHub.
2. **Create Database** → Redis → same region as Supabase → **Free** plan.
3. Leave **Eviction disabled**. BullMQ stores job state in Redis; if Redis is
   allowed to evict keys, queued emails silently disappear.
4. Copy the `rediss://default:...@....upstash.io:6379` URL → this is your
   `REDIS_URL`. (Under *Connect* → *Node* / *ioredis*, not the REST URL.)

## 4. Create the database tables

From your machine. Put both URLs in `packages/db/.env` (it's gitignored):

```bash
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

then:

```bash
npm run db:push
```

Re-run this whenever `packages/db/prisma/schema.prisma` changes. Note that this
file currently points at your local Docker Postgres — swap the values to deploy,
or keep two copies and switch between them.

## 5. Worker — Render

1. Push this repo to GitHub (already done if you cloned it from there).
2. Sign up at [render.com](https://render.com) with GitHub.
3. **New** → **Blueprint** → select the `mailhelper` repo. Render reads
   [`render.yaml`](render.yaml) and proposes a free web service called
   `mailhelper-worker`.
4. It will prompt for the three secrets marked `sync: false`:
   - `DATABASE_URL` — the Supabase **transaction pooler** string (port 6543)
   - `REDIS_URL` — the Upstash `rediss://` URL
   - `ENCRYPTION_KEY` — from step 1
5. **Apply**. When the deploy finishes, copy the service URL, e.g.
   `https://mailhelper-worker.onrender.com`.
6. Confirm it's alive: `curl https://mailhelper-worker.onrender.com/healthz`
   → `{"status":"ok"}`.

## 6. Web — Vercel

1. Sign up at [vercel.com](https://vercel.com) with GitHub.
2. **Add New** → **Project** → import the `mailhelper` repo.
3. **Set Root Directory to `apps/web`.** This is the one setting Vercel can't
   infer — without it the build fails, because this is a Turborepo and the
   Next.js app is not at the repo root. Leave "Include files outside the root
   directory" enabled so the `packages/*` workspaces are available.
4. Add environment variables:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction pooler string (port 6543) |
   | `REDIS_URL` | Upstash `rediss://` URL |
   | `ENCRYPTION_KEY` | from step 1 — **same value as Render** |
   | `AUTH_SECRET` | from step 1 |
   | `WORKER_WAKE_URL` | `https://mailhelper-worker.onrender.com/healthz` |

   `DIRECT_URL` is deliberately **not** here, and not on Render either. Only
   `prisma db push` reads it, and that runs from your machine.

5. **Deploy.**

## 7. Verify

1. Open the Vercel URL, sign up for an account.
2. **Settings** → connect a Gmail address with 2-Step Verification on and a
   16-character [app password](https://myaccount.google.com/apppasswords).
   Saving succeeds only if the credentials verify against Gmail, so this also
   proves `ENCRYPTION_KEY` is working.
3. Create a campaign, add yourself as the only recipient, send.
4. Watch the Render logs — you should see the worker wake and log the job.

The first send after a quiet period takes about a minute: the worker instance
is asleep and has to cold-start. Subsequent sends are immediate.

---

## How the free tier is made to work

Render's free plan has no background-worker type and suspends an idle instance
after ~15 minutes. Three things in this repo work around that without paying
and without keeping an idle instance artificially alive:

- The worker serves `/healthz` on `$PORT`, so it qualifies as a *web* service
  ([`apps/worker/src/index.ts`](apps/worker/src/index.ts)).
- After enqueuing, the web app pings `WORKER_WAKE_URL`, which resumes the
  suspended instance (`wakeWorker()` in
  [`packages/queue/src/index.ts`](packages/queue/src/index.ts)). Jobs already
  sitting in Redis are drained as soon as it boots.
- While jobs are flowing, the worker pings itself every 5 minutes so a long
  campaign — throttled to ~1 email/1.2s, so 500 recipients takes ~10 minutes —
  doesn't get suspended mid-send. Once the queue is quiet the pings stop and
  the instance is allowed to sleep, as the free tier intends.

`WORKER_DRAIN_DELAY` (default 30s) controls how long the worker blocks on an
idle queue. The BullMQ default of 5s would spend roughly the entire Upstash
free monthly command quota doing nothing. A newly queued job still wakes the
blocking read instantly, so the higher value costs no latency.

## Limits worth knowing

- **Gmail, not the hosting, is the real cap.** ~500 emails/day on a free
  account, ~2000 on Workspace. `DAILY_SEND_LIMIT` (default 450) enforces this
  per user; recipients beyond it are marked failed with a "resend tomorrow"
  message and can be retried with **Resend failed**.
- **Render free: 750 instance-hours/month.** One service running continuously
  uses ~744 in a 31-day month, and this one sleeps when idle, so you'll stay
  well under. Adding a second free service would not fit.
- **Supabase free pauses a project after 7 days without API requests**, and
  resuming is a manual click in their dashboard — the app is fully down until
  you do it. This is the one sharp edge of the free stack, and it bites exactly
  when you'd expect: a tool used a few times a term sits idle in between. See
  [Keeping Supabase awake](#keeping-supabase-awake).
- **Supabase free: 500 MB database, 2 active projects, no backups.** Storage is
  a non-issue here — recipients and campaigns are tiny rows.
- **Upstash free: 500k commands/month, 256 MB.** Fine for this workload with
  `WORKER_DRAIN_DELAY` at 30s.
- **Vercel Hobby is for non-commercial use.** If Mail Helper starts earning
  money, Vercel's terms require a Pro plan.

## Keeping Supabase awake

[`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml)
pings the project every 3 days, which resets the inactivity timer. To turn it
on, add two repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Where to find it |
| --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` — Project Settings → API |
| `SUPABASE_ANON_KEY` | the anon/public key on that same page |

Actions minutes are free on public repos. Without the secrets the job exits
quietly, so leaving it unconfigured breaks nothing.

One caveat: **GitHub disables scheduled workflows in a repo with no commits for
60 days.** If you stop touching the repo entirely, the keep-alive stops too and
the project will eventually pause anyway. Re-enable it from the Actions tab.

If the pause bites you, the project is not lost — data is retained, and
resuming restores it exactly as it was.

## Alternatives

**If you want a worker that never sleeps** — GitHub Student Developer Pack
includes **Azure for Students**: $100 credit, verified with your student email,
**no credit card**. Deploy the worker to Azure Container Apps using
[`apps/worker/Dockerfile`](apps/worker/Dockerfile) with min-replicas 1. The
same image runs on Fly.io, Railway, Koyeb or any VPS:

```bash
docker build -f apps/worker/Dockerfile -t mailhelper-worker .
```

Set `WORKER_PUBLIC_URL` on hosts that don't inject `RENDER_EXTERNAL_URL`, or
leave it unset on an always-on host — the self-ping is only needed where the
instance can be suspended.

Note that most other student-pack offers (DigitalOcean's $200, Heroku,
Namecheap) **do** require a card for identity verification, which is why the
main path above avoids them.

**If the 7-day pause becomes annoying** — [Neon](https://neon.tech)'s free tier
is a drop-in replacement that autosuspends but *auto-resumes* on the next query
in about a second, so an idle app never appears broken. Only `DATABASE_URL` and
`DIRECT_URL` change (Neon's pooled host contains `-pooler`; its direct string is
the `DIRECT_URL`), and you can delete the keep-awake workflow. Also no card.

**Redis swap:** Redis Cloud's free 30 MB works in place of Upstash — only
`REDIS_URL` changes.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Vercel build: `Cannot find module '@mailhelper/db'` | Root Directory isn't set to `apps/web` |
| Worker logs `ECONNRESET` / TLS errors on Redis | `REDIS_URL` is `redis://` where Upstash needs `rediss://` |
| Sends fail with `Unsupported state or unable to authenticate data` | `ENCRYPTION_KEY` differs between Vercel and Render |
| Campaign stuck on "queued", worker idle | `WORKER_WAKE_URL` unset or wrong on Vercel; the worker only wakes when something hits it |
| `Too many connections` from Postgres | Using the session pooler (5432) on Vercel instead of the transaction pooler (6543) |
| Every page errors, Supabase dashboard says "Paused" | 7 days of no requests — click Restore, then set up the keep-awake workflow |
| `prisma db push` hangs or `ENETUNREACH` | Using `db.<ref>.supabase.co` (IPv6-only) as `DIRECT_URL` instead of the session pooler |
| `prepared statement "s0" already exists` | `?pgbouncer=true` missing from `DATABASE_URL` |
| Send fails with `Invalid login` | Gmail app password wrong, or 2-Step Verification is off on that account |
