import { getEnvValue } from "./settings.js";

const TREND_DAYS = 14;
const PAGE_SIZE = 1000;
const MAX_ROWS = 5000;
const DASHBOARD_MAX_ROWS = 20000;
const DEFAULT_TABLE = "analytics_events";
const DEFAULT_LABEL = "Connected Project";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

interface SourceRow {
  event_type?: string;
  created_at?: string;
  visitor_id?: string;
  path?: string;
  device?: string;
  referrer_host?: string;
  session_id?: string;
}

export interface ExternalAnalyticsSummary {
  configured: boolean;
  error?: string;
  label?: string;
  totals?: {
    totalEvents: number;
    uniqueVisitors: number;
    byEventType: Array<{ eventType: string; count: number }>;
  };
  daily?: Array<{ date: string; events: number; visitors: number }>;
}

function config() {
  const url = getEnvValue("ANALYTICS_SOURCE_URL")?.replace(/\/+$/, "");
  const serviceKey = getEnvValue("ANALYTICS_SOURCE_SERVICE_KEY");
  const rawTable = getEnvValue("ANALYTICS_SOURCE_TABLE")?.trim();
  const table = rawTable && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawTable) ? rawTable : DEFAULT_TABLE;
  const label = getEnvValue("ANALYTICS_SOURCE_LABEL")?.trim() || DEFAULT_LABEL;
  return { url, serviceKey, table, label };
}

export function isExternalAnalyticsConfigured(): boolean {
  const { url, serviceKey } = config();
  return Boolean(url && serviceKey);
}

export function getAnalyticsSourceLabel(): string {
  return config().label;
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Pulls raw rows (bounded at maxRows) straight from the connected project's
 * Supabase table via the service role key — no changes needed on that
 * project's side, since this just reads the table directly like any other
 * PostgREST client would.
 */
async function fetchRows(
  url: string,
  serviceKey: string,
  table: string,
  select: string,
  sinceIso: string,
  maxRows: number,
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  let offset = 0;
  while (offset < maxRows) {
    const qs = new URLSearchParams({ select, created_at: `gte.${sinceIso}`, order: "created_at.asc" });
    const res = await fetch(`${url}/rest/v1/${table}?${qs.toString()}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Analytics source responded ${res.status} ${res.statusText}`.trim());
    const page = (await res.json()) as SourceRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function getExternalAnalytics(): Promise<ExternalAnalyticsSummary> {
  const { url, serviceKey, table, label } = config();
  if (!url || !serviceKey) return { configured: false };

  const since = new Date();
  since.setDate(since.getDate() - (TREND_DAYS - 1));
  since.setHours(0, 0, 0, 0);

  let rows: SourceRow[];
  try {
    rows = await fetchRows(url, serviceKey, table, "event_type,created_at,visitor_id", since.toISOString(), MAX_ROWS);
  } catch (err) {
    return { configured: true, label, error: err instanceof Error ? err.message : String(err) };
  }

  const uniqueVisitors = new Set<string>();
  const byEventType = new Map<string, number>();
  const dayBuckets = new Map<string, { events: number; visitors: Set<string> }>();
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayBuckets.set(d.toISOString().slice(0, 10), { events: 0, visitors: new Set() });
  }

  for (const row of rows) {
    if (row.visitor_id) uniqueVisitors.add(row.visitor_id);
    const type = row.event_type || "unknown";
    byEventType.set(type, (byEventType.get(type) ?? 0) + 1);

    if (!row.created_at) continue;
    const bucket = dayBuckets.get(isoDate(row.created_at));
    if (!bucket) continue;
    bucket.events += 1;
    if (row.visitor_id) bucket.visitors.add(row.visitor_id);
  }

  return {
    configured: true,
    label,
    totals: {
      totalEvents: rows.length,
      uniqueVisitors: uniqueVisitors.size,
      byEventType: [...byEventType.entries()]
        .map(([eventType, count]) => ({ eventType, count }))
        .sort((a, b) => b.count - a.count),
    },
    daily: [...dayBuckets.entries()].map(([date, b]) => ({ date, events: b.events, visitors: b.visitors.size })),
  };
}

// ---------- Full dashboard (opened as its own page/tab) ----------

interface MetricTotals {
  visitors: number;
  pageViews: number;
  logins: number;
  signups: number;
  linkVisits: number;
  listingViews: number;
  bookingStarts: number;
  clicks: number;
}

interface DailyPoint extends MetricTotals {
  date: string;
}

export interface ExternalAnalyticsDashboard {
  configured: boolean;
  error?: string;
  label?: string;
  range?: { key: string; days: number };
  totals?: { current: MetricTotals; previous: MetricTotals; pctChange: Record<keyof MetricTotals, number> };
  daily?: DailyPoint[];
  device?: Array<{ device: string; visitors: number; pct: number }>;
  topPages?: Array<{ path: string; views: number }>;
  sources?: Array<{ source: string; visitors: number }>;
  exitPages?: Array<{ path: string; exits: number; exitRate: number }>;
  funnel?: Array<{ stage: string; count: number }>;
  peakHours?: { cells: Array<{ dow: number; hour: number; count: number }>; max: number };
}

const EVENT_METRIC: Record<string, keyof MetricTotals> = {
  page_view: "pageViews",
  login: "logins",
  signup: "signups",
  link_visit: "linkVisits",
  listing_view: "listingViews",
  booking_started: "bookingStarts",
  click: "clicks",
};

function emptyTotals(): MetricTotals {
  return { visitors: 0, pageViews: 0, logins: 0, signups: 0, linkVisits: 0, listingViews: 0, bookingStarts: 0, clicks: 0 };
}

function computeTotals(rows: SourceRow[]): MetricTotals {
  const totals = emptyTotals();
  const visitors = new Set<string>();
  for (const row of rows) {
    if (row.visitor_id) visitors.add(row.visitor_id);
    const metric = row.event_type ? EVENT_METRIC[row.event_type] : undefined;
    if (metric) totals[metric] += 1;
  }
  totals.visitors = visitors.size;
  return totals;
}

function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export async function getExternalAnalyticsDashboard(rangeKey: string): Promise<ExternalAnalyticsDashboard> {
  const { url, serviceKey, table, label } = config();
  if (!url || !serviceKey) return { configured: false };

  const days = RANGE_DAYS[rangeKey] ?? RANGE_DAYS["7d"];
  const currStart = new Date();
  currStart.setDate(currStart.getDate() - (days - 1));
  currStart.setHours(0, 0, 0, 0);
  const prevStart = new Date(currStart);
  prevStart.setDate(prevStart.getDate() - days);

  let rows: SourceRow[];
  try {
    rows = await fetchRows(
      url,
      serviceKey,
      table,
      "event_type,created_at,visitor_id,path,device,referrer_host,session_id",
      prevStart.toISOString(),
      DASHBOARD_MAX_ROWS,
    );
  } catch (err) {
    return { configured: true, label, error: err instanceof Error ? err.message : String(err) };
  }

  const currStartMs = currStart.getTime();
  const current = rows.filter((r) => r.created_at && new Date(r.created_at).getTime() >= currStartMs);
  const previous = rows.filter((r) => r.created_at && new Date(r.created_at).getTime() < currStartMs);

  const currTotals = computeTotals(current);
  const prevTotals = computeTotals(previous);
  const pct = {} as Record<keyof MetricTotals, number>;
  for (const key of Object.keys(currTotals) as Array<keyof MetricTotals>) {
    pct[key] = pctChange(currTotals[key], prevTotals[key]);
  }

  // Daily trend (current window only), zero-filled.
  const dayBuckets = new Map<string, { totals: MetricTotals; visitors: Set<string> }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayBuckets.set(d.toISOString().slice(0, 10), { totals: emptyTotals(), visitors: new Set() });
  }
  for (const row of current) {
    if (!row.created_at) continue;
    const bucket = dayBuckets.get(isoDate(row.created_at));
    if (!bucket) continue;
    if (row.visitor_id) bucket.visitors.add(row.visitor_id);
    const metric = row.event_type ? EVENT_METRIC[row.event_type] : undefined;
    if (metric) bucket.totals[metric] += 1;
  }
  const daily: DailyPoint[] = [...dayBuckets.entries()].map(([date, b]) => ({ date, ...b.totals, visitors: b.visitors.size }));

  // Device breakdown — unique visitors per device, among visitors with a known device.
  const deviceVisitors = new Map<string, Set<string>>();
  for (const row of current) {
    if (!row.device || !row.visitor_id) continue;
    if (!deviceVisitors.has(row.device)) deviceVisitors.set(row.device, new Set());
    deviceVisitors.get(row.device)!.add(row.visitor_id);
  }
  const deviceTotal = new Set([...deviceVisitors.values()].flatMap((s) => [...s])).size || 1;
  const device = [...deviceVisitors.entries()]
    .map(([d, visitors]) => ({ device: d, visitors: visitors.size, pct: Math.round((visitors.size / deviceTotal) * 100) }))
    .sort((a, b) => b.visitors - a.visitors);

  // Top pages — page_view events grouped by path.
  const pageViews = new Map<string, number>();
  for (const row of current) {
    if (row.event_type !== "page_view" || !row.path) continue;
    pageViews.set(row.path, (pageViews.get(row.path) ?? 0) + 1);
  }
  const topPages = [...pageViews.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  // Traffic sources — unique visitors per referrer host ("Direct" when absent).
  const sourceVisitors = new Map<string, Set<string>>();
  for (const row of current) {
    if (!row.visitor_id) continue;
    const source = row.referrer_host || "Direct";
    if (!sourceVisitors.has(source)) sourceVisitors.set(source, new Set());
    sourceVisitors.get(source)!.add(row.visitor_id);
  }
  const sources = [...sourceVisitors.entries()]
    .map(([source, visitors]) => ({ source, visitors: visitors.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 8);

  // Exit pages — last event per session, grouped by its path.
  const lastBySession = new Map<string, SourceRow>();
  for (const row of current) {
    if (!row.session_id || !row.created_at) continue;
    const existing = lastBySession.get(row.session_id);
    if (!existing || !existing.created_at || new Date(row.created_at) > new Date(existing.created_at)) {
      lastBySession.set(row.session_id, row);
    }
  }
  const exitCounts = new Map<string, number>();
  for (const row of lastBySession.values()) {
    if (!row.path) continue;
    exitCounts.set(row.path, (exitCounts.get(row.path) ?? 0) + 1);
  }
  const exitPages = [...exitCounts.entries()]
    .map(([path, exits]) => ({ path, exits, exitRate: pageViews.has(path) ? Math.round((exits / pageViews.get(path)!) * 100) : 0 }))
    .sort((a, b) => b.exits - a.exits)
    .slice(0, 8);

  // Conversion funnel — unique visitors reaching each stage (independent sets, not strict sequential drop-off).
  const visited = new Set<string>();
  const viewedListing = new Set<string>();
  const authenticated = new Set<string>();
  const startedBooking = new Set<string>();
  for (const row of current) {
    if (!row.visitor_id) continue;
    visited.add(row.visitor_id);
    if (row.event_type === "listing_view") viewedListing.add(row.visitor_id);
    if (row.event_type === "login" || row.event_type === "signup") authenticated.add(row.visitor_id);
    if (row.event_type === "booking_started") startedBooking.add(row.visitor_id);
  }
  const funnel = [
    { stage: "Visited", count: visited.size },
    { stage: "Viewed a listing", count: viewedListing.size },
    { stage: "Logged in or signed up", count: authenticated.size },
    { stage: "Started a booking", count: startedBooking.size },
  ];

  // Peak hours — event count per (day-of-week, hour), UTC.
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const row of current) {
    if (!row.created_at) continue;
    const d = new Date(row.created_at);
    grid[d.getUTCDay()][d.getUTCHours()] += 1;
  }
  const cells: Array<{ dow: number; hour: number; count: number }> = [];
  let max = 0;
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = grid[dow][hour];
      cells.push({ dow, hour, count });
      if (count > max) max = count;
    }
  }

  return {
    configured: true,
    label,
    range: { key: rangeKey, days },
    totals: { current: currTotals, previous: prevTotals, pctChange: pct },
    daily,
    device,
    topPages,
    sources,
    exitPages,
    funnel,
    peakHours: { cells, max },
  };
}
