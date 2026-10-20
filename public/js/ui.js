// ui.js — pemformat angka (Indonesia), ikon pixel, dan potongan HTML.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
export const pct = (v, d = 1) => (Number.isFinite(v) ? nf(v * 100, d) + "%" : "—");
export const mm = (v, d = 1) => (Number.isFinite(v) ? nf(v / 1e6, d) : "—");           // juta
export const usd = (v, d = 1) => (Number.isFinite(v) ? (v < 0 ? "−" : "") + "US$ " + nf(Math.abs(v) / 1e6, d) + " jt" : "—");
export const compact = (v) => (Math.abs(v) >= 1e6 ? nf(v / 1e6, 2) + " jt" : Math.abs(v) >= 1e3 ? nf(v / 1e3, 1) + " rb" : nf(v, 0));

export const card = (title, id, { cls = "", h = "" } = {}) => `<div class="card ${cls}"><h3>${title}</h3><div id="${id}" class="chart ${h}"></div></div>`;
export const kpi = (id, label, cls = "") => `<div class="kpi ${cls}" id="${id}"><div class="l">${label}</div><div class="v">—</div><div class="s"></div></div>`;
export function setKpi(id, value, sub = "", tone = "") {
  const el = document.getElementById(id); if (!el) return;
  el.querySelector(".v").textContent = value; el.querySelector(".s").innerHTML = sub;
  el.classList.remove("good", "warn", "bad"); if (tone) el.classList.add(tone);
}
export const setRead = () => {};   // keterangan di bawah grafik dinonaktifkan (tampilan ringkas)
export const $ = (id) => document.getElementById(id);