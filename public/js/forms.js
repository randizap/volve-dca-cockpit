// forms.js — slider asumsi ekonomi yang terikat ke state (dipakai di halaman Investasi & panel Asumsi).
import { S, setEcon } from "./store.js";
import { nf, pct } from "./ui.js";

export const FIELDS = {
  price: { l: "Harga minyak (US$/bbl)", min: 30, max: 130, step: 1, f: (v) => nf(v, 0) },
  opex: { l: "OPEX variabel (US$/bbl tambahan)", min: 5, max: 40, step: 0.5, f: (v) => nf(v, 1) },
  capex: { l: "CAPEX intervensi (juta US$)", min: 1, max: 60, step: 0.5, f: (v) => nf(v, 1) },
  uplift: { l: "Uplift laju setelah intervensi", min: 0.02, max: 0.6, step: 0.01, f: (v) => pct(v, 0) },
  disc: { l: "Discount rate / tahun", min: 0.05, max: 0.2, step: 0.005, f: (v) => pct(v, 1) },
  woDays: { l: "Hari sumur berhenti saat intervensi", min: 0, max: 90, step: 1, f: (v) => nf(v, 0) + " hr" },
  months: { l: "Horizon evaluasi (bulan)", min: 24, max: 120, step: 6, f: (v) => nf(v, 0) },
  dmin: { l: "Decline terminal (nominal/tahun)", min: 0.03, max: 0.25, step: 0.01, f: (v) => pct(v, 0) },
  priceVol: { l: "Volatilitas harga (σ, MC)", min: 0.05, max: 0.6, step: 0.05, f: (v) => pct(v, 0) },
  capexVol: { l: "Ketidakpastian CAPEX (σ, MC)", min: 0.0, max: 0.5, step: 0.05, f: (v) => pct(v, 0) },
  upliftSpread: { l: "Sebaran uplift (± dari nilai tengah, MC)", min: 0.1, max: 0.9, step: 0.05, f: (v) => "±" + pct(v, 0) },
  declineVol: { l: "Ketidakpastian decline (σ, MC)", min: 0.05, max: 0.6, step: 0.05, f: (v) => pct(v, 0) },
};
let timer;
export function buildForm(el, keys) {
  el.classList.add("frm");
  el.innerHTML = keys.map((k) => { const F = FIELDS[k]; return `<div class="fi"><label for="${el.id}-${k}">${F.l}<output id="${el.id}-${k}-o"></output></label><input type="range" id="${el.id}-${k}" data-k="${k}" min="${F.min}" max="${F.max}" step="${F.step}"></div>`; }).join("");
  el.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
    const k = inp.dataset.k, v = parseFloat(inp.value); document.getElementById(`${el.id}-${k}-o`).textContent = FIELDS[k].f(v);
    clearTimeout(timer); timer = setTimeout(() => setEcon({ [k]: v }), 140);
  }));
  syncForm(el);
}
export function syncForm(el) {
  el.querySelectorAll("input").forEach((inp) => { const k = inp.dataset.k; if (document.activeElement !== inp) inp.value = S.econ[k]; document.getElementById(`${el.id}-${k}-o`).textContent = FIELDS[k].f(S.econ[k]); });
}