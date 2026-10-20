import { card, kpi, setKpi, setRead, nf, pct, usd } from "../ui.js";
import { draw, C, grid, numFmt } from "../charts.js";
import { npvWaterfall } from "../builders.js";
import { histogram } from "../econ.js";
import { S } from "../store.js";
import { buildForm, syncForm } from "../forms.js";

export default {
  id: "investasi", num: "05", title: "Investasi", icon: "investasi",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Kelayakan Investasi</h1>
      <p>Kelayakan intervensi sumur pada asumsi ekonomi yang dipilih.</p></div></div>
    <div class="card" style="margin-bottom:16px"><h3>Asumsi utama</h3><div id="iv-form"></div>
      </div>
    <div class="grid g6">
      ${kpi("iv-npv", "NPV P50")}${kpi("iv-pp", "Peluang NPV > 0")}${kpi("iv-irr", "IRR (deterministik)")}
      ${kpi("iv-pb", "Payback")}${kpi("iv-bep", "Harga impas")}${kpi("iv-beu", "Uplift impas")}
    </div>
    <div class="grid g2">
      ${card("Profil produksi", "iv-prof", { h: "short", hint: "Bulan 1–3 dari prakiraan terpadu 30/60/90 hari; setelahnya Arps hyperbolic → eksponensial terminal." })}
      ${card("Arus kas kumulatif (juta US$)", "iv-cum", { h: "short", hint: "Pita = P90–P10 dari Monte Carlo; garis tebal = P50." })}
    </div>
    <div class="grid g3">
      ${card("Dari produksi ke NPV (juta US$)", "iv-wf", { h: "short" })}
      ${card("Sensitivitas NPV", "iv-tor", { h: "short", hint: "Perubahan NPV terhadap NPV dasar." })}
      ${card("Sebaran NPV (Monte Carlo)", "iv-hist", { h: "short" })}
    </div>
    ${card("NPV menurut harga dan uplift (juta US$)", "iv-heat", { h: "tall", hint: "Hijau = NPV positif, merah = negatif. Kotak berbingkai = asumsi Anda saat ini (kotak terdekat)." })}`;
    buildForm(root.querySelector("#iv-form"), ["price", "uplift", "capex", "opex", "disc", "woDays"]);
  },
  update(c) {
    syncForm(document.getElementById("iv-form"));
    const e = c.eco(); if (!e) return;
    const p = S.econ, mc = e.mc, kk = c.U.k / 6.2898;
    setKpi("iv-npv", usd(mc.P50, 1), `P90 ${usd(mc.P90, 1)} · P10 ${usd(mc.P10, 1)}`, mc.P50 > 0 ? "good" : "bad");
    setKpi("iv-pp", pct(mc.pPos, 0), `${p.paths.toLocaleString("id-ID")} simulasi`, mc.pPos >= 0.75 ? "good" : mc.pPos >= 0.4 ? "warn" : "bad");
    setKpi("iv-irr", e.irr != null ? pct(e.irr, 0) : "—", "per tahun (asumsi dasar)");
    setKpi("iv-pb", e.payback ? e.payback + " bln" : "> horizon", "tanpa diskonto");
    setKpi("iv-bep", e.be.price != null ? "US$ " + nf(e.be.price, 1) : "—", `asumsi Anda: US$ ${nf(p.price, 0)}`);
    setKpi("iv-beu", e.be.uplift != null ? pct(e.be.uplift, 1) : "—", `asumsi Anda: ${pct(p.uplift, 0)}`);
    const N = p.months, xs = Array.from({ length: N }, (_, i) => i + 1);
    draw("iv-prof", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", valueFormatter: (v) => nf(v) + " " + c.U.rate },
      xAxis: { type: "category", data: xs, name: "bulan", nameLocation: "middle", nameGap: 24, axisLabel: { interval: 5 }, nameTextStyle: { color: C.muted } },
      yAxis: { type: "value", name: c.U.rate, min: 0, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: [{ name: "Dengan uplift", type: "line", data: Array.from(e.base, (v) => +(v * (1 + p.uplift) * kk).toFixed(0)), showSymbol: false, lineStyle: { color: C.green, width: 2.4 }, areaStyle: { color: C.greenA } },
        { name: "Dasar (tanpa intervensi)", type: "line", data: Array.from(e.base, (v) => +(v * kk).toFixed(0)), showSymbol: false, lineStyle: { color: C.ink, width: 2 }, areaStyle: { color: "#ffffff", opacity: 1 } }],
    });
    const m = Array.from({ length: N + 1 }, (_, i) => i), q = (a) => Array.from(a, (v) => +(v / 1e6).toFixed(2));
    const p90 = q(mc.cumP90), p50 = q(mc.cumP50), p10 = q(mc.cumP10);
    draw("iv-cum", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0, data: ["P50", "Rentang P90–P10"] }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: m, name: "bulan", nameLocation: "middle", nameGap: 24, axisLabel: { interval: 5 }, nameTextStyle: { color: C.muted } },
      yAxis: { type: "value", name: "juta US$", nameTextStyle: { align: "left", color: C.muted } },
      series: [{ name: "b", type: "line", stack: "band", data: p90, showSymbol: false, lineStyle: { width: 0 }, tooltip: { show: false } },
        { name: "Rentang P90–P10", type: "line", stack: "band", data: p10.map((v, i) => +(v - p90[i]).toFixed(2)), showSymbol: false, lineStyle: { width: 0 }, areaStyle: { color: C.greenA }, tooltip: { show: false } },
        { name: "P50", type: "line", data: p50, showSymbol: false, lineStyle: { color: C.green2, width: 3 }, itemStyle: { color: C.green2 },
          markLine: { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } }],
    });
    setRead("iv-cum", `Cakupan: 80% simulasi berada di dalam pita. Payback deterministik: <b>${e.payback ? "bulan ke-" + e.payback : "di luar horizon"}</b>.`);
    draw("iv-wf", npvWaterfall(e.det));
    const T = e.torn.rows.slice().reverse();
    draw("iv-tor", {
      grid: grid({ top: 8, left: 4, right: 30 }), tooltip: { trigger: "item", formatter: (pp) => { const r = T[pp.dataIndex]; return `<b>${r.name}</b><br/>${r.lowLabel}: ${r.lo >= 0 ? "+" : "−"}${nf(Math.abs(r.lo) / 1e6, 1)} jt<br/>${r.highLabel}: ${r.hi >= 0 ? "+" : "−"}${nf(Math.abs(r.hi) / 1e6, 1)} jt`; } },
      xAxis: { type: "value", axisLabel: { formatter: (v) => nf(v, 0) } }, yAxis: { type: "category", data: T.map((r) => r.name), axisTick: { show: false }, axisLabel: { fontSize: 11 } },
      series: [{ type: "bar", barGap: "-100%", barWidth: 14, data: T.map((r) => ({ value: +(r.lo / 1e6).toFixed(2), itemStyle: { color: r.lo < 0 ? C.terra : C.green } })) }, { type: "bar", barWidth: 14, data: T.map((r) => ({ value: +(r.hi / 1e6).toFixed(2), itemStyle: { color: r.hi < 0 ? C.terra : C.green } })) }],
    });
    setRead("iv-tor", `NPV dasar ${usd(e.torn.base, 1)}. Faktor teratas: <b>${e.torn.rows[0].name}</b>.`);
    const H = histogram(Array.from(mc.npvs, (v) => v / 1e6), 32), zero = 0;
    draw("iv-hist", {
      grid: grid({ top: 8, bottom: 24 }), tooltip: { show: false },
      xAxis: { type: "value", min: H.lo, max: H.lo + H.w * 32, name: "juta US$", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: C.muted } }, yAxis: { type: "value", name: "frekuensi", nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: [{ type: "custom", data: H.counts.map((n, i) => [H.lo + H.w * i, H.lo + H.w * (i + 1), n]), encode: { x: [0, 1], y: 2 },
        renderItem(pp, api) { const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), 0]); return { type: "rect", shape: { x: a[0] + 0.5, y: a[1], width: Math.max(1, b[0] - a[0] - 1), height: b[1] - a[1] }, style: { fill: api.value(0) + H.w / 2 < 0 ? C.terra : C.green } }; } },
        { type: "line", data: [], markLine: { silent: true, symbol: "none", label: { formatter: (o) => o.name, position: "end", fontSize: 10.5 }, lineStyle: { type: "dashed", color: C.ink },
          data: [{ xAxis: mc.P90 / 1e6, name: "P90" }, { xAxis: mc.P50 / 1e6, name: "P50" }, { xAxis: mc.P10 / 1e6, name: "P10" }, { xAxis: 0, name: "0", lineStyle: { color: C.terra, type: "solid" } }] } }],
    });
    setRead("iv-hist", `P(NPV &gt; 0) = <b>${pct(mc.pPos, 0)}</b>. Rata-rata ${usd(mc.mean, 1)}.`);
    const ci = nearest(e.prices, p.price), ri = nearest(e.uplifts, p.uplift), vals = e.grid.flat().map((v) => v / 1e6), Mx = Math.max(...vals.map(Math.abs), 1);
    draw("iv-heat", {
      grid: grid({ top: 8, right: 84, bottom: 46 }), tooltip: { formatter: (pp) => `harga US$ ${e.prices[pp.value[0]]}, uplift ${pct(e.uplifts[pp.value[1]], 0)}<br/>NPV ${nf(pp.value[2], 1)} juta US$` },
      xAxis: { type: "category", data: e.prices.map((v) => "US$ " + v), name: "harga minyak", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.muted }, splitArea: { show: false } },
      yAxis: { type: "category", data: e.uplifts.map((v) => pct(v, 0)), name: "uplift", nameTextStyle: { align: "right", color: C.muted } },
      visualMap: { min: -Mx, max: Mx, dimension: 2, calculable: false, orient: "vertical", right: 0, top: "middle", itemHeight: 130, text: ["NPV +", "NPV −"], inRange: { color: ["#b43a2e", "#f3dcd8", "#ffffff", "#d6eadf", "#1f7a4d"] }, textStyle: { color: C.muted, fontSize: 11 } },
      series: [{ type: "heatmap", data: e.grid.flatMap((row, yi) => row.map((v, xi) => [xi, yi, +(v / 1e6).toFixed(1)])), label: { show: true, fontSize: 10.5, color: C.ink }, itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
        markPoint: { symbol: "rect", symbolSize: [46, 34], itemStyle: { color: "transparent", borderColor: C.ink, borderWidth: 3 }, label: { show: false }, data: [{ coord: [ci, ri] }] } }],
    });
    setRead("iv-heat", `Pada uplift <b>${pct(p.uplift, 0)}</b> harga impasnya US$ <b>${e.be.price != null ? nf(e.be.price, 1) : "—"}</b>; pada harga US$ ${p.price} uplift impasnya <b>${e.be.uplift != null ? pct(e.be.uplift, 1) : "—"}</b>. <b>Uplift adalah asumsi:</b> tim harus menunjukkan dasar angka itu (analog workover, catatan sumur).`);
  },
};
function nearest(arr, v) { let b = 0; arr.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(arr[b] - v)) b = i; }); return b; }