// Quant Kit indicators. Plain arrays in, plain arrays out (NaN until enough data).
// Every value at bar i uses bars 0..i only. Standard textbook definitions.

const nan = (n) => new Array(n).fill(NaN);

export function sma(v, n) {
  const out = nan(v.length);
  let sum = 0, count = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]; count++;
    if (count > n) { sum -= v[i - n]; count--; }
    if (count === n) out[i] = sum / n;
  }
  return out;
}

export function ema(v, n) {
  const out = nan(v.length), k = 2 / (n + 1);
  let prev = NaN, seed = 0;
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) { seed += v[i]; continue; }
    if (i === n - 1) { prev = (seed + v[i]) / n; out[i] = prev; continue; }
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder smoothing seeded with a simple average of the first n values (skipping leading NaN). */
export function wilder(v, n) {
  const out = nan(v.length);
  let start = v.findIndex((x) => !Number.isNaN(x));
  if (start < 0) return out;
  let acc = 0;
  for (let i = start; i < v.length; i++) {
    const j = i - start;
    if (j < n) { acc += v[i]; if (j === n - 1) { acc /= n; out[i] = acc; } continue; }
    acc = (acc * (n - 1) + v[i]) / n;
    out[i] = acc;
  }
  return out;
}

export function rsi(close, n = 14) {
  const g = nan(close.length), l = nan(close.length);
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    g[i] = Math.max(d, 0); l[i] = Math.max(-d, 0);
  }
  const ag = wilder(g, n), al = wilder(l, n);
  return ag.map((x, i) => (Number.isNaN(x) ? NaN : al[i] === 0 ? (x === 0 ? 50 : 100) : 100 - 100 / (1 + x / al[i])));
}

export function trueRange(bars) {
  return bars.map((b, i) => (i === 0 ? b.high - b.low
    : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
}

export function atr(bars, n = 14) {
  return wilder(trueRange(bars), n);
}

function rollingStd(v, n) {
  const m = sma(v, n);
  return v.map((_, i) => {
    if (Number.isNaN(m[i])) return NaN;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m[i]) ** 2;
    return Math.sqrt(s / n);
  });
}

export function bollinger(close, n = 20, k = 2) {
  const mid = sma(close, n), sd = rollingStd(close, n);
  return { mid, upper: mid.map((m, i) => m + k * sd[i]), lower: mid.map((m, i) => m - k * sd[i]) };
}

/** Highest high / lowest low of the n bars BEFORE bar i, so a close above it is a true breakout. */
export function donchian(bars, n = 20) {
  const hi = nan(bars.length), lo = nan(bars.length);
  for (let i = n; i < bars.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - n; j < i; j++) { h = Math.max(h, bars[j].high); l = Math.min(l, bars[j].low); }
    hi[i] = h; lo[i] = l;
  }
  return { high: hi, low: lo };
}

export function macd(close, fast = 12, slow = 26, signal = 9) {
  const f = ema(close, fast), s = ema(close, slow);
  const line = f.map((x, i) => x - s[i]);
  const firstValid = line.findIndex((x) => !Number.isNaN(x));
  const sig = nan(close.length);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signal);
    tail.forEach((x, j) => { sig[firstValid + j] = x; });
  }
  return { line, signal: sig, hist: line.map((x, i) => x - sig[i]) };
}

export function adx(bars, n = 14) {
  const pdm = nan(bars.length), mdm = nan(bars.length), tr = nan(bars.length);
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high, dn = bars[i - 1].low - bars[i].low;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  }
  const str = wilder(tr, n), sp = wilder(pdm, n), sm = wilder(mdm, n);
  const dx = str.map((t, i) => {
    if (Number.isNaN(t) || t === 0) return NaN;
    const p = (100 * sp[i]) / t, m = (100 * sm[i]) / t;
    return p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m);
  });
  return wilder(dx, n);
}

/** Supertrend line (below price in an uptrend, above in a downtrend). */
export function supertrend(bars, n = 10, mult = 3) {
  const a = atr(bars, n), size = bars.length;
  const line = nan(size);
  let upper = NaN, lower = NaN, dir = 0;
  for (let i = 0; i < size; i++) {
    if (Number.isNaN(a[i])) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    const pc = i > 0 ? bars[i - 1].close : bars[i].close;
    if (dir === 0) { upper = bu; lower = bl; dir = 1; }
    else {
      upper = bu < upper || pc > upper ? bu : upper;
      lower = bl > lower || pc < lower ? bl : lower;
      if (dir < 0 && bars[i].close > upper) dir = 1;
      else if (dir > 0 && bars[i].close < lower) dir = -1;
    }
    line[i] = dir > 0 ? lower : upper;
  }
  return line;
}

/** Percent change over n bars. */
export function roc(close, n = 10) {
  return close.map((c, i) => (i >= n ? (100 * (c - close[i - n])) / close[i - n] : NaN));
}

/** Session VWAP, reset whenever the calendar date (first 10 chars of bar.date) changes. */
export function vwap(bars) {
  const out = nan(bars.length);
  let day = "", pv = 0, vol = 0;
  bars.forEach((b, i) => {
    const d = String(b.date).slice(0, 10);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    pv += ((b.high + b.low + b.close) / 3) * (b.volume || 0);
    vol += b.volume || 0;
    out[i] = vol > 0 ? pv / vol : NaN;
  });
  return out;
}
