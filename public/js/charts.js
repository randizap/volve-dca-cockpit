// charts.js — tema ECharts, palet bermakna tetap, dan penggambar grafik.
export const C = { green: "#1f7a4d", green2: "#145c39", terra: "#b43a2e", gold: "#a86b12", blue: "#2c6aa6", gray: "#98a2aa",
  ink: "#1b2630", muted: "#6b7782", line: "#dde2e6", grid: "#eef1f3", purple: "#6b5b95", greenA: "rgba(31,122,77,.14)", terraA: "rgba(180,58,46,.14)" };
export const WELL_COLORS = { "F-12": "#14384f", "F-14": "#4f8fbf", "F-11": "#2a8c7a", "F-15 D": "#8fb35a", "F-1 C": "#7d5a8c", "F-5": "#a9b2b8" };

const THEME = {
  color: ["#14384f", "#1f7a4d", "#2c6aa6", "#a86b12", "#7d5a8c", "#98a2aa"],
  backgroundColor: "transparent",
  textStyle: { fontFamily: "Plex, Segoe UI, system-ui, sans-serif", color: C.ink, fontSize: 12 },
  title: { textStyle: { color: C.ink } },
  legend: { textStyle: { color: C.muted, fontSize: 12 }, itemWidth: 12, itemHeight: 3, icon: "rect", itemGap: 16 },
  tooltip: { backgroundColor: "#ffffff", borderColor: C.line, borderWidth: 1, textStyle: { color: C.ink, fontSize: 12.5 }, extraCssText: "border-radius:8px;box-shadow:0 6px 20px rgba(20,30,40,.12)" },
  categoryAxis: { axisLine: { lineStyle: { color: C.line } }, axisTick: { lineStyle: { color: C.line } }, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } } },
  valueAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, nameTextStyle: { color: C.muted } },
};
let ready = false;
const inst = new Map();
export function draw(id, option, { notMerge = true } = {}) {
  const el = document.getElementById(id); if (!el || typeof echarts === "undefined") return null;
  if (!ready) { echarts.registerTheme("cockpit", THEME); ready = true; }
  let c = inst.get(id);
  if (!c || c.isDisposed() || c.getDom() !== el) {
    c?.dispose(); c = echarts.init(el, "cockpit", { renderer: "canvas" }); inst.set(id, c);
    new ResizeObserver(() => { if (el.offsetWidth) c.resize(); }).observe(el);
  }
  c.setOption({ animation: false, ...option }, notMerge);
  return c;
}
export const resizeAll = () => inst.forEach((c) => !c.isDisposed() && c.getDom().offsetWidth && c.resize());
export const chartImage = (id) => { const c = inst.get(id); return c ? c.getDataURL({ pixelRatio: 2, backgroundColor: "#ffffff" }) : null; };

export const grid = (o = {}) => ({ left: 8, right: 14, top: 34, bottom: 8, containLabel: true, ...o });
export const legendTop = (extra = {}) => ({ top: 0, left: 0, ...extra });
export const dateLine = (x, label = "tanggal keputusan") => ({ silent: true, symbol: "none", lineStyle: { color: C.ink, type: "dashed", width: 1.4 }, label: { formatter: label, color: C.muted, fontSize: 11, position: "end" }, data: [{ xAxis: x }] });
export const numFmt = (v) => (Math.abs(v) >= 1e6 ? +(v / 1e6).toFixed(2) + " jt" : Math.abs(v) >= 1e4 ? +(v / 1e3).toFixed(0) + " rb" : Math.abs(v) >= 1e3 ? +(v / 1e3).toFixed(1) + " rb" : +v.toFixed(1));

/** batang kesalahan vertikal (P90–P10) pada sumbu kategori/nilai. data: [x, lo, hi] */
export function errorBars(name, data, color, { cap = 7 } = {}) {
  return { type: "custom", name, z: 5, silent: false, data,
    renderItem(params, api) {
      const x = api.coord([api.value(0), api.value(1)])[0], lo = api.coord([api.value(0), api.value(1)])[1], hi = api.coord([api.value(0), api.value(2)])[1];
      const st = api.style({ stroke: color, lineWidth: 2, fill: null });
      return { type: "group", children: [
        { type: "line", shape: { x1: x, y1: lo, x2: x, y2: hi }, style: st },
        { type: "line", shape: { x1: x - cap, y1: lo, x2: x + cap, y2: lo }, style: st },
        { type: "line", shape: { x1: x - cap, y1: hi, x2: x + cap, y2: hi }, style: st }] };
    }, encode: { x: 0, y: [1, 2] } };
}

/** render opsi ke gambar (data URL) di elemen luar layar — untuk brief cetak. */
export function renderImage(option, w = 640, h = 300) {
  if (typeof echarts === "undefined") return null;
  if (!ready) { echarts.registerTheme("cockpit", THEME); ready = true; }
  const el = document.createElement("div"); el.style.cssText = `position:fixed;left:-9999px;top:0;width:${w}px;height:${h}px`; document.body.appendChild(el);
  const c = echarts.init(el, "cockpit", { renderer: "canvas" }); c.setOption({ animation: false, ...option });
  const url = c.getDataURL({ pixelRatio: 2, backgroundColor: "#ffffff" }); c.dispose(); el.remove(); return url;
}