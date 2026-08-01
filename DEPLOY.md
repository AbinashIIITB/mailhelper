# Deploying Mail Helper

Four free accounts, no credit card, no payment verification. Sign in to all of
them with GitHub.

| Piece | Host | Free tier |
| --- | --- | --- |
| `apps/web` (Next.js) | **Vercel** Hobby | no card |
| `apps/worker` (BullMQ) | **Azure Container Apps** | no card, via Azure for Students |
| Postgres | **Supabase** free | no card, 500 MB, 2 projects |
| Redis | **Upstash** free | no card, 256 MB / 500k commands per month |

Supabase does not offer Redis, so the BullMQ queue still needs Upstash — the
two are separate accounts.

> **The worker host must permit outbound SMTP.** Most free PaaS tiers do not.
> Render's free web services [stopped allowing outbound traffic to ports 25,
> 465 and 587 in September 2025](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports),
> which makes them incapable of running this worker no matter how the code is
> written — every send fails with `ENETUNREACH` or a connection timeout. Check
> this before choosing any alternative host.

> Free tiers change. Each of these required no card at the time of writing —
> if a signup ever asks for one, see [Alternatives](#alternatives) below.

Total cost: **$0**. Azure for Students needs a GitHub Student Pack / student
email but no credit card, and the worker is configured to scale to zero, so it
bills only while a campaign is actually sending.

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
npm run db:lockdown   # ← do not skip this
```

Re-run **both** whenever `packages/db/prisma/schema.prisma` changes.

### Why `db:lockdown` is not optional

Supabase publishes the `public` schema through its REST Data API and grants the
`anon` role access to every table created there. The `anon` key is designed to
be embedded in client-side code — Supabase treats it as public — so those
default grants make every row in your database world-readable, including
`User.passwordHash` and your entire recipient lists.

Mail Helper never uses the Data API; it talks to Postgres directly through
Prisma as the table owner. So
[`lockdown.sql`](packages/db/prisma/lockdown.sql) revokes those roles entirely
and enables RLS as a second layer. The app is unaffected — table owners bypass
RLS.

Verify it worked (should return `permission denied`, not data):

```bash
curl "https://<ref>.supabase.co/rest/v1/User?select=*" -H "apikey: <anon-key>"
```

A `prisma db push` that recreates a table can restore the default grants, which
is why `db:lockdown` runs after every push.

## 5. Worker — Azure Container Apps

### 5a. Publish the image

[`.github/workflows/worker-image.yml`](.github/workflows/worker-image.yml)
builds [`apps/worker/Dockerfile`](apps/worker/Dockerfile) and pushes it to
GitHub Container Registry, which is free for public repos — so no paid
container registry is needed. Run it once from **Actions → Build worker image →
Run workflow**, then make the package public at
`https://github.com/users/<you>/packages/container/mailhelper-worker/settings`
so Azure can pull it without credentials.

### 5b. Create the container app

1. Claim **Azure for Students** at
   [azure.microsoft.com/free/students](https://azure.microsoft.com/free/students)
   with your university email. $100 credit, no credit card.
2. Install the CLI (`brew install azure-cli`) and `az login`.
3. Run, substituting your own values:

```bash
RG=mailhelper
LOC=centralindia            # nearest region to a Supabase/Upstash in ap-south-1

az group create -n $RG -l $LOC
az containerapp env create -n mailhelper-env -g $RG -l $LOC

az containerapp create \
  -n mailhelper-worker -g $RG --environment mailhelper-env \
  --image ghcr.io/<your-github-user>/mailhelper-worker:latest \
  --target-port 8080 --ingress external \
  --min-replicas 0 --max-replicas 1 \
  --cpu 0.25 --memory 0.5Gi \
  --secrets db="<supabase-6543-url>" redis="<upstash-rediss-url>" enc="<encryption-key>" \
  --env-vars DATABASE_URL=secretref:db REDIS_URL=secretref:redis \
             ENCRYPTION_KEY=secretref:enc DAILY_SEND_LIMIT=450
```

4. Read back the URL and tell the worker about itself:

```bash
FQDN=$(az containerapp show -n mailhelper-worker -g $RG \
  --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update -n mailhelper-worker -g $RG \
  --set-env-vars WORKER_PUBLIC_URL="https://$FQDN"
echo "https://$FQDN/healthz"
```

5. Confirm: `curl https://$FQDN/healthz` → `{"status":"ok"}`.

### Why min-replicas 0

An always-on 0.25 vCPU container costs roughly $15–20/month, which would eat
the $100 credit in about five months. Scaling to zero means you are billed only
while a campaign is sending.

Nothing is lost, because the app already wakes the worker on demand: the web
app pings `WORKER_WAKE_URL` after enqueuing, which is an inbound HTTP request
and therefore scales the app 0 → 1. While jobs are flowing the worker pings
itself every five minutes so a long campaign isn't scaled down mid-send. Once
the queue is quiet it drops back to zero. Same mechanism that made the free
Render tier workable — it just happens to be the right shape here too.

Expect roughly 10–30 seconds of cold start on the first send after an idle
period.

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
   | `ENCRYPTION_KEY` | from step 1 — **same value as the worker** |
   | `AUTH_SECRET` | from step 1 |
   | `WORKER_WAKE_URL` | the worker's `https://<fqdn>/healthz` from step 5 |

   `DIRECT_URL` is deliberately **not** here, and not on the worker either.
   Only `prisma db push` reads it, and that runs from your machine.

5. **Deploy.**

## 7. Verify

1. Open the Vercel URL, sign up for an account.
2. **Settings** → connect a Gmail address with 2-Step Verification on and a
   16-character [app password](https://myaccount.google.com/apppasswords).
   Saving succeeds only if the credentials verify against Gmail, so this also
   proves `ENCRYPTION_KEY` is working.
3. Create a campaign, add yourself as the only recipient, send.
4. Watch the worker logs (`az containerapp logs show -n mailhelper-worker -g
   mailhelper --follow`) — you should see it wake and log the job.

The first send after a quiet period takes about a minute: the worker instance
is asleep and has to cold-start. Subsequent sends are immediate.

---

## How the free tier is made to work

The worker is a long-running queue consumer, which is the awkward shape for
cheap hosting: nothing wants to run an idle process for free. Three things let
it live on a scale-to-zero platform without holding an instance open:

- It serves `/healthz` on `$PORT`, so it presents as an ordinary HTTP service
  ([`apps/worker/src/index.ts`](apps/worker/src/index.ts)) and can be scaled by
  request. Free PaaS tiers often have no background-worker type at all.
- After enqueuing, the web app pings `WORKER_WAKE_URL` (`wakeWorker()` in
  [`packages/queue/src/index.ts`](packages/queue/src/index.ts)). That inbound
  request is what brings a scaled-to-zero worker back up; jobs already sitting
  in Redis are drained as soon as it boots.
- While jobs are flowing, the worker pings itself every 5 minutes so a long
  campaign — throttled to ~1 email/1.2s, so 500 recipients takes ~10 minutes —
  isn't scaled down mid-send. Once the queue is quiet the pings stop and it
  drops back to zero.

Both pings disable themselves when their env var is unset, so the same image
runs unchanged on an always-on host.

`WORKER_DRAIN_DELAY` (default 30s) controls how long the worker blocks on an
idle queue. The BullMQ default of 5s would spend roughly the entire Upstash
free monthly command quota doing nothing. A newly queued job still wakes the
blocking read instantly, so the higher value costs no latency.

## Limits worth knowing

- **Gmail, not the hosting, is the real cap.** ~500 emails/day on a free
  account, ~2000 on Workspace. `DAILY_SEND_LIMIT` (default 450) enforces this
  per user; recipients beyond it are marked failed with a "resend tomorrow"
  message and can be retried with **Resend failed**.
- **Azure credit is $100 and does not renew.** Scaled to zero the worker costs
  cents a month; left always-on it would be $15-20. Check *Cost Management* in
  the portal now and then.
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
runs a trivial query every 3 days, which resets the inactivity timer. To turn
it on, add one repository secret (**Settings → Secrets and variables →
Actions**):

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | your `DIRECT_URL` — the session pooler string, port 5432 |

It queries Postgres directly rather than calling the REST API, because
[`db:lockdown`](#why-dblockdown-is-not-optional) strips the Data API roles of
all access.

Actions minutes are free on public repos. Without the secret the job exits
quietly, so leaving it unconfigured breaks nothing.

One caveat: **GitHub disables scheduled workflows in a repo with no commits for
60 days.** If you stop touching the repo entirely, the keep-alive stops too and
the project will eventually pause anyway. Re-enable it from the Actions tab.

If the pause bites you, the project is not lost — data is retained, and
resuming restores it exactly as it was.

## Alternatives

**Other worker hosts.** The image is plain Docker and runs anywhere:

```bash
docker build -f apps/worker/Dockerfile -t mailhelper-worker .
```

Set `WORKER_PUBLIC_URL` to the worker's own public URL on any host that can
suspend or scale it down; leave it unset on a host that is always on, and the
self-ping disables itself.

Before committing to a host, **check that it permits outbound TCP on 465**.
This is the constraint that rules out most free tiers, and it usually isn't
mentioned until your mail silently fails:

| Host | Outbound SMTP |
| --- | --- |
| Render free | **blocked** since Sept 2025 — unusable for this worker |
| Render paid (from $7/mo) | allowed on 465/587 |
| Azure | allowed on 465/587 (port 25 blocked, which Gmail doesn't need) |
| Fly.io / Railway / most VPS | allowed, but all want a card |

Your own laptop also works — point the worker at the production `DATABASE_URL`
and `REDIS_URL` and run `npm run start:local -w worker`. It picks up whatever is
queued. Useful for a one-off send, or for proving a delivery problem is the
host and not the code.

Most other student-pack offers (DigitalOcean's $200, Heroku, Namecheap) **do**
require a card for identity verification, which is why the main path avoids
them.

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
| Sends fail with `Unsupported state or unable to authenticate data` | `ENCRYPTION_KEY` differs between Vercel and the worker |
| Campaign stuck on "queued", worker idle | `WORKER_WAKE_URL` unset or wrong on Vercel; the worker only wakes when something hits it |
| `Too many connections` from Postgres | Using the session pooler (5432) on Vercel instead of the transaction pooler (6543) |
| Every page errors, Supabase dashboard says "Paused" | 7 days of no requests — click Restore, then set up the keep-awake workflow |
| `prisma db push` hangs or `ENETUNREACH` | Using `db.<ref>.supabase.co` (IPv6-only) as `DIRECT_URL` instead of the session pooler |
| `prepared statement "s0" already exists` | `?pgbouncer=true` missing from `DATABASE_URL` |
| Send fails with `Invalid login` | Gmail app password wrong, or 2-Step Verification is off on that account |
| Sends fail with `ENETUNREACH` or `Connection timeout` to smtp.gmail.com | The worker host blocks outbound SMTP. Not fixable in code — move hosts |
