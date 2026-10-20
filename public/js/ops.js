// ops.js — downtime (produksi tertunda) & surveillance berbasis pengecualian. Tanpa DOM.
import { D, effectiveWells } from "./data.js";
import { HZ, isoOf } from "./features.js";

/* ------------------------------------------------------------ Downtime */
/** potensi harian: median 60 hari terakhir dari laju hari-mengalir (jam ≥ 22), dibawa maju saat sumur berhenti lama. */
export function potentialOf(w) {
  if (w._pot) return w._pot;
  const pot = new Float64Array(w.n); let last = NaN;
  for (let i = 0; i < w.n; i++) {
    const v = [];
    for (let j = Math.max(0, i - 59); j <= i; j++) if (w.hours[j] >= 22 && w.oil[j] > 0) v.push(w.oil[j]);
    if (v.length >= 5) { v.sort((a, b) => a - b); last = v[v.length >> 1]; }
    pot[i] = last;
  }
  let first = pot.find((x) => Number.isFinite(x)) ?? 0;
  for (let i = 0; i < w.n && !Number.isFinite(pot[i]); i++) pot[i] = first;
  return (w._pot = pot);
}

/** hari fasilitas (heuristik): ≥2 sumur aktif dan ≥80% di antaranya berjam operasi ≤ 2. */
export function facilityDays() {
  if (D._fac) return D._fac;
  const fac = new Uint8Array(D.nCal);
  const ws = effectiveWells();
  for (let d = 0; d < D.nCal; d++) {
    let active = 0, down = 0;
    for (const w of ws) {
      const i = d - w.s0; if (i < 0 || i >= w.n || w.miss[i]) continue;
      if (potentialOf(w)[i] > 5) { active++; if (w.hours[i] <= 2) down++; }
    }
    if (active >= 2 && down / active >= 0.8) fac[d] = 1;
  }
  return (D._fac = fac);
}

/** ringkasan downtime untuk jendela [endIdx-window+1 .. endIdx] pada indeks kalender. */
export function downtimeSummary(calEnd, windowDays) {
  const fac = facilityDays(), rows = [];
  for (const w of D.wells) {
    const pot = potentialOf(w); let real = 0, dF = 0, dW = 0, downDays = 0, unk = 0, days = 0;
    for (let d = calEnd - windowDays + 1; d <= calEnd; d++) {
      const i = d - w.s0; if (i < 0 || i >= w.n) continue;
      if (w.miss[i]) { unk++; continue; }
      days++; real += w.oil[i];
      const loss = pot[i] * Math.max(0, 1 - w.hours[i] / 24);
      if (loss > 0) { if (fac[d]) dF += loss; else dW += loss; }
      if (w.hours[i] <= 2) downDays++;
    }
    if (days) rows.push({ name: w.name, short: w.short, real, dF, dW, downDays, unk, days, potential: real + dF + dW, shortHist: !!w.short_history });
  }
  return rows;
}

/** deret bulanan produksi tertunda per kelas (Sm3) sepanjang riwayat. */
export function downtimeMonthly() {
  const fac = facilityDays(), map = new Map();
  for (const w of D.wells) {
    const pot = potentialOf(w);
    for (let i = 0; i < w.n; i++) {
      if (w.miss[i]) continue;
      const loss = pot[i] * Math.max(0, 1 - w.hours[i] / 24); if (loss <= 0) continue;
      const m = isoOf(w.day0 + i).slice(0, 7), e = map.get(m) || { f: 0, w: 0 };
      if (fac[w.s0 + i]) e.f += loss; else e.w += loss; map.set(m, e);
    }
  }
  return map;
}

/* ------------------------------------------------------------ Surveillance */
/** titik evaluasi (tanpa F-5): {well,k,t,m30,y,e,a,u7}. Kejadian = rata-rata 30 hari ke depan < X × rata-rata 30 hari terakhir. */
export function survPoints() {
  if (D._sp) return D._sp;
  const pts = [];
  for (const w of effectiveWells()) {
    const f = w.oof; if (!f) continue;
    for (let k = 0; k < f.m30.length; k++) {
      const y = f.y[30][k], e = f.e[30][k];
      if (!(f.m30[k] > 5) || !Number.isFinite(y) || !Number.isFinite(e)) continue;
      pts.push({ w: w.name, t: f.o0 + k, m30: f.m30[k], y, e, a: f.a[30][k], u7: f.u7[k] });
    }
  }
  return (D._sp = pts);
}
export const SCORERS = {
  terpadu: { label: "Prakiraan terpadu", short: "Terpadu", score: (p) => 1 - p.e / p.m30 },
  arps: { label: "Arps saja", short: "Arps", score: (p) => 1 - p.a / p.m30 },
  uptime: { label: "Naif: uptime 7 hari", short: "Uptime 7h", score: (p) => 1 - p.u7 },
  rata2: { label: "Gabungan (eksploratif)", short: "Gabungan", score: (p) => 0.5 * (1 - p.e / p.m30) + 0.5 * (1 - p.u7) },
};

export function prCurve(points, X, scorer) {
  const lab = points.map((p) => (p.y < X * p.m30 ? 1 : 0)), sc = points.map(scorer.score);
  const idx = sc.map((_, i) => i).sort((i, j) => sc[j] - sc[i]);
  const P = lab.reduce((s, v) => s + v, 0); let tp = 0, fp = 0, ap = 0, prevR = 0;
  const curve = [];
  idx.forEach((i, n) => {
    if (lab[i]) tp++; else fp++;
    const prec = tp / (tp + fp), rec = P ? tp / P : 0;
    if (lab[i]) { ap += (rec - prevR) * prec; prevR = rec; }
    if (n % Math.max(1, Math.floor(idx.length / 220)) === 0) curve.push([rec, prec]);
  });
  return { curve, ap, prevalence: points.length ? P / points.length : 0, P, n: points.length };
}
export function confusion(points, X, scorer, tau) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of points) { const ev = p.y < X * p.m30, al = scorer.score(p) >= tau; if (ev && al) tp++; else if (!ev && al) fp++; else if (ev && !al) fn++; else tn++; }
  const prec = tp + fp ? tp / (tp + fp) : 0, rec = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, tn, precision: prec, recall: rec, f1: prec + rec ? (2 * prec * rec) / (prec + rec) : 0 };
}