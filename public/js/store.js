// store.js — state global + konteks turunan (prakiraan, ekonomi) yang dimemoisasi.
import { D, idxOf, forecastAt, dateOf } from "./data.js";
import { arpsFit, arpsWindow, BBL, HZ, dayNum, isoOf } from "./features.js";
import { DEFAULT_ECON, baseProfile, cashflows, monteCarlo, breakevenPrice, breakevenUplift, paybackMonth, irrAnnual, tornado, breakevenGrid, recommend } from "./econ.js";

export const S = {
  well: null, date: null, unit: "bbl", page: "ringkasan",
  econ: structuredClone(DEFAULT_ECON), scenarios: [],
  srv: { X: 0.7, rate: 0.10, scorer: "rata2" },
  dt: { window: 365 },
};
const subs = new Set();
export const subscribe = (fn) => subs.add(fn);
let raf = 0;
export function notify() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => subs.forEach((f) => f())); }
export function set(patch) { Object.assign(S, patch); notify(); }
export function setEcon(patch) { Object.assign(S.econ, patch); notify(); }

export const availOf = (w) => {
  if (w._av) return w._av;
  const f = w.oof, av = []; if (f) for (let k = 0; k < f.m30.length; k++) if (Number.isFinite(f.e[30][k])) av.push(f.o0 + k);
  return (w._av = av);
};
export const curWell = () => D.byName[S.well];
/** ubah tanggal ke tanggal terdekat yang punya prakiraan pada sumur aktif */
export function snapDate(iso, w = curWell()) {
  const av = availOf(w); if (!av.length) return iso;
  const want = dayNum(iso) - w.day0; let lo = 0, hi = av.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (av[m] < want) lo = m + 1; else hi = m; }
  const cand = [av[Math.max(0, lo - 1)], av[lo]].filter((x) => x != null).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
  return dateOf(w, cand);
}
export function selectWell(name) { const cur = S.date; S.well = name; S.date = snapDate(cur || D.meta.sample_case.date, D.byName[name]); notify(); }
export function shiftDays(n) { const w = curWell(); S.date = snapDate(isoOf(dayNum(S.date) + n), w); notify(); }
export function useSample() { const sc = D.meta.sample_case; S.well = sc.well; S.date = snapDate(sc.date, D.byName[sc.well]); S.unit = "bbl"; S.econ = { ...structuredClone(DEFAULT_ECON) }; notify(); }

export const unitInfo = () => (S.unit === "bbl" ? { k: BBL, rate: "bbl/hari", vol: "bbl", short: "bbl" } : { k: 1, rate: "Sm³/hari", vol: "Sm³", short: "Sm³" });

let cache = { key: "", c: null };
export function ctx() {
  const w = curWell(); if (!w) return null;
  const key = [S.well, S.date, S.unit, JSON.stringify(S.econ)].join("|");
  if (cache.key === key) return cache.c;
  const t = idxOf(w, S.date), F = forecastAt(w, t), U = unitInfo();
  const c = { w, t, date: S.date, F, U, econ: S.econ, calIdx: w.day0 + t - D.cal0, _e: null };
  c.ecoInputs = () => {
    if (!F) return null;
    const fit = arpsFit(arpsWindow(w.oil, t));
    return { e30: F.byH[30].e * BBL, e60: F.byH[60].e * BBL, e90: F.byH[90].e * BBL, fit };
  };
  c.eco = () => {                               // dihitung lazily & dimemoisasi per (sumur, tanggal, asumsi)
    if (c._e) return c._e;
    const a = c.ecoInputs(); if (!a) return (c._e = null);
    const p = S.econ, base = baseProfile(a, p), det = cashflows(base, p);
    const b90 = F.byH[90], lv = (x) => x / Math.max(1e-9, b90.e);
    const alt = { lo: baseProfile(a, p, { level: lv(b90.lo) }), hi: baseProfile(a, p, { level: lv(b90.hi) }), declHi: baseProfile(a, p, { declMult: 1.3 }), declLo: baseProfile(a, p, { declMult: 0.7 }) };
    const resid = D.bands[90][F.regime].sample;
    const mc = monteCarlo(a, p, resid, 20260930);
    const prices = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120], uplifts = [0.02, 0.04, 0.06, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40];
    return (c._e = { a, base, det, mc, alt, prices, uplifts,
      be: { price: breakevenPrice(base, p), uplift: breakevenUplift(base, p) },
      payback: paybackMonth(det.cf), irr: irrAnnual(det.cf), torn: tornado(base, p, alt),
      grid: breakevenGrid(base, p, prices, uplifts), rec: recommend(mc) });
  };
  cache = { key, c }; return c;
}