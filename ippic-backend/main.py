from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import requests
import numpy as np
from sklearn.linear_model import LinearRegression
from statsmodels.tsa.holtwinters import ExponentialSmoothing
import math
import re

app = FastAPI(title="i-PPIC Enterprise Core Engine")

app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# MASUKKAN API KEY ANDA DI SINI
SUPABASE_URL = "https://pikkiuviwbjnrywfdboj.supabase.co"
SUPABASE_KEY = "KUNCI_SUPABASE_RAHASIA"  # Ganti dengan key Supabase Anda
GEMINI_API_KEY = "KUNCI_GEMINI_RAHASIA" # Ganti dengan key Gemini Anda

# HEADER UNTUK SUPABASE RAW REST API
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

class MRPRequest(BaseModel):
    id_barang_jadi: int
    permintaan_pesanan: List[int]
    metode: str
    scrap_factor: float
    h_cost: float
    s_cost: float
    lead_time: int
    teks_kendala: str

class ForecastRequest(BaseModel):
    histori_permintaan: List[int]
    periode_prediksi: int
    metode_ai: str

class ScanRequest(BaseModel):
    kode_produk: str

# 1. FUNGSI GEMINI FAIL-SAFE (Anti Error 429)
def call_gemini(prompt: str, fallback_text: str) -> str:
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        res = requests.post(url, json=payload, timeout=10)
        if res.status_code == 200:
            return res.json()['candidates'][0]['content']['parts'][0]['text'].strip()
        else:
            return f"{fallback_text} (Catatan: API AI Limit. Mode Standar Aktif)."
    except Exception:
        return f"{fallback_text} (Catatan: Koneksi AI Terputus. Mode Standar Aktif)."

# 2. ENDPOINT DASHBOARD & PRODUK DENGAN RAW API (Anti Error 500)
@app.get("/api/dashboard-ews")
def get_dashboard():
    try:
        res = requests.get(f"{SUPABASE_URL}/rest/v1/produk?select=*", headers=HEADERS)
        data = res.json()
        kritis = [p for p in data if p['stok_aktual'] <= p['safety_stock']]
        return {"total_item": len(data), "item_kritis": len(kritis), "detail_kritis": kritis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/produk-jadi")
def get_produk_jadi():
    # URL di-encode %20 untuk spasi pada "Barang Jadi"
    res = requests.get(f"{SUPABASE_URL}/rest/v1/produk?kategori=eq.Barang%20Jadi&select=*", headers=HEADERS)
    return res.json()

@app.get("/api/vendor-kontak")
def get_vendor():
    res = requests.get(f"{SUPABASE_URL}/rest/v1/vendors?select=*", headers=HEADERS)
    return res.json()

@app.post("/api/scan-barcode")
def scan_barcode(req: ScanRequest):
    res = requests.get(f"{SUPABASE_URL}/rest/v1/produk?kode_produk=eq.{req.kode_produk}&select=*", headers=HEADERS)
    data = res.json()
    if not data:
        return {"status": "error", "pesan": "Kode Barcode Tidak Dikenal!"}
    
    produk = data[0]
    stok_baru = produk['stok_aktual'] + 50 
    
    # Update stok via PATCH
    requests.patch(f"{SUPABASE_URL}/rest/v1/produk?kode_produk=eq.{req.kode_produk}", headers=HEADERS, json={"stok_aktual": stok_baru})
    return {"status": "sukses", "pesan": f"Stok {produk['nama_produk']} berhasil ditambahkan 50 unit.", "stok_baru": stok_baru}

# 3. ENDPOINT FORECAST DENGAN DAMPED TREND
@app.post("/api/forecast")
def run_forecast(req: ForecastRequest):
    y = np.array(req.histori_permintaan)
    predictions = []
    
    if req.metode_ai == "Linear Regression":
        X = np.arange(1, len(y) + 1).reshape(-1, 1)
        model = LinearRegression().fit(X, y)
        future_X = np.arange(len(y) + 1, len(y) + 1 + req.periode_prediksi).reshape(-1, 1)
        predictions = np.maximum(0, model.predict(future_X)).round(0).astype(int).tolist()
    else:
        try:
            # damped_trend=True memaksa grafik melengkung
            model = ExponentialSmoothing(y, trend="add", seasonal=None, damped_trend=True, initialization_method="estimated").fit()
            predictions = np.maximum(0, model.forecast(req.periode_prediksi)).round(0).astype(int).tolist()
        except:
            predictions = [int(np.mean(y))] * req.periode_prediksi
    
    prompt = f"Data histori: {req.histori_permintaan}. Prediksi {req.metode_ai}: {predictions}. Berikan 2 kalimat strategi pengadaan logistik kritis penyeimbang supply-demand untuk manajer percetakan."
    fallback = "Tren pesanan menunjukkan potensi peningkatan berkelanjutan. Sangat disarankan untuk mengamankan persediaan bahan baku utama (Flexi & Tinta) sebesar 15% di atas rata-rata bulan lalu untuk menghindari stockout."
    
    insight = call_gemini(prompt, fallback)
    return {"prediksi": predictions, "insight_ai": insight}

def parse_kendala(teks: str, periode: int):
    if not teks:
        return []
    prompt = f"Teks keluhan lapangan: '{teks}'. Identifikasi minggu ke berapa saja vendor tutup/libur. Keluarkan HANYA array angka JSON murni di dalam batasan periode {periode}. Contoh output: [1, 3]"
    resp = call_gemini(prompt, "[]")
    match = re.search(r'\[(.*?)\]', resp)
    if match:
        return [int(x.strip()) for x in match.group(1).split(',') if x.strip().isdigit()]
    return []

def jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, metode, h_cost, s_cost, lead_time, minggu_libur):
    periods = len(keb_kotor)
    plan_receipts = [0] * periods
    plan_releases = [0] * periods
    proj_avail = [0] * periods
    
    total_demand = sum(keb_kotor)
    eoq = math.ceil(math.sqrt((2 * total_demand * s_cost) / h_cost)) if total_demand > 0 else 1
    
    if eoq > 150:
        s_cost = s_cost * 0.85

    for i in range(periods):
        current_stock = stok_awal + sum(plan_receipts[:i]) - sum(keb_kotor[:i])
        net = max(0, keb_kotor[i] + ss - current_stock)
        
        if net > 0:
            if metode == "L4L": lot = net
            elif metode == "EOQ": lot = math.ceil(net/eoq) * eoq
            elif metode == "POQ": lot = net + (keb_kotor[i+1] if i+1 < periods else 0)
            else: lot = math.ceil(net/100) * 100 
                
            target = i
            while target >= 0 and (target + 1) in minggu_libur: target -= 1
            if target < 0:
                target = i
                while target < periods and (target + 1) in minggu_libur: target += 1
                if target >= periods: target = periods - 1
            plan_receipts[target] += lot
            
        proj_avail[i] = stok_awal + sum(plan_receipts[:i+1]) - sum(keb_kotor[:i+1])
        
    for i in range(periods):
        if plan_receipts[i] > 0:
            release_idx = max(0, i - lead_time)
            plan_releases[release_idx] += plan_receipts[i]
            
    tc_holding = sum(proj_avail) * h_cost
    tc_setup = sum([1 for x in plan_receipts if x > 0]) * s_cost
    return plan_receipts, plan_releases, proj_avail, tc_holding, tc_setup

# 4. ENDPOINT MRP KOMPREHENSIF DENGAN RAW API
@app.post("/api/hitung-mrp-komprehensif")
def hitung_mrp(req: MRPRequest):
    # Mengambil relasi BOM dan Detail Produk via Supabase REST
    url = f"{SUPABASE_URL}/rest/v1/bom?id_barang_jadi=eq.{req.id_barang_jadi}&select=id_bahan_baku,rasio_kebutuhan,produk(nama_produk,stok_aktual,safety_stock)"
    res = requests.get(url, headers=HEADERS)
    
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Gagal menghubungi database BOM")
        
    bom_data = res.json()
    minggu_libur = parse_kendala(req.teks_kendala, len(req.permintaan_pesanan))
    hasil_semua_bahan = []
    summary_perbandingan = []

    for item in bom_data:
        nama_bahan = item['produk']['nama_produk']
        stok_awal = item['produk']['stok_aktual']
        ss = item['produk']['safety_stock']
        rasio = float(item['rasio_kebutuhan'])
        
        keb_kotor = [math.ceil((p * rasio) / (1 - req.scrap_factor)) for p in req.permintaan_pesanan]
        
        pr, pl, pa, tch, tcs = jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, req.metode, req.h_cost, req.s_cost, req.lead_time, minggu_libur)
        
        _, _, _, l4l_h, l4l_s = jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, "L4L", req.h_cost, req.s_cost, req.lead_time, minggu_libur)
        _, _, _, eoq_h, eoq_s = jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, "EOQ", req.h_cost, req.s_cost, req.lead_time, minggu_libur)
        _, _, _, poq_h, poq_s = jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, "POQ", req.h_cost, req.s_cost, req.lead_time, minggu_libur)
        _, _, _, fpr_h, fpr_s = jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, "FPR", req.h_cost, req.s_cost, req.lead_time, minggu_libur)

        hasil_semua_bahan.append({
            "bahan_baku": nama_bahan, "keb_kotor_bom": keb_kotor, 
            "plan_receipt": pr, "plan_release": pl, "proj_avail": pa, 
            "tc_holding": list(map(float, [tch])), "tc_setup": list(map(float, [tcs])), "total_biaya": float(tch + tcs)
        })
        
        summary_perbandingan.append({
            "bahan": nama_bahan,
            "L4L": float(l4l_h + l4l_s),
            "EOQ": float(eoq_h + eoq_s),
            "POQ": float(poq_h + poq_s),
            "FPR": float(fpr_h + fpr_s)
        })

    pesan = f"Penjadwalan Aman. Vendor terdeteksi libur pada minggu ke: {minggu_libur}" if minggu_libur else "Jadwal normal, tidak ada kendala vendor."
    return {
        "pesan_ai": pesan, 
        "detail_mrp": hasil_semua_bahan,
        "perbandingan_ekotek": summary_perbandingan
    }

@app.post("/api/analisis-finansial")
def analisis_finansial(req: dict):
    prompt = f"Hasil perbandingan total cost inventory: {req['matrix']}. Berikan rekomendasi manajerial sepanjang 3 kalimat tegas metode mana yang terbaik."
    fallback = "Metode L4L menghasilkan biaya pemesanan yang tinggi, sedangkan EOQ menyeimbangkan diskon grosir. Kami merekomendasikan penggunaan EOQ jika kapasitas gudang memadai, atau L4L jika arus kas sedang ketat."
    return {"rekomendasi": call_gemini(prompt, fallback)}