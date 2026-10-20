import { card, setRead, nf, pct, esc } from "../ui.js";
import { draw, C, grid, errorBars, numFmt } from "../charts.js";
import { fanOption } from "../builders.js";
import { D, featOf, effectiveWells } from "../data.js";
import { HZ, FEATS, isoOf } from "../features.js";
import { predictRatio, wfName, latency, ortReady } from "../onnx.js";

const LBL = { oil_m7_m30: "Rasio laju 7h/30h", oil_m30_m90: "Rasio laju 30h/90h", oil_d1_m30: "Laju hari ini / 30h", wc7: "Water cut 7h", wc_delta: "Δ water cut (7h−30h)", log_gor7: "log(1+GOR 7h)", gor_ratio: "Rasio GOR 7h/30h",
  whp7: "WHP 7h (bar)", whp_ratio: "Rasio WHP 7h/30h", choke7: "Choke 7h (%)", uptime7: "Uptime 7h", uptime30: "Uptime 30h", log_m30: "log(1+laju 30h)", inj30: "Injeksi air lapangan 30h", inj_ratio: "Injeksi ÷ cairan lapangan" };
let RW = null, whatif = { key: "", feats: null }, token = 0;

function rolling() {           // WAPE per kuartal, tiap metode (walk-forward, tanpa F-5)
  if (RW) return RW;
  const acc = new Map();
  for (const w of effectiveWells()) {
    const f = w.oof; if (!f) continue;
    for (let k = 0; k < f.m30.length; k++) {
      const y = f.y[30][k], e = f.e[30][k]; if (!(f.m30[k] > 5) || !Number.isFinite(y) || !Number.isFinite(e)) continue;
      const d = isoOf(w.day0 + f.o0 + k), q = d.slice(0, 4) + " T" + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1);
      const a = acc.get(q) || { y: 0, e: 0, p: 0, a: 0, m: 0 };
      a.y += y; a.e += Math.abs(e - y); a.p += Math.abs(f.p[30][k] - y); a.a += Math.abs(f.a[30][k] - y); a.m += Math.abs(f.m30[k] - y); acc.set(q, a);
    }
  }
  const keys = [...acc.keys()].sort();
  return (RW = { keys, e: keys.map((q) => acc.get(q).e / acc.get(q).y * 100), p: keys.map((q) => acc.get(q).p / acc.get(q).y * 100), a: keys.map((q) => acc.get(q).a / acc.get(q).y * 100), m: keys.map((q) => acc.get(q).m / acc.get(q).y * 100) });
}

export default {
  id: "prakiraan", num: "03", title: "Prakiraan", icon: "prakiraan",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Prakiraan Produksi</h1>
      <p>Rata-rata laju minyak 30, 60, dan 90 hari ke depan.</p></div></div>
    <div class="grid g21">
      ${card("Prakiraan dan rentang P90–P10", "pk-fan", { h: "tall", hint: "Batang hijau = P90–P10 (rentang 80%, dikalibrasi dari galat historis). P90 = konservatif, P10 = optimistis." })}
      <div class="card"><h3>Angka prakiraan</h3><div class="tscroll"><table class="tbl" id="pk-tbl"></table></div></div>
    </div>
    <div class="grid g2">
      ${card("Volume kumulatif ke depan", "pk-vol", { hint: "Volume = rata-rata laju × H hari. Batang = P50, garis = P90–P10.", h: "short" })}
      ${card("Galat per kuartal (WAPE 30 hari)", "pk-roll", { hint: "Semakin rendah semakin baik. Kuartal yang buruk ditampilkan apa adanya.", h: "short" })}
    </div>
    <div class="card"><h3>Model di browser (ONNX)</h3>
      <div class="grid g2" style="margin:8px 0 0"><div><div class="frm" id="pk-in"></div><p style="margin-top:10px"><button class="btn small" id="pk-reset">Reset fitur</button> <button class="btn small" id="pk-lat">Ukur latensi</button></p></div>
      <div><div class="tscroll"><table class="tbl" id="pk-onx"></table></div><div id="pk-par" class="note ok" style="margin-top:10px"></div></div></div></div>`;
    root.querySelector("#pk-reset").onclick = () => { whatif.key = ""; root.querySelector("#pk-in").dataset.k = ""; this._c && this.update(this._c); };
    root.querySelector("#pk-lat").onclick = async () => {
      const b = root.querySelector("#pk-lat"); b.disabled = true; b.textContent = "mengukur…";
      const c = this._c, yr = Math.min(2016, Math.max(2011, +c.date.slice(0, 4)));
      const L = await latency(wfName(yr, 30), whatif.feats || featOf(c.w).rows[c.t]);
      document.getElementById("pk-par").innerHTML += ` Latensi median ${nf(L.median, 2)} ms.`; b.disabled = false; b.textContent = "Ukur latensi";
    };
  },
  update(c) {
    this._c = c; const { w, t, F, U } = c, k = U.k;
    if (!F) return;
    draw("pk-fan", fanOption(c));
    const bands = HZ.map((H) => F.byH[H]);
    const err = (v, y) => (y != null ? nf(((v - y) / Math.max(1, y)) * 100, 0) + "%" : "—");
    const row = (lab, key, cls = "") => `<tr class="${cls}"><td>${lab}</td>${HZ.map((H) => `<td>${nf(F.byH[H][key] * k)}</td>`).join("")}</tr>`;
    document.getElementById("pk-tbl").innerHTML = `<thead><tr><th>${U.rate}</th><th>30 hari</th><th>60 hari</th><th>90 hari</th></tr></thead><tbody>
      ${row("P90 (konservatif)", "lo")}${row("Terpadu P50", "e", "best")}${row("P10 (optimistis)", "hi")}${row("XGBoost (komponen)", "p")}${row("Arps", "a")}${row("Persistence", "pers")}
      <tr><td>Aktual</td>${HZ.map((H) => `<td>${F.byH[H].y != null ? nf(F.byH[H].y * k) : "—"}</td>`).join("")}</tr>
      <tr><td>Galat terpadu</td>${HZ.map((H) => `<td>${err(F.byH[H].e, F.byH[H].y)}</td>`).join("")}</tr>
      <tr><td>Galat Arps</td>${HZ.map((H) => `<td>${err(F.byH[H].a, F.byH[H].y)}</td>`).join("")}</tr></tbody>`;

    // volume kumulatif
    const cat = ["30 hari", "60 hari", "90 hari"], V = (key) => HZ.map((H, i) => F.byH[H][key] * H * k);
    draw("pk-vol", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0, data: ["Terpadu P50", "Arps", "Aktual"] }, tooltip: { trigger: "item", formatter: (p) => (p.seriesName === "P90–P10" ? `P90–P10<br/>${nf(p.value[1])} – ${nf(p.value[2])} ${U.vol}` : `${p.seriesName}: ${nf(p.value)} ${U.vol}`) },
      xAxis: { type: "category", data: cat }, yAxis: { type: "value", name: U.vol, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: [{ name: "Terpadu P50", type: "bar", barWidth: 34, data: V("e").map((v) => +v.toFixed(0)), itemStyle: { color: C.greenA, borderColor: C.green, borderWidth: 2 } },
        errorBars("P90–P10", HZ.map((H, i) => [i, F.byH[H].lo * H * k, F.byH[H].hi * H * k]), C.green2),
        { name: "Arps", type: "scatter", symbol: "diamond", symbolSize: 12, itemStyle: { color: C.terra }, data: V("a").map((v) => +v.toFixed(0)), z: 6 },
        { name: "Aktual", type: "scatter", symbol: "circle", symbolSize: 12, itemStyle: { color: "#fff", borderColor: C.ink, borderWidth: 2.5 }, data: HZ.map((H) => (F.byH[H].y != null ? +(F.byH[H].y * H * k).toFixed(0) : null)), z: 7 }],
    });
    const R = rolling(), qd = c.date.slice(0, 4) + " T" + (Math.floor((+c.date.slice(5, 7) - 1) / 3) + 1);
    draw("pk-roll", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", valueFormatter: (v) => nf(v, 1) + "%" },
      xAxis: { type: "category", data: R.keys, axisLabel: { interval: 3 } }, yAxis: { type: "value", name: "WAPE %", nameTextStyle: { align: "left", color: C.muted }, min: 0 },
      series: [
        { name: "Terpadu", type: "line", data: R.e, showSymbol: false, lineStyle: { width: 3, color: C.green }, itemStyle: { color: C.green }, markLine: { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { formatter: "keputusan", position: "end" }, data: [{ xAxis: qd }] } },
        { name: "XGBoost saja", type: "line", data: R.p, showSymbol: false, lineStyle: { width: 1.6, color: C.gold }, itemStyle: { color: C.gold } },
        { name: "Arps", type: "line", data: R.a, showSymbol: false, lineStyle: { width: 1.6, color: C.terra }, itemStyle: { color: C.terra } },
        { name: "Persistence", type: "line", data: R.m, showSymbol: false, lineStyle: { width: 1.6, color: C.gray }, itemStyle: { color: C.gray } }],
    });
    setRead("pk-roll", "<b>Baca:</b> tidak ada satu metode yang selalu menang. 2011–2013 model ML masih sedikit data latih; 2015–2016 (gangguan lebih sering) Arps memburuk. Kombinasi paling stabil.");
    this.onnx(c);
  },
  async onnx(c) {
    const my = ++token, { w, t, F } = c;
    const key = `${c.w.name}|${c.date}`;
    if (whatif.key !== key) whatif = { key, feats: [...featOf(w).rows[t]] };
    const box = document.getElementById("pk-in");
    if (box && !box.dataset.k || (box && box.dataset.k !== key)) {
      box.dataset.k = key;
      box.innerHTML = FEATS.map((f, i) => `<div class="fi"><label for="wf-${i}">${LBL[f] || f}</label><input class="in" type="number" step="any" id="wf-${i}" value="${+whatif.feats[i].toFixed(4)}"></div>`).join("");
      box.querySelectorAll("input").forEach((el, i) => el.addEventListener("input", () => { const v = parseFloat(el.value); if (Number.isFinite(v)) { whatif.feats[i] = v; this.onnx(c); } }));
    }
    const tb = document.getElementById("pk-onx"), par = document.getElementById("pk-par");
    if (!ortReady()) { par.className = "note bad"; par.textContent = "onnxruntime-web tidak termuat (vendor/ort)."; return; }
    try {
      const yr = Math.min(2016, Math.max(2011, +c.date.slice(0, 4))), out = {}, orig = featOf(w).rows[t];
      let worst = 0;
      for (const H of HZ) {
        const rNew = await predictRatio(wfName(yr, H), whatif.feats), rOld = await predictRatio(wfName(yr, H), orig);
        out[H] = { xgb: rNew * (F.m30 + 1), old: rOld * (F.m30 + 1) };
        worst = Math.max(worst, Math.abs(out[H].old - F.byH[H].p));
      }
      if (my !== token) return;
      const k = c.U.k;
      tb.innerHTML = `<thead><tr><th>${c.U.rate}</th><th>30 hari</th><th>60 hari</th><th>90 hari</th></tr></thead><tbody>
        <tr><td>XGBoost, fitur diubah</td>${HZ.map((H) => `<td>${nf(out[H].xgb * k)}</td>`).join("")}</tr>
        <tr><td>XGBoost, asli</td>${HZ.map((H) => `<td>${nf(F.byH[H].p * k)}</td>`).join("")}</tr>
        <tr class="best"><td>Terpadu, fitur diubah</td>${HZ.map((H) => `<td>${nf(((out[H].xgb + F.byH[H].a + F.m30) / 3) * k)}</td>`).join("")}</tr>
        <tr><td>Terpadu, asli</td>${HZ.map((H) => `<td>${nf(F.byH[H].e * k)}</td>`).join("")}</tr></tbody>`;
      par.className = "note " + (worst < 0.2 ? "ok" : "warn");
      par.innerHTML = `Hasil di browser sama dengan Python (selisih maks ${nf(worst, 3)} Sm³/hari).`;
    } catch (err) { par.className = "note bad"; par.textContent = "Gagal menjalankan ONNX: " + err.message; }
  },
};