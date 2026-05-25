from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from supabase import create_client, Client
from google import genai
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

# KONEKSI CLOUD LOGISTIK
SUPABASE_URL = "https://pikkiuviwbjnrywfdboj.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpa2tpdXZpd2JqbnJ5d2ZkYm9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MTQyMTksImV4cCI6MjA5Mzk5MDIxOX0.eyWW0jDMCYmXFjbGFFBDs-K8He5FBUakJBSY-FKZ4BE"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
ai_client = genai.Client(api_key="AIzaSyBVCtPgKqR7KAvVA292xO1_yRaDv2wZP_0")

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

@app.get("/api/dashboard-ews")
def get_dashboard():
    res = supabase.table("produk").select("kode_produk, nama_produk, stok_aktual, safety_stock").execute()
    kritis = [p for p in res.data if p['stok_aktual'] <= p['safety_stock']]
    return {"total_item": len(res.data), "item_kritis": len(kritis), "detail_kritis": kritis}

@app.get("/api/produk-jadi")
def get_produk_jadi():
    return supabase.table("produk").select("*").eq("kategori", "Barang Jadi").execute().data

@app.get("/api/vendor-kontak")
def get_vendor():
    return supabase.table("vendors").select("*").execute().data

@app.post("/api/scan-barcode")
def scan_barcode(req: ScanRequest):
    res = supabase.table("produk").select("*").eq("kode_produk", req.kode_produk).execute()
    if not res.data:
        return {"status": "error", "pesan": "Kode Barcode Tidak Dikenal!"}
    
    produk = res.data[0]
    stok_baru = produk['stok_aktual'] + 50 
    supabase.table("produk").update({"stok_aktual": stok_baru}).eq("kode_produk", req.kode_produk).execute()
    return {"status": "sukses", "pesan": f"Stok {produk['nama_produk']} berhasil ditambahkan 50 unit.", "stok_baru": stok_baru}

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
            model = ExponentialSmoothing(y, trend="add", seasonal=None, initialization_method="estimated").fit()
            predictions = np.maximum(0, model.forecast(req.periode_prediksi)).round(0).astype(int).tolist()
        except:
            predictions = [int(np.mean(y))] * req.periode_prediksi
    
    prompt = f"Data historis penjualan cetak: {req.histori_permintaan}. Hasil prediksi {req.metode_ai} untuk 4 periode depan: {predictions}. Berikan 2 kalimat strategi pengadaan logistik kritis penyeimbang supply-demand untuk manajer percetakan."
    insight = "Gagal memuat analisis wawasan otomatis."
    try:
        insight = ai_client.models.generate_content(model='gemini-2.5-flash', contents=prompt).text.strip()
    except:
        pass
    
    return {"prediksi": predictions, "insight_ai": insight}

def parse_kendala(teks: str, periode: int):
    if not teks:
        return []
    try:
        resp = ai_client.models.generate_content(model='gemini-2.5-flash', contents=f"Teks keluhan lapangan: '{teks}'. Identifikasi minggu ke berapa saja vendor tutup/libur/tidak mengirim pasokan. Keluarkan HANYA array angka JSON murni di dalam batasan periode {periode}. Contoh output: [1, 3]").text
        match = re.search(r'\[(.*?)\]', resp)
        if match:
            return [int(x.strip()) for x in match.group(1).split(',') if x.strip().isdigit()]
    except:
        pass
    return []

# FUNGSI INTERNAL: EKSEKUSI INDIVIDUAL LOGIKA MRP UNTUK PEMBANDING EKOTEK
def jalankan_kalkulasi_mrp_internal(keb_kotor, stok_awal, ss, metode, h_cost, s_cost, lead_time, minggu_libur):
    periods = len(keb_kotor)
    plan_receipts = [0] * periods
    plan_releases = [0] * periods
    proj_avail = [0] * periods
    
    total_demand = sum(keb_kotor)
    eoq = math.ceil(math.sqrt((2 * total_demand * s_cost) / h_cost)) if total_demand > 0 else 1
    
    # Penerapan Quantity Discount Riil Lapangan (Jika lot EOQ besar, s_cost diasumsikan mendapat efisiensi transportasi)
    if eoq > 150:
        s_cost = s_cost * 0.85

    for i in range(periods):
        current_stock = stok_awal + sum(plan_receipts[:i]) - sum(keb_kotor[:i])
        net = max(0, keb_kotor[i] + ss - current_stock)
        
        if net > 0:
            if metode == "L4L":
                lot = net
            elif metode == "EOQ":
                lot = math.ceil(net/eoq) * eoq
            elif metode == "POQ":
                lot = net + (keb_kotor[i+1] if i+1 < periods else 0)
            else:
                lot = math.ceil(net/100) * 100 # FPR kelipatan 100 unit utuh
                
            target = i
            # Logika Shifting Maju Mundur yang Diperbaiki
            while target >= 0 and (target + 1) in minggu_libur:
                target -= 1
            if target < 0:
                target = i
                while target < periods and (target + 1) in minggu_libur:
                    target += 1
                if target >= periods:
                    target = periods - 1
            
            plan_receipts[target] += lot
            
        proj_avail[i] = stok_awal + sum(plan_receipts[:i+1]) - sum(keb_kotor[:i+1])
        
    for i in range(periods):
        if plan_receipts[i] > 0:
            release_idx = max(0, i - lead_time)
            plan_releases[release_idx] += plan_receipts[i]
            
    tc_holding = sum(proj_avail) * h_cost
    tc_setup = sum([1 for x in plan_receipts if x > 0]) * s_cost
    return plan_receipts, plan_releases, proj_avail, tc_holding, tc_setup

@app.post("/api/hitung-mrp-komprehensif")
def hitung_mrp(req: MRPRequest):
    bom_data = supabase.table("bom").select("id_bahan_baku, rasio_kebutuhan, produk!id_bahan_baku(nama_produk, stok_aktual, safety_stock)").eq("id_barang_jadi", req.id_barang_jadi).execute().data
    minggu_libur = parse_kendala(req.teks_kendala, len(req.permintaan_pesanan))
    hasil_semua_bahan = []
    summary_perbandingan = []

    for item in bom_data:
        nama_bahan = item['produk']['nama_produk']
        stok_awal = item['produk']['stok_aktual']
        ss = item['produk']['safety_stock']
        rasio = float(item['rasio_kebutuhan'])
        
        keb_kotor = [math.ceil((p * rasio) / (1 - req.scrap_factor)) for p in req.permintaan_pesanan]
        
        # Jalankan metode utama yang dipilih user
        pr, pl, pa, tch, tcs = jalankan_kalkulasi_mrp_internal(
            keb_kotor, stok_awal, ss, req.metode, req.h_cost, req.s_cost, req.lead_time, minggu_libur
        )
        
        # HITUNG KE-4 METODE SEKALIGUS UNTUK GRAFIK EKOTEK
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

    return {
        "pesan_ai": f"Algoritma Shifting Mengamankan Jadwal. Vendor terdeteksi libur/tutup pada periode: {minggu_libur}", 
        "detail_mrp": hasil_semua_bahan,
        "perbandingan_ekotek": summary_perbandingan
    }

@app.post("/api/analisis-finansial")
def analisis_finansial(req: dict):
    prompt = f"Hasil perbandingan total cost inventory pabrik: {req['matrix']}. Berikan rekomendasi manajerial sepanjang 3 kalimat tegas untuk menentukan keputusan pembebanan lot pengadaan logistik terbaik di CV Sandy Graphia."
    try:
        return {"rekomendasi": ai_client.models.generate_content(model='gemini-2.5-flash', contents=prompt).text.strip()}
    except:
        return {"rekomendasi": "Gagal menghasilkan evaluasi kelayakan finansial otomatis."}