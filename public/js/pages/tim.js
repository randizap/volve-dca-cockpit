import { nf } from "../ui.js";
import { D } from "../data.js";
import { latency, finalName, ortReady } from "../onnx.js";
import { getTeam, teamCards } from "../team.js";

export const REPO_URL = "https://github.com/randizap/volve-dca-cockpit";       // ← isi URL GitHub publik tim
export const CLAIMS = `
<ul>
  <li><b>Yang dibuktikan:</b> prakiraan rata-rata laju minyak 30/60/90 hari pada 6 sumur Volve, divalidasi walk-forward 2011–2016. WAPE prakiraan terpadu ≈ 20% (XGBoost saja ≈ 23–25%; Arps ≈ 24%; persistence ≈ 23–27%).</li>
  <li><b>XGBoost sendirian tidak mengalahkan baseline di semua periode.</b> Keunggulan muncul dari kombinasi dan pada periode dengan gangguan lebih sering.</li>
  <li><b>Pita P90–P10</b> dihitung dari galat historis; cakupannya 76–79% (nominal 80%) — sedikit terlalu sempit.</li>
  <li><b>Peringatan dini penurunan 30 hari</b> lemah (sekitar 1,6× acak untuk skor terbaik); jangan dipakai sebagai alarm otomatis.</li>
  <li><b>Bukan data Volve:</b> harga, OPEX, CAPEX, uplift intervensi, discount rate. Semuanya asumsi pengguna; nilai bawaan hanya ilustrasi.</li>
  <li><b>Produksi tertunda</b> adalah estimasi heuristik dari jam operasi; penyebab shut-in tidak tercatat di data.</li>
  <li><b>F-5</b> hanya 144 hari berproduksi (sebelumnya injektor); dikeluarkan dari pelatihan dan metrik agregat. <b>F-1 C</b> berhenti 41% hari; galat semua metode tinggi.</li>
  <li><b>Tidak ada</b> tekanan reservoir, model material balance, simulasi reservoir, atau pemodelan gas. Tidak menggantikan studi teknik reservoir.</li>
  <li><b>Kasus contoh</b> (F-11, 30 Jun 2015) ditetapkan sebelum melihat hasil, bukan dipilih karena bagus.</li>
  <li><b>Data &amp; lisensi:</b> Equinor Volve Data Village — disediakan “apa adanya”, untuk tujuan pendidikan/riset; cantumkan atribusi dan periksa syarat lisensi Equinor sebelum publikasi.</li>
</ul>`;

export default {
  id: "tim", num: "09", title: "Tim", icon: "tim",
  async build(root) {
    const team = await getTeam(), cards = teamCards(team);
    root.innerHTML = `
    <div class="ph"><div><h1>Tim dan Metode</h1>
      <p>Kasus 18: Production Forecasting &amp; Decline Curve Analysis. Tugas Besar Terapan Machine Learning, UPN “Veteran” Jawa Timur.</p></div>
      <div>${REPO_URL ? `<a class="btn" href="${REPO_URL}" target="_blank" rel="noopener">Repositori GitHub ↗</a>` : ""}</div></div>
    <div class="team" style="margin-bottom:22px">${cards || "<p class='muted'>public/team.json tidak terbaca.</p>"}</div>
    <div class="grid g21">
      <div class="card"><h3>Alur kerja</h3>
        <div class="pipe"><span class="s">Data Volve</span><span class="a">›</span><span class="s">Pembersihan</span><span class="a">›</span><span class="s">15 fitur</span><span class="a">›</span><span class="s">XGBoost, Arps, persistence</span><span class="a">›</span><span class="s">Prakiraan terpadu dan P90–P10</span><span class="a">›</span><span class="s">ONNX di browser</span><span class="a">›</span><span class="s">NPV, downtime, surveillance</span></div></div>
      <div class="card"><h3>Green AI</h3><div id="ga"></div><p style="margin:10px 0 0"><button class="btn small" id="ga-btn">Ukur latensi</button></p><div id="ga-out" class="small" style="margin-top:6px"></div></div>
    </div>`;
    // Green AI
    const fin = D.metrics.onnx.filter((o) => o.kind === "final"), wf = D.metrics.onnx.filter((o) => o.kind === "wf" && o.H === 30);
    root.querySelector("#ga").innerHTML = `<table class="tbl"><tbody>
      <tr><td class="txt">Ukuran model per horizon</td><td>${nf(fin[0].kb, 0)} KB</td></tr><tr><td class="txt">Server inferensi</td><td>tidak ada</td></tr>
      <tr><td class="txt">Waktu latih dan validasi (CPU)</td><td>± ${D.meta.train_seconds ?? 17} detik</td></tr></tbody></table>`;
    root.querySelector("#ga-btn").onclick = async (ev) => {
      const b = ev.target; if (!ortReady()) return; b.disabled = true; b.textContent = "mengukur…";
      try { const w = D.byName[D.meta.sample_case.well], F = (await import("../data.js")).featOf(w), L = await latency(finalName(30), F.rows[700]); root.querySelector("#ga-out").innerHTML = `Median <b>${nf(L.median, 3)} ms</b> per prakiraan (p95 ${nf(L.p95, 3)} ms, ${L.n} prakiraan).`; } catch (e) { root.querySelector("#ga-out").textContent = "Gagal: " + e.message; }
      b.disabled = false; b.textContent = "Ukur latensi di perangkat ini";
    };
  },
  update() { /* halaman statis. Unggah data dipindah ke halaman "Data Anda" (pages/data.js). */ },
};
