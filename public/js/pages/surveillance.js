import { card, kpi, setKpi, setRead, nf, pct, esc } from "../ui.js";
import { draw, C, grid, numFmt } from "../charts.js";
import { D, dateOf } from "../data.js";
import { survPoints, SCORERS, prCurve, confusion } from "../ops.js";
import { S, set } from "../store.js";
import { quantile } from "../features.js";

const COL = { terpadu: C.green, arps: C.terra, uptime: C.gold, rata2: C.ink };
export default {
  id: "surveillance", num: "06", title: "Surveillance", icon: "surveillance",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Surveillance</h1>
      <p>Sumur yang kinerjanya menyimpang dari prakiraan.</p></div></div>
    <div class="card" style="margin-bottom:16px"><h3>Pengaturan</h3>
      <div class="frm" style="margin-top:6px">
        <div class="fi"><label for="sv-x">Ambang kejadian (X) <output id="sv-xo"></output></label><input id="sv-x" type="range" min="0.5" max="0.9" step="0.05"></div>
        <div class="fi"><label for="sv-r">Tingkat alarm (porsi hari yang ditandai) <output id="sv-ro"></output></label><input id="sv-r" type="range" min="0.02" max="0.3" step="0.01"></div>
        <div class="fi"><label for="sv-s">Skor peringatan</label><select class="sel" id="sv-s" style="width:100%">${Object.entries(SCORERS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></div>
      </div></div>
    <div id="sv-honest" class="hidden"></div>
    <div class="grid g6">${kpi("sv-p", "Presisi")}${kpi("sv-r2", "Recall")}${kpi("sv-f", "F1")}${kpi("sv-l", "Lift vs acak")}${kpi("sv-pv", "Prevalensi kejadian")}${kpi("sv-ap", "PR-AUC (AP)")}</div>
    ${card("Aktual terhadap rentang prakiraan", "sv-env", { h: "tall", hint: "Pita = P90–P10 dari prakiraan 30 hari. Titik merah = rata-rata 30 hari aktual jatuh di bawah P90 (kinerja di bawah ekspektasi)." })}
    <div class="grid g2">
      ${card("Kualitas peringatan dini", "sv-pr", { h: "short", hint: "Garis putus-putus = presisi bila menebak acak (= prevalensi)." })}
      ${card("Hasil alarm", "sv-cm", { h: "short" })}
    </div>
    <div class="card"><h3>Alarm terbaru</h3><div class="tscroll"><table class="tbl" id="sv-tbl"></table></div></div>`;
    const sync = (id, key, fn) => (root.querySelector(id).oninput = (e) => { S.srv[key] = fn(e.target.value); set({}); });
    sync("#sv-x", "X", parseFloat); sync("#sv-r", "rate", parseFloat); sync("#sv-s", "scorer", String);
  },
  update(c) {
    const { X, rate, scorer } = S.srv, pts = survPoints();
    document.getElementById("sv-x").value = X; document.getElementById("sv-r").value = rate; document.getElementById("sv-s").value = scorer;
    document.getElementById("sv-xo").textContent = "X = " + pct(X, 0); document.getElementById("sv-ro").textContent = pct(rate, 0);
    const sc = SCORERS[scorer], scores = pts.map(sc.score).sort((a, b) => a - b), tau = quantile(scores, 1 - rate), cm = confusion(pts, X, sc, tau);
    const curves = Object.entries(SCORERS).map(([k, s]) => ({ k, s, ...prCurve(pts, X, s) })), cur = curves.find((x) => x.k === scorer), prev = cur.prevalence;
    const best = curves.slice().sort((a, b) => b.ap - a.ap)[0], ens = curves.find((x) => x.k === "terpadu"), upt = curves.find((x) => x.k === "uptime");
    setKpi("sv-p", pct(cm.precision, 1), `${cm.tp} benar dari ${cm.tp + cm.fp} alarm`); setKpi("sv-r2", pct(cm.recall, 1), `${cm.tp} dari ${cm.tp + cm.fn} kejadian`);
    setKpi("sv-f", nf(cm.f1, 2), "harmonik presisi & recall"); const lift = prev ? cm.precision / prev : 0;
    setKpi("sv-l", nf(lift, 2) + "×", "presisi ÷ prevalensi", lift >= 1.5 ? "good" : lift >= 1.15 ? "warn" : "bad");
    setKpi("sv-pv", pct(prev, 1), `${cur.P} kejadian dari ${cur.n} hari-sumur`); setKpi("sv-ap", nf(cur.ap, 3), `acak = ${nf(prev, 3)}`, cur.ap >= prev * 1.5 ? "good" : cur.ap >= prev * 1.15 ? "warn" : "bad");
    // (a) envelope
    const w = c.w, f = w.oof;
    if (f) {
      const cats = [], lo = [], hi = [], mid = [], act = [], br = []; let n = 0, below = 0, above = 0;
      for (let k = 0; k < f.m30.length; k++) {
        const y = f.y[30][k], e = f.e[30][k]; if (!Number.isFinite(y) || !Number.isFinite(e)) continue;
        const b = D.bands[30][f.u30[k] < D.meta.dist_cut ? "gangguan" : "normal"], l = Math.max(0, Math.exp(b.q10) * (e + 1) - 1), h = Math.exp(b.q90) * (e + 1) - 1, kk = c.U.k;
        cats.push(dateOf(w, f.o0 + k + 30)); lo.push(+(l * kk).toFixed(0)); hi.push(+((h - l) * kk).toFixed(0)); mid.push(+(e * kk).toFixed(0)); act.push(+(y * kk).toFixed(0));
        n++; if (y < l) { below++; br.push([cats.length - 1, +(y * kk).toFixed(0)]); } else if (y > h) above++;
      }
      let mk = cats.findIndex((d) => d >= c.date); if (mk < 0) mk = cats.length - 1;
      draw("sv-env", {
        grid: grid({ top: 50 }), legend: { top: 0, left: 0, data: ["Rentang P90–P10", "Prakiraan P50", "Aktual (30 hari)", "Di bawah P90"] }, tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: cats, boundaryGap: false, axisLabel: { interval: Math.max(1, Math.floor(cats.length / 8)), formatter: (v) => v.slice(0, 7) } },
        yAxis: { type: "value", name: c.U.rate, min: 0, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
        series: [{ name: "b", type: "line", stack: "band", data: lo, showSymbol: false, lineStyle: { width: 0 }, tooltip: { show: false } },
          { name: "Rentang P90–P10", type: "line", stack: "band", data: hi, showSymbol: false, lineStyle: { width: 0 }, itemStyle: { color: "rgba(31,122,77,.4)" }, areaStyle: { color: C.greenA } },
          { name: "Prakiraan P50", type: "line", data: mid, showSymbol: false, lineStyle: { color: C.green2, width: 1.6, type: "dashed" }, itemStyle: { color: C.green2 } },
          { name: "Aktual (30 hari)", type: "line", data: act, showSymbol: false, lineStyle: { color: C.ink, width: 1.8 }, itemStyle: { color: C.ink }, markLine: { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { formatter: "keputusan", position: "end" }, data: [{ xAxis: mk }] } },
          { name: "Di bawah P90", type: "scatter", data: br, symbolSize: 7, itemStyle: { color: C.terra } }],
      });
      setRead("sv-env", `${w.short}: aktual di bawah P90 pada <b>${pct(below / Math.max(1, n), 1)}</b> hari (nominal ≈ 10%) dan di atas P10 pada <b>${pct(above / Math.max(1, n), 1)}</b> (nominal ≈ 10%). Pita dikalibrasi lintas sumur; per sumur bisa lebih meleset.`);
    }
    // (b) PR
    const prMax = Math.min(1, Math.max(0.5, Math.max(...curves.map((x) => Math.max(...x.curve.map((q) => q[1])))) * 1.05));
    draw("sv-pr", {
      grid: grid({ top: 50, bottom: 36 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", axisPointer: { type: "cross" }, valueFormatter: (v) => nf(v, 2) },
      xAxis: { type: "value", min: 0, max: 1, name: "recall", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: C.muted } }, yAxis: { type: "value", min: 0, max: prMax, name: "presisi", nameTextStyle: { align: "left", color: C.muted } },
      series: [...curves.map((x) => ({ name: SCORERS[x.k].short, type: "line", data: x.curve, showSymbol: false, lineStyle: { width: x.k === scorer ? 3 : 1.5, color: COL[x.k] }, itemStyle: { color: COL[x.k] }, z: x.k === scorer ? 5 : 2 })),
        { name: "Acak", type: "line", data: [[0, prev], [1, prev]], showSymbol: false, lineStyle: { type: "dashed", color: C.gray, width: 1.4 }, itemStyle: { color: C.gray } }],
    });
    draw("sv-cm", {
      grid: grid({ top: 8, right: 8, bottom: 30, left: 4 }), tooltip: { formatter: (p) => `${p.value[2]} hari-sumur` },
      xAxis: { type: "category", data: ["Alarm", "Tidak alarm"], position: "top", splitArea: { show: false }, axisLine: { show: false } }, yAxis: { type: "category", data: ["Kejadian", "Bukan kejadian"], inverse: true },
      series: [{ type: "heatmap", data: [[0, 0, cm.tp, C.green], [1, 0, cm.fn, C.terra], [0, 1, cm.fp, C.gold], [1, 1, cm.tn, "#cfe3d7"]].map(([x, y, v, col]) => ({ value: [x, y, v], itemStyle: { color: col, borderColor: "#ffffff", borderWidth: 3 } })),
        label: { show: true, fontSize: 18, fontWeight: 700, color: "#fff", formatter: (p) => nf(p.value[2]) } }],
    });
    // tabel alarm
    const t0 = c.t, list = [];
    if (f) for (let k = f.m30.length - 1; k >= 0 && list.length < 10; k--) {
      const t = f.o0 + k; if (t > t0) continue; const y = f.y[30][k], e = f.e[30][k]; if (!(f.m30[k] > 5) || !Number.isFinite(e)) continue;
      const p = { m30: f.m30[k], e, a: f.a[30][k], u7: f.u7[k], y }; const s = sc.score(p);
      if (s >= tau) list.push({ d: dateOf(w, t), s, y, m: f.m30[k], ev: Number.isFinite(y) ? y < X * f.m30[k] : null });
    }
    document.getElementById("sv-tbl").innerHTML = `<thead><tr><th>Tanggal</th><th>Skor</th><th>Laju 30h terakhir (${c.U.rate})</th><th>Aktual 30h ke depan</th><th class="txt">Hasil</th></tr></thead><tbody>${list.length ? list.map((r) => `<tr><td>${r.d}</td><td>${nf(r.s, 2)}</td><td>${nf(r.m * c.U.k)}</td><td>${r.y != null && Number.isFinite(r.y) ? nf(r.y * c.U.k) : "—"}</td><td class="txt">${r.ev == null ? "belum diketahui" : r.ev ? "<b style='color:var(--green2)'>kejadian terjadi</b>" : "<span class='muted'>alarm palsu</span>"}</td></tr>`).join("") : `<tr><td colspan="5" class="txt muted">Tidak ada alarm pada sumur ini sampai tanggal keputusan dengan pengaturan sekarang.</td></tr>`}</tbody>`;
  },
};