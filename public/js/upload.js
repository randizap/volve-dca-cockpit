// upload.js — baca file Volve milik pengguna (xlsx/csv), bersihkan dengan aturan yang SAMA seperti pipeline Python,
// hitung fitur, jalankan ONNX final di browser + Arps + persistence.
import { computeFeatures, arpsFit, arpsWindow, arpsMeans, HZ, isoOf, dayNum } from "./features.js";
import { predictRatio, finalName } from "./onnx.js";
import { D, bandFor } from "./data.js";

export const REQUIRED = [["DATEPRD", "tanggal (YYYY-MM-DD atau serial Excel)"], ["NPD_WELL_BORE_NAME", "nama sumur"], ["ON_STREAM_HRS", "jam operasi/hari"], ["AVG_WHP_P", "tekanan kepala sumur"],
  ["AVG_CHOKE_SIZE_P", "ukuran choke"], ["BORE_OIL_VOL", "minyak (Sm³/hari)"], ["BORE_GAS_VOL", "gas (Sm³/hari)"], ["BORE_WAT_VOL", "air (Sm³/hari)"]];
export const OPTIONAL = [["WELL_TYPE", "OP = produser, WI = injektor. Tanpa ini semua baris dianggap produser."], ["BORE_WI_VOL", "volume injeksi air (baris WI). Tanpa ini fitur injeksi = 0 dan XGBoost bisa bias."]];

const toISO = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return isoOf(Math.round(v) - 25569);
  const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return null;
};
export async function readFile(file) {
  if (typeof XLSX === "undefined") throw new Error("Pustaka XLSX tidak termuat.");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const name = wb.SheetNames.find((n) => /daily/i.test(n)) || wb.SheetNames[0];
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { raw: true }), sheet: name };
}
export function build(rows) {
  const log = [], warn = [];
  if (!rows.length) throw new Error("Sheet kosong.");
  const colSet = new Set(); for (const r of rows) for (const k in r) colSet.add(k); const cols = [...colSet], miss = REQUIRED.filter(([c]) => !cols.includes(c)).map(([c]) => c);
  if (miss.length) throw new Error("Kolom wajib tidak ada: " + miss.join(", "));
  const hasType = cols.includes("WELL_TYPE"), hasWI = cols.includes("BORE_WI_VOL");
  const op = [], wi = [];
  for (const r of rows) { const d = toISO(r.DATEPRD); if (!d) continue; const ty = hasType ? String(r.WELL_TYPE).trim().toUpperCase() : "OP"; (ty === "WI" ? wi : op).push({ d, r }); }
  if (!hasType) warn.push("Kolom WELL_TYPE tidak ada — semua baris dianggap produser.");
  if (!hasWI || !wi.length) warn.push("Data injeksi air (baris WI / BORE_WI_VOL) tidak ada — fitur injeksi = 0. Model dilatih dengan injeksi &gt; 0, jadi komponen XGBoost bisa bias; komponen Arps & persistence tetap valid.");
  const seen = new Set(), by = new Map(); let clipH = 0, negV = 0, bad = 0;
  for (const { d, r } of op) {
    const key = r.NPD_WELL_BORE_NAME + "|" + d; if (seen.has(key)) continue; seen.add(key);
    let h = +r.ON_STREAM_HRS || 0; if (h > 24) { h = 24; clipH++; } if (h < 0) h = 0;
    let o = +r.BORE_OIL_VOL || 0, g = +r.BORE_GAS_VOL || 0, w = +r.BORE_WAT_VOL || 0; if (o < 0 || g < 0 || w < 0) negV++; o = Math.max(0, o); g = Math.max(0, g); w = Math.max(0, w);
    if (h === 0 && o > 0) { bad++; continue; }
    (by.get(r.NPD_WELL_BORE_NAME) || by.set(r.NPD_WELL_BORE_NAME, []).get(r.NPD_WELL_BORE_NAME)).push({ n: dayNum(d), h, whp: +r.AVG_WHP_P, ch: +r.AVG_CHOKE_SIZE_P, o, g, w });
  }
  log.push(`jam &gt; 24 dipangkas: ${clipH}`, `volume negatif dinolkan: ${negV}`, `jam = 0 tetapi minyak &gt; 0 dibuang: ${bad}`);
  const wells = []; let lo = Infinity, hi = -Infinity;
  for (const [name, arr] of by) {
    arr.sort((a, b) => a.n - b.n); if (arr.length < 90) { warn.push(`${name}: hanya ${arr.length} baris (&lt; 90) — dilewati.`); continue; }
    const a0 = arr[0].n, n = arr[arr.length - 1].n - a0 + 1, W = { name, short: String(name).replace("15/9-", ""), day0: a0, n, oil: new Float64Array(n), gas: new Float64Array(n), wat: new Float64Array(n), hours: new Float64Array(n), whp: new Float64Array(n), choke: new Float64Array(n), miss: new Uint8Array(n).fill(1) };
    let lw = NaN, lc = NaN; const wk = new Float64Array(n).fill(NaN), ck = new Float64Array(n).fill(NaN);
    for (const x of arr) { const i = x.n - a0; W.oil[i] = x.o; W.gas[i] = x.g; W.wat[i] = x.w; W.hours[i] = x.h; wk[i] = x.whp; ck[i] = x.ch; W.miss[i] = 0; }
    for (let i = 0; i < n; i++) { if (Number.isFinite(wk[i])) lw = wk[i]; else if (Number.isFinite(lw)) wk[i] = lw; if (Number.isFinite(ck[i])) lc = ck[i]; else if (Number.isFinite(lc)) ck[i] = lc; }
    for (let i = n - 1; i >= 0; i--) { if (!Number.isFinite(wk[i])) wk[i] = i < n - 1 ? wk[i + 1] : 0; if (!Number.isFinite(ck[i])) ck[i] = i < n - 1 ? ck[i + 1] : 0; }
    W.whp = wk.map((v) => (Number.isFinite(v) ? v : 0)); W.choke = ck.map((v) => (Number.isFinite(v) ? v : 0));
    lo = Math.min(lo, a0); hi = Math.max(hi, a0 + n - 1); wells.push(W);
  }
  if (!wells.length) throw new Error("Tidak ada sumur produser dengan ≥ 90 baris.");
  const nCal = hi - lo + 1, inj = new Float64Array(nCal), liq = new Float64Array(nCal);
  for (const { d, r } of wi) { const i = dayNum(d) - lo; if (i >= 0 && i < nCal) inj[i] += Math.max(0, +r.BORE_WI_VOL || 0); }
  for (const W of wells) for (let i = 0; i < W.n; i++) liq[W.day0 - lo + i] += W.oil[i] + W.wat[i];
  for (const W of wells) { const s0 = W.day0 - lo; W._F = computeFeatures(W, inj.subarray(s0, s0 + W.n), liq.subarray(s0, s0 + W.n)); }
  return { wells, log, warn };
}
/** prakiraan pada indeks t memakai ONNX final. */
export async function forecast(W, t) {
  const F = W._F, m30 = F.m30[t], u30 = F.u30[t], fit = arpsFit(arpsWindow(W.oil, t)), am = arpsMeans(fit) || [m30, m30, m30];
  const reg = u30 < D.meta.dist_cut ? "gangguan" : "normal", byH = {};
  for (let i = 0; i < HZ.length; i++) {
    const H = HZ[i], p = (await predictRatio(finalName(H), F.rows[t])) * (m30 + 1), e = (p + am[i] + m30) / 3, b = bandFor(H, u30);
    let y = null; if (t + H < W.n) { let s = 0; for (let d = 1; d <= H; d++) s += W.oil[t + d]; y = s / H; }
    byH[H] = { e, p, a: am[i], y, pers: m30, lo: Math.max(0, Math.exp(b.q10) * (e + 1) - 1), hi: Math.exp(b.q90) * (e + 1) - 1 };
  }
  return { t, m30, u30, u7: F.u7[t], regime: reg, byH };
}