#!/usr/bin/env python3
"""Volve Cockpit — pipeline data & model (dijalankan SEKALI; hasilnya disimpan ke public/).

Tahapan:
 1. Baca & bersihkan sheet 'Daily Production Data' (hanya produser, WELL_TYPE = OP)
 2. Fitur lag + rolling (14 fitur; SAMA persis dengan public/js/features.js)
 3. Baseline: persistence, Arps hyperbolic (b dibatasi 0..1), Arps terkoreksi uptime
    + PRAKIRAAN TERPADU = rata-rata bobot sama (XGBoost, Arps, persistence)
 4. Validasi walk-forward (refit tahunan, model hanya melihat data SEBELUM tahun uji)
    + leave-one-well-out (generalisasi ke sumur baru) + ablasi + sensitivitas tanggal hilang
 5. Interval ketidakpastian dari residual out-of-fold (per horizon & rezim uptime)
 6. TreeSHAP, ekspor ONNX (final + tiap refit tahunan), ekspor JSON untuk website
"""
import json, pathlib, sys, time, warnings, datetime as dt
import numpy as np, pandas as pd, xgboost as xgb, onnxruntime as ort
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public"
HZ = (30, 60, 90)
FEATS_V0 = ["oil_m7_m30", "oil_m30_m90", "oil_d1_m30", "wc7", "wc_delta", "log_gor7", "gor_ratio",
            "whp7", "whp_ratio", "choke7", "uptime7", "uptime30", "log_days", "log_m30"]   # set awal (14)
X_DHP, X_INJ = ["dhp7", "dhp_ratio"], ["inj30", "inj_ratio"]
# FINAL: tanpa umur sumur (log_days menghafal sumur) + injeksi air lapangan (dukungan tekanan).
# Dipilih dari data 2011-2013, dikonfirmasi pada 2014-2016 (lihat metrics.selection).
FEATS = [c for c in FEATS_V0 if c != "log_days"] + X_INJ
ARPS_WIN, TEST_START, SHORT, DIST_CUT = 180, pd.Timestamp("2011-01-01"), "15/9-F-5", 0.85
BBL_PER_SM3 = 6.2898
SAMPLE_CASE = {"well": "15/9-F-11", "date": "2015-06-30"}   # ditetapkan SEBELUM melihat hasil
XGB = dict(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
           min_child_weight=5, random_state=0, n_jobs=4)


def log(*a):
    print(*a, flush=True)


# --------------------------------------------------------------------------- 1. data
def load_and_clean(path):
    d = pd.read_excel(path, sheet_name="Daily Production Data")
    d["DATEPRD"] = pd.to_datetime(d.DATEPRD)
    inj = d[d.WELL_TYPE == "WI"].groupby("DATEPRD").BORE_WI_VOL.sum()
    op = d[d.WELL_TYPE == "OP"].rename(columns={
        "DATEPRD": "date", "NPD_WELL_BORE_NAME": "well", "ON_STREAM_HRS": "hours", "AVG_WHP_P": "whp",
        "AVG_CHOKE_SIZE_P": "choke", "AVG_DOWNHOLE_PRESSURE": "dhp", "BORE_OIL_VOL": "oil",
        "BORE_GAS_VOL": "gas", "BORE_WAT_VOL": "wat"})[["date", "well", "hours", "whp", "choke", "dhp", "oil", "gas", "wat"]].copy()
    L = {"baris_produser_awal": int(len(op))}
    L["duplikat_dibuang"] = int(op.duplicated(["well", "date"]).sum())
    op = op.drop_duplicates(["well", "date"])
    L["jam_lebih_24_dipangkas"] = int((op.hours > 24).sum()); op["hours"] = op.hours.clip(0, 24)
    L["volume_negatif_dinolkan"] = int(((op[["oil", "gas", "wat"]] < 0).any(axis=1)).sum())
    op[["oil", "gas", "wat"]] = op[["oil", "gas", "wat"]].clip(lower=0)
    bad = (op.hours == 0) & (op.oil > 0)
    L["jam0_tapi_minyak_positif_dibuang"] = int(bad.sum()); op = op[~bad]
    L["baris_produser_akhir"] = int(len(op))
    return op, inj, L


def prep_well(g):
    g = g.set_index("date").sort_index()
    full = pd.date_range(g.index.min(), g.index.max())
    miss = ~full.isin(g.index)
    g = g.reindex(full)
    for c in ["oil", "gas", "wat", "hours"]:
        g[c] = g[c].fillna(0)                       # ASUMSI: tanggal hilang = 0 (diuji sensitivitasnya)
    for c in ["whp", "choke", "dhp"]:
        g[c] = g[c].ffill().bfill().fillna(0)
    g["miss"] = miss.astype(int)
    return g[["hours", "whp", "choke", "dhp", "oil", "gas", "wat", "miss"]]


# --------------------------------------------------------------------------- 2. fitur
def build_features(g, inj_d, liq_d, nan_mode=False):
    s = g.copy()
    if nan_mode:
        s.loc[s.miss == 1, ["oil", "gas", "wat", "hours"]] = np.nan
    r = lambda x, w: x.rolling(w, min_periods=1).mean()
    o = s.oil
    m7, m30, m90 = r(o, 7), r(o, 30), r(o, 90)
    wc7 = r(s.wat, 7) / (r(s.oil + s.wat, 7) + 1e-6)
    wc30 = r(s.wat, 30) / (r(s.oil + s.wat, 30) + 1e-6)
    gor7, gor30 = r(s.gas, 7) / (m7 + 1e-6), r(s.gas, 30) / (m30 + 1e-6)
    f = pd.DataFrame({
        "oil_m7_m30": m7 / (m30 + 1), "oil_m30_m90": m30 / (m90 + 1), "oil_d1_m30": o / (m30 + 1),
        "wc7": wc7, "wc_delta": wc7 - wc30, "log_gor7": np.log1p(gor7),
        "gor_ratio": (gor7 / (gor30 + 1e-6)).clip(0, 5),
        "whp7": r(s.whp, 7), "whp_ratio": (r(s.whp, 7) / (r(s.whp, 30) + 1e-6)).clip(0, 5), "choke7": r(s.choke, 7),
        "uptime7": r(s.hours, 7) / 24, "uptime30": r(s.hours, 30) / 24,
        "log_days": np.log1p(np.arange(len(g))), "log_m30": np.log1p(m30),
    }, index=g.index)
    d7, d30 = r(g.dhp, 7), r(g.dhp, 30)
    f["dhp7"], f["dhp_ratio"] = d7, (d7 / (d30 + 1e-6)).clip(0, 5)
    i30 = inj_d.reindex(g.index).fillna(0).rolling(30, min_periods=1).mean()
    f["inj30"] = i30
    f["inj_ratio"] = i30 / (liq_d.reindex(g.index).fillna(0).rolling(30, min_periods=1).mean() + 1)
    f = f.fillna(0)
    m30z = g.oil.rolling(30, min_periods=1).mean()          # target & skala selalu dari deret terisi-0
    f["m30"] = m30z
    for H in HZ:
        f[f"y{H}"] = g.oil.rolling(H).mean().shift(-H)      # rata-rata hari t+1..t+H
    f["t"] = np.arange(len(g))
    f["date"] = g.index
    return f


# --------------------------------------------------------------------------- 3. Arps (grid-fit, identik dengan js/features.js)
DI = np.logspace(-4, -1, 31)
BB = np.linspace(0.02, 1.0, 21)
DIG, BG = [a.ravel() for a in np.meshgrid(DI, BB, indexing="ij")]
BASIS = (1 + BG[:, None] * DIG[:, None] * np.arange(ARPS_WIN)[None, :]) ** (-1.0 / BG[:, None])


def arps_fit(y):
    L = len(y); m = y > 0
    if m.sum() < 20:
        return None
    B = BASIS[:, :L]; ym = np.where(m, y, 0.0); mf = m.astype(float)
    sxy, sxx = B @ ym, (B * B) @ mf
    qi = sxy / np.maximum(sxx, 1e-12)
    sse = (ym ** 2).sum() - 2 * qi * sxy + qi ** 2 * sxx
    sse = np.where((qi > 0) & (qi <= 3 * y[m].max()), sse, np.inf)
    k = int(np.argmin(sse))
    return None if not np.isfinite(sse[k]) else (float(qi[k]), float(DIG[k]), float(BG[k]))


def arps_means(oil, t):
    y = oil[max(0, t - ARPS_WIN + 1):t + 1]
    p = arps_fit(y)
    if p is None:
        return None
    qi, di, b = p; L = len(y)
    q = qi * (1 + b * di * (L + np.arange(max(HZ)))) ** (-1.0 / b)
    return [float(q[:H].mean()) for H in HZ]


# --------------------------------------------------------------------------- util
def wape(e, y):
    return float(np.abs(e).sum() / max(y.sum(), 1e-9))


def summarize(y, p):
    e = p - y
    return {"MAE": round(float(np.abs(e).mean()), 2), "RMSE": round(float(np.sqrt((e ** 2).mean())), 2),
            "WAPE": round(wape(e, y), 4), "bias": round(float(e.mean()), 2), "n": int(len(y))}


def train(X, y):
    return xgb.XGBRegressor(**XGB).fit(X.astype(np.float32), y)


def ratio_target(F, H):
    return (F[f"y{H}"] / (F.m30 + 1)).clip(0, 3)


def wf_predict(Fall, cols, H, keep_models=False):
    """Walk-forward: refit tahunan. Model tahun Y hanya dilatih pada baris dengan jendela label selesai sebelum 1 Jan Y."""
    pred = pd.Series(np.nan, index=Fall.index); models = {}
    for Y in range(TEST_START.year, int(Fall.date.dt.year.max()) + 1):
        cut = pd.Timestamp(f"{Y}-01-01")
        tr = Fall[(Fall.well != SHORT) & (Fall.m30 > 5) & Fall[f"y{H}"].notna() & (Fall.date < cut - pd.Timedelta(days=H))]
        te = Fall[(Fall.date.dt.year == Y) & Fall.te]
        if len(tr) < 300 or te.empty:
            continue
        m = train(tr[cols].values, ratio_target(tr, H))
        pred.loc[te.index] = m.predict(te[cols].values.astype(np.float32)) * (te.m30 + 1)
        models[Y] = m
    return (pred, models) if keep_models else pred


def main():
    t0 = time.time()
    xls = next((ROOT / "data/raw").glob("*.xlsx"), None)
    if xls is None:
        sys.exit("File Volve .xlsx tidak ditemukan di data/raw/. Taruh 'Volve production data.xlsx' di sana lalu jalankan ulang.")
    op, inj, CL = load_and_clean(xls)
    log("bersih:", CL)
    wells = {w: prep_well(g) for w, g in op.groupby("well")}
    order = sorted(wells, key=lambda w: (w == SHORT, -len(wells[w])))
    liq = sum(g.oil.add(g.wat).reindex(pd.date_range("2007-09-01", "2016-12-01")).fillna(0) for g in wells.values())
    inj_d = inj.reindex(pd.date_range("2007-09-01", "2016-12-01")).fillna(0)

    # ---- fitur & baseline
    Fz, Fn, parts = [], [], []
    for w in order:
        g = wells[w]
        f = build_features(g, inj_d, liq); f["well"] = w; Fz.append(f)
        fn = build_features(g, inj_d, liq, nan_mode=True); fn["well"] = w; Fn.append(fn)
    Fall = pd.concat(Fz); Fnan = pd.concat(Fn)
    Fall["te"] = (Fall.date >= TEST_START) & (Fall.t >= 60) & (Fall.m30 > 5)
    Fnan["te"] = Fall["te"].values
    Fall = Fall.reset_index(drop=True); Fnan = Fnan.reset_index(drop=True)
    for H in HZ:
        Fall[f"a{H}"] = np.nan
    log("Arps grid-fit untuk semua hari uji ...")
    for w in order:
        oil = wells[w].oil.values; idx = Fall.index[(Fall.well == w) & Fall.te]
        for i in idx:
            am = arps_means(oil, int(Fall.at[i, "t"]))
            if am is None:
                am = [Fall.at[i, "m30"]] * 3
            for k, H in enumerate(HZ):
                Fall.at[i, f"a{H}"] = am[k]
    for H in HZ:
        Fall[f"pers{H}"] = Fall.m30
        Fall[f"c{H}"] = Fall[f"a{H}"] * Fall.uptime30

    # ---- walk-forward utama (14 fitur)
    log("walk-forward ...")
    wf_models = {}
    for H in HZ:
        Fall[f"p{H}"], wf_models[H] = wf_predict(Fall, FEATS, H, keep_models=True)
        Fall[f"e{H}"] = (Fall[f"p{H}"] + Fall[f"a{H}"] + Fall.m30) / 3          # prakiraan terpadu (bobot sama, tanpa fitting)
    ev = Fall[Fall.te & (Fall.well != SHORT)]
    metrics = {"protocol": "walk-forward, refit tahunan (model hanya melihat data sebelum 1 Jan tahun uji)",
               "test_start": str(TEST_START.date()), "horizons": {}, "per_well": {}, "per_year": {}, "regime": {}}
    names = {"terpadu": "e", "xgb": "p", "persistence": "pers", "arps": "a", "arps_uptime": "c"}
    for H in HZ:
        e = ev[ev[f"y{H}"].notna() & ev[f"p{H}"].notna()]
        metrics["horizons"][H] = {k: summarize(e[f"y{H}"].values, e[f"{v}{H}"].values) for k, v in names.items()}
        metrics["per_well"][H] = {w: {k: round(wape(d[f"{v}{H}"] - d[f"y{H}"], d[f"y{H}"]), 4) for k, v in names.items()}
                                  | {"n": int(len(d))} for w, d in e.groupby("well")}
        metrics["per_year"][H] = {int(y): {k: round(wape(d[f"{v}{H}"] - d[f"y{H}"], d[f"y{H}"]), 4) for k, v in names.items()}
                                  for y, d in e.groupby(e.date.dt.year)}
        for reg, msk in {"normal": e.uptime30 >= DIST_CUT, "gangguan": e.uptime30 < DIST_CUT}.items():
            d = e[msk]
            metrics["regime"].setdefault(H, {})[reg] = {k: round(wape(d[f"{v}{H}"] - d[f"y{H}"], d[f"y{H}"]), 4) for k, v in names.items()} | {"n": int(len(d))}
    log(json.dumps({H: {k: v["WAPE"] for k, v in metrics["horizons"][H].items()} for H in HZ}))
    log("regime (WAPE 30d):", metrics["regime"][30])

    # ---- LOWO
    log("leave-one-well-out ...")
    lowo = {}
    for H in HZ:
        for w in order:
            if w == SHORT:
                continue
            tr = Fall[(Fall.well != SHORT) & (Fall.well != w) & (Fall.m30 > 5) & Fall[f"y{H}"].notna()]
            te = Fall[(Fall.well == w) & Fall.te & Fall[f"y{H}"].notna()]
            m = train(tr[FEATS].values, ratio_target(tr, H))
            p = m.predict(te[FEATS].values.astype(np.float32)) * (te.m30 + 1)
            ens = (p + te[f"a{H}"] + te.m30) / 3
            lowo.setdefault(H, {})[w] = {"terpadu": round(wape(ens - te[f"y{H}"], te[f"y{H}"]), 4),
                "xgb": round(wape(p - te[f"y{H}"], te[f"y{H}"]), 4),
                "arps": round(wape(te[f"a{H}"] - te[f"y{H}"], te[f"y{H}"]), 4),
                "arps_uptime": round(wape(te[f"c{H}"] - te[f"y{H}"], te[f"y{H}"]), 4),
                "persistence": round(wape(te.m30 - te[f"y{H}"], te[f"y{H}"]), 4), "n": int(len(te))}
    metrics["lowo"] = lowo

    # ---- ablasi & sensitivitas (H=30, walk-forward)
    log("ablasi ...")
    def wf_score(F, cols):
        p = wf_predict(F, cols, 30)
        d = F[F.te & (F.well != SHORT) & F.y30.notna() & p.notna()]
        e = p[d.index] - d.y30
        yr = d.date.dt.year
        return {"WAPE": round(wape(e, d.y30), 4), "WAPE_2011_13": round(wape(e[yr <= 2013], d.y30[yr <= 2013]), 4),
                "WAPE_2014_16": round(wape(e[yr >= 2014], d.y30[yr >= 2014]), 4), "MAE": round(float(e.abs().mean()), 2), "n": int(len(d))}
    grp = {"injeksi air": X_INJ, "uptime": ["uptime7", "uptime30"], "water cut": ["wc7", "wc_delta"], "GOR": ["log_gor7", "gor_ratio"],
           "tekanan & choke": ["whp7", "whp_ratio", "choke7"]}
    abl = [{"varian": "Model final (15 fitur)", **wf_score(Fall, FEATS)},
           {"varian": "Set awal (14 fitur, dengan umur sumur)", **wf_score(Fall, FEATS_V0)},
           {"varian": "Final + umur sumur (log_days)", **wf_score(Fall, FEATS + ["log_days"])}]
    for k, v in grp.items():
        abl.append({"varian": f"Final tanpa {k}", **wf_score(Fall, [c for c in FEATS if c not in v])})
    abl.append({"varian": "Final + downhole pressure", **wf_score(Fall, FEATS + X_DHP)})
    Fn2 = Fnan.copy()
    for c in ("m30", "te", "well", "date", "t") + tuple(f"y{H}" for H in HZ):
        Fn2[c] = Fall[c].values
    gap_sens = {"tanggal_hilang_diisi_0": abl[0]["WAPE"], "tanggal_hilang_diabaikan_(NaN)": wf_score(Fn2, FEATS)["WAPE"]}
    metrics["ablation"] = abl; metrics["gap_sensitivity"] = gap_sens
    metrics["selection"] = {"catatan": "Fitur final dipilih dari 2011-2013 dan dikonfirmasi pada 2014-2016 (tidak dipakai memilih).",
                            "awal": {k: abl[1][k] for k in ("WAPE_2011_13", "WAPE_2014_16")},
                            "final": {k: abl[0][k] for k in ("WAPE_2011_13", "WAPE_2014_16")}}
    for a_ in abl: log("  ", a_)
    log("  gap:", gap_sens)

    # ---- interval dari residual OOF
    log("interval & kalibrasi ...")
    bands, cov = {}, {}
    for H in HZ:
        d = Fall[Fall.te & (Fall.well != SHORT) & Fall[f"y{H}"].notna() & Fall[f"e{H}"].notna()].copy()
        d["e"] = np.log1p(d[f"y{H}"]) - np.log1p(d[f"e{H}"]); d["reg"] = np.where(d.uptime30 < DIST_CUT, "gangguan", "normal")
        d["yr"] = d.date.dt.year
        bands[H] = {}
        for reg in ("normal", "gangguan"):
            x = d[d.reg == reg].e
            src = x if len(x) >= 100 else d.e
            bands[H][reg] = {"q10": round(float(src.quantile(.10)), 4), "q50": round(float(src.quantile(.50)), 4),
                             "q90": round(float(src.quantile(.90)), 4), "n": int(len(x)),
                             "sample": [round(float(v), 3) for v in src.sample(min(400, len(src)), random_state=1)]}
        inside = []
        for y_ in d.yr.unique():
            other, cur = d[d.yr != y_], d[d.yr == y_]
            for reg in ("normal", "gangguan"):
                o_ = other[other.reg == reg].e; o_ = o_ if len(o_) >= 100 else other.e
                c_ = cur[cur.reg == reg].e
                inside += list(((c_ >= o_.quantile(.1)) & (c_ <= o_.quantile(.9))).values)
        cov[H] = round(float(np.mean(inside)), 4)
    metrics["band_coverage_loyo"] = cov
    log("  cakupan pita (target 0.80):", cov)

    # ---- ONNX (final + tiap refit tahunan) + paritas
    log("ekspor ONNX ...")
    mdir = OUT / "models"; mdir.mkdir(parents=True, exist_ok=True)
    for f in mdir.glob("*.onnx"): f.unlink()
    def export(model, name, Xcheck):
        onx = convert_xgboost(model, initial_types=[("input", FloatTensorType([None, len(FEATS)]))], target_opset=15)
        (mdir / name).write_bytes(onx.SerializeToString())
        s = ort.InferenceSession(str(mdir / name)); X = Xcheck[:200].astype(np.float32)
        diff = float(np.abs(s.run(None, {"input": X})[0].ravel() - model.predict(X)).max())
        return {"file": name, "kb": round((mdir / name).stat().st_size / 1024, 1), "max_diff": diff}
    onnx_info = []
    trn = Fall[(Fall.well != SHORT) & (Fall.m30 > 5)]
    for H in HZ:
        d = trn[trn[f"y{H}"].notna()]
        final = train(d[FEATS].values, ratio_target(d, H))
        onnx_info.append({"kind": "final", "H": H, **export(final, f"final_h{H}.onnx", d[FEATS].values)})
        for Y, m in wf_models[H].items():
            onnx_info.append({"kind": "wf", "H": H, "year": Y, **export(m, f"wf{Y}_h{H}.onnx", d[FEATS].values)})
    metrics["onnx"] = onnx_info
    log("  maks selisih ONNX vs XGBoost:", max(o["max_diff"] for o in onnx_info), "| total KB:", round(sum(o["kb"] for o in onnx_info)))

    # ---- SHAP (H=30, model walk-forward tiap tahun)
    log("TreeSHAP ...")
    shap = {}
    for Y, m in wf_models[30].items():
        te = Fall[(Fall.date.dt.year == Y) & Fall.te]
        if te.empty: continue
        C = m.get_booster().predict(xgb.DMatrix(te[FEATS].values.astype(np.float32)), pred_contribs=True)
        C = C * (te.m30.values + 1)[:, None]
        for i, row in zip(te.index, C):
            shap[i] = row
    ev30 = Fall[Fall.te & (Fall.well != SHORT)].index
    metrics["shap_global"] = {f: round(float(np.mean([abs(shap[i][k]) for i in ev30 if i in shap])), 3) for k, f in enumerate(FEATS)}

    # ---- ekspor JSON
    log("ekspor JSON ...")
    def L(a, nd=1):
        a = np.asarray(a, dtype=float)
        return [None if not np.isfinite(v) else (int(v) if nd == 0 else round(float(v), nd)) for v in a]
    out_w = []
    for w in order:
        g = wells[w]; F = Fall[Fall.well == w].reset_index()
        valid = F.te | F[[f"p{H}" for H in HZ]].notna().any(axis=1)
        o0 = int(F.t[valid].min()) if valid.any() else None
        rec = {"name": w, "short": w.replace("15/9-", ""), "start": str(g.index[0].date()), "n": int(len(g)),
               "short_history": w == SHORT,
               "oil": L(g.oil, 4), "gas": L(g.gas, 2), "wat": L(g.wat, 4), "hours": L(g.hours, 6), "whp": L(g.whp, 6), "choke": L(g.choke, 6),
               "dhp": L(g.dhp, 2), "miss": [int(v) for v in g.miss]}
        if o0 is not None:
            s = F[F.t >= o0]
            rec["oof"] = {"o0": o0, "m30": L(s.m30), "u30": L(s.uptime30, 3),
                          "u7": L(s.uptime7, 3),
                          "p": {str(H): L(s[f"p{H}"]) for H in HZ}, "a": {str(H): L(s[f"a{H}"]) for H in HZ},
                          "e": {str(H): L(s[f"e{H}"]) for H in HZ}, "y": {str(H): L(s[f"y{H}"]) for H in HZ},
                          "shap30": [None if k not in shap else [round(float(v), 1) for v in shap[k]] for k in s["index"]]}
        out_w.append(rec)
    cal0 = "2007-09-01"
    data = {"meta": {"generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "source": "Equinor Volve Data Village — Volve production data.xlsx",
                     "horizons": list(HZ), "feats": FEATS, "feats_v0": FEATS_V0, "arps_win": ARPS_WIN, "bbl_per_sm3": BBL_PER_SM3, "dist_cut": DIST_CUT,
                     "test_start": str(TEST_START.date()), "short_well": SHORT, "sample_case": SAMPLE_CASE, "cal0": cal0,
                     "cleaning": CL, "years_wf": sorted(wf_models[30].keys()), "train_seconds": int(round(time.time() - t0))},
            "wells": out_w,
            "field": {"cal0": cal0, "inj": L(inj_d, 2)},
            "bands": bands, "metrics": metrics}
    p = OUT / "data" / "cockpit.json"; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    log(f"selesai dalam {time.time() - t0:.0f} detik. cockpit.json = {p.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()