const WATCHLIST = [
  { symbol: "500285.BO", code: "500285", name: "SpiceJet" },
  { symbol: "533096.BO", code: "533096", name: "Adani Power" },
  { symbol: "500400.BO", code: "500400", name: "Tata Power" },
  { symbol: "532822.BO", code: "532822", name: "Vodafone Idea" },
  { symbol: "532648.BO", code: "532648", name: "Yes Bank" },
  { symbol: "500180.BO", code: "500180", name: "HDFC Bank" },
  { symbol: "532281.BO", code: "532281", name: "HCL Technologies" },
];

function isBseOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || "";
  const weekday = value("weekday");
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  return !["Sat", "Sun"].includes(weekday) && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

async function getQuote(item: (typeof WATCHLIST)[number]) {
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    for (const query of ["interval=1m&range=1d", "interval=1d&range=5d"]) {
      try {
        const response = await fetch(`https://${host}/v8/finance/chart/${item.symbol}?${query}`, {
          headers: { "User-Agent": "Mozilla/5.0 WealthLens/1.0", Accept: "application/json" },
          cf: { cacheTtl: 45, cacheEverything: true },
        } as RequestInit);
        if (!response.ok) continue;
        const json = await response.json() as {
          chart?: { result?: Array<{ meta?: Record<string, number | string>; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> }
        };
        const result = json.chart?.result?.[0];
        const meta = result?.meta || {};
        const closes = (result?.indicators?.quote?.[0]?.close || []).filter((v): v is number => typeof v === "number");
        const price = Number(meta.regularMarketPrice ?? closes.at(-1));
        const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2));
        if (!Number.isFinite(price)) continue;
        const change = Number.isFinite(previousClose) ? price - previousClose : null;
        return {
          ...item, price, previousClose: Number.isFinite(previousClose) ? previousClose : null, change,
          changePercent: change !== null && previousClose ? change / previousClose * 100 : null,
          currency: String(meta.currency || "INR"),
          updatedAt: meta.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : new Date().toISOString(),
        };
      } catch {}
    }
  }
  return { ...item, price: null, previousClose: null, change: null, changePercent: null, currency: "INR", updatedAt: null };
}

async function GET() {
  const quotes = [];
  for (const item of WATCHLIST) quotes.push(await getQuote(item));
  return Response.json({
    marketOpen: isBseOpen(),
    updatedAt: new Date().toISOString(),
    quotes,
  }, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
  });
}

const cors = {"Access-Control-Allow-Origin":"https://nileshpdarji.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
Deno.serve(async (request: Request) => {
 if (request.method === "OPTIONS") return new Response("ok", {headers:cors});
 const response = await GET();
 return new Response(response.body,{status:response.status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"private, max-age=30"}});
});
