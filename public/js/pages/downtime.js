import { card, setRead, nf, pct, usd } from "../ui.js";
import { draw, C, grid, numFmt } from "../charts.js";
import { waterfallOption } from "../builders.js";
import { D, monthKeys } from "../data.js";
import { downtimeSummary, downtimeMonthly, potentialOf, facilityDays } from "../ops.js";
import { S, set } from "../store.js";
import { BBL } from "../features.js";

function buckets(calEnd) {
  const fac = facilityDays(), B = [{ n: "1 hari", lo: 1, hi: 1 }, { n: "2–3", lo: 2, hi: 3 }, { n: "4–7", lo: 4, hi: 7 }, { n: "8–14", lo: 8, hi: 14 }, { n: "15–30", lo: 15, hi: 30 }, { n: "> 30 hari", lo: 31, hi: 1e9 }].map((b) => ({ ...b, c: 0, v: 0 }));
  for (const w of D.wells) {
    const pot = potentialOf(w); let run = 0, vol = 0;
    const flush = () => { if (run > 0) { const b = B.find((x) => run >= x.lo && run <= x.hi); b.c++; b.v += vol; } run = 0; vol = 0; };
    for (let i = 0; i < w.n && w.s0 + i <= calEnd; i++) {
      if (!w.miss[i] && w.hours[i] <= 2 && pot[i] > 5) { run++; vol += pot[i] * (1 - w.hours[i] / 24); } else flush();
    }
    flush();
  }
  return B;
}

export default {
  id: "downtime", num: "04", title: "Downtime", icon: "downtime",
  build(root) {
    root.innerHTML = `
    <div class="ph"><div><h1>Produksi Tertunda</h1>
      <p>Selisih potensi dan realisasi produksi akibat sumur berhenti.</p></div>
      <div class="seg" id="dt-win" role="group" aria-label="Jendela waktu"><button data-w="90">90 hari</button><button data-w="180">180 hari</button><button data-w="365">12 bulan</button></div></div>
    <div class="grid g2">
      ${card("Potensi ke realisasi", "dt-wf", { hint: "Potensi = median laju hari-mengalir 60 hari terakhir × hari. Selisihnya = produksi tertunda.", h: "" })}
      ${card("Produksi tertunda per sumur", "dt-well", { hint: "Fasilitas = ≥80% sumur aktif berhenti bersamaan; sisanya dihitung level sumur (heuristik).", h: "" })}
    </div>
    <div class="grid g2">
      ${card("Produksi tertunda per bulan", "dt-mon", { h: "short" })}
      ${card("Durasi kejadian berhenti", "dt-dur", { hint: "Kejadian = hari beruntun dengan jam operasi ≤ 2. Sampai tanggal keputusan.", h: "short" })}
    </div>
    <div class="card"><h3>Rincian per sumur</h3><div class="tscroll"><table class="tbl" id="dt-tbl"></table></div><div class="read" id="dt-tbl-read"></div></div>`;
    root.querySelectorAll("#dt-win button").forEach((b) => (b.onclick = () => { S.dt.window = +b.dataset.w; set({}); }));
  },
  update(c) {
    const k = c.U.k, win = S.dt.window;
    document.querySelectorAll("#dt-win button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.w === win)));
    const rows = downtimeSummary(c.calIdx, win).filter((r) => r.days > 0);
    const tot = rows.reduce((a, r) => ({ real: a.real + r.real, dF: a.dF + r.dF, dW: a.dW + r.dW }), { real: 0, dF: 0, dW: 0 });
    const f = (v, axis) => (axis ? numFmt(v) : nf(v, 0));
    draw("dt-wf", waterfallOption([{ name: "Potensi", v: (tot.real + tot.dF + tot.dW) * k, total: 1 }, { name: "Hilang: fasilitas", v: -tot.dF * k, kind: "hilang" }, { name: "Hilang: level sumur", v: -tot.dW * k, kind: "hilang" }, { name: "Realisasi", v: tot.real * k, total: 1, kind: "nyata" }], f, { unit: c.U.vol }));
    const lost = tot.dF + tot.dW, share = lost / Math.max(1, tot.real + lost);
    setRead("dt-wf", `Dalam ${win} hari, <b>${pct(share, 1)}</b> potensi tertunda (≈ ${nf(lost * BBL / 1e3, 0)} rb bbl). Margin tertunda ≈ <b>${usd(lost * BBL * (S.econ.price - S.econ.opex), 0)}</b> pada asumsi harga US$ ${S.econ.price} dan OPEX US$ ${S.econ.opex}/bbl.`);
    draw("dt-well", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => nf(v) + " " + c.U.vol },
      xAxis: { type: "category", data: rows.map((r) => r.short + (r.shortHist ? "*" : "")) }, yAxis: { type: "value", name: c.U.vol, nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: [{ name: "Fasilitas", type: "bar", stack: "d", data: rows.map((r) => +(r.dF * k).toFixed(0)), itemStyle: { color: C.gold } }, { name: "Level sumur", type: "bar", stack: "d", data: rows.map((r) => +(r.dW * k).toFixed(0)), itemStyle: { color: C.terra } }],
    });
    const mp = downtimeMonthly(), keys = monthKeys(), mk = c.date.slice(0, 7);
    draw("dt-mon", {
      grid: grid({ top: 50 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis", valueFormatter: (v) => nf(v) + " " + c.U.vol },
      xAxis: { type: "category", data: keys, axisLabel: { interval: 11, formatter: (v) => v.slice(0, 4) } }, yAxis: { type: "value", name: c.U.vol + "/bulan", nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } },
      series: [{ name: "Fasilitas", type: "bar", stack: "m", barCategoryGap: "8%", data: keys.map((m) => +((mp.get(m)?.f || 0) * k).toFixed(0)), itemStyle: { color: C.gold } },
        { name: "Level sumur", type: "bar", stack: "m", data: keys.map((m) => +((mp.get(m)?.w || 0) * k).toFixed(0)), itemStyle: { color: C.terra }, markLine: { silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed" }, label: { formatter: "keputusan", position: "end" }, data: [{ xAxis: mk }] } }],
    });
    const B = buckets(c.calIdx);
    draw("dt-dur", {
      grid: grid({ top: 50, right: 44 }), legend: { top: 0, left: 0 }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: B.map((b) => b.n) },
      yAxis: [{ type: "value", name: "volume tertunda (" + c.U.vol + ")", nameTextStyle: { align: "left", color: C.muted }, axisLabel: { formatter: numFmt } }, { type: "value", name: "jumlah kejadian", splitLine: { show: false }, nameTextStyle: { align: "right", color: C.muted } }],
      series: [{ name: "Volume tertunda", type: "bar", data: B.map((b) => +(b.v * k).toFixed(0)), itemStyle: { color: C.terra } }, { name: "Jumlah kejadian", type: "line", yAxisIndex: 1, data: B.map((b) => b.c), symbolSize: 8, itemStyle: { color: C.ink }, lineStyle: { color: C.ink, width: 2 } }],
    });
    const long = B[5], sh = B.slice(0, 3).reduce((a, b) => a + b.v, 0), all = B.reduce((a, b) => a + b.v, 0);
    setRead("dt-dur", `Kejadian &gt; 30 hari = <b>${nf(long.c)}</b> kali tetapi <b>${pct(long.v / Math.max(1, all), 0)}</b> volume tertunda; gangguan ≤ 7 hari menyumbang ${pct(sh / Math.max(1, all), 0)}. Data tidak mencatat penyebab; kejadian panjang <i>mungkin</i> berupa intervensi atau perbaikan sumur (dugaan, belum terverifikasi).`);
    const m = S.econ.price - S.econ.opex;
    document.getElementById("dt-tbl").innerHTML = `<thead><tr><th>Sumur</th><th>Hari data</th><th>Hari berhenti (≤2 jam)</th><th>Potensi (${c.U.vol})</th><th>Realisasi</th><th>Tertunda fasilitas</th><th>Tertunda sumur</th><th>Margin tertunda</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td><b>${r.short}</b>${r.shortHist ? " *" : ""}</td><td>${r.days}</td><td>${r.downDays}</td><td>${nf(r.potential * k)}</td><td>${nf(r.real * k)}</td><td>${nf(r.dF * k)}</td><td>${nf(r.dW * k)}</td><td>${usd((r.dF + r.dW) * BBL * m, 1)}</td></tr>`).join("")}</tbody>`;
    setRead("dt-tbl", "Margin = volume tertunda (bbl) × (harga − OPEX) dari panel Asumsi. <b>Batas klaim:</b> potensi diasumsikan sama dengan median laju hari-mengalir terakhir; sumur yang memang menurun secara alami akan terhitung berlebihan.");
  },
};