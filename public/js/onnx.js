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
export async function latency(name, feats, n = 40) {
  await predictRatio(name, feats);                    // pemanasan
  const t = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); await predictRatio(name, feats); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  return { median: t[t.length >> 1], p95: t[Math.floor(t.length * 0.95)], n };
}