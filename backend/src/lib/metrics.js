const httpRequests = new Map();
const httpErrors = new Map();
const httpDurations = new Map();
const gps = { ticks: 0, failures: 0, count: 0, sumMs: 0 };
const startedAt = Date.now();

function bump(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

export function observeHttp({ method, status, durationMs }) {
  bump(httpRequests, `${method}|${status}`);
  if (status >= 400) bump(httpErrors, `${Math.floor(status / 100)}xx`);
  const key = httpDurations.get(method) || { count: 0, sum: 0 };
  key.count += 1;
  key.sum += durationMs;
  httpDurations.set(method, key);
}

export function observeGpsTick({ ok, durationMs }) {
  gps.ticks += 1;
  if (!ok) gps.failures += 1;
  gps.count += 1;
  gps.sumMs += durationMs;
}

function renderHttp() {
  const out = [];
  for (const [key, value] of httpRequests) {
    const [method, status] = key.split('|');
    out.push(`fleet_http_requests_total{method="${method}",status="${status}"} ${value}`);
  }
  for (const [klass, value] of httpErrors) out.push(`fleet_http_errors_total{class="${klass}"} ${value}`);
  for (const [method, value] of httpDurations) {
    out.push(`fleet_http_request_duration_ms_count{method="${method}"} ${value.count}`);
    out.push(`fleet_http_request_duration_ms_sum{method="${method}"} ${value.sum}`);
  }
  return out;
}

export function renderMetrics() {
  const lines = [
    '# HELP fleet_http_requests_total HTTP requests by method and status',
    '# TYPE fleet_http_requests_total counter',
    '# HELP fleet_http_errors_total HTTP responses with status >= 400 by class',
    '# TYPE fleet_http_errors_total counter',
    '# HELP fleet_http_request_duration_ms HTTP request duration in milliseconds',
    '# TYPE fleet_http_request_duration_ms summary',
    ...renderHttp(),
    '# HELP fleet_gps_simulator_ticks_total DEMO GPS simulator ticks',
    '# TYPE fleet_gps_simulator_ticks_total counter',
    `fleet_gps_simulator_ticks_total ${gps.ticks}`,
    '# HELP fleet_gps_simulator_tick_failures_total DEMO GPS simulator failed ticks',
    '# TYPE fleet_gps_simulator_tick_failures_total counter',
    `fleet_gps_simulator_tick_failures_total ${gps.failures}`,
    '# HELP fleet_gps_simulator_tick_duration_ms DEMO GPS simulator tick duration',
    '# TYPE fleet_gps_simulator_tick_duration_ms summary',
    `fleet_gps_simulator_tick_duration_ms_count ${gps.count}`,
    `fleet_gps_simulator_tick_duration_ms_sum ${gps.sumMs}`,
    '# HELP fleet_process_uptime_seconds Process uptime in seconds',
    '# TYPE fleet_process_uptime_seconds gauge',
    `fleet_process_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
    '# HELP fleet_process_resident_memory_bytes Resident memory size',
    '# TYPE fleet_process_resident_memory_bytes gauge',
    `fleet_process_resident_memory_bytes ${process.memoryUsage().rss}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function resetMetrics() {
  httpRequests.clear();
  httpErrors.clear();
  httpDurations.clear();
  gps.ticks = 0;
  gps.failures = 0;
  gps.count = 0;
  gps.sumMs = 0;
}
