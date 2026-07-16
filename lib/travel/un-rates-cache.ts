import { promises as fs } from "fs";
import path from "path";
import type { UnRate, UnRatesPayload } from "./un-rates";

// Server-only: talks to the filesystem and the UN Treasury site. Phase 2 can swap the
// readCacheFile/writeCacheFile pair for a database read/write without touching getUnRates'
// callers (the /api/exchange-rate route and, indirectly, the Travel Request page).

const CACHE_PATH = path.join(process.cwd(), "data", "un-rates.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const UN_HISTORY_URL = "https://treasury.un.org/operationalrates/xsqlHistory.php";

interface CacheFile {
  fetchedAt: string;
  rates: UnRate[];
}

async function readCacheFile(): Promise<CacheFile | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!Array.isArray(parsed.rates) || typeof parsed.fetchedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCacheFile(cache: CacheFile): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // Best-effort cache -- e.g. a read-only filesystem on a serverless host must never fail the request.
  }
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseUnDate(text: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(text.trim());
  if (!m) return null;
  const [, day, mon, year] = m;
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

/** Parses the <table> HTML fragment returned by xsqlHistory.php for INstrRATECODE=MMK. */
function parseMmkHistoryHtml(html: string): UnRate[] {
  const rates: UnRate[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([^<]*)<\/td>/gi)].map((c) => c[1].trim());
    if (cells.length < 3 || cells[0] !== "MMK") continue;
    const rate = Number.parseFloat(cells[1]);
    const effectiveDate = parseUnDate(cells[2]);
    if (Number.isFinite(rate) && effectiveDate) rates.push({ rate, effectiveDate });
  }
  rates.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0));
  return rates;
}

async function fetchFromUN(): Promise<UnRate[]> {
  const res = await fetch(UN_HISTORY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ INdtmFROM: "", INstrRATECODE: "MMK" }).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`UN treasury responded ${res.status}`);
  const html = await res.text();
  const rates = parseMmkHistoryHtml(html);
  if (rates.length === 0) throw new Error("No MMK rows found in the UN treasury response");
  return rates;
}

export async function getUnRates(forceRefresh = false): Promise<UnRatesPayload> {
  const cached = await readCacheFile();
  const isFresh = cached !== null && Date.now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS;

  if (!forceRefresh && isFresh && cached) {
    return { rates: cached.rates, fetchedAt: cached.fetchedAt, source: "cache" };
  }

  try {
    const rates = await fetchFromUN();
    const fetchedAt = new Date().toISOString();
    await writeCacheFile({ fetchedAt, rates });
    return { rates, fetchedAt, source: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "UN treasury fetch failed";
    if (cached) {
      return { rates: cached.rates, fetchedAt: cached.fetchedAt, source: "cache", error: message };
    }
    return { rates: [], fetchedAt: null, source: "none", error: message };
  }
}
