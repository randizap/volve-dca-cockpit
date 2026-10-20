import { card, setRead, nf, pct, esc } from "../ui.js";
import { draw, C, grid, WELL_COLORS, numFmt } from "../charts.js";
import { waterfallOption } from "../builders.js";
import { D, effectiveWells } from "../data.js";
import { FEATS, HZ } from "../features.js";

const M_LABEL = { terpadu: "Terpadu", xgb: "XGBoost", persistence: "Persistence", arps: "Arps", arps_uptime: "Arps × uptime" };
const M_COLOR = { terpadu: C.green, xgb: C.gold, persistence: C.gray, arps: C.terra, arps_uptime: C.purple };
const FEAT_LBL = { oil_m7_m30: "laju 7h/30h", oil_m30_m90: "laju 30h/90h", oil_d1_m30: "laju hari ini/30h", wc7: "water cut 7h", wc_delta: "Δ water cut", log_gor7: "log GOR", gor_ratio: "rasio GOR", whp7: "WHP 7h", whp_ratio: "rasio WHP", choke7: "choke 7h", uptime7: "uptime 7h", uptime30: "uptime 30h", log_m30: "log laju 30h", inj30: "injeksi air 30h", inj_ratio: "injeksi/cairan" };

export default {
  id: "kepercayaan", num: "07", title: "Kepercayaan", icon: "kepercayaan",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Keandalan Model</h1>
      <p>Kinerja model pada data yang tidak pernah dilihatnya (2011–2016).</p></div></div>
    <div id="kp-head" class="hidden"></div>
    <div class="grid g2">
      ${card("Galat menurut horizon (WAPE)", "kp-h", { h: "short", hint: "Semakin rendah semakin baik. Uji 2011–2016, tanpa F-5." })}
      ${card("Galat per sumur (WAPE 30 hari)", "kp-w", { h: "short", hint: "F-1 C sulit bagi semua metode (41% hari berhenti)." })}
    </div>
    <div class="grid g2">
      ${card("Prediksi vs aktual (terpadu, 30 hari)", "kp-sc", { h: "short", hint: "Garis putus-putus = prediksi sempurna. Sampel ≤ 1.500 titik." })}
      ${card("Kalibrasi rentang P90–P10", "kp-cal", { h: "short", hint: "Seharusnya 80% aktual jatuh di dalam pita. Dinilai dengan kalibrasi pada tahun lain (leave-one-year-out)." })}
    </div>
    <div class="grid g2">
      ${card("Pengaruh fitur (SHAP)", "kp-sg", { h: "short", hint: "Rata-rata |kontribusi| terhadap prakiraan 30 hari (Sm³/hari). SHAP hanya menjelaskan komponen XGBoost." })}
      ${card("Penjelasan prakiraan tanggal ini (SHAP)", "kp-sl", { h: "short" })}
    </div>
    <div class="grid g2">
      <div class="card"><h3>Ablasi fitur (30 hari, walk-forward)</h3><div class="tscroll"><table class="tbl" id="kp-abl"></table></div><div class="read" id="kp-abl-read"></div></div>
      <div class="card"><h3>Uji pada sumur yang tidak dilatih</h3><div class="tscroll"><table class="tbl" id="kp-lowo"></table></div><div class="read" id="kp-lowo-read"></div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>Kondisi normal vs sering berhenti</h3><div class="tscroll"><table class="tbl" id="kp-reg"></table></div><div class="read" id="kp-reg-read"></div></div>
      <div class="card"><h3>Pembersihan data</h3><div id="kp-clean"></div></div>
    </div>
    <div class="card"><h3>Model ONNX yang dikirim ke browser</h3><div class="tscroll"><table class="tbl" id="kp-onnx"></table></div><div class="read" id="kp-onnx-read"></div></div>`;
  },
  update(c) {
    const Mx = D.metrics, keys = ["terpadu", "xgb", "persistence", "arps", "arps_uptime"];
    const h30 = Mx.horizons[30], bestK = keys.slice().sort((a, b) => h30[a].WAPE - h30[b].WAPE)[0];
    draw("kp-h", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => nf(v, 1) + "%" },
      xAxis: { type: "category", data: HZ.map((H) => H + " hari") }, yAxis: { type: "value", name: "WAPE %", min: 0, nameTextStyle: { align: "left", color: C.muted } },
      series: keys.map((m) => ({ name: M_LABEL[m], type: "bar", itemStyle: { color: M_COLOR[m] }, label: m === "terpadu" ? { show: true, position: "top", formatter: (p) => nf(p.value, 1), fontSize: 11 } : undefined, data: HZ.map((H) => +(Mx.horizons[H][m].WAPE * 100).toFixed(1)) })),
    });
    const wl = Object.keys(Mx.per_well[30]);
    draw("kp-w", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => nf(v, 1) + "%" },
      xAxis: { type: "category", data: wl.map((n) => n.replace("15/9-", "")) }, yAxis: { type: "value", name: "WAPE %", min: 0, nameTextStyle: { align: "left", color: C.muted } },
      series: ["terpadu", "arps", "persistence"].map((m) => ({ name: M_LABEL[m], type: "bar", itemStyle: { color: M_COLOR[m] }, data: wl.map((n) => +(Mx.per_well[30][n][m] * 100).toFixed(1)) })),
    });
    // scatter
    const sc = {}; let cnt = 0;
    for (const w of effectiveWells()) { const f = w.oof; if (!f) continue; const arr = []; for (let k = 0; k < f.m30.length; k += 3) { const y = f.y[30][k], e = f.e[30][k]; if (f.m30[k] > 5 && Number.isFinite(y) && Number.isFinite(e)) { arr.push([+(y * c.U.k).toFixed(0), +(e * c.U.k).toFixed(0)]); cnt++; } } sc[w.short] = arr; }
    const mx = Math.max(...Object.values(sc).flat().flat());
    draw("kp-sc", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "item", formatter: (p) => `${p.seriesName}<br/>aktual ${nf(p.value[0])} · prediksi ${nf(p.value[1])}` },
      xAxis: { type: "value", name: "aktual (" + c.U.rate + ")", nameLocation: "middle", nameGap: 26, max: mx, nameTextStyle: { color: C.muted }, axisLabel: { formatter: numFmt } }, yAxis: { type: "value", name: "prediksi", max: mx, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: [...Object.entries(sc).map(([n, d]) => ({ name: n, type: "scatter", symbolSize: 4, itemStyle: { color: WELL_COLORS[n], opacity: 0.55 }, data: d })),
        { name: "ideal", type: "line", data: [[0, 0], [mx, mx]], showSymbol: false, lineStyle: { type: "dashed", color: C.ink, width: 1.4 }, tooltip: { show: false } }],
    });
    const cov = Mx.band_coverage_loyo;
    draw("kp-cal", {
      grid: grid({ top: 50 }), tooltip: { valueFormatter: (v) => nf(v, 1) + "%" },
      xAxis: { type: "category", data: HZ.map((H) => H + " hari") }, yAxis: { type: "value", min: 50, max: 100, name: "% aktual di dalam pita", nameTextStyle: { align: "left", color: C.muted } },
      series: [{ type: "bar", barWidth: 42, data: HZ.map((H) => +(cov[H] * 100).toFixed(1)), itemStyle: { color: C.green }, label: { show: true, position: "top", formatter: (p) => nf(p.value, 1) + "%", fontSize: 12, fontWeight: 700 },
        markLine: { silent: true, symbol: "none", lineStyle: { color: C.terra, type: "dashed", width: 2 }, label: { formatter: "target 80%", position: "end" }, data: [{ yAxis: 80 }] } }],
    });
    setRead("kp-cal", `Cakupan ${pct(cov[30], 0)} / ${pct(cov[60], 0)} / ${pct(cov[90], 0)} untuk 30/60/90 hari: pita sedikit <b>terlalu sempit</b> (kurang dari 80%), semakin jauh horizon semakin optimistis. Anggap P90–P10 sebagai batas bawah ketidakpastian.`);
    // SHAP global
    const sg = Object.entries(Mx.shap_global).sort((a, b) => a[1] - b[1]);
    draw("kp-sg", {
      grid: grid({ top: 6, left: 4, right: 40 }), tooltip: { valueFormatter: (v) => nf(v, 1) + " Sm³/hari" }, xAxis: { type: "value" }, yAxis: { type: "category", data: sg.map((s) => FEAT_LBL[s[0]] || s[0]), axisTick: { show: false }, axisLabel: { interval: 0, fontSize: 11 } },
      series: [{ type: "bar", barWidth: 12, data: sg.map((s) => +s[1].toFixed(1)), itemStyle: { color: C.green }, label: { show: true, position: "right", fontSize: 11, formatter: (p) => nf(p.value, 1) } }],
    });
    // SHAP lokal
    const F = c.F;
    if (F && F.shap) {
      const sh = F.shap, base = sh[FEATS.length], items = [{ name: "Nilai dasar", v: base * c.U.k, total: 1 }];
      const idx = FEATS.map((f, i) => i).sort((a, b) => Math.abs(sh[b]) - Math.abs(sh[a])); const top = idx.slice(0, 5), rest = idx.slice(5);
      top.forEach((i) => items.push({ name: FEAT_LBL[FEATS[i]] || FEATS[i], v: sh[i] * c.U.k }));
      const rs = rest.reduce((a, i) => a + sh[i], 0); items.push({ name: "lainnya", v: rs * c.U.k });
      items.push({ name: "XGBoost 30h", v: F.byH[30].p * c.U.k, total: 1 });
      draw("kp-sl", waterfallOption(items, (v, ax) => (ax ? numFmt(v) : (v > 0 && !items.find((x) => x.total && x.v === v) ? "+" : "") + nf(v, 0)), { unit: c.U.rate, top: 28 }));
      setRead("kp-sl", `Dari nilai dasar ${nf(base * c.U.k)} ke prakiraan XGBoost ${nf(F.byH[30].p * c.U.k)} ${c.U.rate}. Ini penjelasan <b>model</b>, bukan sebab-akibat fisik.`);
    }
    // ablasi
    const ab = Mx.ablation, minW = Math.min(...ab.map((a) => a.WAPE));
    document.getElementById("kp-abl").innerHTML = `<thead><tr><th>Varian</th><th>2011–13</th><th>2014–16</th><th>Semua</th><th>MAE</th></tr></thead><tbody>${ab.map((a, i) => `<tr class="${i === 0 ? "best" : ""}"><td class="txt">${esc(a.varian)}</td><td>${pct(a.WAPE_2011_13, 1)}</td><td>${pct(a.WAPE_2014_16, 1)}</td><td>${pct(a.WAPE, 1)}</td><td>${nf(a.MAE, 0)}</td></tr>`).join("")}</tbody>`;
    const nop = ab.find((a) => a.varian.includes("tekanan"));
    setRead("kp-abl", `Fitur final dipilih memakai 2011–13 lalu <b>dikonfirmasi pada 2014–16</b> (${pct(Mx.selection.awal.WAPE_2014_16, 1)} → ${pct(Mx.selection.final.WAPE_2014_16, 1)}). Menghapus <b>umur sumur</b> membantu (model tak lagi menghafal sumur); injeksi air membantu; downhole pressure tidak. Menghapus tekanan &amp; choke tampak lebih baik (${pct(nop.WAPE, 1)}) tetapi ditemukan setelah melihat semua periode, jadi <b>tidak diadopsi</b> — kandidat penyederhanaan.`);
    const lw = Mx.lowo[30];
    document.getElementById("kp-lowo").innerHTML = `<thead><tr><th>Sumur dikeluarkan</th><th>Terpadu</th><th>XGBoost</th><th>Arps</th><th>Persist.</th><th>n</th></tr></thead><tbody>${Object.entries(lw).map(([n, r]) => `<tr><td>${n.replace("15/9-", "")}</td><td>${pct(r.terpadu, 1)}</td><td>${pct(r.xgb, 1)}</td><td>${pct(r.arps, 1)}</td><td>${pct(r.persistence, 1)}</td><td>${r.n}</td></tr>`).join("")}</tbody>`;
    setRead("kp-lowo", "Model dilatih tanpa sumur itu sama sekali (30 hari). <b>Batas:</b> protokol ini masih memakai data masa depan sumur lain, jadi hanya menguji generalisasi antar-sumur, bukan ketepatan waktu.");
    const rg = Mx.regime[30];
    document.getElementById("kp-reg").innerHTML = `<thead><tr><th>Rezim</th><th>Terpadu</th><th>XGBoost</th><th>Arps</th><th>Persist.</th><th>n</th></tr></thead><tbody>${["normal", "gangguan"].map((k) => `<tr><td>${k === "normal" ? "Normal (uptime ≥ 85%)" : "Sering berhenti (&lt; 85%)"}</td><td>${pct(rg[k].terpadu, 1)}</td><td>${pct(rg[k].xgb, 1)}</td><td>${pct(rg[k].arps, 1)}</td><td>${pct(rg[k].persistence, 1)}</td><td>${rg[k].n}</td></tr>`).join("")}</tbody>`;
    setRead("kp-reg", "Semua metode memburuk saat sumur sering berhenti; pita ketidakpastian di halaman lain otomatis melebar untuk rezim ini.");
    const cl = D.meta.cleaning, gs = Mx.gap_sensitivity;
    document.getElementById("kp-clean").innerHTML = `<table class="tbl"><tbody>
      <tr><td class="txt">Baris produser awal → akhir</td><td>${nf(cl.baris_produser_awal)} → ${nf(cl.baris_produser_akhir)}</td></tr>
      <tr><td class="txt">Jam operasi &gt; 24 dipangkas ke 24</td><td>${cl.jam_lebih_24_dipangkas}</td></tr>
      <tr><td class="txt">Volume negatif dinolkan</td><td>${cl.volume_negatif_dinolkan}</td></tr>
      <tr><td class="txt">Jam = 0 tetapi minyak &gt; 0 (dibuang)</td><td>${cl.jam0_tapi_minyak_positif_dibuang}</td></tr>
      <tr><td class="txt">Tanggal hilang diisi 0 → WAPE 30h</td><td>${pct(gs.tanggal_hilang_diisi_0, 1)}</td></tr>
      <tr><td class="txt">Tanggal hilang diabaikan (NaN) → WAPE 30h</td><td>${pct(gs["tanggal_hilang_diabaikan_(NaN)"], 1)}</td></tr></tbody></table>
      `;
    const on = Mx.onnx, fin = on.filter((o) => o.kind === "final"), wf = on.filter((o) => o.kind === "wf");
    document.getElementById("kp-onnx").innerHTML = `<thead><tr><th>Model</th><th>Jumlah file</th><th>Ukuran per file</th><th>Total</th><th>Selisih maks vs XGBoost</th></tr></thead><tbody>
      <tr><td class="txt">Final (semua data) — untuk data unggahan</td><td>${fin.length}</td><td>${nf(fin[0].kb, 0)} KB</td><td>${nf(fin.reduce((a, o) => a + o.kb, 0), 0)} KB</td><td>${Math.max(...fin.map((o) => o.max_diff)).toExponential(1)}</td></tr>
      <tr><td class="txt">Walk-forward tahunan 2011–2016 — untuk hindcast</td><td>${wf.length}</td><td>${nf(wf[0].kb, 0)} KB</td><td>${nf(wf.reduce((a, o) => a + o.kb, 0), 0)} KB</td><td>${Math.max(...wf.map((o) => o.max_diff)).toExponential(1)}</td></tr></tbody>`;
    setRead("kp-onnx", "Model dimuat <b>sesuai kebutuhan</b> (lazy), satu file ± 100 KB per horizon — bukan seluruh 21 file. Hyperparameter belum di-tuning (bawaan yang wajar); tuning dengan validasi waktu adalah pekerjaan lanjutan.");
  },
};