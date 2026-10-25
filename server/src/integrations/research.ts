import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DocKind } from "@hacktx/shared";
import { env } from "../env";
import { search, type SearchResult } from "./search";

/**
 * Research router: reads a request, picks the SerpApi engines that actually answer it (finance, markets,
 * trends, news, scholar, YouTube transcripts, plain web search), and turns their results into a LIVE DATA
 * block for the model plus a list of citable sources.
 */

export interface Research {
  /** Citable title/URL pairs; slide citations are checked against these. */
  sources: SearchResult[];
  /** Plain-text facts for the prompt, empty when nothing was looked up. */
  context: string;
  /** Engines used, for the log. */
  used: string[];
}

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const cacheFile = path.join(dataDir, "research-cache.json");
const MAX_LOOKUPS = 3;

type Json = Record<string, any>;
let cache: Record<string, { at: number; data: Json }> | undefined;

/** One SerpApi call with a disk cache; live market data goes stale in minutes, everything else in a day. */
async function serp(params: Record<string, string>, ttlMs: number): Promise<Json> {
  cache ??= await readFile(cacheFile, "utf8").then((t) => JSON.parse(t), () => ({}));
  const key = JSON.stringify(params);
  const hit = cache![key];
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries({ ...params, api_key: env.serpApiKey })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(`SerpApi ${params.engine} ${res.status}: ${data.error ?? res.statusText}`);
  // "No results" is an answer worth remembering too, so misses don't burn searches twice.
  cache![key] = { at: Date.now(), data };
  await mkdir(dataDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache));
  return data;
}

const MINUTES = 60_000;
const DAY = 24 * 60 * MINUTES;

/** Strips the "make me a deck about…" wrapper so searches get the subject, not the instructions. */
export function topicOf(request: string): string {
  return request
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(please|can you|could you|i want|i need|help me)\b/gi, " ")
    .replace(/\b(make|create|build|write|draft|generate|give me|put together|design)\b( me)?( an?| the)?( \d+[- ]?(slide|page|minute|min|row))?( short| quick| detailed| simple)?( pitch)?\s*(deck|presentation|slides?|slideshow|doc(ument)?|report|essay|summary|spreadsheet|sheet|table|tracker|notes?|mind ?map|board|overview|outline)?\b/gi, " ")
    .replace(/\b(about|on|for|of|covering|explaining|that explains|with (a |one )?(real )?(photo|picture|image|chart|graph)s?( of it)?)\b/gi, " ")
    // Time and source words steer which engine runs; they only add noise to the query itself.
    .replace(/\b(latest|recent(ly)?|current(ly)?|newest|news|today|right now|this (week|month|year)|over the (past|last) (year|month|week|\d+ (years|months))|tracking|track|research|papers?|studies|study)\b/gi, " ")
    .replace(/^\s*(the|a|an)\s+/i, "")
    .replace(/[^\p{L}\p{N}$&.' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Companies and coins people name in plain words; Google Finance needs TICKER:EXCHANGE. */
const SYMBOLS: Record<string, string> = {
  apple: "AAPL:NASDAQ", microsoft: "MSFT:NASDAQ", nvidia: "NVDA:NASDAQ", google: "GOOGL:NASDAQ", alphabet: "GOOGL:NASDAQ",
  amazon: "AMZN:NASDAQ", meta: "META:NASDAQ", facebook: "META:NASDAQ", tesla: "TSLA:NASDAQ", netflix: "NFLX:NASDAQ",
  amd: "AMD:NASDAQ", intel: "INTC:NASDAQ", broadcom: "AVGO:NASDAQ", qualcomm: "QCOM:NASDAQ", adobe: "ADBE:NASDAQ",
  paypal: "PYPL:NASDAQ", costco: "COST:NASDAQ", starbucks: "SBUX:NASDAQ", pepsico: "PEP:NASDAQ", pepsi: "PEP:NASDAQ",
  airbnb: "ABNB:NASDAQ", palantir: "PLTR:NASDAQ", coinbase: "COIN:NASDAQ", spotify: "SPOT:NYSE", uber: "UBER:NYSE",
  oracle: "ORCL:NYSE", salesforce: "CRM:NYSE", ibm: "IBM:NYSE", disney: "DIS:NYSE", nike: "NKE:NYSE", "coca-cola": "KO:NYSE",
  coke: "KO:NYSE", walmart: "WMT:NYSE", "jpmorgan": "JPM:NYSE", "jp morgan": "JPM:NYSE", visa: "V:NYSE", mastercard: "MA:NYSE",
  boeing: "BA:NYSE", "berkshire": "BRK.B:NYSE", "goldman sachs": "GS:NYSE", mcdonald: "MCD:NYSE", "exxon": "XOM:NYSE",
  chevron: "CVX:NYSE", pfizer: "PFE:NYSE", "johnson & johnson": "JNJ:NYSE", tsmc: "TSM:NYSE", alibaba: "BABA:NYSE",
  snowflake: "SNOW:NYSE", shopify: "SHOP:NYSE", "general motors": "GM:NYSE", ford: "F:NYSE", "dell": "DELL:NYSE", reddit: "RDDT:NYSE",
  bitcoin: "BTC-USD", btc: "BTC-USD", ethereum: "ETH-USD", eth: "ETH-USD", solana: "SOL-USD", dogecoin: "DOGE-USD", xrp: "XRP-USD",
};
const NOT_TICKERS = new Set(["AI", "CEO", "USA", "US", "UK", "EU", "API", "GDP", "IPO", "ETF", "PDF", "FAQ", "HTML", "CSS", "SQL", "NYSE", "I", "A"]);
const FINANCE_WORDS = /\b(stocks?|shares?|share price|ticker|market cap|earnings|valuation|invest(ing|ment|or)?|portfolio|dividend|crypto(currency)?|price of|trading)\b/i;

/** Every symbol a request mentions: known names, or $TICKER / TICKER next to finance words. */
function symbolsIn(request: string): { exact: string[]; guesses: string[] } {
  const lower = request.toLowerCase();
  const exact = new Set<string>();
  for (const [name, sym] of Object.entries(SYMBOLS)) if (new RegExp(`\\b${name.replace(/[.&]/g, "\\$&")}\\b`).test(lower)) exact.add(sym);
  const guesses = new Set<string>();
  for (const m of request.matchAll(/\$([A-Z]{1,5})\b/g)) guesses.add(m[1]!);
  if (FINANCE_WORDS.test(request)) for (const m of request.matchAll(/\b([A-Z]{2,5})\b/g)) if (!NOT_TICKERS.has(m[1]!)) guesses.add(m[1]!);
  // A crypto name only counts as a finance request; "eth" in prose is too ambiguous otherwise.
  return { exact: [...exact].filter((s) => !s.endsWith("-USD") || FINANCE_WORDS.test(request) || /bitcoin|ethereum|solana|dogecoin/i.test(request)), guesses: [...guesses] };
}

const money = (n: number, currency = "USD") => `${currency === "USD" ? "$" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}${currency === "USD" ? "" : ` ${currency}`}`;
/** Up to n evenly spaced points from a long series. */
const sample = <T>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]!));

async function stock(symbol: string, out: Research): Promise<boolean> {
  const data = await serp({ engine: "google_finance", q: symbol, window: "1Y" }, 10 * MINUTES);
  const s = data.summary;
  if (!s?.extracted_price) return false;
  // With window=1Y, Google Finance reports the change across that year, not the day.
  const move = s.price_movement ? `${s.price_movement.movement === "Down" ? "down" : "up"} ${s.price_movement.percentage.toFixed(2)}% (${money(s.price_movement.value, s.currency)}) over the past year` : "";
  const stats = (data.knowledge_graph?.key_stats?.stats ?? []).slice(0, 10).map((x: Json) => `${x.label} ${x.value}`).join("; ");
  const year = sample((data.graph ?? []) as Json[], 13).map((p) => `${String(p.date).replace(/,? \d{1,2}:\d{2}.*$/, "")}: ${money(p.price, p.currency)}`).join(", ");
  const name = `${s.title}${s.stock ? ` (${s.stock}${s.exchange ? `:${s.exchange}` : ""})` : ""}`;
  out.context += `STOCK ${name}: ${money(s.extracted_price, s.currency)}, ${move}, as of ${s.date ?? "the latest close"}.\n`;
  if (stats) out.context += `  Key stats: ${stats}\n`;
  if (year) out.context += `  Past year (price at each point): ${year}\n`;
  for (const n of (data.news_results ?? []).slice(0, 3) as Json[]) if (n.link) out.context += `  News: ${n.snippet} (${n.source}, ${n.date}) ${n.link}\n`;
  out.sources.push({ title: `${s.title} stock price - Google Finance`, url: `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}`, snippet: `${money(s.extracted_price, s.currency)} ${move}` });
  return true;
}

async function markets(out: Research) {
  const data = await serp({ engine: "google_finance_markets", trend: "indexes" }, 10 * MINUTES);
  const line = (m: Json) => `${m.name} ${m.price?.toLocaleString("en-US")} (${m.price_movement?.movement === "Down" ? "-" : "+"}${m.price_movement?.percentage?.toFixed(2)}%)`;
  for (const region of ["us", "europe", "asia", "crypto", "currencies"]) {
    const list = (data.markets?.[region] ?? []) as Json[];
    if (list.length) out.context += `MARKETS ${region.toUpperCase()}: ${list.slice(0, 6).map(line).join("; ")}\n`;
  }
  out.sources.push({ title: "Markets - Google Finance", url: "https://www.google.com/finance/markets/indexes", snippet: "Market indexes" });
}

async function trends(topic: string, out: Research) {
  const data = await serp({ engine: "google_trends", q: topic, data_type: "TIMESERIES", date: "today 12-m" }, DAY);
  const points = (data.interest_over_time?.timeline_data ?? []) as Json[];
  if (!points.length) return;
  const series = sample(points, 12).map((p) => `${String(p.date).split(/ [–-] /)[0]}: ${p.values?.[0]?.extracted_value}`).join(", ");
  out.context += `GOOGLE TRENDS search interest for "${topic}" (0-100, past 12 months): ${series}\n`;
  out.sources.push({ title: `Google Trends: ${topic}`, url: `https://trends.google.com/trends/explore?date=today%2012-m&q=${encodeURIComponent(topic)}`, snippet: "Search interest over time" });
}

async function news(topic: string, out: Research) {
  const data = await serp({ engine: "google_news", q: topic }, 2 * 60 * MINUTES);
  const items = ((data.news_results ?? []) as Json[]).filter((n) => n.title && n.link).slice(0, 6);
  for (const n of items) {
    const date = n.iso_date ? String(n.iso_date).slice(0, 10) : (n.date ?? "");
    out.context += `NEWS ${date}: ${n.title} (${n.source?.name ?? ""}) ${n.link}\n`;
    out.sources.push({ title: n.title, url: n.link, snippet: `${n.source?.name ?? ""} ${date}` });
  }
}

async function scholar(topic: string, out: Research) {
  const data = await serp({ engine: "google_scholar", q: topic }, DAY);
  for (const p of ((data.organic_results ?? []) as Json[]).filter((x) => x.title && x.link).slice(0, 5)) {
    const cited = p.inline_links?.cited_by?.total;
    out.context += `PAPER: ${p.title}. ${p.publication_info?.summary ?? ""}${cited ? `. Cited by ${cited}` : ""}. ${p.link}\n`;
    out.sources.push({ title: p.title, url: p.link, snippet: p.publication_info?.summary ?? "" });
  }
}

async function transcript(videoId: string, out: Research) {
  const data = await serp({ engine: "youtube_video_transcript", v: videoId }, DAY);
  const lines = (data.transcript ?? []) as Json[];
  if (!lines.length) return;
  const chapters = ((data.chapters ?? []) as Json[]).map((c) => `${c.start_time_text} ${c.chapter}`).join("; ");
  // Roughly the first 15 minutes of speech keeps the prompt a sensible size.
  let text = "";
  for (const l of lines) {
    if (text.length > 9000) break;
    text += `[${l.start_time_text}] ${l.snippet} `;
  }
  out.context += `YOUTUBE TRANSCRIPT (https://www.youtube.com/watch?v=${videoId})${chapters ? `\n  Chapters: ${chapters}` : ""}\n  ${text.trim()}\n`;
  out.sources.push({ title: "YouTube video transcript", url: `https://www.youtube.com/watch?v=${videoId}`, snippet: chapters });
}

const youtubeId = (text: string) => /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(text)?.[1];

/** Pure styling or layout tweaks need no research. */
const STYLE_ONLY = /^\s*(make|change|move|set|use|switch|turn|resize|align|center|bold|italic|recolou?r|swap)\b[^.]*\b(colou?r|font|bigger|smaller|size|bold|italic|theme|background|align|left|right|cent(er|re)|position|darker|lighter|spacing)\b/i;

/** Looks up whatever the request needs and returns it ready for the prompt. Never throws: research is best effort. */
export async function research(request: string, kind: DocKind, opts: { newFile: boolean }): Promise<Research> {
  const out: Research = { sources: [], context: "", used: [] };
  if (!env.serpApiKey || STYLE_ONLY.test(request)) return out;
  const topic = topicOf(request) || request.slice(0, 120);
  const jobs: { name: string; run: () => Promise<unknown> }[] = [];
  const add = (name: string, run: () => Promise<unknown>) => jobs.length < MAX_LOOKUPS && jobs.push({ name, run });

  const video = youtubeId(request);
  if (video) add("youtube_transcript", () => transcript(video, out));

  const dataKinds = kind === "slides" || kind === "doc" || kind === "sheet";
  if (dataKinds) {
    const { exact, guesses } = symbolsIn(request);
    for (const sym of exact.slice(0, 2)) add(`finance ${sym}`, () => stock(sym, out));
    for (const t of guesses.slice(0, exact.length ? 0 : 1))
      add(`finance ${t}`, async () => (await stock(`${t}:NASDAQ`, out)) || (await stock(`${t}:NYSE`, out)));
    if (/\b(stock market|the markets?|market (overview|update|today|recap)|s&p|nasdaq|dow jones|indices|indexes|wall street)\b/i.test(request)) add("finance_markets", () => markets(out));
    if (/\b(trend(s|ing)?|popularity|popular|interest over time|search interest|hype|growing interest)\b/i.test(request)) add("trends", () => trends(topic, out));
  }
  const prose = kind === "slides" || kind === "doc" || kind === "notes";
  if (prose && /\b(research(ers)?|(research|academic|scientific) papers?|studies|academic|scientific|literature review|peer[- ]reviewed|scholar(ly)?|citations?)\b/i.test(request)) add("scholar", () => scholar(topic, out));
  if ((prose || kind === "sheet") && /\b(latest|news|this (week|month|year)|today|recent(ly)?|current(ly)?|right now|update|20[2-9]\d)\b/i.test(request)) add("news", () => news(topic, out));

  // Slides always cite something; a new deck or a content request gets a web search when nothing better fit.
  if (kind === "slides" && !video && (opts.newFile || /\b(add|about|include|more|slide on|facts?|explain|why|how)\b/i.test(request)) && jobs.length < MAX_LOOKUPS) {
    add("google", async () => {
      for (const r of await search(topic)) out.sources.push(r);
    });
  }

  await Promise.all(
    jobs.map(async (j) => {
      try {
        await j.run();
        out.used.push(j.name);
      } catch (err) {
        console.warn(`[research] ${j.name} failed:`, err instanceof Error ? err.message : err);
      }
    }),
  );
  if (out.context) out.context = `LIVE DATA (looked up ${new Date().toISOString().slice(0, 10)}; use these exact figures, say "as of" with their dates, and cite the URLs):\n${out.context}`;
  return out;
}
