# Mail Helper — Interview Explainer

A complete walkthrough of the project for technical interviews: what it does, how
it's built, the decisions behind it, and the questions an interviewer is likely
to ask. Written to be read top-to-bottom before a system-design or project
deep-dive round, and skimmed as a cheat-sheet the morning of.

---

## 1. The one-paragraph pitch

Mail Helper is a free, self-hostable **personalized bulk-email (mail-merge)**
tool for small orgs — a teacher sending each student their marks, a club sending
each member their credentials. You write **one template** with `{{ blanks }}`,
upload a **spreadsheet of recipients**, and it sends **each person their own
private email** from **your own Gmail**, throttled to respect Gmail's limits,
with per-recipient status and retries. The whole thing is engineered to run on
**$0 of free-tier hosting with no credit card**.

The interesting engineering is not the feature set — it's making a
**long-running queue worker that sends throttled email** survive on
**scale-to-zero free infrastructure**, and doing it **securely** (encrypted
credentials, locked-down database, brute-force protection).

---

## 2. What problem does it solve?

"Bulk email" tools like Mailchimp are built for *marketing* — one identical
message to a list, sent from a shared/branded domain. That's the wrong tool when:

- Each recipient must get **different, private** content (marks, invoices,
  passwords). A group email or CC leaks everyone's data to everyone.
- You want the mail to come **from your own address**, land in a normal inbox,
  and not look like marketing (no unsubscribe footer, no tracking pixel).
- You have **no budget** — a school club, a small NGO, a course TA.

Mail Helper fills that gap: mail-merge from your own Gmail, one private email per
person, for free.

---

## 3. High-level architecture

It's a **Turborepo monorepo** with a clean **producer/consumer** split around a
Redis-backed job queue.

```
┌─────────────────┐     enqueue jobs      ┌──────────────┐     BLPOP      ┌──────────────────┐
│   apps/web       │ ───────────────────▶ │    Redis      │ ◀───────────── │   apps/worker     │
│  (Next.js)       │                       │  (BullMQ)     │                │  (BullMQ Worker)  │
│                  │  ── wake ping ──────────────────────────────────────▶ │                   │
│  PRODUCER        │                       └──────────────┘                │  CONSUMER          │
│  - UI + API      │                                                        │  - sends via SMTP  │
│  - enqueues      │        ┌────────────────────────────┐                 │  - throttles       │
└────────┬─────────┘        │        Postgres             │                └─────────┬─────────┘
         │                  │  (Prisma: users, campaigns, │                          │
         └─────────────────▶│   recipients, smtp config)  │◀─────────────────────────┘
              read/write    └────────────────────────────┘         read/write
                                                                          │
                                                                          ▼
                                                                  smtp.gmail.com:465
                                                                  (sender's own Gmail)
```

### The five packages

| Package | Role | Runtime |
| --- | --- | --- |
| `apps/web` | Next.js UI + API routes. The **producer**: authenticates users, manages campaigns/recipients, enqueues send jobs. | Vercel (serverless) |
| `apps/worker` | Long-running BullMQ **consumer**. The only thing that actually sends mail. | Azure Container Apps (scale-to-zero container) |
| `packages/db` | Prisma schema + generated client (Postgres). | shared library |
| `packages/core` | Pure logic: AES-256-GCM crypto, template merge, Gmail SMTP transport, zod schemas. | shared library |
| `packages/queue` | BullMQ queue + Redis connection helpers, shared by producer & consumer. | shared library |

**Why this split matters (and is the #1 thing to be able to explain):**
Serverless functions (Vercel) are short-lived and can't hold a connection open to
slowly drip 500 emails over 10 minutes. Sending must live in a **long-running
process**. So the web app never sends — it only writes rows and drops jobs on the
queue; a separate always-available-on-demand worker drains the queue. That
producer/consumer boundary is the backbone of the whole design.

---

## 4. Tech stack

- **Language:** TypeScript end to end.
- **Web:** Next.js (App Router), next-auth v5 (credentials/JWT sessions),
  React server + client components.
- **Queue:** BullMQ over Redis (ioredis).
- **DB:** Postgres via Prisma.
- **Email:** Nodemailer → Gmail SMTP (port 465, `secure: true`) using a Google
  **App Password**.
- **Crypto:** Node `crypto`, AES-256-GCM.
- **Validation:** zod (shared schemas used by both API and forms).
- **Monorepo:** Turborepo + npm workspaces.
- **Hosting (all free, no card):** Vercel (web) · Azure Container Apps (worker) ·
  Supabase (Postgres) · Upstash (Redis).

---

## 5. Data model (Prisma)

Four tables. `onDelete: Cascade` throughout, so deleting a user cleans up
everything they own.

```
User 1───1 SmtpConfig          (one Gmail connection per user)
User 1───* Campaign 1───* Recipient
```

- **User** — `email` (unique), `passwordHash` (bcrypt). That's it; auth is
  credentials-only.
- **SmtpConfig** — `gmailAddress`, `appPasswordEnc` (**AES-256-GCM encrypted**,
  never stored plaintext), optional `fromName`. One per user (`userId @unique`).
- **Campaign** — `name`, `subject`, `bodyTemplate`, a `status` enum
  (`draft → queued → sending → completed/failed`), and denormalized counters
  `total / sent / failed` so the dashboard never has to aggregate recipients.
- **Recipient** — `email`, `variables` (JSON: the spreadsheet columns for this
  row), `status` enum (`pending / sent / failed`), `error`, `sentAt`.

### Indexes (be ready to justify these)

- `Campaign @@index([userId, updatedAt])` — serves the campaign list and
  dashboard: "my campaigns, newest first."
- `Recipient @@index([campaignId, status])` — "how many of this campaign's
  recipients are still pending?" (used to finalize a campaign).
- `Recipient @@index([status, sentAt])` — serves the **rolling 24-hour send
  count** that enforces the daily Gmail cap across all of a user's campaigns.

Talking point: **the counters on Campaign are deliberate denormalization.** They
could be computed with `COUNT(*) GROUP BY status`, but the dashboard and the
per-send finalize check would pay for that repeatedly. Instead the worker
`increment`s them inside the same transaction that flips a recipient's status, so
they stay consistent without a query.

---

## 6. The core flows

### 6a. Sign up / log in

- Signup: zod-validated, bcrypt hash (cost 10), rate-limited to **5 accounts/hour
  per IP**.
- Login: next-auth Credentials provider. **Two anti-enumeration defenses worth
  calling out:**
  1. When the email doesn't exist, it still runs a bcrypt compare against a
     constant dummy hash (`ABSENT_USER_HASH`) so a missing account takes the same
     time as a wrong password — **response time can't reveal whether an account
     exists.**
  2. Login is rate-limited to **10 attempts / 15 min per email**.
- Sessions are **JWT** (`strategy: "jwt"`), so no session table and no DB read on
  every request — important on serverless.

### 6b. Connect Gmail (`POST /api/smtp`)

1. User enters their Gmail + 16-char App Password (App Passwords require 2-Step
   Verification; the schema strips the spaces Google shows).
2. **Verify before persisting:** the server actually opens an SMTP connection and
   calls `transport.verify()`. Bad credentials fail fast with a clear message
   instead of silently breaking every future send.
3. Only then encrypt the app password (AES-256-GCM) and `upsert` the
   `SmtpConfig`.

### 6c. Build a campaign + add recipients

- Recipients come in three ways — **CSV upload, paste from a sheet (TSV/CSV), or
  manual entry** — all funnel through one parser (`lib/recipients.ts`, using
  PapaParse).
- The parser auto-detects the **email column** (looks for a header like `email` /
  `e-mail address`, else any header containing "mail"), turns the remaining
  columns into per-recipient `variables`, and reports **invalid rows** by line
  number.
- Saving recipients (`PUT .../recipients`) **replaces the whole set** in one
  transaction and resets the campaign to `draft`. Blocked while a campaign is
  `queued`/`sending`.

### 6d. Send (`POST /api/campaigns/[id]/send`) — the producer path

Guard rails first, then enqueue:

1. Reject if already `queued`/`sending` (409), if there's no subject, no Gmail
   connected, or no recipients (400).
2. In one transaction: mark all recipients `pending`, reset counters, set
   campaign `status = queued`, `total = N`.
3. `enqueueSends(campaignId, recipientIds)` — **one job per recipient**, added in
   `addBulk` chunks of 500 (so a multi-thousand-recipient campaign doesn't blow
   past a hosted Redis request-size limit).
4. `wakeWorker()` — HTTP-ping the worker's `/healthz` so a **scaled-to-zero**
   worker boots and starts draining. No-op locally.

Job options: `attempts: 3`, exponential backoff (5s), `removeOnComplete: 1000`,
`removeOnFail: 5000` (bounded so Redis memory stays flat on the 256 MB free
tier).

### 6e. Process a job — the consumer path (the heart of the system)

`apps/worker/src/index.ts`, per job (`{ campaignId, recipientId }`):

1. **Idempotency:** load the recipient; if it's already `sent`, return. Retries
   and duplicate jobs can't double-send.
2. On the first job, flip campaign `queued → sending`.
3. **Daily cap:** check the user's rolling 24h sent count against
   `DAILY_SEND_LIMIT` (default 450, under Gmail's ~500). Over the cap → mark the
   recipient `failed` with "resend tomorrow" and stop.
4. Get (or build + cache) the user's SMTP transport. Merge the template with this
   recipient's variables. Send both an **HTML** and a **plain-text** body.
5. On success: `countSend`, then in one transaction mark recipient `sent`
   (`sentAt = now`) and `increment` the campaign's `sent`.
6. On failure: only record a **terminal** `failed` once BullMQ's retries are
   exhausted (`attemptsMade + 1 >= attempts`); otherwise re-throw so BullMQ
   retries with backoff. Invalidate the cached transport in case it's the thing
   that broke.
7. `maybeFinalize`: when nothing is `pending` left, set the campaign to
   `completed` (if anything sent) or `failed` (if nothing did).

Worker tuning: `concurrency: 3` but a **rate limiter of `max: 1 per 1200ms`** —
so effectively ~1 email every 1.2s regardless of concurrency, to avoid tripping
Gmail's anti-spam. 500 recipients ≈ 10 minutes.

### 6f. Watching progress + resending

- The campaign editor **polls** `GET .../status`, which returns counters + a
  lightweight per-recipient list (id/email/status/error) — it deliberately
  **omits `variables`** (the bulk of the payload, and unchanging mid-send).
- **Resend failed** re-queues only the `failed` recipients (same enqueue + wake
  path), useful after hitting the daily cap or transient SMTP errors.

---

## 7. Security — the decisions to lead with

This is where the project scores points. Be able to explain each:

1. **App passwords encrypted at rest (AES-256-GCM).** Stored as
   `iv:authTag:ciphertext`, all hex. GCM is **authenticated** encryption — the
   auth tag means tampered ciphertext fails to decrypt rather than yielding
   garbage. The 256-bit key lives only in env (`ENCRYPTION_KEY`), **shared
   between web and worker** (web encrypts, worker decrypts) and never in the DB.
2. **Verify-before-store for Gmail creds** — bad credentials never get persisted.
3. **Anti-enumeration login** — constant-time-ish behavior via the dummy bcrypt
   hash; identical response whether or not the account exists.
4. **Rate limiting** (Redis fixed-window, `lib/rate-limit.ts`) on signup, login,
   and password change. It **fails open**: if Redis is down, people can still log
   in — losing brute-force protection briefly beats locking everyone out.
5. **Re-auth on password change** — must supply the current password, so a stolen
   session can't silently take over the account.
6. **Database lockdown (`lockdown.sql`) — the subtle one.** Supabase auto-exposes
   the `public` schema through its REST Data API and grants the `anon` role
   (whose key is *designed to be public*) access to every table — which would
   make `passwordHash` and every recipient list **world-readable**. Mail Helper
   never uses the Data API (it talks to Postgres directly as the table owner via
   Prisma), so the lockdown script **revokes those roles entirely** and enables
   **RLS with no policies** as defense-in-depth. Must be re-run after any
   `prisma db push`.
7. **Ownership scoping** — every campaign/recipient query is filtered by
   `userId` (`findFirst({ where: { id, userId } })`), so users can't touch each
   other's data even by guessing IDs.
8. **HTML escaping** — the body is authored and previewed as plain text, so
   `renderHtmlBody` escapes *everything*, including values coming from spreadsheet
   cells. A cell containing `<script>` arrives as literal text, not markup — no
   injection into the recipient's email.

---

## 8. The hard part: making it free (scale-to-zero)

A long-running queue consumer is the **worst possible shape for free hosting** —
nobody rents you an idle process for $0. Three tricks make it work; this is prime
"tell me about an interesting technical challenge" material.

1. **The worker presents as an HTTP service.** It serves `/healthz` on `$PORT`,
   so free PaaS platforms (which usually only host *web* services, not background
   workers) will run it and can **scale it by request**.
2. **Wake-on-enqueue.** After queuing jobs, the web app pings
   `WORKER_WAKE_URL`. That inbound request scales the worker **0 → 1**, and it
   immediately drains whatever's already in Redis. Without this, a queued
   campaign would sit untouched until something happened to hit the worker.
3. **Self-ping during a campaign.** A throttled 500-recipient send takes ~10 min,
   longer than the idle window that scales the worker back down (Azure Container
   Apps idles a replica after 300s). So while jobs are flowing the worker pings
   *itself* every **2 minutes** (comfortably inside the 300s cooldown — pinging
   *at* the cooldown is a race the campaign loses). Once the queue is quiet, the
   pings stop and it drops back to zero. Billed only while actually sending.

Both pings **disable themselves when their env var is unset**, so the exact same
image runs unchanged on an always-on host.

**Cost-control detail:** `WORKER_DRAIN_DELAY` (default 30s) is how long the worker
blocks on an empty queue. BullMQ's default of 5s would burn ~500k Redis
commands/month doing nothing — the *entire* Upstash free quota. A newly queued
job still wakes the blocking read instantly, so the higher value costs no latency
but saves the quota.

**Two more free-tier sharp edges handled:**
- **Supabase pauses a project after 7 days idle** (manual click to resume). A
  GitHub Action runs a trivial query every 3 days to reset that timer — querying
  Postgres directly, because the lockdown stripped the Data API roles.
- **Outbound SMTP is blocked on most free tiers** (Render blocked ports 25/465/587
  in Sept 2025). This is why the worker is on Azure and not Render — a
  code-independent hosting constraint that's easy to miss until every send
  silently fails with `ENETUNREACH`.

---

## 9. Notable trade-offs & "why not X?"

Interviewers love these. Have an opinion ready.

| Decision | Why | Cost / when it'd change |
| --- | --- | --- |
| **One job per recipient** (not one per campaign) | Per-recipient retries, throttling, idempotency, and progress all fall out naturally. | Thousands of tiny Redis jobs. Fine at this scale; batch if you ever needed millions. |
| **Gmail SMTP** (not SendGrid/SES/Gmail API) | Zero cost, no domain, no verification; mail comes from the user's real address. | Hard ~500/day cap; App Password friction; not for true mass mail. |
| **Denormalized `sent/failed/total` counters** | Dashboard/finalize never aggregate; updated in the same txn as status. | Must keep counters and rows in sync — done transactionally. |
| **JWT sessions** | No session table, no per-request DB hit — serverless-friendly. | Can't revoke a token server-side before expiry. |
| **Cached daily-count in the worker** (re-read once/min, incremented locally) | The 24h COUNT joins every recipient the user ever had; per-job it'd dominate cost. Safe because **this process is the only sender.** | Would break if you ran multiple worker instances — see below. |
| **Rate limiter fails open** | Availability > brute-force protection for a self-hosted tool. | A Redis outage briefly removes throttling. |
| **Escape-everything HTML** | Body is authored/previewed as plain text; kills injection from sheet cells. | No rich-text/HTML emails (a deliberate scope cut). |

---

## 10. Likely interview questions (with crisp answers)

**Q: Walk me through what happens when a user clicks "Send."**
A: See §6d→6e. Producer validates, resets state, enqueues one job per recipient in
chunks, pings the worker. Worker wakes, drains the queue, and for each job:
idempotency check → daily-cap check → merge template → send via cached SMTP
transport → transactionally mark sent + bump counter → finalize when nothing's
pending. Throttled to ~1/1.2s; failures retry 3× with backoff before becoming
terminal.

**Q: How do you make sure nobody gets the same email twice?**
A: Jobs are keyed by `recipientId`; the first thing the handler does is skip
anything already `sent`. So a BullMQ retry or a duplicate enqueue is a no-op.
The DB status is the source of truth, not the queue.

**Q: How do you avoid getting the sender's Gmail flagged as spam / hitting
limits?**
A: A worker-level rate limiter (`max 1 / 1200ms`) paces sends regardless of
concurrency, and a per-user rolling-24h cap (`DAILY_SEND_LIMIT`, default 450)
stays under Gmail's ~500/day. Over-cap recipients are marked "resend tomorrow"
and can be retried the next day.

**Q: Where's the security risk in storing someone's Gmail password, and how do
you handle it?**
A: It's an **App Password**, not the account password, and it's stored
**AES-256-GCM encrypted** with a key that lives only in env and never in the DB.
GCM is authenticated so tampering is detected. It's verified against Gmail before
we ever store it. And the database itself is locked down so Supabase's public API
roles can't read the table at all.

**Q: This runs on free tiers — what breaks and how did you keep it alive?**
A: See §8. The worker is a long-running process on scale-to-zero hosting, kept
alive by wake-on-enqueue + a 2-minute self-ping during sends, and idled back to
zero afterward. Supabase's 7-day idle pause is countered by a scheduled query.
Outbound-SMTP blocking dictated the host choice.

**Q: Why a separate worker? Why not send from the API route?**
A: Serverless functions are short-lived and can't hold a connection open to drip
500 throttled emails over ~10 minutes; they'd time out. Sending needs a
long-running process, so the API only enqueues and a dedicated consumer sends.
It also decouples the two — the UI stays responsive and a send crash can't take
the web app down.

**Q: What if you needed to scale to multiple workers?**
A: The one thing that assumes a single sender is the **in-memory cached daily
count** (`dailyCounts` map) — it's only exact because this process is the only
one incrementing it. With multiple workers you'd move that to an atomic Redis
counter (or just always read from Postgres and accept the query cost). BullMQ,
the DB writes, and idempotency are already multi-consumer safe; the rate limiter
would need to become a global (Redis) limiter too.

**Q: How do you handle a recipient whose send fails?**
A: BullMQ retries 3× with exponential backoff. Only once retries are exhausted do
we write a terminal `failed` with the error message. The user sees per-recipient
errors in the UI and can hit **Resend failed** to re-queue just those.

**Q: How is the template rendered? Injection concerns?**
A: `{{ name }}`-style placeholders, matched case-sensitively against the
recipient's columns; missing values become empty strings. Both a plain-text and
an HTML part are sent. The HTML part **escapes everything** — since the body is
authored/previewed as plain text, any markup could only come from a spreadsheet
cell, so it's neutralized.

**Q: How does the monorepo help here?**
A: `packages/core` (crypto, template, schemas) and `packages/queue` (job types,
Redis config) are **shared by both producer and worker** — the exact same
encryption, the exact same job shape, the exact same validation on both sides of
the queue. That's what guarantees the worker can decrypt what the web app
encrypted and parse the jobs it enqueued.

---

## 11. If asked "what would you improve?"

Honest, forward-looking answers signal seniority:

- **Move the daily-count out of process memory** into Redis so the worker can
  scale horizontally.
- **Webhooks/SSE instead of polling** the status endpoint.
- **OAuth (Gmail API) as an alternative to App Passwords** — better UX and no
  stored secret, at the cost of a Google verification process.
- **Bounce/complaint handling** — right now "sent to SMTP" isn't "delivered."
- **Tests** — the pure logic (crypto round-trip, template merge, recipient
  parsing, the daily-cap math) is very unit-testable; that's the first thing I'd
  add.
- **A scheduled auto-resend** for the "hit the daily cap, try tomorrow" case.

---

## 12. 30-second version (if you only get one breath)

> Mail Helper is a mail-merge tool: one template plus a spreadsheet of
> recipients, and it sends each person a private email from your own Gmail.
> Architecturally it's a producer/consumer split — a Next.js app enqueues one job
> per recipient onto a Redis/BullMQ queue, and a separate long-running worker
> drains it, sending through Gmail SMTP throttled to ~1/1.2s with a daily cap,
> per-recipient retries, and idempotency. The hard parts were security — Gmail
> credentials are AES-256-GCM encrypted and the database is locked down against
> Supabase's public API — and making a long-running worker survive on
> scale-to-zero free hosting via wake-on-enqueue and self-pings. It runs on $0
> with no credit card.
