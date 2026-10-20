// builders.js — pembangun opsi grafik yang dipakai lintas halaman.
import { C, errorBars, grid, numFmt } from "./charts.js";
import { featOf } from "./data.js";
import { HZ } from "./features.js";
import { nf, mm } from "./ui.js";

/** Grafik prakiraan: riwayat harian + titik prakiraan rata-rata 0..H hari dengan rentang P90–P10. */
export function fanOption(c, { mini = false, hist = 150 } = {}) {
  const { w, t, F, U } = c, k = U.k, fe = featOf(w);
  const t0 = Math.max(0, t - hist + 1);
  const raw = [], sm = [];
  for (let i = t0; i <= t; i++) { raw.push([i - t, w.oil[i] * k]); sm.push([i - t, fe.m7[i] * k]); }
  const fut = []; for (let d = 1; d <= 90 && t + d < w.n; d++) fut.push([d, w.oil[t + d] * k]);
  const pts = (key) => HZ.map((H) => [H, F.byH[H][key] * k]);
  const eb = HZ.map((H) => [H, F.byH[H].lo * k, F.byH[H].hi * k]);
  const act = HZ.filter((H) => F.byH[H].y != null).map((H) => [H, F.byH[H].y * k]);
  const anchor = [[0, F.m30 * k]];
  const series = [
    { name: "Riwayat harian", type: "line", data: raw, showSymbol: false, lineStyle: { color: "#c3cbd1", width: 1 }, itemStyle: { color: "#c3cbd1" }, z: 1 },
    { name: "Rata-rata 7 hari", type: "line", data: sm, showSymbol: false, lineStyle: { color: C.ink, width: 2 }, itemStyle: { color: C.ink }, z: 2,
      markLine: { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { formatter: "keputusan", position: "end", color: C.ink }, data: [{ xAxis: 0 }] } },
    { name: "Aktual setelahnya", type: "line", data: fut, showSymbol: false, lineStyle: { color: C.gray, width: 1.4, type: "dashed" }, itemStyle: { color: C.gray }, z: 1 },
    { name: "Prakiraan terpadu (P50)", type: "line", data: [...anchor, ...pts("e")], symbolSize: 9, symbol: "circle", itemStyle: { color: C.green }, lineStyle: { color: C.green, width: 2.4, type: "dashed" }, z: 6 },
    errorBars("P90–P10", eb, C.green),
    { name: "Arps", type: "scatter", data: pts("a"), symbol: "diamond", symbolSize: 11, itemStyle: { color: C.terra }, z: 7 },
    { name: "Persistence", type: "scatter", data: pts("pers"), symbol: "triangle", symbolSize: 10, itemStyle: { color: C.gold }, z: 7 },
  ];
  if (act.length) series.push({ name: "Aktual rata-rata 0–H", type: "scatter", data: act, symbol: "circle", symbolSize: 11, itemStyle: { color: "#fff", borderColor: C.ink, borderWidth: 2.5 }, z: 8 });
  return {
    grid: grid({ top: 58, bottom: 34 }),
    legend: { top: 0, left: 0, itemGap: mini ? 8 : 14, data: mini ? ["Rata-rata 7 hari", "Prakiraan terpadu (P50)", "Arps", "Aktual rata-rata 0–H"].filter((n) => n !== "Aktual rata-rata 0–H" || act.length) : series.map((s) => s.name).filter((n) => n !== "P90–P10") },
    tooltip: { trigger: "item", formatter: (p) => p.seriesName === "P90–P10" ? `<b>P90–P10</b> (0–${p.value[0]} hari)<br/>${nf(p.value[1])} – ${nf(p.value[2])} ${U.rate}` : Array.isArray(p.value) ? `<b>${p.seriesName}</b><br/>hari ${p.value[0] >= 0 ? "+" : ""}${p.value[0]}: ${nf(p.value[1])} ${U.rate}` : p.seriesName },
    xAxis: { type: "value", min: -(hist - 1), max: 95, axisLabel: { formatter: (v) => (v === 0 ? "0" : (v > 0 ? "+" : "") + v), color: C.muted }, splitLine: { show: false }, name: "hari relatif terhadap tanggal keputusan", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: C.muted, fontSize: 11 } },
    yAxis: { type: "value", min: 0, axisLabel: { formatter: numFmt } },
    series,
  };
}

/** Waterfall generik (batang melayang, bisa melewati nol). items: [{name, v, total?}] */
export function waterfallOption(items, fmtVal, { unit = "", top = 26 } = {}) {
  let run = 0;
  const rows = items.map((it, i) => { const s = it.total ? 0 : run, e = it.total ? it.v : run + it.v; run = it.total ? it.v : run + it.v; return { i, name: it.name, s, e, v: it.v, tot: it.total ? 1 : 0, kind: it.kind || "" }; });
  return {
    grid: grid({ top, bottom: 4 }), tooltip: { trigger: "item", formatter: (p) => `<b>${rows[p.value[0]].name}</b><br/>${fmtVal(rows[p.value[0]].v)} ${unit}` },
    xAxis: { type: "category", data: rows.map((r) => r.name), axisLabel: { interval: 0, color: C.muted, fontSize: 11, width: 92, overflow: "break" }, axisTick: { show: false } },
    yAxis: { type: "value", name: unit, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: (v) => fmtVal(v, true) } },
    series: [{ type: "custom", data: rows.map((r) => [r.i, r.s, r.e, r.v, r.tot, r.kind]), encode: { x: 0, y: [1, 2] },
      renderItem(params, api) {
        const i = api.value(0), s = api.value(1), e = api.value(2), v = api.value(3), tot = api.value(4), kind = api.value(5);
        const p0 = api.coord([i, s]), p1 = api.coord([i, e]), wd = api.size([1, 0])[0] * 0.56;
        const color = kind === "hilang" ? C.terra : kind === "nyata" ? C.green2 : tot ? (v >= 0 ? C.green2 : C.terra) : v >= 0 ? C.green : C.terra;
        const y = Math.min(p0[1], p1[1]), h = Math.max(2, Math.abs(p1[1] - p0[1]));
        return { type: "group", children: [
          { type: "rect", shape: { x: p0[0] - wd / 2, y, width: wd, height: h }, style: { fill: color } },
          { type: "text", style: { text: fmtVal(v), x: p0[0], y: y - 4, textAlign: "center", textVerticalAlign: "bottom", fill: C.ink, font: "600 11.5px Plex" } }] };
      } }],
  };
}

/** Waterfall NPV (juta USD) dari hasil cashflows deterministik. */
export function npvWaterfall(det, { mini = false } = {}) {
  const f = (v, axis) => (axis ? nf(v / 1e6, 0) : (v < 0 ? "−" : "") + nf(Math.abs(v) / 1e6, 1));
  return waterfallOption([
    { name: "Pendapatan tambahan", v: det.revPV }, { name: "OPEX", v: -det.opexPV }, { name: "Produksi tertunda", v: -det.deferPV },
    { name: "CAPEX", v: -det.capexPV }, { name: "NPV", v: det.npv, total: 1 }], f, { unit: "" });
}