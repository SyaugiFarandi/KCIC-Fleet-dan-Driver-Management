# Observability Guide

Covers the P1 observability remediation: structured logs, request correlation, health
checks, metrics, background-job monitoring, and alert guidance. The application emits the
signals; it does not ship an external monitoring stack (no Grafana/Loki/Sentry account is
configured or claimed).

## 1. Structured logs

Every log line is a single JSON object on stdout (info) or stderr (warn/error):

```json
{"ts":"2026-11-23T09:50:58.847Z","level":"info","service":"fleet-api","env":"development","message":"http_request","requestId":"6ba982d4-…","method":"GET","path":"/api/health","status":200,"durationMs":10,"userId":null}
```

| Field | Meaning |
| --- | --- |
| `ts` | ISO-8601 UTC timestamp |
| `level` | `info` / `warn` / `error` |
| `service`, `env` | Constant service tag and `NODE_ENV` |
| `message` | Event name (`http_request`, `server_started`, `gps_simulator_tick_failed`, …) |
| `requestId` | Correlation ID (see §2) |
| `method`, `path`, `status`, `durationMs` | HTTP access log; `path` excludes the query string |
| `userId` | Authenticated user when known, else `null` |

Logged lifecycle events: `server_started`, `server_shutdown`, `gps_simulator_started`,
`health_database_check_failed`, `request_failed` (5xx), `audit_write_failed`,
`notification_create_failed`, `notification_broadcast_failed`,
`notification_reminder_sweep_failed`, `gps_stream_failed`, `notification_stream_failed`,
`unhandled_rejection`, `uncaught_exception`.

**Secrets are never logged.** Request bodies, headers, cookies and the `Authorization`
header are never included. The logger additionally redacts any meta key matching
`password|token|secret|authorization|cookie|jwt|api_key` and truncates long strings. The JWT
is delivered via an httpOnly cookie and is not readable by client JS.

Access logs are suppressed when `NODE_ENV=test` to keep test output readable; structured
errors are also suppressed there.

## 2. Request correlation

`X-Request-Id` middleware:

1. Accepts an inbound `X-Request-Id` if it matches `[A-Za-z0-9._-]{8,128}` (safe for logs).
2. Otherwise generates a UUID v4.
3. Echoes it on the response and includes it in every access/error log for that request.

Use it to join nginx access logs (`$http_x_request_id` → log `X-Request-Id`), API logs, and
client error reports.

## 3. Health checks

`GET /api/health` (unauthenticated, used by Docker healthcheck):

```json
{
  "ok": true,
  "database": "up",
  "checks": {
    "database": { "status": "up", "latencyMs": 5 },
    "gpsSimulator": {
      "status": "running",
      "mode": "DEMO_SIMULATOR",
      "intervalMs": 15000,
      "lastTickAgeSeconds": 5,
      "lastError": null
    }
  },
  "uptimeSeconds": 6
}
```

- HTTP `200` only when the database query succeeds; `503` when it fails.
- `gpsSimulator.status` is `disabled`, `running`, or `error`. `mode` is always
  `DEMO_SIMULATOR` — this is not real GPS hardware.
- `lastTickAgeSeconds` stalling beyond ~3× `intervalMs` indicates a stuck background job.

## 4. Metrics

`GET /api/metrics` returns Prometheus text format, protected by a shared token in the
`X-Metrics-Token` header.

- Set `METRICS_TOKEN` (≥16 chars) in the environment. When unset the endpoint returns
  `404` (hidden). Production startup logs a warning and refuses tokens shorter than 16 chars.
- Scrape example:

```yaml
scrape_configs:
  - job_name: kcic-fleet-api
    metrics_path: /api/metrics
    static_configs:
      - targets: ["api:4000"]
    http_headers:
      X-Metrics-Token:
        values: ["<METRICS_TOKEN>"]
```

Metrics exposed:

| Metric | Type | Use |
| --- | --- | --- |
| `fleet_http_requests_total{method,status}` | counter | Traffic volume, error rate |
| `fleet_http_errors_total{class}` | counter | 4xx/5xx trend |
| `fleet_http_request_duration_ms_count/sum{method}` | summary | Average latency |
| `fleet_gps_simulator_ticks_total` | counter | Background job is alive |
| `fleet_gps_simulator_tick_failures_total` | counter | Background job errors |
| `fleet_gps_simulator_tick_duration_ms_count/sum` | summary | Job latency |
| `fleet_process_uptime_seconds` | gauge | Restarts |
| `fleet_process_resident_memory_bytes` | gauge | Memory growth |

## 5. Suggested alerts

| Alert | Condition (example) | Severity |
| --- | --- | --- |
| API down | `up{job="kcic-fleet-api"} == 0` for 2m | Page |
| Database down | `/api/health` non-200 or `database!="up"` for 2m | Page |
| 5xx error rate | `sum(rate(fleet_http_errors_total{class="5xx"}[5m])) / sum(rate(fleet_http_requests_total[5m])) > 0.05` for 5m | Page |
| 4xx spike | 4xx ratio > 20% for 15m (possible auth brute force) | Ticket |
| Latency | `fleet_http_request_duration_ms_sum / fleet_http_request_duration_ms_count > 1000` (ms) for 10m | Ticket |
| Simulator stalled | `time() - fleet_gps_simulator_last_tick` style check via `lastTickAgeSeconds` in health > 60s, or tick counter flat for 5m | Ticket |
| Simulator failures | `increase(fleet_gps_simulator_tick_failures_total[15m]) > 3` | Ticket |
| Memory | RSS > 80% of container limit for 15m | Ticket |
| Restart loop | `changes(fleet_process_uptime_seconds[10m])` decreasing repeatedly | Page |

Log-based alerts (Loki/CloudWatch): count `level:"error"` per 5m; alert on
`uncaught_exception`/`unhandled_rejection` immediately.

## 6. Verified in this environment

- `GET /api/health` returned 200 with `database.latencyMs` and `gpsSimulator.status="running"`.
- `GET /api/metrics` returned 401 without the token and 200 with it; counters included the
  preceding health/login calls.
- Access log line observed with request ID, correct path, status and duration; the login
  request body/password never appears in logs.
- `node --test test/observability.test.js test/observability-hidden.test.js` — 4/4 pass.

## 7. Known gaps

- Logs go to container stdout/stderr only; ship them (Loki, CloudWatch, ELK) to persist.
- In-process counters reset on restart; use Prometheus, not the endpoint, for history.
- No tracing (OpenTelemetry) integration; request IDs provide coarse correlation.
- Metrics endpoint is intentionally token-gated; it is not exposed publicly through nginx.
