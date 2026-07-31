# Deploying Mail Helper

Four free accounts, no credit card, no payment verification. Sign in to all of
them with GitHub.

| Piece | Host | Free tier |
| --- | --- | --- |
| `apps/web` (Next.js) | **Vercel** Hobby | no card |
| `apps/worker` (BullMQ) | **Render** free web service | no card, 750 instance-hours/mo |
| Postgres | **Neon** free | no card, 0.5 GB |
| Redis | **Upstash** free | no card, 256 MB / 500k commands per month |

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

## 2. Postgres — Neon

1. Sign up at [neon.tech](https://neon.tech) with GitHub.
2. **New Project** → name `mailhelper`, pick the region closest to you.
3. From the connection-string widget, copy **both**:
   - the **Pooled** string (host contains `-pooler`) → this is your `DATABASE_URL`
   - the **Direct** / unpooled string → used once, in step 4

   Both should end in `?sslmode=require`.

Pooled is what serverless functions need; a Vercel deploy opens a new
connection per cold start and would exhaust the direct-connection limit.

## 3. Redis — Upstash

1. Sign up at [upstash.com](https://upstash.com) with GitHub.
2. **Create Database** → Redis → same region as Neon → **Free** plan.
3. Leave **Eviction disabled**. BullMQ stores job state in Redis; if Redis is
   allowed to evict keys, queued emails silently disappear.
4. Copy the `rediss://default:...@....upstash.io:6379` URL → this is your
   `REDIS_URL`. (Under *Connect* → *Node* / *ioredis*, not the REST URL.)

## 4. Create the database tables

From your machine, using the **direct** (unpooled) Neon string:

```bash
DATABASE_URL="postgresql://…neon.tech/mailhelper?sslmode=require" npm run db:push
```

Re-run this whenever `packages/db/prisma/schema.prisma` changes.

## 5. Worker — Render

1. Push this repo to GitHub (already done if you cloned it from there).
2. Sign up at [render.com](https://render.com) with GitHub.
3. **New** → **Blueprint** → select the `mailhelper` repo. Render reads
   [`render.yaml`](render.yaml) and proposes a free web service called
   `mailhelper-worker`.
4. It will prompt for the three secrets marked `sync: false`:
   - `DATABASE_URL` — the **pooled** Neon string
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
   | `DATABASE_URL` | pooled Neon string |
   | `REDIS_URL` | Upstash `rediss://` URL |
   | `ENCRYPTION_KEY` | from step 1 — **same value as Render** |
   | `AUTH_SECRET` | from step 1 |
   | `WORKER_WAKE_URL` | `https://mailhelper-worker.onrender.com/healthz` |

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
- **Neon free autosuspends** after ~5 minutes idle; the first query afterwards
  takes an extra second or so.
- **Upstash free: 500k commands/month, 256 MB.** Fine for this workload with
  `WORKER_DRAIN_DELAY` at 30s.
- **Vercel Hobby is for non-commercial use.** If Mail Helper starts earning
  money, Vercel's terms require a Pro plan.

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

**Other swaps that keep the zero-card property:** Supabase or Vercel Postgres
in place of Neon; Redis Cloud's free 30 MB in place of Upstash. Both are drop-in
— only `DATABASE_URL` / `REDIS_URL` change.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Vercel build: `Cannot find module '@mailhelper/db'` | Root Directory isn't set to `apps/web` |
| Worker logs `ECONNRESET` / TLS errors on Redis | `REDIS_URL` is `redis://` where Upstash needs `rediss://` |
| Sends fail with `Unsupported state or unable to authenticate data` | `ENCRYPTION_KEY` differs between Vercel and Render |
| Campaign stuck on "queued", worker idle | `WORKER_WAKE_URL` unset or wrong on Vercel; the worker only wakes when something hits it |
| `Too many connections` from Postgres | Using the direct Neon string on Vercel instead of the pooled one |
| Send fails with `Invalid login` | Gmail app password wrong, or 2-Step Verification is off on that account |
