import { kpi, setKpi, card, nf, pct, usd, esc } from "../ui.js";
import { draw, C, grid, numFmt } from "../charts.js";
import { fanOption, npvWaterfall } from "../builders.js";
import { downtimeSummary } from "../ops.js";
import { D, forecastAt } from "../data.js";
import { S } from "../store.js";
import { getTeam, teamStrip } from "../team.js";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const tgl = (iso) => `${+iso.slice(8, 10)} ${BULAN[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const VERDICT = { go: "Intervensi layak dilanjutkan", marginal: "Intervensi marginal", nogo: "Intervensi belum layak" };

/** bilah rentang NPV P90–P10 dengan penanda P50 dan nol */
function rangeBar(mc) {
  const lo = Math.min(mc.P90, 0), hi = Math.max(mc.P10, 0), pad = (hi - lo) * 0.08 || 1, a = lo - pad, b = hi + pad;
  const x = (v) => ((v - a) / (b - a)) * 100;
  const band = (from, to, neg) => (to > from ? `<div class="band ${neg ? "neg" : ""}" style="left:${x(from)}%;width:${x(to) - x(from)}%"></div>` : "");
  const f = (v) => nf(v / 1e6, 1);
  return `<div class="range"><div class="lab"><span>Rentang NPV (juta US$)</span><span>${pct(mc.pPos, 0)} peluang positif</span></div>
    <div class="track"><div class="axis"></div>${band(mc.P90, Math.min(0, mc.P10), true)}${band(Math.max(0, mc.P90), mc.P10, false)}
      <div class="zero" style="left:${x(0)}%"></div><div class="p50" style="left:calc(${x(mc.P50)}% - 1px)"></div></div>
    <div class="ticks"><span style="left:${x(mc.P90)}%"><b>${f(mc.P90)}</b>P90</span><span style="left:${x(mc.P50)}%"><b>${f(mc.P50)}</b>P50</span><span style="left:${x(mc.P10)}%"><b>${f(mc.P10)}</b>P10</span></div></div>`;
}

export default {
  id: "ringkasan", title: "Ringkasan", icon: "ringkasan",
  build(root) {
    root.innerHTML = `
    <section class="hero" id="rs-hero" aria-live="polite"></section>
    <p class="cta-up small">Contoh di halaman ini memakai data Volve. Punya data produksi harian sendiri? <a href="#/data">Unggah di halaman Data Anda</a>.</p>
    <div class="grid g6">
      ${kpi("k-rate", "Laju 30 hari terakhir")}${kpi("k-fc", "Prakiraan 90 hari")}${kpi("k-act", "Aktual 90 hari")}
      ${kpi("k-dt", "Produksi tertunda, 12 bulan")}${kpi("k-be", "Harga impas")}${kpi("k-pb", "Payback")}
    </div>
    <div class="grid g2">
      ${card("Prakiraan produksi", "rs-fan", { h: "mini" })}
      ${card("Dari produksi ke NPV (juta US$)", "rs-wf", { h: "mini" })}
    </div>
    <div class="grid g21">
      ${card("Kondisi semua sumur", "rs-wells", { h: "short" })}
      <div class="card"><h3>Tim</h3><div id="rs-team"></div><p class="small" style="margin:12px 0 0"><a href="#/tim">Profil tim dan metode</a></p></div>
    </div>`;
    getTeam().then((t) => { root.querySelector("#rs-team").innerHTML = teamStrip(t); });
  },
  update(c) {
    const { w, F, U } = c, k = U.k, hero = document.getElementById("rs-hero");
    if (!F) { hero.innerHTML = `<div><div class="ctx">${esc(w.short)}</div><div class="verdict">Belum ada prakiraan pada tanggal ini</div></div>`; return; }
    const e = c.eco(), b90 = F.byH[90], dt = downtimeSummary(c.calIdx, 365).find((r) => r.name === w.name);
    hero.innerHTML = `<div><div class="ctx">Sumur ${esc(w.short)}, keputusan ${tgl(c.date)}</div>
        <div class="verdict ${e.rec.level}">${VERDICT[e.rec.level]}</div>
        <div class="why">NPV tengah ${usd(e.mc.P50, 1)} dengan harga impas US$ ${e.be.price != null ? nf(e.be.price, 0) : "—"}/bbl, pada asumsi harga US$ ${nf(S.econ.price, 0)} dan uplift ${pct(S.econ.uplift, 0)}.</div>
        <div class="tiny muted" style="margin-top:10px">Asumsi ekonomi bersifat ilustratif dan dapat diubah di menu Asumsi.</div></div>
      <div>${rangeBar(e.mc)}</div>`;
    setKpi("k-rate", nf(F.m30 * k), `${U.rate}, uptime ${pct(F.u30, 0)}`);
    setKpi("k-fc", nf(b90.e * k), `${U.rate}, rentang ${nf(b90.lo * k)}–${nf(b90.hi * k)}`);
    setKpi("k-act", b90.y != null ? nf(b90.y * k) : "—", b90.y != null ? `${U.rate}, selisih ${nf(((b90.e - b90.y) / Math.max(1, b90.y)) * 100, 0)}%` : "belum tersedia");
    setKpi("k-dt", dt ? nf(((dt.dF + dt.dW) * k) / 1e3, 0) + " rb" : "—", dt ? `${U.vol}, ${pct((dt.dF + dt.dW) / Math.max(1, dt.potential), 0)} dari potensi` : "");
    setKpi("k-be", e.be.price != null ? "US$ " + nf(e.be.price, 1) : "—", "per bbl");
    setKpi("k-pb", e.payback ? e.payback + " bulan" : "> horizon", e.irr != null ? `IRR ${pct(e.irr, 0)}` : "");
    draw("rs-fan", fanOption(c, { mini: true, hist: 120 }));
    draw("rs-wf", npvWaterfall(e.det));
    const rows = [];
    for (const x of D.wells) { const Fx = forecastAt(x, c.calIdx - x.s0); if (Fx) rows.push({ n: x.short, m: Fx.m30 * k, f: Fx.byH[90].e * k, u: Fx.u30 }); }
    draw("rs-wells", {
      grid: grid({ top: 30, right: 40 }), legend: { top: 0, left: 0, data: ["Laju 30 hari", "Prakiraan 90 hari"] }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => nf(v) + " " + U.rate },
      xAxis: { type: "value", axisLabel: { formatter: numFmt } }, yAxis: { type: "category", data: rows.map((r) => r.n), inverse: true, axisTick: { show: false } },
      series: [
        { name: "Laju 30 hari", type: "bar", barWidth: 14, itemStyle: { color: "#14384f", borderRadius: [0, 3, 3, 0] }, data: rows.map((r) => ({ value: +r.m.toFixed(0), itemStyle: r.u < 0.85 ? { color: C.gold } : undefined })), label: { show: true, position: "right", formatter: (p) => nf(p.value), color: C.muted, fontSize: 11.5 } },
        { name: "Prakiraan 90 hari", type: "scatter", symbol: "diamond", symbolSize: 11, data: rows.map((r) => +r.f.toFixed(0)), itemStyle: { color: C.green } }],
    });
  },
};