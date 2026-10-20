// econ.js — mesin ekonomi what-if (tanpa DOM). SEMUA angka masukan adalah asumsi pengguna, bukan data Volve.
import { BBL } from "./features.js";

export const DEFAULT_ECON = {
  price: 65,        // USD/bbl (asumsi ilustrasi — isi sumber di panel)
  opex: 15,         // USD/bbl minyak tambahan (OPEX variabel, asumsi)
  capex: 10,        // juta USD (biaya intervensi, asumsi)
  disc: 0.10,       // discount rate tahunan
  uplift: 0.10,     // kenaikan laju akibat intervensi (input skenario, BUKAN output model)
  woDays: 20,       // hari sumur berhenti selama intervensi
  months: 60,       // horizon evaluasi (bulan)
  dmin: 0.08,       // decline terminal eksponensial (nominal/tahun)
  priceVol: 0.25, capexVol: 0.15, upliftSpread: 0.5, declineVol: 0.25,   // ketidakpastian Monte Carlo (asumsi)
  paths: 4000,
  sources: { price: "", opex: "", capex: "" },
};
const DPM = 30.4375;

export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const randn = (rng) => { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** Profil dasar (bbl/hari rata-rata per bulan). e30/e60/e90 = rata-rata 0..H hari (bbl/hari). fit = hasil arpsFit (Sm3/hari). */
export function baseProfile({ e30, e60, e90, fit }, econ, { level = 1, declMult = 1 } = {}) {
  const N = econ.months, out = new Float64Array(N);
  const r1 = e30, r2raw = 2 * e60 - e30, r3raw = 3 * e90 - 2 * e60;
  const r2 = Math.min(2 * e30, Math.max(0.25 * e30, r2raw)), r3 = Math.min(2 * e30, Math.max(0.25 * e30, r3raw));
  const b = fit ? Math.min(1, Math.max(0.02, fit.b)) : 0.5;
  let Di = fit ? fit.di / (1 + fit.b * fit.di * (fit.L + 90)) : 0.0006;
  Di = Math.min(0.004, Math.max(0.00005, Di)) * declMult;
  const Dt = econ.dmin / 365;
  const tStar = Di > Dt ? (Di / Dt - 1) / (b * Di) : 0;
  const qStar = r3 * Math.pow(1 + b * Di * tStar, -1 / b);
  out[0] = r1; if (N > 1) out[1] = r2; if (N > 2) out[2] = r3;
  for (let m = 3; m < N; m++) {
    const tau = DPM * (m + 0.5) - 75;
    out[m] = tau <= tStar ? r3 * Math.pow(1 + b * Di * tau, -1 / b) : qStar * Math.exp(-Dt * (tau - tStar));
  }
  for (let m = 0; m < N; m++) out[m] *= level;
  return out;
}

/** Arus kas bulanan & metrik. base = profil dasar (bbl/hari). p = parameter (boleh menimpa econ). */
export function cashflows(base, p) {
  const N = base.length, cf = new Float64Array(N + 1), margin = p.price - p.opex;
  cf[0] = -p.capex * 1e6;
  let revPV = 0, opexPV = 0, deferPV = 0;
  const rm = Math.pow(1 + p.disc, 1 / 12) - 1;
  for (let m = 1; m <= N; m++) {
    const inc = p.uplift * base[m - 1] * DPM;
    let c = margin * inc;
    revPV += (p.price * inc) / Math.pow(1 + rm, m); opexPV += (p.opex * inc) / Math.pow(1 + rm, m);
    if (m === 1) { const d = margin * base[0] * p.woDays; c -= d; deferPV += d / (1 + rm); }
    cf[m] = c;
  }
  let npv = cf[0]; for (let m = 1; m <= N; m++) npv += cf[m] / Math.pow(1 + rm, m);
  return { cf, npv, revPV, opexPV, deferPV, capexPV: p.capex * 1e6 };
}
export const npvOf = (base, p) => cashflows(base, p).npv;

export function paybackMonth(cf) { let s = 0; for (let m = 0; m < cf.length; m++) { s += cf[m]; if (s >= 0 && m > 0) return m; } return null; }
export function irrAnnual(cf) {
  const f = (r) => cf.reduce((s, c, m) => s + c / Math.pow(1 + r, m), 0);
  let lo = -0.9, hi = 5; if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}
function bisect(fn, lo, hi) { const flo = fn(lo), fhi = fn(hi); if (flo * fhi > 0) return null; let a = lo, b = hi; for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (fn(a) * fn(m) <= 0) b = m; else a = m; } return (a + b) / 2; }
export const breakevenPrice = (base, p) => bisect((x) => npvOf(base, { ...p, price: x }), p.opex, 600);
export const breakevenUplift = (base, p) => bisect((x) => npvOf(base, { ...p, uplift: x }), 0.0001, 5);

export function tornado(base, p, baseFn) {
  const n0 = npvOf(base, p), rows = [];
  const add = (name, lowLabel, highLabel, lowNpv, highNpv) => rows.push({ name, lowLabel, highLabel, lo: lowNpv - n0, hi: highNpv - n0 });
  const v = (k, f) => npvOf(base, { ...p, [k]: p[k] * f });
  add("Harga minyak", "−20%", "+20%", v("price", 0.8), v("price", 1.2));
  add("Uplift produksi", "−20%", "+20%", v("uplift", 0.8), v("uplift", 1.2));
  add("OPEX / bbl", "+20%", "−20%", v("opex", 1.2), v("opex", 0.8));
  add("CAPEX", "+20%", "−20%", v("capex", 1.2), v("capex", 0.8));
  add("Discount rate", "+3 pt", "−3 pt", npvOf(base, { ...p, disc: p.disc + 0.03 }), npvOf(base, { ...p, disc: Math.max(0.01, p.disc - 0.03) }));
  add("Hari shut-in intervensi", "+50%", "−50%", v("woDays", 1.5), v("woDays", 0.5));
  if (baseFn) { add("Level produksi dasar", "P90", "P10", npvOf(baseFn.lo, p), npvOf(baseFn.hi, p)); add("Laju decline", "+30%", "−30%", npvOf(baseFn.declHi, p), npvOf(baseFn.declLo, p)); }
  rows.sort((a, b) => Math.max(Math.abs(b.lo), Math.abs(b.hi)) - Math.max(Math.abs(a.lo), Math.abs(a.hi)));
  return { base: n0, rows };
}

export function breakevenGrid(base, p, prices, uplifts) {
  return uplifts.map((u) => prices.map((pr) => npvOf(base, { ...p, price: pr, uplift: u })));
}

/** Monte Carlo. resid = sampel log-residual horizon 90 hari (dari validasi walk-forward). */
export function monteCarlo({ e30, e60, e90, fit }, p, resid, seed = 12345) {
  const rng = mulberry32(seed), N = p.paths, M = p.months;
  const npvs = new Float64Array(N), cum = Array.from({ length: M + 1 }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    const level = resid && resid.length ? Math.exp(resid[Math.floor(rng() * resid.length)]) : 1;
    const dm = Math.exp(randn(rng) * p.declineVol - 0.5 * p.declineVol ** 2);
    const price = p.price * Math.exp(randn(rng) * p.priceVol - 0.5 * p.priceVol ** 2);
    const capex = p.capex * Math.exp(randn(rng) * p.capexVol - 0.5 * p.capexVol ** 2);
    const a = p.uplift * (1 - p.upliftSpread), b = p.uplift, c = p.uplift * (1 + p.upliftSpread), u = rng();
    const F = (b - a) / (c - a), up = u < F ? a + Math.sqrt(u * (c - a) * (b - a)) : c - Math.sqrt((1 - u) * (c - a) * (c - b));
    const base = baseProfile({ e30, e60, e90, fit }, p, { level, declMult: dm });
    const r = cashflows(base, { ...p, price, capex, uplift: up });
    npvs[i] = r.npv; let s = 0; for (let m = 0; m <= M; m++) { s += r.cf[m]; cum[m][i] = s; }
  }
  const sorted = Float64Array.from(npvs).sort();
  const q = (x) => sorted[Math.min(N - 1, Math.max(0, Math.floor(x * (N - 1))))];
  const pct = (arr, x) => { const s = Float64Array.from(arr).sort(); return s[Math.min(N - 1, Math.floor(x * (N - 1)))]; };
  return {
    npvs, sorted, P90: q(0.10), P50: q(0.50), P10: q(0.90), mean: npvs.reduce((s, v) => s + v, 0) / N,
    pPos: npvs.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) / N,
    cumP90: cum.map((c) => pct(c, 0.10)), cumP50: cum.map((c) => pct(c, 0.50)), cumP10: cum.map((c) => pct(c, 0.90)),
  };
}

export function histogram(values, bins = 30) {
  let lo = Infinity, hi = -Infinity; for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const w = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return { lo, w, counts, centers: counts.map((_, i) => lo + w * (i + 0.5)) };
}

/** Rekomendasi berbasis aturan (bukan AI generatif). */
export function recommend(mc, be) {
  if (mc.pPos >= 0.75 && mc.P90 > 0) return { level: "go", text: "Layak dilanjutkan pada asumsi ini" };
  if (mc.pPos >= 0.4) return { level: "marginal", text: "Marginal — sensitif terhadap harga dan uplift" };
  return { level: "nogo", text: "Belum layak pada asumsi ini" };
}
export const toBbl = (sm3) => sm3 * BBL;