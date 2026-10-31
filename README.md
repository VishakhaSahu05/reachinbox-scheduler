# ReachInbox Email Scheduler

**Live:** https://reachinbox-scheduler.koreacentral.cloudapp.azure.com (queue dashboard at `/admin/queues` after login)

A small email scheduling service with a dashboard. Users sign in with Google, upload a list of leads, and schedule a campaign. Every email becomes a BullMQ delayed job, a worker sends it through Ethereal SMTP at the right time, and per-sender and per-campaign hourly limits are enforced in Redis. The system survives restarts without losing or duplicating emails. When a limit is hit, a Slack message goes to the user's connected channel.

## Tech stack

| Layer    | Choice |
| -------- | ------ |
| Backend  | TypeScript, Express 5, Prisma (PostgreSQL), BullMQ + ioredis, nodemailer (Ethereal), Elasticsearch 8, Bull Board, pino |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, React Router, TanStack Query |
| Infra    | PostgreSQL 16, Redis 7 (AOF), Elasticsearch 8.15 via `docker-compose.yml` |
| Tests    | Vitest (backend unit + Redis integration tests, frontend unit tests) |

## Repository layout

```
backend/
  prisma/schema.prisma        data model + migrations
  src/
    server.ts                 API entry point
    worker.ts                 BullMQ worker entry point
    app.ts                    Express app, routes, Bull Board mount
    config/env.ts             env validation (zod)
    modules/
      auth/                   Google OAuth, session cookie
      campaigns/              schedule API + send-time planner
      emails/                 list/detail/counts, Elasticsearch index + search
      senders/                Ethereal sender provisioning
      slack/                  Slack OAuth, rate-limit alerts
    queue/
      email-queue.ts          queue + enqueue helpers
      send-email.processor.ts what the worker does per job
      rate-limiter.ts         Lua script: throttles + hourly counters
      reconcile.ts            re-creates missing jobs on worker start
    scripts/                  reindex, load-test, list senders
  tests/
frontend/
  src/
    api/                      fetch client, types, React Query hooks
    components/ui/            Button, Input, Popover, Toast, StatusBadge, ...
    components/layout/        sidebar, header, user menu
    features/                 auth, emails, compose, slack
docker-compose.yml
```

## Running it locally

### 1. Infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL on port **5433** (so it doesn't clash with a local install), Redis on 6379 with AOF persistence and `noeviction`, and Elasticsearch 8.15.3 on 9200 with security disabled.

### 2. Backend

```bash
cd backend
cp .env.example .env          # then fill in Google / Slack credentials, see below
npm install
npx prisma migrate deploy
npm run dev                   # API on :4000 + worker, via concurrently
```

- `npm run dev:api` and `npm run dev:worker` run the two processes separately. You can start several workers; they coordinate through Redis.
- For production: `npm run build && npm start`.
- On first boot the API creates three Ethereal sender accounts and the Elasticsearch index.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Vite proxies `/api` and `/admin` to `http://localhost:4000`, so the browser only talks to one origin and the session cookie just works.

### Tests

```bash
cd backend && npm test        # planner unit tests + rate limiter tests against a real Redis
cd frontend && npm test       # lead parsing
```

### Deploying

`deploy/docker-compose.yml` runs the whole stack on a single VM with Docker: the app image (API, worker and the built dashboard on one origin), PostgreSQL, Redis, Elasticsearch, and Caddy, which gets an HTTPS certificate automatically.

```bash
cd deploy
cp .env.example .env          # domain, secrets, Google / Slack credentials
docker compose up -d --build
```

Add `https://<domain>/api/auth/google/callback` and `https://<domain>/api/slack/callback` as redirect URLs in Google and Slack. The host must allow outbound SMTP on port 587 for Ethereal.

## Configuration

### Google OAuth

1. In Google Cloud Console, create an **OAuth client ID** of type "Web application".
2. Authorized JavaScript origin: `http://localhost:5173`
3. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
4. Put the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

The backend runs the authorization-code flow with a `state` cookie, verifies the ID token, upserts the user, and sets a 7-day `httpOnly` session cookie.

### Slack

1. Create an app at https://api.slack.com/apps and add the **`incoming-webhook`** bot scope.
2. Slack only accepts **https** redirect URLs. Expose the API through a tunnel, e.g. `ngrok http 4000` or `cloudflared tunnel --url http://localhost:4000`.
3. Add `https://<tunnel-host>/api/slack/callback` as a redirect URL in the Slack app.
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_REDIRECT_URI` to that same URL.

The callback can land on the tunnel host, where the session cookie isn't available. So the user id is carried in a signed, 10-minute `state` token instead of the cookie.

### Ethereal

Nothing is required. If the `Sender` table is empty, the API creates `ETHEREAL_SENDER_COUNT` (default 3) accounts through the Ethereal API and stores them. Run `npm run senders` in `backend/` to print their logins, then sign in at https://ethereal.email to browse what was sent. Each sent email also gets a preview link, shown in the dashboard.

To use your own accounts instead:

```
ETHEREAL_SENDERS=[{"name":"Sales","user":"xxx@ethereal.email","pass":"yyy"}]
```

### Scheduler settings

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `WORKER_CONCURRENCY` | `5` | Jobs a single worker process handles in parallel |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Minimum gap between two sends **from the same sender** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hard cap per sender per window (0 = off) |
| `MAX_EMAILS_PER_HOUR` | `0` | Optional cap across all senders (0 = off) |
| `RATE_LIMIT_WINDOW_MS` | `3600000` | Window length. Keep one hour; shorten only for demos |
| `SEND_MAX_ATTEMPTS` | `3` | SMTP attempts before an email is marked failed |
| `MAIL_TRANSPORT` | `smtp` | `smtp` sends through Ethereal, `stub` skips SMTP (load testing) |

The delay I chose is **at least 2 seconds between sends per sender**. A campaign can ask for a longer delay in the compose form, but never a shorter one.

## Architecture

```
 Browser ──► Vite (5173) ──proxy──► Express API (4000) ──► PostgreSQL (source of truth)
                                        │   │
                                        │   └──► Elasticsearch (search index)
                                        ▼
                                  BullMQ queue "email-send" (Redis, AOF)
                                        │  one delayed job per email, jobId = email id
                                        ▼
                                  Worker(s) ──► Lua rate limiter (Redis)
                                        │
                                        ├──► Ethereal SMTP (nodemailer, pooled)
                                        └──► Slack webhook (on limit hits)
```

### How scheduling works

`POST /api/campaigns` does the following:

1. Validates the body with zod: up to 10,000 recipients, de-duplicated and lower-cased.
2. Works out every send time with `planSchedule()`. Emails are spaced by `max(campaign delay, MIN_DELAY_BETWEEN_EMAILS_MS)`, and no clock window gets more than `min(campaign hourly limit, per-sender cap)`. When a window is full, the next email moves to the start of the following window. That way the Scheduled tab shows realistic times from the start.
3. Writes the campaign and all its email rows in **one transaction**.
4. Adds one BullMQ **delayed job** per email (`addBulk` in chunks of 500), with `jobId = email.id` and `delay = scheduledAt - now`. There is no cron anywhere.
5. If the queue can't be reached, deletes the campaign again and returns 503, so nothing is left half-scheduled.
6. Bulk-indexes the emails into Elasticsearch. This is best effort; search can be rebuilt from Postgres.

### What the worker does per job

```
load email row ──► SENT/FAILED? ───────────────► done (no-op)
      │
      ├─ SENDING and stale (>5 min)? ──────────► mark FAILED (see "crash mid-send")
      ├─ SENDING and fresh? ───────────────────► check again in 60s
      ▼
acquire permit (one Lua script)
      ├─ wait      ─► slot reserved in the future, job.moveToDelayed(slotAt)
      ├─ reserved  ─► hourly limit hit, place reserved in a later window,
      │               row = RATE_LIMITED + new scheduledAt, Slack alert, moveToDelayed
      ├─ exhausted ─► no room in the look-ahead, retry at the end of it
      ▼ granted
claim row: UPDATE ... SET status='SENDING' WHERE status IN ('SCHEDULED','RATE_LIMITED')
      ▼ (0 rows updated → someone else has it, give the permit back, stop)
sleep until the granted send time (at most a few seconds)
      ▼
nodemailer.sendMail (pooled transport, Message-ID <emailId@reachinbox.local>)
      ├─ ok      ─► SENT, sentAt, messageId, Ethereal preview URL
      ├─ SMTP 5xx ─► FAILED right away (UnrecoverableError, no retries)
      └─ other   ─► back to SCHEDULED, BullMQ retries with exponential backoff (30s, 60s, ...),
                    FAILED after SEND_MAX_ATTEMPTS
```

Reschedules and final states (SENT / FAILED) are mirrored into Elasticsearch.

## Persistence and restarts

- **Delayed jobs live in Redis**, which runs with AOF enabled (`--appendonly yes`), so a Redis restart keeps them. When the API and worker restart, BullMQ picks up the same delayed jobs and fires them at their original times. Jobs that came due while everything was down run as soon as the worker is back, still subject to the rate limits.
- **Postgres is the source of truth.** On startup the worker scans every unfinished email (`SCHEDULED`, `RATE_LIMITED`, `SENDING`) and checks that it has a job. A missing job, or a job that finished while the row didn't, is re-added. Re-adding is safe because the job id is the email id. This covers Redis data loss and an enqueue that failed halfway.
- **Graceful shutdown.** On SIGINT or SIGTERM the worker calls `worker.close()`, which stops taking new jobs and waits for in-flight sends to finish before the process exits.
- **Crash in the middle of a send.** If the process dies after claiming a row but before recording the result, the row stays `SENDING`. BullMQ's stalled-job check hands the job out again. If the row is still `SENDING` after 5 minutes, the worker marks it `FAILED` with a clear reason **instead of sending it again**. Whether the SMTP server already accepted the message can't be known, and a duplicate cold email is worse than a missed one. This is a deliberate at-most-once choice for that narrow window, which is only the duration of one SMTP call. Everything outside that window is retried normally.

I tested all of these with real services: a graceful restart before the send time, the worker down while emails came due, jobs deleted from Redis by hand (they were re-created and sent), and a row left stuck in `SENDING` (it was marked failed and not re-sent).

## Idempotency

Several layers, each covering a different way a duplicate could appear:

| Layer | Protects against |
| ----- | ---------------- |
| `Idempotency-Key` header on `POST /api/campaigns`, unique on `(userId, idempotencyKey)` | Double clicks and retried requests creating a second campaign. The dashboard sends one key per compose session |
| `jobId = email.id` | The same email being queued twice, by reconciliation or anything else |
| Conditional claim `SCHEDULED/RATE_LIMITED → SENDING` | Two workers processing the same email at once |
| Unique `(campaignId, toAddress)` | The same recipient twice in one campaign |
| Stable `Message-ID` per email | Lets the receiving side recognise a retried message as the same one |

## Rate limiting and concurrency

All limits are enforced by **one Lua script** in `backend/src/queue/rate-limiter.ts`. Redis runs a script atomically, so the decision is consistent across any number of worker processes or machines. Nothing is counted in memory.

**Throttles (minimum gap between sends).** Each throttle is a key holding the earliest time the next send may start:

- per sender: `reachinbox:throttle:sender:{id}`, gap = `MIN_DELAY_BETWEEN_EMAILS_MS`
- per campaign: `reachinbox:throttle:campaign:{id}`, gap = the delay the user picked

**Hourly counters.** Fixed clock windows, keyed by window index (`floor(timestamp / RATE_LIMIT_WINDOW_MS)`):

- `reachinbox:rl:sender:{senderId}:{window}`: server-wide cap per sender
- `reachinbox:rl:campaign:{campaignId}:{window}`: the hourly limit set in the compose form
- `reachinbox:rl:global:{window}`: optional cap across all senders

Counters expire automatically one window after their own window ends.

**What the script decides:**

- **Granted.** Every counter has room. All counters are incremented, every throttle moves forward by its gap, and the worker sends at the returned time. With concurrency, parallel jobs for the same sender get consecutive slots (now, +2s, +4s, ...) instead of all firing together.
- **Wait.** The next free slot is more than 5 seconds away. Instead of keeping a worker busy, the slot is reserved and the job is delayed until then (`slotAt` is stored on the job). A job that comes back more than 2 seconds late loses its slot and queues again, so a backlog can't break the minimum gap.
- **Reserved (limit hit).** The email is **not dropped or failed**. The script finds the first later window that has room on every limit and increments those counters right away, which reserves the place. The job is delayed to `windowStart + (position - 1) × minDelay`, the row becomes `RATE_LIMITED` with its new `scheduledAt`, and the job remembers `reservedWindow` so it isn't counted twice when it runs. Emails pushed first get the earliest places, which preserves order. Because places are handed out in advance, 800 overflow emails don't all wake up at the next window start and fight over 200 slots.

**Why not BullMQ's built-in limiter.** It limits the whole queue (N jobs per duration). It can't express "200 per hour per sender" next to "50 per hour for this campaign", and an hourly limit there would simply stall the queue. Concurrency still comes from BullMQ (`WORKER_CONCURRENCY`, plus more worker processes if needed). The script is what makes that concurrency safe.

**Trade-offs**

- Windows are fixed clock windows (14:00–15:00), not sliding ones. That makes them simple to reason about and to show in the UI.
- A reservation whose job later disappears leaves an unused place in that window. The system can under-send slightly, but it never over-sends.
- The planner at schedule time only knows about its own campaign. When several campaigns share a sender, the runtime limiter does the final ordering.

### Behaviour under load (1000+ emails at the same moment)

1. Scheduling 1000 recipients is a single transaction plus two `addBulk` calls. In my runs it took about 1–2 seconds.
2. When they come due, the worker pulls them in FIFO order with `WORKER_CONCURRENCY` in parallel. Each one asks the limiter for a permit.
3. The first `cap` emails in the window are sent, spaced by the minimum delay. The rest are reserved into the following windows in order, and their new times appear in the Scheduled tab as "Rate limited".
4. Each window then sends exactly up to its cap, until everything is out.

Measured run: window shortened to 30 seconds, sender cap 200 per window, stub transport, and **two 500-email campaigns on the same sender scheduled for the same moment**.

| Window | Sent |
| ------ | ---- |
| 1 | 200 |
| 2 | 200 |
| 3 | 191 |
| 4 | 200 |
| 5 | 200 |
| 6 | 9 |

All 1000 were sent, no window went over 200, no email was rescheduled more than twice, and there were 0 duplicate Message-IDs.

To try it yourself, start a worker with `MAIL_TRANSPORT=stub` so Ethereal doesn't get a thousand emails, then run:

```bash
cd backend
npm run load-test -- --count 1000 --hourly 200 --delay 0 --user you@gmail.com
```

The script prints how the emails were spread over windows. Passing `--user` makes them show up in your own dashboard.

## Slack alerts

- **Connect.** "Connect Slack" in the header starts the real OAuth flow (`/oauth/v2/authorize` with the `incoming-webhook` scope). The callback exchanges the code with `oauth.v2.access`, and the webhook URL, channel, team and token are stored per user in `SlackConnection`. A short confirmation message is posted to the channel.
- **When a message is sent.** Either a send used up the last place in a window, or an email had to be pushed to a later window. The message says which limit was hit (sender cap, campaign limit or global cap), the window, and when sending resumes. Times use Slack's date formatting, so each reader sees their own timezone.
- **No spam.** One alert per user, limit and window, enforced with a Redis `SET NX` key.
- **Not connected.** The alert is skipped silently and nothing is remembered. When the user connects later, the next limit hit notifies them straight away, with no redeploy or restart. Slack failures are logged and never affect sending.
- **In the UI:** "Send test message", plus "Disconnect", which revokes the token so Slack removes the webhook too.

## Search (Elasticsearch)

- Index `emails`, one document per email: recipient, subject, body, status, sender, times.
- Addresses use a custom pattern analyzer, so `john.doe@acme.io` is indexed as `john`, `doe`, `acme`, `io`. Recipient and subject are `search_as_you_type` fields.
- Each word typed has to match some field, as a prefix. So "john acme" finds `john@acme.io`, and "rl-b" doesn't match everything that starts with "b".
- Elasticsearch returns ids; the rows are then loaded from Postgres, so statuses are never stale.
- If Elasticsearch is down, search falls back to a Postgres `ILIKE` on recipient and subject, and the UI says so.
- `npm run reindex` rebuilds the index from Postgres.

## Queue dashboard

Bull Board is mounted at **`/admin/queues`** (http://localhost:5173/admin/queues through the proxy) and requires a login. It shows delayed, active, completed and failed jobs live. There's a link in the sidebar and the user menu.

## API

All `/api` routes except auth and the Slack callback need the session cookie.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/health` | Postgres / Redis / Elasticsearch status |
| GET | `/api/config` | Server-side limits (used for hints in the compose form) |
| GET | `/api/auth/google` | Starts Google sign-in |
| GET | `/api/auth/google/callback` | OAuth callback, sets the session cookie |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Clears the session |
| GET | `/api/senders` | Available sender mailboxes |
| POST | `/api/campaigns` | Schedule a campaign (201 created, 200 for a repeated idempotency key) |
| GET | `/api/emails?view=scheduled\|sent&page=1&pageSize=25&q=` | Lists; `q` searches through Elasticsearch |
| GET | `/api/emails/counts` | `{ scheduled, sent, failed }` |
| GET | `/api/emails/:id` | Full email with body, attempts, preview link |
| GET | `/api/slack/status` | Connection state |
| GET | `/api/slack/connect` | Redirects to Slack's OAuth screen |
| GET | `/api/slack/callback` | OAuth callback |
| POST | `/api/slack/test` | Posts a test message |
| DELETE | `/api/slack` | Disconnects and revokes the token |

Example schedule request:

```http
POST /api/campaigns
Content-Type: application/json
Idempotency-Key: 4f7d0c2e-0b8a-4c1e-9d55-2a1f0e6b9c11

{
  "senderId": "6c1b0d0e-1f4a-4c55-9a43-1d6a7c2e8b10",
  "subject": "Quick question",
  "body": "Hi there,\n\nWould you be open to a short call next week?",
  "recipients": ["jane@acme.io", "john@example.com"],
  "startAt": "2026-11-01T09:00:00.000Z",
  "delayBetweenEmailsSec": 5,
  "hourlyLimit": 50
}
```

## Features implemented

**Backend**

- [x] Schedule API storing campaigns and emails in PostgreSQL
- [x] BullMQ delayed jobs, one per email, with no cron of any kind
- [x] Multiple Ethereal senders, auto-provisioned or configured
- [x] Persistence across restarts (Redis AOF, startup reconciliation, graceful shutdown)
- [x] Idempotency at the request, queue, database and message level
- [x] Configurable worker concurrency, safe with parallel jobs and multiple workers
- [x] Minimum delay between sends per sender (Redis-backed) plus per-campaign delay
- [x] Hourly limits per sender, per campaign and optionally global; overflow is rescheduled in order, never dropped
- [x] Slack OAuth plus live alerts when a limit is reached, handling disconnect and reconnect
- [x] Elasticsearch indexing and search with a Postgres fallback
- [x] Bull Board dashboard
- [x] Unit tests (planner) and integration tests (Lua limiter against Redis)

**Frontend**

- [x] Real Google login; redirect to the dashboard; logout
- [x] Header showing name, email and avatar
- [x] Sidebar with Compose, Scheduled and Sent, with live counts
- [x] Compose: sender, recipients (type, paste, or upload CSV/TXT with a detected count), subject, body, delay between emails, hourly limit, start time through the "Send Later" picker
- [x] Scheduled and Sent lists with email, subject, time and status chip; loading skeletons, empty states, error states, pagination, search
- [x] Lists refresh every 5 seconds, so emails visibly move from Scheduled to Sent
- [x] Email detail page with attempts, reschedules, Message-ID and an Ethereal preview link
- [x] Toasts for success and errors; Slack connect, test and disconnect from the header
- [x] Typed API layer with reusable UI components (Button, Input, Field, Popover, Toast, StatusBadge, EmptyState, Pagination, Avatar)

## Assumptions and trade-offs

- **Design.** The assignment text didn't include a working Figma link, so the UI follows the usual ReachInbox layout: a sidebar with Compose and Scheduled/Sent, list rows with status chips, and a "Send Later" popover with presets. Two things were left out on purpose: email/password login (only Google login is required, and fake fields would do nothing) and a rich-text toolbar (bodies are plain text, sent as text plus simple HTML).
- **Senders are a shared pool.** The per-sender cap therefore applies across all users, as a real mailbox limit would. Campaign limits are per campaign.
- **Secrets at rest.** Slack tokens and SMTP passwords are stored in plain text in the database. In production I would encrypt them or keep them in a secrets manager.
- **Fixed windows** instead of sliding ones (see the rate limiting section). Windows are aligned to UTC hours, so in IST they start at :30 (e.g. 17:30–18:30).
- **At-most-once for a crash during SMTP.** Explained under "Persistence and restarts".
- **Bull Board shows every user's jobs.** It's an operator tool behind login, not a per-user view.
- **Sessions** are a 7-day JWT in an `httpOnly`, `SameSite=Lax` cookie. Logout clears the cookie; there is no server-side session list.
- **Elasticsearch is secondary.** Postgres is always the source of truth, and the index can be rebuilt with `npm run reindex`.
