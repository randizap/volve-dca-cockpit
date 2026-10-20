// data.js — halaman "Data Anda": unggah file produksi harian, prakiraan dengan ONNX final di browser.
// Dipisah dari halaman Tim agar mudah ditemukan. Hasil di halaman ini TIDAK memengaruhi halaman lain.
import { nf, pct, esc } from "../ui.js";
import { draw } from "../charts.js";
import { fanOption } from "../builders.js";
import { D } from "../data.js";
import { HZ } from "../features.js";
import { ortReady } from "../onnx.js";
import { readFile, build, forecast, REQUIRED, OPTIONAL } from "../upload.js";
import { unitInfo } from "../store.js";

let UP = null, upToken = 0;

/** nama sumur dinormalisasi agar "15/9-F-15 D" dan "15/9-f-15d" dianggap sama */
const norm = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Sumur yang ikut melatih model final (semua sumur Volve kecuali sumur riwayat pendek, sesuai build_data.py).
 * Bila pengguna mengunggah salah satunya, prakiraan bersifat in-sample: model sudah melihat "masa depan" tanggal itu.
 */
function trainedWells() {
  const short = norm(D.meta.short_well);
  return new Set(D.wells.map((w) => norm(w.name)).filter((n) => n !== short));
}
const isTrained = (name) => trainedWells().has(norm(name));

export default {
  id: "data", title: "Data Anda", icon: "data",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Prakiraan dari data Anda</h1>
      <p>Unggah data produksi harian dengan format Volve. File diproses di browser dan tidak dikirim ke server.
      Hasilnya hanya tampil di halaman ini; halaman lain tetap memakai data Volve.</p></div></div>
    <div class="card" id="up-card">
      <div class="grid g2" style="margin:0">
        <div><div class="dz" id="up-dz" tabindex="0" role="button" aria-label="Pilih file xlsx atau csv"><b>Pilih atau tarik file .xlsx / .csv</b><br><span class="small muted">Sheet harian, satu baris per sumur per hari</span></div>
          <input type="file" id="up-file" accept=".xlsx,.xls,.csv" class="hidden"><div id="up-msg" style="margin-top:10px"></div></div>
        <details class="cols"><summary>Kolom yang dibutuhkan</summary>
          <div class="tscroll"><table class="tbl"><thead><tr><th>Kolom</th><th class="txt">Isi</th></tr></thead><tbody>${REQUIRED.map(([c, d]) => `<tr><td class="mono">${c}</td><td class="txt">${d} <b>(wajib)</b></td></tr>`).join("")}${OPTIONAL.map(([c, d]) => `<tr><td class="mono">${c}</td><td class="txt">${d}</td></tr>`).join("")}</tbody></table></div></details>
      </div>
    </div>
    <div id="up-out" class="hidden" style="margin-top:16px">
      <div id="up-leak"></div>
      <div class="card" style="margin-bottom:16px"><div class="fld" style="flex-wrap:wrap"><label for="up-well">Sumur</label><select class="sel" id="up-well"></select><label for="up-date">Tanggal keputusan</label><input type="range" id="up-date" style="min-width:240px;accent-color:var(--accent)"><span class="datelbl" id="up-dl"></span></div></div>
      <div class="grid g21"><div class="card"><h3>Prakiraan</h3><div id="up-fan" class="chart"></div></div><div class="card"><h3>Angka</h3><div class="tscroll"><table class="tbl" id="up-tbl"></table></div><div class="read" id="up-note"></div></div></div>
    </div>`;
    const dz = root.querySelector("#up-dz"), fi = root.querySelector("#up-file");
    dz.onclick = () => fi.click(); dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); } };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("drag"); }; dz.ondragleave = () => dz.classList.remove("drag");
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("drag"); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0], root); };
    fi.onchange = () => { fi.files[0] && handle(fi.files[0], root); fi.value = ""; };   // reset agar file yang sama bisa diunggah ulang
    root.querySelector("#up-well").onchange = () => selectUp(root);
    root.querySelector("#up-date").oninput = () => showUp(root);
  },
  update() { if (UP) showUp(document.getElementById("pg-data")); },   // hanya untuk ganti satuan bbl/Sm³
};

async function handle(file, root) {
  const msg = root.querySelector("#up-msg"); msg.className = "note"; msg.textContent = "Membaca " + file.name + " …";
  try {
    const { rows, sheet } = await readFile(file), R = build(rows); UP = { ...R, sel: 0 };
    const nTrained = R.wells.filter((w) => isTrained(w.name)).length;
    msg.className = "note " + (R.warn.length ? "warn" : "ok");
    msg.innerHTML = `Sheet “${esc(sheet)}”: ${nf(rows.length)} baris, <b>${R.wells.length}</b> sumur produser.
      ${nTrained ? `${nTrained} di antaranya adalah sumur Volve yang dipakai melatih model.` : ""}
      Pembersihan: ${R.log.join("; ")}.${R.warn.length ? "<br>⚠ " + R.warn.join("<br>⚠ ") : ""}`;
    const sel = root.querySelector("#up-well");
    sel.innerHTML = R.wells.map((w, i) => `<option value="${i}">${esc(w.name)} (${w.n} hari)${isTrained(w.name) ? " · data latih" : ""}</option>`).join("");
    root.querySelector("#up-out").classList.remove("hidden"); selectUp(root);
  } catch (e) { msg.className = "note bad"; msg.textContent = "Gagal: " + e.message; root.querySelector("#up-out").classList.add("hidden"); UP = null; }
}

function selectUp(root) {
  UP.sel = +root.querySelector("#up-well").value; const W = UP.wells[UP.sel], r = root.querySelector("#up-date");
  r.min = 60; r.max = W.n - 1; r.value = W.n - 1;
  root.querySelector("#up-leak").innerHTML = isTrained(W.name)
    ? `<div class="note warn"><b>Sumur ini ikut dipakai melatih model.</b> Model final dilatih dengan seluruh riwayat ${esc(W.name)},
       termasuk produksi setelah tanggal yang Anda pilih. Karena itu kecocokan prakiraan dengan baris "Aktual" di bawah
       <b>bukan ukuran akurasi</b> (in-sample). Akurasi yang jujur, diuji pada data yang belum pernah dilihat model,
       ada di halaman <a href="#/kepercayaan">Kepercayaan</a> dan <a href="#/prakiraan">Prakiraan</a>.</div>`
    : "";
  showUp(root);
}

async function showUp(root) {
  if (!UP) return;
  const my = ++upToken, W = UP.wells[UP.sel], t = +root.querySelector("#up-date").value;
  root.querySelector("#up-dl").textContent = isoOf2(W.day0 + t);
  if (!ortReady()) { root.querySelector("#up-note").textContent = "Model ONNX belum siap. Tunggu sebentar lalu geser tanggal lagi."; return; }
  try {
    const F = await forecast(W, t); if (my !== upToken) return;
    const U = unitInfo(), c = { w: W, t, F, U }; draw("up-fan", fanOption(c, { hist: 120 }));
    const k = U.k, leak = isTrained(W.name);
    root.querySelector("#up-tbl").innerHTML = `<thead><tr><th>${U.rate}</th>${HZ.map((H) => `<th>${H} hr</th>`).join("")}</tr></thead><tbody>
      <tr><td>P90</td>${HZ.map((H) => `<td>${nf(F.byH[H].lo * k)}</td>`).join("")}</tr><tr class="best"><td>Terpadu P50</td>${HZ.map((H) => `<td>${nf(F.byH[H].e * k)}</td>`).join("")}</tr><tr><td>P10</td>${HZ.map((H) => `<td>${nf(F.byH[H].hi * k)}</td>`).join("")}</tr>
      <tr><td>XGBoost</td>${HZ.map((H) => `<td>${nf(F.byH[H].p * k)}</td>`).join("")}</tr><tr><td>Arps</td>${HZ.map((H) => `<td>${nf(F.byH[H].a * k)}</td>`).join("")}</tr>
      <tr><td>Aktual${leak ? "*" : ""}</td>${HZ.map((H) => `<td>${F.byH[H].y != null ? nf(F.byH[H].y * k) : "—"}</td>`).join("")}</tr></tbody>`;
    root.querySelector("#up-note").innerHTML = `Uptime 30 hari ${pct(F.u30, 0)} (${F.regime}). Pita P90–P10 dikalibrasi pada data Volve; pada lapangan lain cakupannya belum terbukti.${leak ? "<br>* In-sample: model sudah melihat periode ini saat dilatih." : ""}`;
  } catch (e) { root.querySelector("#up-note").textContent = "Gagal menjalankan ONNX: " + e.message; }
}
const isoOf2 = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
