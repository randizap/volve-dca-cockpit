import { card, nf, pct, usd, esc } from "../ui.js";
import { draw, C, grid, renderImage } from "../charts.js";
import { fanOption, npvWaterfall } from "../builders.js";
import { downtimeSummary } from "../ops.js";
import { S, set, ctx } from "../store.js";

const COLS = [C.green, C.terra, C.blue, C.gold];
const csvEsc = (v) => `"${String(v).replace(/"/g, '""')}"`;

export default {
  id: "skenario", num: "08", title: "Skenario", icon: "skenario",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Skenario</h1>
      <p>Bandingkan hingga empat skenario, lalu unduh atau cetak.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="sc-save">Simpan skenario</button><button class="btn" id="sc-csv">Unduh CSV</button><button class="btn" id="sc-print">Cetak ringkasan</button></div></div>
    <div id="sc-msg" class="hidden"></div>
    <div class="grid g2">
      ${card("Arus kas kumulatif P50 (juta US$)", "sc-cum", { h: "short" })}${card("NPV P90 / P50 / P10 (juta US$)", "sc-bar", { h: "short" })}
    </div>
    <div class="card"><h3>Perbandingan</h3><div class="tscroll"><table class="tbl" id="sc-tbl"></table></div></div>`;
    root.querySelector("#sc-save").onclick = () => {
      if (S.scenarios.length >= 4) { document.getElementById("sc-msg").className = "note warn"; document.getElementById("sc-msg").textContent = "Maksimum 4 skenario. Hapus salah satu dulu."; return; }
      const c = ctx(), e = c.eco(); if (!e) return;
      S.scenarios.push({ id: Date.now(), well: c.w.short, date: c.date, econ: { ...S.econ }, P90: e.mc.P90, P50: e.mc.P50, P10: e.mc.P10, pPos: e.mc.pPos, bep: e.be.price, beu: e.be.uplift, pb: e.payback, cum: Array.from(e.mc.cumP50, (v) => v / 1e6), rec: e.rec.text });
      set({});
    };
    root.querySelector("#sc-csv").onclick = () => {
      const hdr = ["No", "Sumur", "Tanggal", "Harga", "OPEX", "CAPEX_jt", "Uplift", "Disc", "HariShut", "Horizon_bln", "NPV_P90_jt", "NPV_P50_jt", "NPV_P10_jt", "P_NPV_positif", "HargaImpas", "UpliftImpas", "Payback_bln", "Rekomendasi"];
      const rows = S.scenarios.map((s, i) => [i + 1, s.well, s.date, s.econ.price, s.econ.opex, s.econ.capex, s.econ.uplift, s.econ.disc, s.econ.woDays, s.econ.months, (s.P90 / 1e6).toFixed(2), (s.P50 / 1e6).toFixed(2), (s.P10 / 1e6).toFixed(2), s.pPos.toFixed(3), s.bep?.toFixed(1) ?? "", s.beu?.toFixed(4) ?? "", s.pb ?? "", s.rec]);
      const blob = new Blob(["\ufeff" + [hdr, ...rows].map((r) => r.map(csvEsc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "skenario_volve_cockpit.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    root.querySelector("#sc-print").onclick = () => printBrief();
  },
  update(c) {
    const sc = S.scenarios, msg = document.getElementById("sc-msg");
    if (sc.length) {  }
    const N = Math.max(1, ...sc.map((s) => s.cum.length));
    draw("sc-cum", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: Array.from({ length: N }, (_, i) => i), name: "bulan", nameLocation: "middle", nameGap: 24, axisLabel: { interval: 5 }, nameTextStyle: { color: C.muted } }, yAxis: { type: "value", name: "juta US$", nameTextStyle: { align: "left", color: C.muted } },
      series: sc.map((s, i) => ({ name: `S${i + 1} · ${s.well}`, type: "line", data: s.cum.map((v) => +v.toFixed(2)), showSymbol: false, lineStyle: { width: 2.5, color: COLS[i] }, itemStyle: { color: COLS[i] }, ...(i === 0 ? { markLine: { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } } : {}) })),
    });
    draw("sc-bar", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => nf(v, 1) + " jt" },
      xAxis: { type: "category", data: sc.map((s, i) => `S${i + 1} · ${s.well}`) }, yAxis: { type: "value", name: "juta US$", nameTextStyle: { align: "left", color: C.muted } },
      series: [["P90", "P90", C.terra], ["P50", "P50", C.green], ["P10", "P10", C.blue]].map(([n, k, col]) => ({ name: n, type: "bar", itemStyle: { color: col }, data: sc.map((s) => +(s[k] / 1e6).toFixed(1)) })),
    });
    document.getElementById("sc-tbl").innerHTML = `<thead><tr><th>#</th><th>Sumur</th><th>Tanggal</th><th>Harga</th><th>Uplift</th><th>CAPEX</th><th>NPV P50</th><th>P(NPV&gt;0)</th><th>Harga impas</th><th>Payback</th><th class="txt">Rekomendasi</th><th></th></tr></thead><tbody>${
      sc.length ? sc.map((s, i) => `<tr><td><b style="color:${COLS[i]}">S${i + 1}</b></td><td>${esc(s.well)}</td><td>${s.date}</td><td>${nf(s.econ.price, 0)}</td><td>${pct(s.econ.uplift, 0)}</td><td>${nf(s.econ.capex, 1)}</td><td>${usd(s.P50, 1)}</td><td>${pct(s.pPos, 0)}</td><td>${s.bep != null ? nf(s.bep, 1) : "—"}</td><td>${s.pb ? s.pb + " bln" : "—"}</td><td class="txt">${esc(s.rec)}</td><td><button class="btn small" data-del="${s.id}">Hapus</button></td></tr>`).join("") : `<tr><td colspan="12" class="txt muted">Belum ada skenario. Atur sumur, tanggal, dan asumsi, lalu pilih Simpan skenario.</td></tr>`}</tbody>`;
    document.querySelectorAll("#sc-tbl [data-del]").forEach((b) => (b.onclick = () => { S.scenarios = S.scenarios.filter((s) => s.id !== +b.dataset.del); set({}); }));
  },
};

function printBrief() {
  const c = ctx(); if (!c || !c.F) return; const e = c.eco(), U = c.U, F = c.F, b90 = F.byH[90];
  const img1 = renderImage(fanOption(c, { mini: true, hist: 120 }), 660, 300), img2 = renderImage(npvWaterfall(e.det), 660, 300);
  const dt = downtimeSummary(c.calIdx, 365).find((r) => r.name === c.w.name);
  document.getElementById("brief").innerHTML = `
    <h1>Volve DCA Cockpit — Brief Keputusan</h1>
    <p><b>Sumur ${esc(c.w.short)}</b> · tanggal keputusan <b>${c.date}</b> (hindcast: model hanya melihat data sebelum 1 Jan ${c.date.slice(0, 4)}) · dicetak ${new Date().toLocaleDateString("id-ID")}</p>
    <p style="font-size:16px"><b>Rekomendasi aturan:</b> ${esc(e.rec.text)} — peluang NPV &gt; 0 = ${pct(e.mc.pPos, 0)}, NPV P90/P50/P10 = ${usd(e.mc.P90, 1)} / ${usd(e.mc.P50, 1)} / ${usd(e.mc.P10, 1)}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0" border="1" cellpadding="5">
      <tr><td>Laju 30 hari terakhir</td><td>${nf(F.m30 * U.k)} ${U.rate}</td><td>Uptime 30 hari</td><td>${pct(F.u30, 0)}</td></tr>
      <tr><td>Prakiraan 90 hari P50 (P90–P10)</td><td>${nf(b90.e * U.k)} (${nf(b90.lo * U.k)}–${nf(b90.hi * U.k)}) ${U.rate}</td><td>Aktual 90 hari</td><td>${b90.y != null ? nf(b90.y * U.k) + " " + U.rate : "belum tersedia"}</td></tr>
      <tr><td>Harga impas</td><td>${e.be.price != null ? "US$ " + nf(e.be.price, 1) + "/bbl" : "—"}</td><td>Uplift impas</td><td>${e.be.uplift != null ? pct(e.be.uplift, 1) : "—"}</td></tr>
      <tr><td>Produksi tertunda 12 bln</td><td>${dt ? nf((dt.dF + dt.dW) * U.k) + " " + U.vol : "—"}</td><td>Payback</td><td>${e.payback ? e.payback + " bulan" : "di luar horizon"}</td></tr></table>
    <div class="b2"><img src="${img1}" alt="Prakiraan"><img src="${img2}" alt="Waterfall NPV"></div>
    <p style="font-size:12.5px"><b>Asumsi ekonomi (ILUSTRASI — bukan data Volve):</b> harga US$ ${S.econ.price}/bbl (sumber: ${esc(S.econ.sources.price || "belum diisi")}), OPEX US$ ${S.econ.opex}/bbl (${esc(S.econ.sources.opex || "belum diisi")}), CAPEX US$ ${S.econ.capex} juta (${esc(S.econ.sources.capex || "belum diisi")}), uplift ${pct(S.econ.uplift, 0)}, discount ${pct(S.econ.disc, 1)}, shut-in ${S.econ.woDays} hari, horizon ${S.econ.months} bulan, decline terminal ${pct(S.econ.dmin, 0)}/tahun.</p>
    <p style="font-size:11.5px;color:#555"><b>Batas klaim.</b> Prakiraan produksi terbukti pada 6 sumur Volve (2011–2016; WAPE terpadu ± 20%); pita P90–P10 sedikit lebih sempit dari nominal 80%. Uplift, harga, dan biaya adalah asumsi pengguna. Estimasi produksi tertunda bersifat heuristik. Alat bantu diskusi, bukan keputusan investasi. Data: Equinor Volve Data Village (lisensi Equinor; dipakai untuk tujuan pendidikan).</p>`;
  window.print();
}