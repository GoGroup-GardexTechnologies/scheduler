# IVDMS Distributed Scheduler

A lightweight, Redis-coordinated job scheduler that periodically triggers cron endpoints on the VDMS backend. Designed to run as one or more stateless containers — Redis-based distributed locking ensures each job fires exactly once across all instances.

---

## How it works

On startup the scheduler connects to Redis and registers a `SimpleIntervalJob` for every enabled webhook defined in `src/config.ts`. When an interval fires, a `TaskCoordinator` acquires a Redis lock before making the HTTP call to the backend. If another instance already holds the lock the job is skipped for that cycle.

```
[Scheduler instance 1]  ──┐
[Scheduler instance 2]  ──┼──> Redis lock ──> POST /api/cron/<job> ──> VDMS Backend
[Scheduler instance N]  ──┘
```

---

## Scheduled jobs

| Job | Endpoint | Interval | Description |
|-----|----------|----------|-------------|
| `track-examination-expiry` | `/trackExaminationExpiry` | 5 min | Marks examinations as FAILED when their end time has passed |
| `track-process-output-document-expiry` | `/trackProcessOutputDocumentExpiry` | 30 min | Expires active process output documents whose `validUntil` has passed |
| `track-process-output-document-for-penalty-fees` | `/trackProcessOutputDocumentForPenaltyFees` | 30 min | Enqueues penalty-fee generation for expired documents |
| `track-payment-lock-expiry` | `/trackPaymentLockExpiry` | 5 min | Releases payment locks whose release time has passed |
| `refresh-ocas-compliance-scores` | `/refreshOcasComplianceScores` | 24 h | Refreshes OCAS compliance scores for all operators active in the scoring window |

---

## Environment variables

Copy `development.env` and fill in the values. All variables marked **required** must be set or the process will exit on startup.

| Variable | Required | Description |
|----------|----------|-------------|
| `SCHEDULER_SECRET` | Yes | Shared secret sent as `x-scheduler-secret` — must match `SCHEDULER_SECRET` in the VDMS backend |
| `REDIS_HOST` | Yes | Redis hostname |
| `REDIS_PORT` | Yes | Redis port |
| `REDIS_PASSWORD` | No | Redis password (omit if none) |
| `IVDMS_SERVICE_URI` | No | Base URL of the VDMS backend cron router (default: `http://localhost:8888/api/cron`) |
| `ADMIN_SECRET` | No | Protects the `/stats` and `/webhooks` endpoints — set this in production |
| `PORT` | No | HTTP port the scheduler listens on (default: `6767`) |
| `NODE_ENV` | No | `development` or `production` (default: `development`) |
| `LOG_LEVEL` | No | Pino log level: `debug`, `info`, `warn`, `error` (default: `info`) |
| `INSTANCE_ID` | No | Human-readable instance label prepended to the generated instance ID (defaults to `$HOSTNAME`) |

---

## HTTP endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | None | Service info |
| `GET` | `/health` | None | Health check — used by Docker/k8s probes |
| `GET` | `/redis/health` | None | Redis connection status |
| `GET` | `/stats` | `x-admin-secret` | Detailed scheduler and task execution statistics |
| `GET` | `/webhooks` | `x-admin-secret` | Lists all configured webhooks |

The `/stats` and `/webhooks` endpoints require the `x-admin-secret` header to match `ADMIN_SECRET`.

---

## Development

```bash
# Install dependencies
npm install

# Start with hot reload
npm run dev

# Run tests
npm test
```

To hit the protected endpoints locally:

```bash
curl -H "x-admin-secret: dev-admin-secret-replace-in-production" http://localhost:6767/stats
curl -H "x-admin-secret: dev-admin-secret-replace-in-production" http://localhost:6767/webhooks
```

---

## Docker

### Build the image

```bash
docker build -t gardextechnologies/ivdms-scheduler:latest .

# Tag a versioned release
docker tag gardextechnologies/ivdms-scheduler:latest \
           gardextechnologies/ivdms-scheduler:1.0.0
```

### Push to Docker Hub

```bash
docker login
docker push gardextechnologies/ivdms-scheduler:latest
docker push gardextechnologies/ivdms-scheduler:1.0.0
```

### Run the container

Pass all secrets and configuration via environment variables — never bake them into the image.

```bash
docker run -d \
  -p ${PORT:-6767}:${PORT:-6767} \
  -e PORT=${PORT:-6767} \
  -e SCHEDULER_SECRET=your-secret \
  -e ADMIN_SECRET=your-admin-secret \
  -e REDIS_HOST=your-redis-host \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=your-redis-password \
  -e IVDMS_SERVICE_URI=https://your-backend/api/cron \
  --name ivdms-scheduler \
  gardextechnologies/ivdms-scheduler:latest
```

### Docker Compose example

```yaml
services:
  ivdms-scheduler:
    image: gardextechnologies/ivdms-scheduler:latest
    restart: unless-stopped
    ports:
      - "${PORT:-6767}:${PORT:-6767}"
    environment:
      PORT: ${PORT:-6767}
      SCHEDULER_SECRET: ${SCHEDULER_SECRET}
      ADMIN_SECRET: ${ADMIN_SECRET}
      REDIS_HOST: ${REDIS_HOST}
      REDIS_PORT: ${REDIS_PORT}
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      IVDMS_SERVICE_URI: ${IVDMS_SERVICE_URI}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${PORT:-6767}/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

---

## Project structure

```
src/
  config.ts                  # Webhook definitions and environment config
  globals.ts                 # Global constants and environment variable reads
  index.ts                   # Express app and graceful shutdown
  scheduler/
    index.ts                 # Job scheduling and task coordination
  routes/
    index.ts                 # HTTP endpoints
  services/
    WebhookService.ts        # HTTP POST requests to the VDMS backend
    TaskCoordinator.ts       # Distributed task execution with Redis locking
    RedisManager.ts          # Redis connection management
  locks/
    DistributedLock.ts       # Redis-based distributed lock implementation
  utils/
    index.ts                 # Pino logger setup
  __tests__/
    setup.ts                 # Jest env var setup (runs before all tests)
    WebhookService.test.ts   # Header, payload, timeout, and error handling tests
    routes.test.ts           # Auth and response shape tests for all HTTP endpoints
    DistributedLock.test.ts  # Lock acquire/release logic tests
```
