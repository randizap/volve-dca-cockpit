// app.js — router, bilah kontrol, panel, dan tur. Menyatukan semua halaman.
import { loadData, D, dateOf } from "./data.js";
import { S, subscribe, notify, ctx, availOf, curWell, selectWell, shiftDays, useSample, set, snapDate } from "./store.js";
import { resizeAll } from "./charts.js";
import { esc, nf, pct, usd } from "./ui.js";
import { buildForm, syncForm } from "./forms.js";
import ringkasan from "./pages/ringkasan.js";
import dataAnda from "./pages/data.js";
import lapangan from "./pages/lapangan.js";
import prakiraan from "./pages/prakiraan.js";
import downtime from "./pages/downtime.js";
import investasi from "./pages/investasi.js";
import surveillance from "./pages/surveillance.js";
import kepercayaan from "./pages/kepercayaan.js";
import skenario from "./pages/skenario.js";
import tim, { CLAIMS } from "./pages/tim.js";

const PAGES = [ringkasan, dataAnda, lapangan, prakiraan, downtime, investasi, surveillance, kepercayaan, skenario, tim];
const $ = (id) => document.getElementById(id);
const byId = Object.fromEntries(PAGES.map((p) => [p.id, p]));
let current = "ringkasan";

function fatal(msg) { $("main").innerHTML = `<div class="note bad"><b>Tidak bisa memulai.</b> ${esc(msg)}</div>`; }

async function init() {
  try { await loadData(); } catch (e) { return fatal(e.message); }
  const sc = D.meta.sample_case; S.well = sc.well;
  // tab & halaman
  $("tabs").innerHTML = PAGES.map((p) => `<a class="tab" href="#/${p.id}" data-id="${p.id}">${p.title}</a>`).join("");
  $("main").innerHTML = PAGES.map((p) => `<section class="page" id="pg-${p.id}" aria-label="${p.title}"></section>`).join("");
  for (const p of PAGES) { try { await p.build($("pg-" + p.id)); } catch (e) { $("pg-" + p.id).innerHTML = `<div class="note bad">Gagal membangun halaman ${p.title}: ${esc(e.message)}</div>`; console.error(e); } }
  // kontrol
  $("c-well").innerHTML = D.wells.map((w) => `<option value="${esc(w.name)}">${esc(w.short)}</option>`).join("");
  $("c-well").onchange = (e) => selectWell(e.target.value);
  $("c-date").oninput = (e) => { const w = curWell(), av = availOf(w); S.date = dateOf(w, av[+e.target.value]); notify(); };
  $("c-prev").onclick = () => shiftDays(-30); $("c-next").onclick = () => shiftDays(30);
  document.querySelectorAll("#c-unit button").forEach((b) => (b.onclick = () => set({ unit: b.dataset.u })));
  $("b-sample").onclick = () => { useSample(); startTour(); };
  $("b-asum").onclick = () => openDrawer("asum"); $("b-claims").onclick = () => openDrawer("claims");
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); endTour(); } });
  window.addEventListener("hashchange", route); window.addEventListener("resize", resizeAll);
  S.date = snapDate(sc.date, D.byName[sc.well]);
  subscribe(render); route(); render();
  window.__cockpit = { S, D, ctx, PAGES };          // untuk pengujian & debugging
}

function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1]; current = byId[id] ? id : "ringkasan";
  document.querySelectorAll(".page").forEach((s) => s.classList.toggle("on", s.id === "pg-" + current));
  document.querySelectorAll(".tab").forEach((t) => (t.dataset.id === current ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")));
  document.body.dataset.page = current;          // CSS menyembunyikan bilah kontrol global di halaman "Data Anda"
  document.title = `${byId[current].title} | Volve Production Cockpit`; render(); requestAnimationFrame(() => { resizeAll(); });
  if (!tourOn) window.scrollTo({ top: 0 });
}

function render() {
  const w = curWell(); if (!w) return;
  const av = availOf(w), d = $("c-date"); let i = av.findIndex((t) => dateOf(w, t) >= S.date); if (i < 0) i = av.length - 1;
  d.min = 0; d.max = av.length - 1; d.value = i; $("c-dl").textContent = S.date; $("c-well").value = w.name;
  document.querySelectorAll("#c-unit button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.u === S.unit)));
  const c = ctx(); if (!c) return;
  const pg = byId[current];
  try { pg.update(c); } catch (e) { console.error("update", current, e); const el = $("pg-" + current); if (!el.querySelector(".err")) el.insertAdjacentHTML("afterbegin", `<div class="note bad err">Kesalahan menampilkan halaman ini: ${esc(e.message)}</div>`); }
  const dr = $("asum-form"); if (dr && dr.childElementCount) { syncForm(dr); asumLive(c); }
}

// ---------------------------------------------------------------- panel
function openDrawer(kind) {
  closeDrawer();
  const host = $("drawer-host"), veil = document.createElement("div"); veil.className = "veil"; veil.onclick = closeDrawer;
  const dr = document.createElement("aside"); dr.className = "drawer"; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true");
  dr.innerHTML = `<button class="btn small x" aria-label="Tutup">✕ Tutup</button>` + (kind === "asum" ? `
    <h2>Asumsi ekonomi</h2><p class="small muted">Semua angka di sini adalah <b>asumsi Anda</b>, bukan data Volve. Catat sumbernya agar hasil dapat dipertanggungjawabkan; sumber ikut tercetak di brief.</p>
    <div class="asum-live" id="asum-live" aria-live="polite"></div>
    <div id="asum-form"></div>
    <h3 style="margin:16px 0 6px;font-size:14px">Sumber angka</h3>
    <div class="fi"><label for="src-price">Harga minyak</label><input class="in" style="width:100%" id="src-price" placeholder="mis. laporan EIA / kontrak, tanggal" value="${esc(S.econ.sources.price)}"></div>
    <div class="fi" style="margin-top:8px"><label for="src-opex">OPEX</label><input class="in" style="width:100%" id="src-opex" placeholder="mis. data biaya operasi lapangan" value="${esc(S.econ.sources.opex)}"></div>
    <div class="fi" style="margin-top:8px"><label for="src-capex">CAPEX intervensi</label><input class="in" style="width:100%" id="src-capex" placeholder="mis. estimasi AFE / analog workover" value="${esc(S.econ.sources.capex)}"></div>
    <p style="margin-top:14px"><button class="btn small" id="asum-reset">Kembalikan angka ke bawaan</button></p>` : `<h2>Batas klaim</h2><p class="small muted">Apa yang dibuktikan dan tidak dibuktikan oleh aplikasi ini.</p><div class="small">${CLAIMS}</div>`);
  host.append(veil, dr); dr.querySelector(".x").focus(); dr.querySelector(".x").onclick = closeDrawer;
  if (kind === "asum") {
    buildForm($("asum-form"), ["price", "opex", "capex", "uplift", "disc", "woDays", "months", "dmin", "priceVol", "capexVol", "upliftSpread", "declineVol"]);
    for (const k of ["price", "opex", "capex"]) $("src-" + k).oninput = (e) => { S.econ.sources[k] = e.target.value; };
    // reset hanya mengembalikan angka; sumber yang sudah diketik tetap; panel tetap terbuka agar efeknya terlihat
    $("asum-reset").onclick = async () => { const { DEFAULT_ECON } = await import("./econ.js"); const src = S.econ.sources; S.econ = { ...structuredClone(DEFAULT_ECON), sources: src }; notify(); };
    asumBase = snap(ctx()); asumLive(ctx());
  }
}
function closeDrawer() { $("drawer-host").innerHTML = ""; asumBase = null; }

// Ringkasan live di panel Asumsi. Slider sudah langsung berlaku (debounce 140 ms), tetapi halaman tertutup panel,
// jadi efeknya ditampilkan di sini, dibandingkan dengan kondisi saat panel dibuka.
const VERD = { go: "Layak", marginal: "Marginal", nogo: "Belum layak" };
let asumBase = null;
function snap(c) { const e = c?.eco?.(); return e ? { p50: e.mc.P50, pPos: e.mc.pPos, be: e.be.price, level: e.rec.level } : null; }
function asumLive(c) {
  const el = $("asum-live"); if (!el) return;
  const now = snap(c);
  if (!now) { el.innerHTML = `<div class="small muted">Belum ada prakiraan pada tanggal ini, jadi NPV belum bisa dihitung. Perubahan tetap disimpan.</div>`; return; }
  const b = asumBase, d = b ? now.p50 - b.p50 : 0, moved = b && Math.abs(d) >= 5e4;
  el.innerHTML = `<div class="tiny muted">Sumur ${esc(c.w.short)}, ${esc(c.date)}. Perubahan langsung berlaku di semua halaman.</div>
    <div class="al-row"><span class="al-v ${now.level}">${VERD[now.level]}</span><span>NPV P50 <b>${usd(now.p50, 1)}</b></span>
      <span>Peluang positif <b>${pct(now.pPos, 0)}</b></span><span>Harga impas <b>${now.be != null ? "US$ " + nf(now.be, 0) : "—"}</b></span></div>
    <div class="tiny muted">${moved ? `Saat panel dibuka: ${VERD[b.level]}, NPV P50 ${usd(b.p50, 1)} (${d > 0 ? "naik" : "turun"} ${usd(Math.abs(d), 1)}).` : "Geser slider untuk melihat perubahannya di sini."}</div>`;
}

// ---------------------------------------------------------------- tur (Try Sample Data)
let tourOn = false, ti = 0;
const STEPS = [
  { page: "ringkasan", sel: "#rs-hero", title: "Keputusan", text: () => "Sumur F-11 pada 30 Jun 2015. Kesimpulan, rentang NPV, dan angka kunci dalam satu layar." },
  { page: "lapangan", sel: "#lp-area", title: "Kondisi lapangan", text: () => "Riwayat produksi seluruh sumur Volve." },
  { page: "prakiraan", sel: "#pk-fan", title: "Prakiraan", text: () => "Prakiraan 30, 60, dan 90 hari dengan rentang P90–P10, dibandingkan dengan yang benar-benar terjadi." },
  { page: "downtime", sel: "#dt-wf", title: "Produksi tertunda", text: () => "Produksi yang hilang karena sumur berhenti." },
  { page: "investasi", sel: "#iv-heat", title: "Kelayakan investasi", text: () => "NPV pada berbagai kombinasi harga minyak dan uplift." },
  { page: "kepercayaan", sel: "#kp-h", title: "Keandalan model", text: () => "Galat model dibandingkan metode konvensional." },
];
function startTour() { tourOn = true; ti = 0; showStep(); }
function endTour() { tourOn = false; $("tour").innerHTML = ""; document.querySelectorAll(".tour-hl").forEach((e) => e.classList.remove("tour-hl")); }
function showStep() {
  const s = STEPS[ti]; location.hash = "#/" + s.page;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll(".tour-hl").forEach((e) => e.classList.remove("tour-hl"));
    const el = document.querySelector(s.sel)?.closest(".card"); if (el) { el.classList.add("tour-hl"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    const c = ctx();
    $("tour").innerHTML = `<div class="tour" role="dialog" aria-label="Tur"><div class="st">${ti + 1} dari ${STEPS.length}</div><h4>${s.title}</h4><div class="small">${s.text(c)}</div>
      <div class="row"><button class="btn small" id="t-x">Selesai</button>${ti > 0 ? `<button class="btn small" id="t-b">‹ Kembali</button>` : ""}${ti < STEPS.length - 1 ? `<button class="btn small primary" id="t-n">Berikutnya ›</button>` : ""}</div></div>`;
    $("t-x").onclick = endTour; if ($("t-b")) $("t-b").onclick = () => { ti--; showStep(); }; if ($("t-n")) $("t-n").onclick = () => { ti++; showStep(); };
  }));
}

init();