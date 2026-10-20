# Volve DCA Cockpit — Prakiraan Produksi & Keputusan Investasi (ML + Edge AI)

**Kasus 18 — Production Forecasting & Decline Curve Analysis** · Tugas Besar Terapan Machine Learning, UPN "Veteran" Jawa Timur
**Industri:** Migas · **Pilar:** Optimasi Produksi & Perencanaan Investasi (OPEX/CAPEX)
**Live demo:** https://kelompok3-volve.vercel.app · **Repositori:** https://github.com/randizap/volve-dca-cockpit

## Apa ini
Dasbor keputusan untuk lapangan Volve. Memilih sumur dan **tanggal keputusan** lalu menjawab: berapa produksi 30/60/90 hari ke depan (dengan rentang P90–P10), berapa yang hilang karena downtime, apakah intervensi layak (NPV, harga impas, Monte Carlo), dan sumur mana yang menyimpang. Prakiraan dihitung **hindcast**: hanya memakai data sebelum tanggal keputusan. Model XGBoost berjalan **di browser** lewat ONNX Runtime Web (tanpa server).

## Hasil validasi (walk-forward 2011–2016, refit tahunan, tanpa F-5)
WAPE rata-rata laju minyak ke depan (lebih rendah lebih baik):

| Metode | 30 hari | 60 hari | 90 hari |
|---|---|---|---|
| **Prakiraan terpadu** (rata-rata XGBoost + Arps + persistence) | 20.5% | 20.2% | 20.2% |
| XGBoost saja | 25.1% | 24.3% | 23.2% |
| Arps hyperbolic (b ≤ 1) | 24.2% | 24.1% | 23.9% |
| Persistence (laju 30 hari terakhir) | 22.9% | 25.5% | 27.0% |
| Arps × uptime (koreksi sederhana) | 26.3% | 27.5% | 27.4% |

**Jujur soal hasil:** XGBoost sendirian **tidak** mengalahkan baseline di semua periode. Ia lebih baik pada 2014–2016 (gangguan operasi lebih sering) dan lebih buruk pada 2011–2013 (data latih baru dua sumur). Kombinasi bobot sama paling akurat, karena itu menjadi prakiraan utama. Pita P90–P10 dikalibrasi dari galat historis; cakupannya 78% / 77% / 76% (nominal 80%) — sedikit terlalu sempit. Peringatan dini penurunan 30 hari **lemah** (± 1,6× acak pada skor terbaik).

## Menjalankan
```bash
pip install -r requirements.txt          # hanya untuk pelatihan
# taruh "Volve production data.xlsx" di data/raw/  (unduh dari Equinor Volve Data Village; tidak di-commit)
python run.py                            # latih bila artefak belum ada, lalu buka http://127.0.0.1:8000
python run.py --rebuild                  # paksa latih ulang
```
Windows: klik dua kali `run.bat`. macOS/Linux: `./run.sh`. Website statis — untuk sekadar melihatnya, `public/data/cockpit.json` dan `public/models/*.onnx` sudah cukup (tanpa Python pelatihan).

## Deploy ke Vercel
Import repo → **Framework: Other**, **Output Directory: `public`**, tanpa build command (`vercel.json` di root sudah mengatur ini). Setelah deploy, isi URL di README dan `REPO_URL` di `public/js/pages/tim.js`.

## Struktur
```
src/build_data.py        pipeline lengkap: bersih → fitur → baseline → walk-forward/LOWO/ablasi → interval → TreeSHAP → ONNX → JSON
data/raw/                file Volve (tidak di-commit)
public/
  index.html, css/       antarmuka statis
  js/features.js         fitur + Arps (identik dengan Python; diuji paritasnya)
  js/econ.js, ops.js     NPV/Monte Carlo/tornado; downtime; surveillance
  js/pages/*.js          sepuluh halaman (data.js = unggah data pengguna)
  data/cockpit.json      data bersih, prakiraan walk-forward, pita, metrik (turunan dari Volve)
  models/*.onnx          3 model final + 18 model refit tahunan (dimuat lazy)
  vendor/                echarts, onnxruntime-web, xlsx (self-hosted)
  team.json, img/team/   data & foto tim
```

## Verifikasi yang sudah dijalankan
- Fitur JavaScript + ONNX + Arps di browser vs nilai Python: 351 titik × 3 horizon, selisih maks 0,05 Sm³/hari (pembulatan penyimpanan).
- ONNX vs XGBoost native: selisih maks ≈ 2e-6.
- Uji browser headless (Chromium): 9 halaman × 6 sumur × 3 tanggal tanpa error; tur, panel, simpan skenario, brief cetak, dan unggah `.xlsx` asli berfungsi. Belum diuji di Safari/Firefox dan perangkat fisik.

## Batas klaim
- **Bukan data Volve:** harga, OPEX, CAPEX, uplift intervensi, discount rate. Semua asumsi pengguna; nilai bawaan hanya ilustrasi. Isi sumbernya di panel "Asumsi".
- Produksi tertunda = estimasi heuristik dari jam operasi; penyebab shut-in tidak tercatat.
- F-5 hanya 144 hari berproduksi (sebelumnya injektor): dikeluarkan dari pelatihan dan metrik agregat. F-1 C berhenti 41% hari: galat semua metode tinggi.
- Fitur final dipilih dari 2011–2013 dan dikonfirmasi pada 2014–2016; hyperparameter belum di-tuning; tidak ada tekanan reservoir, material balance, atau simulasi reservoir.
- Kasus contoh (F-11, 30 Jun 2015) ditetapkan sebelum melihat hasil.

## Data & lisensi
Equinor Volve Data Village — disediakan "apa adanya" untuk tujuan pendidikan/riset. `public/data/cockpit.json` memuat data produksi turunan dari dataset itu: cantumkan atribusi dan **periksa syarat lisensi Equinor sebelum repo dipublikasikan**.

## Tim
| Nama | NIM | Peran | LinkedIn |
|---|---|---|---|
| Raditya Andiza Putro (Ketua) | 23083010058 | Lead Technical Writer | _(isi)_ |
| Rosyidatul Kamila | 23083010076 | Data & Pipeline Specialist | https://www.linkedin.com/in/rosyidatulkamila |
| Pinka Nurdiana | 23083010057 | Model Architect | https://www.linkedin.com/in/pinka-nurdiana |
| Vivian Subiono | 23083010065 | Frontend & UX Engineer | https://www.linkedin.com/in/vivian-subiono |
| Nahda Hayu Hemalina | 23083010066 | Deployment & Edge Engineer | https://www.linkedin.com/in/nahda-hayu-hemalina-250393235 |