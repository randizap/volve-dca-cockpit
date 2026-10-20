// features.js — inti numerik (tanpa DOM). Cermin dari src/build_data.py; diuji terhadap nilai Python.
export const FEATS = ["oil_m7_m30", "oil_m30_m90", "oil_d1_m30", "wc7", "wc_delta", "log_gor7", "gor_ratio",
  "whp7", "whp_ratio", "choke7", "uptime7", "uptime30", "log_m30", "inj30", "inj_ratio"];
export const HZ = [30, 60, 90];
export const ARPS_WIN = 180;
export const BBL = 6.2898;

export const dayNum = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// setara pandas .rolling(w, min_periods=1).mean()
export function rollingMean(a, w) {
  const out = new Float64Array(a.length); let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= w) s -= a[i - w]; out[i] = s / Math.min(i + 1, w); }
  return out;
}

/** S = {oil,gas,wat,hours,whp,choke} (sejajar harian, sudah diisi). inj, liq = deret lapangan sejajar tanggal sumur. */
export function computeFeatures(S, inj, liq) {
  const n = S.oil.length, r = (x, w) => rollingMean(x, w);
  const m7 = r(S.oil, 7), m30 = r(S.oil, 30), m90 = r(S.oil, 90);
  const w7 = r(S.wat, 7), w30 = r(S.wat, 30), o7 = r(S.oil, 7), o30 = m30;
  const g7 = r(S.gas, 7), g30 = r(S.gas, 30);
  const whp7 = r(S.whp, 7), whp30 = r(S.whp, 30), ch7 = r(S.choke, 7);
  const h7 = r(S.hours, 7), h30 = r(S.hours, 30);
  const i30 = r(inj, 30), l30 = r(liq, 30);
  const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const wc7 = w7[i] / (o7[i] + w7[i] + 1e-6), wc30 = w30[i] / (o30[i] + w30[i] + 1e-6);
    const gor7 = g7[i] / (m7[i] + 1e-6), gor30 = g30[i] / (m30[i] + 1e-6);
    rows[i] = [
      m7[i] / (m30[i] + 1), m30[i] / (m90[i] + 1), S.oil[i] / (m30[i] + 1),
      wc7, wc7 - wc30, Math.log1p(gor7), clip(gor7 / (gor30 + 1e-6), 0, 5),
      whp7[i], clip(whp7[i] / (whp30[i] + 1e-6), 0, 5), ch7[i],
      h7[i] / 24, h30[i] / 24, Math.log1p(m30[i]), i30[i], i30[i] / (l30[i] + 1),
    ];
  }
  return { rows, m30, m7, u7: h7.map((v) => v / 24), u30: h30.map((v) => v / 24) };
}

// ---- Arps hyperbolic: grid-search (di,b) + qi regresi tertutup. IDENTIK dengan build_data.py (b dibatasi 0..1)
const DI = Array.from({ length: 31 }, (_, k) => Math.pow(10, -4 + (3 * k) / 30));
const BB = Array.from({ length: 21 }, (_, k) => 0.02 + (0.98 * k) / 20);
export function arpsFit(hist) {
  const L = hist.length; let np_ = 0, ymax = 0, yy = 0;
  for (let i = 0; i < L; i++) if (hist[i] > 0) { np_++; ymax = Math.max(ymax, hist[i]); yy += hist[i] * hist[i]; }
  if (np_ < 20) return null;
  let best = null;
  for (const di of DI) for (const b of BB) {
    let sxy = 0, sxx = 0;
    for (let i = 0; i < L; i++) { if (hist[i] > 0) { const bas = Math.pow(1 + b * di * i, -1 / b); sxy += bas * hist[i]; sxx += bas * bas; } }
    if (sxx <= 1e-12) continue;
    const qi = sxy / sxx;
    if (!(qi > 0 && qi <= 3 * ymax)) continue;
    const sse = yy - 2 * qi * sxy + qi * qi * sxx;
    if (!best || sse < best.sse) best = { qi, di, b, sse, L };
  }
  return best;
}
/** rata-rata laju hari ke-1..H setelah akhir jendela, untuk tiap H. */
export function arpsMeans(fit, Hs = HZ) {
  if (!fit) return null;
  const maxH = Math.max(...Hs), q = [];
  for (let k = 0; k < maxH; k++) q.push(fit.qi * Math.pow(1 + fit.b * fit.di * (fit.L + k), -1 / fit.b));
  return Hs.map((H) => q.slice(0, H).reduce((a, b) => a + b, 0) / H);
}
export const arpsWindow = (oil, t) => oil.slice(Math.max(0, t - ARPS_WIN + 1), t + 1);

// ---- statistik kecil
export const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
export function quantile(sorted, q) {
  if (!sorted.length) return NaN; const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}