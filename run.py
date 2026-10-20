#!/usr/bin/env python3
"""Jalankan Volve DCA Cockpit secara lokal.

  python run.py            # siapkan artefak bila belum ada, lalu buka http://127.0.0.1:8000
  python run.py --rebuild  # paksa latih ulang dari data/raw/*.xlsx

Website statis; hanya membutuhkan Python bawaan untuk menyajikan file. Pelatihan (src/build_data.py)
butuh paket di requirements.txt dan file Volve di data/raw/ — dan hanya dijalankan bila artefak belum ada.
"""
import http.server, pathlib, socketserver, subprocess, sys, webbrowser

ROOT = pathlib.Path(__file__).resolve().parent
PUB = ROOT / "public"
ARTEFAK = [PUB / "data" / "cockpit.json", PUB / "models" / "final_h30.onnx", PUB / "models" / "wf2015_h30.onnx"]


# semua file yang WAJIB ada di public/ (relatif). Satu saja hilang → modul JS gagal dimuat → layar "Memuat data dan model…" macet.
WAJIB = [
    "css/style.css",
    "data/cockpit.json",
    "fonts/IBMPlexSans-400.woff2",
    "fonts/IBMPlexSans-500.woff2",
    "fonts/IBMPlexSans-600.woff2",
    "index.html",
    "js/app.js",
    "js/builders.js",
    "js/charts.js",
    "js/data.js",
    "js/econ.js",
    "js/features.js",
    "js/forms.js",
    "js/onnx.js",
    "js/ops.js",
    "js/pages/data.js",
    "js/pages/downtime.js",
    "js/pages/investasi.js",
    "js/pages/kepercayaan.js",
    "js/pages/lapangan.js",
    "js/pages/prakiraan.js",
    "js/pages/ringkasan.js",
    "js/pages/skenario.js",
    "js/pages/surveillance.js",
    "js/pages/tim.js",
    "js/store.js",
    "js/team.js",
    "js/ui.js",
    "js/upload.js",
    "models/final_h30.onnx",
    "models/final_h60.onnx",
    "models/final_h90.onnx",
    "models/wf2011_h30.onnx",
    "models/wf2011_h60.onnx",
    "models/wf2011_h90.onnx",
    "models/wf2012_h30.onnx",
    "models/wf2012_h60.onnx",
    "models/wf2012_h90.onnx",
    "models/wf2013_h30.onnx",
    "models/wf2013_h60.onnx",
    "models/wf2013_h90.onnx",
    "models/wf2014_h30.onnx",
    "models/wf2014_h60.onnx",
    "models/wf2014_h90.onnx",
    "models/wf2015_h30.onnx",
    "models/wf2015_h60.onnx",
    "models/wf2015_h90.onnx",
    "models/wf2016_h30.onnx",
    "models/wf2016_h60.onnx",
    "models/wf2016_h90.onnx",
    "vendor/echarts/echarts.min.js",
    "vendor/ort/ort-wasm-simd-threaded.mjs",
    "vendor/ort/ort-wasm-simd-threaded.wasm",
    "vendor/ort/ort.wasm.min.js",
    "vendor/xlsx/xlsx.full.min.js"
]


def cek_file():
    hilang = [f for f in WAJIB if not (PUB / f).exists()]
    if hilang:
        print("\n[!] File berikut TIDAK ditemukan di public/ (periksa tabel penempatan):")
        for f in hilang:
            salah = list(ROOT.rglob(pathlib.Path(f).name))
            lokasi = f"   <- ditemukan di: {salah[0].relative_to(ROOT)}" if salah else ""
            print(f"    public/{f}{lokasi}")
        print("Website tidak akan jalan sampai file di atas berada di tempat yang benar.\n")
    return not hilang


def siap():
    return all(p.exists() for p in ARTEFAK)


def main():
    if "--rebuild" in sys.argv or not siap():
        if not list((ROOT / "data" / "raw").glob("*.xlsx")):
            sys.exit("Artefak belum ada dan data/raw/ kosong.\nUnduh 'Volve production data.xlsx' dari Equinor Volve Data Village, taruh di data/raw/, lalu jalankan ulang.")
        print("Menyiapkan data & model (± 20 detik) ...")
        r = subprocess.run([sys.executable, str(ROOT / "src" / "build_data.py")])
        if r.returncode:
            sys.exit("Pelatihan gagal. Pastikan: pip install -r requirements.txt")

    if not cek_file():
        sys.exit(1)

    class H(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json"}

        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(PUB), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    for port in range(8000, 8020):
        try:
            srv = socketserver.TCPServer(("127.0.0.1", port), H)
            break
        except OSError:
            continue
    else:
        sys.exit("Port 8000–8019 terpakai semua.")
    url = f"http://127.0.0.1:{port}/"
    print(f"Cockpit berjalan di {url}  (Ctrl+C untuk berhenti)")
    webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nberhenti.")


if __name__ == "__main__":
    main()