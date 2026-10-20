import { card, setRead, nf, pct } from "../ui.js";
import { draw, C, grid, WELL_COLORS, numFmt } from "../charts.js";
import { D, monthKeys } from "../data.js";
import { isoOf } from "../features.js";

let M = null;   // agregat bulanan (dihitung sekali)
function agg() {
  if (M) return M;
  const keys = monthKeys(), ix = new Map(keys.map((k, i) => [k, i])), n = keys.length;
  const per = D.wells.map((w) => {
    const oil = new Array(n).fill(null), up = new Array(n).fill(null), cnt = new Array(n).fill(0), so = new Array(n).fill(0), sh = new Array(n).fill(0), sw = new Array(n).fill(0);
    for (let i = 0; i < w.n; i++) { const j = ix.get(isoOf(w.day0 + i).slice(0, 7)); if (j == null) continue; cnt[j]++; so[j] += w.oil[i]; sh[j] += w.hours[i]; sw[j] += w.wat[i]; }
    for (let j = 0; j < n; j++) if (cnt[j]) { oil[j] = so[j] / cnt[j]; up[j] = sh[j] / cnt[j] / 24; }
    return { w, oil, up, cnt, so, sw };
  });
  const ft = { oil: new Array(n).fill(0), wat: new Array(n).fill(0), inj: new Array(n).fill(0), days: new Array(n).fill(0) };
  for (let d = 0; d < D.nCal; d++) { const j = ix.get(isoOf(D.cal0 + d).slice(0, 7)); if (j != null) { ft.inj[j] += D.inj[d]; ft.days[j]++; } }
  for (const p of per) for (let j = 0; j < n; j++) { ft.oil[j] += p.so[j]; ft.wat[j] += p.sw[j]; }
  return (M = { keys, per, ft });
}

export default {
  id: "lapangan", num: "02", title: "Lapangan", icon: "lapangan",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Lapangan</h1>
      <p>Riwayat produksi lapangan Volve, 2008–2016.</p></div></div>

    <div class="grid g2">
      ${card("Laju minyak per sumur", "lp-area", { h: "tall", hint: "Puncak 2009, turun ~79% pada 2012, lalu sumur baru 2013–2014 menahan penurunan." })}
      ${card("Cairan, injeksi air, dan water cut", "lp-liq", { h: "tall", hint: "Water cut naik seiring injeksi air; produksi minyak turun sementara air terproduksi naik." })}
    </div>
    <div class="grid g2">
      ${card("Uptime per sumur per bulan", "lp-heat", { hint: "Jam operasi ÷ 24. Petak gelap = sumur sering berhenti — sumber utama ketidakpastian prakiraan.", h: "short" })}
      ${card("Kumulatif minyak per sumur", "lp-cum", { h: "short", hint: "Juta volume sejak produksi awal." })}
    </div>
    <div class="card"><h3>Ringkasan per sumur</h3><div class="tscroll"><table class="tbl" id="lp-tbl"></table></div></div>`;
  },
  update(c) {
    const A = agg(), { keys, per, ft } = A, k = c.U.k, mk = c.date.slice(0, 7), mline = { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { formatter: "keputusan", color: C.ink, position: "end" }, data: [{ xAxis: mk }] };
    draw("lp-area", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: keys, boundaryGap: false, axisLabel: { interval: 11, formatter: (v) => v.slice(0, 4) } },
      yAxis: { type: "value", name: c.U.rate, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: per.map((p, i) => ({ name: p.w.short, type: "line", stack: "t", areaStyle: { opacity: 0.85 }, showSymbol: false, lineStyle: { width: 0.6 }, itemStyle: { color: WELL_COLORS[p.w.short] }, data: p.oil.map((v) => (v == null ? null : +(v * k).toFixed(0))), ...(i === 0 ? { markLine: mline } : {}) })),
    });
    // laju harian lapangan = jumlah laju rata-rata harian tiap sumur pada bulan itu
    const oilRate = keys.map((_, j) => per.reduce((s, p) => s + (p.oil[j] == null ? 0 : p.oil[j]), 0));
    const watRate = keys.map((_, j) => per.reduce((s, p) => s + (p.cnt[j] ? p.sw[j] / p.cnt[j] : 0), 0));
    draw("lp-liq", {
      grid: grid({ top: 50, right: 44 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: keys, axisLabel: { interval: 11, formatter: (v) => v.slice(0, 4) } },
      yAxis: [{ type: "value", name: c.U.rate, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } }, { type: "value", name: "water cut %", min: 0, max: 100, splitLine: { show: false }, nameTextStyle: { align: "right", color: C.muted } }],
      series: [
        { name: "Minyak", type: "bar", stack: "l", data: oilRate.map((v) => +(v * k).toFixed(0)), itemStyle: { color: C.green }, barCategoryGap: "10%" },
        { name: "Air terproduksi", type: "bar", stack: "l", data: watRate.map((v) => +(v * k).toFixed(0)), itemStyle: { color: C.blue } },
        { name: "Injeksi air", type: "line", data: ft.inj.map((v, j) => +((v / Math.max(1, ft.days[j])) * k).toFixed(0)), showSymbol: false, lineStyle: { color: C.gold, width: 2 }, itemStyle: { color: C.gold } },
        { name: "Water cut (kanan)", type: "line", yAxisIndex: 1, data: oilRate.map((o, j) => (o + watRate[j] > 0 ? +((watRate[j] / (o + watRate[j])) * 100).toFixed(1) : null)), showSymbol: false, lineStyle: { color: C.terra, width: 2 }, itemStyle: { color: C.terra }, markLine: mline }],
    });
    setRead("lp-liq", "<b>Baca:</b> tinggi tumpukan = total cairan; hijau menyusut, biru membesar → produksi makin didominasi air.");
    draw("lp-heat", {
      grid: grid({ top: 8, right: 70, bottom: 26 }), tooltip: { formatter: (p) => `${per[p.value[1]].w.short} · ${keys[p.value[0]]}<br/>uptime ${nf(p.value[2] * 100, 0)}%` },
      xAxis: { type: "category", data: keys, splitArea: { show: false }, axisLabel: { interval: 11, formatter: (v) => v.slice(0, 4) } },
      yAxis: { type: "category", data: per.map((p) => p.w.short), inverse: true },
      visualMap: { min: 0, max: 1, dimension: 2, calculable: false, orient: "vertical", right: 0, top: "middle", itemHeight: 90, text: ["24 jam", "0"], inRange: { color: ["#b43a2e", "#e9d9a8", "#1f7a4d"] }, textStyle: { color: C.muted, fontSize: 11 } },
      series: [{ type: "heatmap", data: per.flatMap((p, wi) => p.up.map((u, j) => (u == null ? null : [j, wi, +u.toFixed(3)])).filter(Boolean)), emphasis: { itemStyle: { borderColor: C.ink, borderWidth: 1 } }, markLine: mline }],
    });
    draw("lp-cum", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: keys, axisLabel: { interval: 11, formatter: (v) => v.slice(0, 4) } },
      yAxis: { type: "value", name: "juta " + c.U.vol, nameTextStyle: { align: "left", color: C.muted } },
      series: per.map((p, i) => { let s = 0; return { name: p.w.short, type: "line", showSymbol: false, itemStyle: { color: WELL_COLORS[p.w.short] }, lineStyle: { width: 2 }, data: p.cnt.map((n, j) => { s += p.so[j]; return n || s > 0 ? +((s * k) / 1e6).toFixed(3) : null; }), ...(i === 0 ? { markLine: mline } : {}) }; }),
    });
    // tabel
    const rows = per.map((p) => {
      const w = p.w, t = c.calIdx - w.s0; if (t < 0 || t >= w.n) return `<tr><td>${w.short}</td><td colspan="6" class="txt muted">belum/tidak ada data pada tanggal ini</td></tr>`;
      let so = 0, sw = 0, sh = 0, cum = 0; const a = Math.max(0, t - 29);
      for (let i = a; i <= t; i++) { so += w.oil[i]; sw += w.wat[i]; sh += w.hours[i]; } for (let i = 0; i <= t; i++) cum += w.oil[i];
      const n = t - a + 1, up = sh / n / 24, wcv = so + sw ? sw / (so + sw) : 0;
      return `<tr><td><b>${w.short}</b>${w.short_history ? " *" : ""}</td><td>${nf((so / n) * k)}</td><td>${pct(up, 0)}</td><td>${pct(wcv, 0)}</td><td>${nf((cum * k) / 1e6, 2)}</td><td>${nf(w.n)}</td><td class="txt">${up < 0.85 ? "sering berhenti" : "normal"}</td></tr>`;
    }).join("");
    document.getElementById("lp-tbl").innerHTML = `<thead><tr><th>Sumur</th><th>Laju 30h (${c.U.rate})</th><th>Uptime 30h</th><th>Water cut 30h</th><th>Kumulatif (juta ${c.U.vol})</th><th>Hari data</th><th class="txt">Status</th></tr></thead><tbody>${rows}</tbody>`;
  },
};