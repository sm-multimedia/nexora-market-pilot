"use server";

import { getDateRange, validateArticle, formatArticle } from "@/lib/utils";
import { POPULAR_STOCK_SYMBOLS } from "@/lib/constants";
import { cache } from "react";

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const NEXT_PUBLIC_FINNHUB_API_KEY =
  process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? "";

async function fetchJSON<T>(
  url: string,
  revalidateSeconds?: number,
): Promise<T> {
  const options: RequestInit & { next?: { revalidate?: number } } =
    revalidateSeconds
      ? { cache: "force-cache", next: { revalidate: revalidateSeconds } }
      : { cache: "no-store" };

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export { fetchJSON };

export async function getStockQuote(symbol: string) {
  const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB API key is not configured");

  const normalizedSymbol = symbol.trim().toUpperCase();
  const quote = await fetchJSON<{ c?: number; dp?: number }>(
    `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(normalizedSymbol)}&token=${token}`,
  );
  const profile = await fetchJSON<{ marketCapitalization?: number }>(
    `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(normalizedSymbol)}&token=${token}`,
    3600,
  ).catch((): { marketCapitalization?: number } => ({}));
  const financials = await fetchJSON<{ metric?: Record<string, number> }>(
    `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(normalizedSymbol)}&metric=all&token=${token}`,
    3600,
  ).catch((): { metric?: Record<string, number> } => ({}));

  return {
    currentPrice: Number.isFinite(quote.c) ? quote.c : undefined,
    changePercent: Number.isFinite(quote.dp) ? quote.dp : undefined,
    marketCap:
      profile.marketCapitalization != null &&
      Number.isFinite(profile.marketCapitalization)
        ? profile.marketCapitalization.toString()
        : undefined,
    peRatio:
      financials.metric?.peTTM?.toString() ??
      financials.metric?.peBasicExclExtraTTM?.toString(),
  };
}

export async function getAverageDailyVolume(symbol: string) {
  const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB API key is not configured");

  const result = await fetchJSON<{ metric?: Record<string, number> }>(
    `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol.trim().toUpperCase())}&metric=all&token=${token}`,
    3600,
  );
  const averageInMillions = result.metric?.["10DayAverageTradingVolume"];
  return Number.isFinite(averageInMillions)
    ? averageInMillions! * 1_000_000
    : undefined;
}

export async function getCurrentDayVolume(symbol: string) {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.trim().toUpperCase())}?range=1d&interval=5m`,
    {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 MarketPilot stock alerts" },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw new Error(`Volume data request failed (${response.status})`);

  const result = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketVolume?: number;
          currentTradingPeriod?: { regular?: { start?: number; end?: number } };
        };
        indicators?: { quote?: Array<{ volume?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  };
  const chart = result.chart?.result?.[0];
  if (!chart)
    throw new Error(
      result.chart?.error?.description || "Volume data unavailable",
    );

  const regularSession = chart.meta?.currentTradingPeriod?.regular;
  const currentTime = Math.floor(Date.now() / 1000);
  if (
    regularSession?.start != null &&
    regularSession.end != null &&
    (currentTime < regularSession.start || currentTime > regularSession.end)
  ) {
    return undefined;
  }

  const barVolumes = chart.indicators?.quote?.[0]?.volume ?? [];
  const currentVolume =
    chart.meta?.regularMarketVolume ??
    barVolumes.reduce<number>((total, volume) => total + (volume ?? 0), 0);
  return Number.isFinite(currentVolume) ? currentVolume : undefined;
}

export async function getNews(
  symbols?: string[],
): Promise<MarketNewsArticle[]> {
  try {
    const range = getDateRange(5);
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) {
      throw new Error("FINNHUB API key is not configured");
    }
    const cleanSymbols = (symbols || [])
      .map((s) => s?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s));

    const maxArticles = 6;

    // If we have symbols, try to fetch company news per symbol and round-robin select
    if (cleanSymbols.length > 0) {
      const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

      await Promise.all(
        cleanSymbols.map(async (sym) => {
          try {
            const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${token}`;
            const articles = await fetchJSON<RawNewsArticle[]>(url, 300);
            perSymbolArticles[sym] = (articles || []).filter(validateArticle);
          } catch (e) {
            console.error("Error fetching company news for", sym, e);
            perSymbolArticles[sym] = [];
          }
        }),
      );

      const collected: MarketNewsArticle[] = [];
      // Round-robin up to 6 picks
      for (let round = 0; round < maxArticles; round++) {
        for (let i = 0; i < cleanSymbols.length; i++) {
          const sym = cleanSymbols[i];
          const list = perSymbolArticles[sym] || [];
          if (list.length === 0) continue;
          const article = list.shift();
          if (!article || !validateArticle(article)) continue;
          collected.push(formatArticle(article, true, sym, round));
          if (collected.length >= maxArticles) break;
        }
        if (collected.length >= maxArticles) break;
      }

      if (collected.length > 0) {
        // Sort by datetime desc
        collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
        return collected.slice(0, maxArticles);
      }
      // If none collected, fall through to general news
    }

    // General market news fallback or when no symbols provided
    const generalUrl = `${FINNHUB_BASE_URL}/news?category=general&token=${token}`;
    const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

    const seen = new Set<string>();
    const unique: RawNewsArticle[] = [];
    for (const art of general || []) {
      if (!validateArticle(art)) continue;
      const key = `${art.id}-${art.url}-${art.headline}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(art);
      if (unique.length >= 20) break; // cap early before final slicing
    }

    const formatted = unique
      .slice(0, maxArticles)
      .map((a, idx) => formatArticle(a, false, undefined, idx));
    return formatted;
  } catch (err) {
    console.error("getNews error:", err);
    throw new Error("Failed to fetch news");
  }
}

export const searchStocks = cache(
  async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
      const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
      if (!token) {
        // If no token, log and return empty to avoid throwing per requirements
        console.error(
          "Error in stock search:",
          new Error("FINNHUB API key is not configured"),
        );
        return [];
      }

      const trimmed = typeof query === "string" ? query.trim() : "";

      let results: FinnhubSearchResult[] = [];

      if (!trimmed) {
        type CompanyProfile = {
          name?: string;
          ticker?: string;
          exchange?: string;
        };
        // Fetch top 10 popular symbols' profiles
        const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
        const profiles = await Promise.all(
          top.map(async (sym) => {
            try {
              const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
              // Revalidate every hour
              const profile = await fetchJSON<CompanyProfile>(url, 3600);
              return { sym, profile };
            } catch (e) {
              console.error("Error fetching profile2 for", sym, e);
              return { sym, profile: null as CompanyProfile | null };
            }
          }),
        );

        results = profiles
          .map(({ sym, profile }) => {
            const symbol = sym.toUpperCase();
            const name: string | undefined =
              profile?.name || profile?.ticker || undefined;
            const exchange = profile?.exchange;
            if (!name) return undefined;
            return {
              symbol,
              description: name,
              displaySymbol: symbol,
              exchange,
              type: "Common Stock",
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
      } else {
        const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
        const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
        results = Array.isArray(data?.result) ? data.result : [];
      }

      const mapped: StockWithWatchlistStatus[] = results
        .map((r) => {
          const upper = (r.symbol || "").toUpperCase();
          const name = r.description || upper;
          const exchange = r.exchange || "US";
          const type = r.type || "Stock";
          const item: StockWithWatchlistStatus = {
            symbol: upper,
            name,
            exchange,
            type,
            isInWatchlist: false,
          };
          return item;
        })
        .slice(0, 15);

      return mapped;
    } catch (err) {
      console.error("Error in stock search:", err);
      return [];
    }
  },
);
