// Types for Quant Kit (plain ESM JavaScript). Keep in sync with the .js files.

export type Bar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
export type IndicatorName =
  | "close" | "open" | "high" | "low" | "volume" | "sma" | "ema" | "rsi" | "atr" | "adx" | "roc"
  | "bbUpper" | "bbMid" | "bbLower" | "donchianHigh" | "donchianLow" | "macd" | "macdSignal" | "macdHist"
  | "supertrend" | "vwap" | "volumeSma";
export type Operand = { value: number } | { ind: IndicatorName; period?: number; mult?: number; offset?: number; times?: number };
export type Op = ">" | "<" | ">=" | "<=" | "crossesAbove" | "crossesBelow";
export type Condition = { left: Operand; op: Op; right: Operand };
export type Market = "stock" | "crypto" | "forex" | "futures";
export type Guards = { profitTargetPct: number | null; dailyLossPct: number | null; maxLossPct: number; maxLossType: "static" | "trailing" };
export type Spec = {
  version: 1;
  name: string;
  symbol: string;
  market: Market;
  timeframe: "1d" | "1h";
  side: "long" | "short";
  entry: Condition[];
  exit: Condition[];
  stop: null | { type: "atr"; mult: number; period: number } | { type: "percent"; pct: number };
  target: null | { type: "r"; r: number } | { type: "percent"; pct: number };
  trail: boolean;
  riskPct: number;
  allocationPct: number;
  maxLeverage: number;
  costBps: number;
  maxBarsInTrade: number;
  guards: Guards | null;
};
/** Anything partially shaped like a Spec; normalizeSpec fills the rest. */
export type SpecInput = Partial<Omit<Spec, "guards">> & { guards?: Partial<Guards> | null; [k: string]: unknown };

export type Trade = {
  entryDate: string; exitDate: string; side: "long" | "short"; entry: number; exit: number; qty: number;
  pnl: number; returnPct: number; r: number | null; bars: number; reason: "rule" | "time" | "stop" | "target" | "end of test";
};
export type Stats = {
  totalReturn: number; cagr: number; maxDrawdown: number; sharpe: number; sortino: number; trades: number;
  winRate: number; profitFactor: number | null; avgR: number | null; exposure: number; buyHold: number; years: number;
};
export type ChallengeRun = { status: "passed" | "failed" | "open"; reason?: "max loss" | "daily loss"; date?: string; days: number };
export type ChallengeStats = {
  attempts: number; passRate: number; failRate: number; openRate: number; medianDaysToPass: number | null;
  failReasons: { dailyLoss: number; maxLoss: number }; first: (ChallengeRun & { start: string }) | null;
};
export type BacktestResult =
  | { ok: false; errors: string[] }
  | {
      ok: true; spec: Spec; from: string; to: string; bars: number; stats: Stats; trades: Trade[];
      openTrade: { entryDate: string; entry: number; stop: number | null; target: number | null } | null;
      equity: { date: string; equity: number }[]; challenge: ChallengeStats | null; warnings: string[];
    };

export declare const INDICATORS: Record<IndicatorName, { label: string; args: ("period" | "mult")[]; defaults?: Record<string, number> }>;
export declare const OPS: Record<Op, string>;
export declare const MARKETS: Market[];
export declare function normalizeSpec(input: unknown): { spec: Spec; errors: string[] } | { spec: null; errors: string[] };
export declare function evaluate(conditions: Condition[], bars: Bar[], cache?: Map<string, number[]>): boolean[];
export declare function series(op: Operand, bars: Bar[], cache?: Map<string, number[]>): number[];
export declare function describe(spec: Spec): [string, string][];
export declare function conditionText(c: Condition): string;
export declare function operandText(o: Operand): string;

export declare function backtest(bars: Bar[], spec: SpecInput, opts?: { startingEquity?: number }): BacktestResult;
export declare function metrics(eq: number[], trades: Trade[], dates: string[], bars: Bar[]): Stats;
export declare function runChallenge(eq: number[], worst: number[], dates: string[], g: Guards, start: number): ChallengeRun;
export declare function challengeStats(eq: number[], worst: number[], dates: string[], g: Guards): ChallengeStats;

export type TemplateId = "trendPullback" | "emaCross" | "donchianBreakout" | "rsi2" | "bollingerReversion" | "macdAdx" | "supertrend";
export declare const TEMPLATES: Record<TemplateId, { label: string; style: string; blurb: string; spec: SpecInput }>;
export declare const PROP_RULES: Record<string, Guards>;
export declare function fromTemplate(id: TemplateId, overrides?: SpecInput): SpecInput;

export declare function parseIdea(text: string, defaults?: { symbol?: string; market?: Market }): { spec: SpecInput; notes: string[] };
export declare function detectSymbol(text: string): { symbol: string; market: Market } | null;

export declare const SPEC_JSON_SCHEMA: Record<string, unknown>;
export declare const SYSTEM_PROMPT: string;
export declare function userPrompt(idea: string, context?: { symbol?: string; market?: Market }): string;
export declare function specFromAi(answer: unknown, idea: string, defaults?: { symbol?: string; market?: Market }): {
  spec: SpecInput; notes: string[]; source: "ai" | "keywords";
};

export declare function fetchYahooBars(symbol: string, timeframe?: "1d" | "1h", fetchImpl?: typeof fetch): Promise<Bar[]>;
export declare const DISCLAIMER: string;
export declare const indicators: {
  sma(v: number[], n: number): number[];
  ema(v: number[], n: number): number[];
  wilder(v: number[], n: number): number[];
  rsi(close: number[], n?: number): number[];
  trueRange(bars: Bar[]): number[];
  atr(bars: Bar[], n?: number): number[];
  bollinger(close: number[], n?: number, k?: number): { mid: number[]; upper: number[]; lower: number[] };
  donchian(bars: Bar[], n?: number): { high: number[]; low: number[] };
  macd(close: number[], fast?: number, slow?: number, signal?: number): { line: number[]; signal: number[]; hist: number[] };
  adx(bars: Bar[], n?: number): number[];
  supertrend(bars: Bar[], n?: number, mult?: number): number[];
  roc(close: number[], n?: number): number[];
  vwap(bars: Bar[]): number[];
};
