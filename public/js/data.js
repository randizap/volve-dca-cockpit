// data.js — memuat cockpit.json dan menyediakan akses per sumur/tanggal. Tanpa DOM.
import { dayNum, isoOf, computeFeatures, HZ, BBL } from "./features.js";

export const D = { ready: false };
const nanArr = (a) => Float64Array.from(a, (v) => (v == null ? NaN : v));

export function ingest(J) {
  D.meta = J.meta; D.bands = J.bands; D.metrics = J.metrics;
  D.cal0 = dayNum(J.field.cal0); D.inj = Float64Array.from(J.field.inj); D.nCal = D.inj.length;
  D.liq = new Float64Array(D.nCal);
  D.wells = J.wells.map((w) => {
    const o = { ...w, day0: dayNum(w.start) };
    o.s0 = o.day0 - D.cal0;
    for (const k of ["oil", "gas", "wat", "hours", "whp", "choke", "dhp"]) o[k] = Float64Array.from(w[k]);
    o.miss = Uint8Array.from(w.miss);
    if (w.oof) {
      const f = w.oof; o.oof = { o0: f.o0, m30: nanArr(f.m30), u30: nanArr(f.u30), u7: nanArr(f.u7), shap30: f.shap30, p: {}, a: {}, e: {}, y: {} };
      for (const H of HZ) for (const key of ["p", "a", "e", "y"]) o.oof[key][H] = nanArr(f[key][H]);
      const e30 = o.oof.e[30]; let lo = -1, hi = -1;
      for (let k = 0; k < e30.length; k++) if (Number.isFinite(e30[k])) { if (lo < 0) lo = k; hi = k; }
      o.tMin = f.o0 + lo; o.tMax = f.o0 + hi;
    }
    return o;
  });
  D.byName = Object.fromEntries(D.wells.map((w) => [w.name, w]));
  for (const w of D.wells) for (let i = 0; i < w.n; i++) D.liq[w.s0 + i] += w.oil[i] + w.wat[i];
  D.ready = true;
  return D;
}
export async function loadData(url = "data/cockpit.json") {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Gagal memuat ${url} (HTTP ${r.status}). Jalankan "python src/build_data.py" atau "python run.py" dulu.`);
  return ingest(await r.json());
}

export const dateOf = (w, t) => isoOf(w.day0 + t);
export const idxOf = (w, iso) => dayNum(iso) - w.day0;
export const effectiveWells = () => D.wells.filter((w) => !w.short_history);

/** fitur (lazy) sebuah sumur: {rows,m30,m7,u7,u30} */
export function featOf(w) {
  if (!w._F) w._F = computeFeatures(w, D.inj.subarray(w.s0, w.s0 + w.n), D.liq.subarray(w.s0, w.s0 + w.n));
  return w._F;
}

/** prakiraan tersimpan (walk-forward) pada indeks hari t; null jika tidak tersedia */
export function forecastAt(w, t) {
  const f = w.oof; if (!f) return null;
  const k = t - f.o0; if (k < 0 || k >= f.m30.length) return null;
  if (!Number.isFinite(f.e[30][k])) return null;
  const u30 = f.u30[k], reg = u30 < D.meta.dist_cut ? "gangguan" : "normal";
  const out = { t, k, m30: f.m30[k], u30, u7: f.u7[k], regime: reg, byH: {} };
  for (const H of HZ) {
    const e = f.e[H][k], p = f.p[H][k], a = f.a[H][k], y = f.y[H][k];
    const b = D.bands[H][reg];
    out.byH[H] = { e, p, a, y: Number.isFinite(y) ? y : null, pers: f.m30[k],
      lo: Math.max(0, Math.exp(b.q10) * (e + 1) - 1),   // P90 (kasus konservatif)
      hi: Math.exp(b.q90) * (e + 1) - 1 };              // P10 (kasus optimistis)
  }
  out.shap = f.shap30[k] || null;
  return out;
}
export function bandFor(H, u30) { return D.bands[H][u30 < D.meta.dist_cut ? "gangguan" : "normal"]; }

// ---- agregat bulanan (rata-rata laju harian) untuk grafik lapangan
export function monthly(w, key = "oil") {
  const out = new Map();
  for (let i = 0; i < w.n; i++) {
    const m = isoOf(w.day0 + i).slice(0, 7); const e = out.get(m) || { s: 0, n: 0 };
    e.s += w[key][i]; e.n++; out.set(m, e);
  }
  return out;
}
export const monthKeys = () => {
  const keys = []; let y = 2008, m = 2;
  while (y < 2016 || (y === 2016 && m <= 9)) { keys.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return keys;
};