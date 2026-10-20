// onnx.js — inferensi ONNX di browser (onnxruntime-web, backend WASM, 1 thread). Global `ort` dimuat lewat <script>.
let configured = false;
const sessions = new Map();
export const ortReady = () => typeof ort !== "undefined";
function configure() {
  if (configured) return; configured = true;
  ort.env.wasm.wasmPaths = new URL("vendor/ort/", document.baseURI).href; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
}
export const wfName = (year, H) => `wf${year}_h${H}.onnx`;
export const finalName = (H) => `final_h${H}.onnx`;
export function session(name) {
  configure();
  if (!sessions.has(name)) sessions.set(name, ort.InferenceSession.create(`models/${name}`, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }));
  return sessions.get(name);
}
/** kembalikan rasio prediksi (rata-rata H hari ÷ (m30+1)); kalikan (m30+1) untuk mendapat laju. */
export async function predictRatio(name, feats) {
  const s = await session(name);
  const out = await s.run({ input: new ort.Tensor("float32", Float32Array.from(feats), [1, feats.length]) });
  return out[s.outputNames[0]].data[0];
}
/** Latensi per prediksi. Pewaktu browser dibulatkan kasar (0,1–1 ms), jadi satu prediksi yang
 *  sangat cepat bisa terbaca 0 ms. Karena itu tiap sampel = rata-rata satu blok `batch` prediksi
 *  berturut-turut; median & p95 diambil dari `rounds` blok. */
export async function latency(name, feats, rounds = 15, batch = 50) {
  for (let i = 0; i < 5; i++) await predictRatio(name, feats);     // pemanasan
  const t = [];
  for (let r = 0; r < rounds; r++) {
    const a = performance.now();
    for (let i = 0; i < batch; i++) await predictRatio(name, feats);
    t.push((performance.now() - a) / batch);
  }
  t.sort((a, b) => a - b);
  return { median: t[t.length >> 1], p95: t[Math.min(t.length - 1, Math.floor(t.length * 0.95))], n: rounds * batch };
}