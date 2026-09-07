// The demo symbol universe: real, well-known tickers grouped into sectors so
// the correlation-break detector has genuine peer groups to work with. All
// price/volume data for these symbols is entirely synthetic (see fakeProvider.ts)
// — this is a deterministic replay provider for an offline demo, not a feed of
// real quotes, and every surface that shows this data should say so.

export interface UniverseSymbol {
  symbol: string;
  name: string;
  sector: string;
  basePrice: number;
  baseVolume: number;
  dailyVolPct: number; // typical daily realised volatility, as a fraction
}

export const UNIVERSE: UniverseSymbol[] = [
  // Tech
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", basePrice: 190, baseVolume: 55_000_000, dailyVolPct: 0.016 },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology", basePrice: 420, baseVolume: 22_000_000, dailyVolPct: 0.015 },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Technology", basePrice: 165, baseVolume: 28_000_000, dailyVolPct: 0.018 },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Technology", basePrice: 128, baseVolume: 240_000_000, dailyVolPct: 0.028 },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology", basePrice: 145, baseVolume: 48_000_000, dailyVolPct: 0.03 },
  { symbol: "ORCL", name: "Oracle Corp.", sector: "Technology", basePrice: 178, baseVolume: 9_000_000, dailyVolPct: 0.02 },
  // Financials
  { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financials", basePrice: 235, baseVolume: 9_000_000, dailyVolPct: 0.014 },
  { symbol: "BAC", name: "Bank of America Corp.", sector: "Financials", basePrice: 42, baseVolume: 38_000_000, dailyVolPct: 0.017 },
  { symbol: "MS", name: "Morgan Stanley", sector: "Financials", basePrice: 118, baseVolume: 7_500_000, dailyVolPct: 0.016 },
  { symbol: "GS", name: "Goldman Sachs Group", sector: "Financials", basePrice: 540, baseVolume: 2_200_000, dailyVolPct: 0.017 },
  // Energy
  { symbol: "XOM", name: "Exxon Mobil Corp.", sector: "Energy", basePrice: 118, baseVolume: 15_000_000, dailyVolPct: 0.015 },
  { symbol: "CVX", name: "Chevron Corp.", sector: "Energy", basePrice: 158, baseVolume: 8_000_000, dailyVolPct: 0.014 },
  { symbol: "COP", name: "ConocoPhillips", sector: "Energy", basePrice: 108, baseVolume: 7_000_000, dailyVolPct: 0.018 },
  // Healthcare
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", basePrice: 160, baseVolume: 6_500_000, dailyVolPct: 0.011 },
  { symbol: "PFE", name: "Pfizer Inc.", sector: "Healthcare", basePrice: 26, baseVolume: 35_000_000, dailyVolPct: 0.015 },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Healthcare", basePrice: 560, baseVolume: 3_200_000, dailyVolPct: 0.017 },
  // Consumer
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Staples", basePrice: 168, baseVolume: 6_000_000, dailyVolPct: 0.01 },
  { symbol: "KO", name: "Coca-Cola Co.", sector: "Consumer Staples", basePrice: 65, baseVolume: 12_000_000, dailyVolPct: 0.009 },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer Staples", basePrice: 92, baseVolume: 16_000_000, dailyVolPct: 0.011 },
  { symbol: "DIS", name: "Walt Disney Co.", sector: "Consumer Discretionary", basePrice: 98, baseVolume: 10_000_000, dailyVolPct: 0.018 },
  // Communication
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Communication Services", basePrice: 680, baseVolume: 3_500_000, dailyVolPct: 0.022 },
  { symbol: "META", name: "Meta Platforms Inc.", sector: "Communication Services", basePrice: 560, baseVolume: 14_000_000, dailyVolPct: 0.022 },
  { symbol: "TMUS", name: "T-Mobile US Inc.", sector: "Communication Services", basePrice: 210, baseVolume: 4_000_000, dailyVolPct: 0.013 },
];

export const UNIVERSE_BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u]));

/**
 * Engineered demo scenarios, all inside the fake provider's own deterministic
 * model (see fakeProvider.ts) — chosen so the seeded demo tells a story out of
 * the box instead of judges having to wait for something interesting to happen:
 */
export const SPLIT_SCENARIO_SYMBOL = "NVDA"; // engineered ~4-for-1 overnight discontinuity, 55 sessions back
export const CORRELATION_BREAK_SYMBOL = "GS"; // diverges hard from JPM/BAC/MS, 4 sessions back
export const VOLUME_SPIKE_SYMBOL = "PFE"; // ~18x normal volume, 6 sessions back
export const THIN_HISTORY_SYMBOL = "TMUS"; // only ~6 sessions of history — exercises "insufficient history" gating
export const FINANCIALS_SECTOR = ["JPM", "BAC", "MS", "GS"];
