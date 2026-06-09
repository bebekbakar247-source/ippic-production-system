"use client";

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { 
  LayoutDashboard, Calculator, ScanBarcode, Package, AlertTriangle, 
  Menu, Bot, ChevronRight, TrendingUp, Smartphone, PieChart, CheckCircle2, DollarSign, RefreshCw
} from 'lucide-react';

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [ewsData, setEwsData] = useState<any>(null);
  const [produkJadi, setProdukJadi] = useState<any[]>([]);
  const [vendorList, setVendorList] = useState<any[]>([]);

  // Forecast Engine State
  const [historiInput, setHistoriInput] = useState('100, 120, 115, 140, 130');
  const [metodeForecast, setMetodeForecast] = useState('Linear Regression');
  const [forecastResult, setForecastResult] = useState<any>(null);
  const [isForecasting, setIsForecasting] = useState(false);

  // MRP Optimization State
  const [selectedProduk, setSelectedProduk] = useState(1);
  const [kebutuhanKotor, setKebutuhanKotor] = useState('150, 180, 200, 120');
  const [metode, setMetode] = useState('L4L');
  const [scrapFactor, setScrapFactor] = useState(5); 
  const [hCost, setHCost] = useState(2000);
  const [sCost, setSCost] = useState(50000);
  const [teksKendala, setTeksKendala] = useState('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [mrpResult, setMrpResult] = useState<any>(null);

  // Evaluasi Keuangan Ekotek State
  const [rekomendasiFinansial, setRekomendasiFinansial] = useState('');
  const [isAnalisis, setIsAnalisis] = useState(false);

  // URL BACKEND HUGGING FACE PRODUCTION RESOLVER (Pipa Data Murni)
  const API_URL = 'https://raihanr247-ippic-backend-api.hf.space';

  const fetchDashboardData = async () => {
    try {
      const [rEws, rProd, rVend] = await Promise.all([
        axios.get(`${API_URL}/api/dashboard-ews`),
        axios.get(`${API_URL}/api/produk-jadi`),
        axios.get(`${API_URL}/api/vendor-kontak`)
      ]);
      setEwsData(rEws.data); setProdukJadi(rProd.data); setVendorList(rVend.data);
    } catch (e) { 
      console.log("Sinkronisasi offline: Menunggu restrukturisasi jaringan API cloud."); 
    }
  };

  useEffect(() => { fetchDashboardData(); }, []);

  // Modul Pemindaian Barcode Kamera
  useEffect(() => {
    if (activeTab === 'scanner') {
      const scanner = new Html5QrcodeScanner("reader", { qrbox: { width: 250, height: 250 }, fps: 5 }, false);
      scanner.render(
        async (decodedText) => {
          scanner.clear().catch(e => console.log(e));
          try {
            const res = await axios.post(`${API_URL}/api/scan-barcode`, { kode_produk: decodedText });
            if (res.data.status === 'sukses') {
              alert(`🖨️ Pemindaian Berhasil: ${res.data.pesan}`);
              fetchDashboardData(); 
            } else { alert("❌ SKU Material tidak terdaftar di sistem cloud."); }
          } catch (e) { alert("Kegagalan menangkap respon server AI."); }
        },
        (error) => { /* Silently catch alignment loss */ }
      );
      return () => { scanner.clear().catch(e => console.log(e)); };
    }
  }, [activeTab]);

const handleForecast = async () => {
  setIsForecasting(true);
  try {
    const payload = { 
      histori_permintaan: historiInput.split(',').map(n => parseInt(n.trim())), 
      periode_prediksi: 4, 
      metode_ai: metodeForecast 
    };
    const res = await axios.post(`${API_URL}/api/forecast`, payload);

    if (res.data && res.data.prediksi) {
      const chartData = payload.histori_permintaan.map((val, i) => ({ minggu: `M-${i+1}`, aktual: val, prediksi: null }))
        .concat(res.data.prediksi.map((val: number, i: number) => ({ minggu: `F-${i+1}`, aktual: null, prediksi: val })));
      setForecastResult({ chart: chartData, insight: res.data.insight_ai });
      setKebutuhanKotor(res.data.prediksi.join(', '));
    }
  } catch (e: any) { 
    alert("⚠️ Gangguan sambungan modul kecerdasan buatan: " + (e.response?.data?.detail || e.message)); 
  }
  setIsForecasting(false);
};

const handleHitungMRP = async () => {
  setIsCalculating(true);
  try {
    const payload = { 
      id_barang_jadi: Number(selectedProduk), 
      permintaan_pesanan: kebutuhanKotor.split(',').map(n => parseInt(n.trim())), 
      metode: metode, 
      scrap_factor: Number(scrapFactor) / 100, 
      h_cost: Number(hCost), 
      s_cost: Number(sCost), 
      lead_time: 1, 
      teks_kendala: teksKendala 
    };
    const response = await axios.post(`${API_URL}/api/hitung-mrp-komprehensif`, payload);
    if (response.data) {
      setMrpResult(response.data);
      setRekomendasiFinansial(''); 
    }
  } catch (e: any) { 
    alert("❌ Kegagalan kalkulasi matrik algoritma MRP: " + (e.response?.data?.detail || e.message)); 
  }
  setIsCalculating(false);
};

  const handleKirimWA = (bahan: string, plan_release: number[], hp: string) => {
    let msg = `*PURCHASE ORDER AUTOMATION SYSTEM*\n*CV SANDY GRAPHIA*\n\nYth. Vendor Logistik,\nKami merilis jadwal pengadaan material untuk *${bahan}*:\n`;
    plan_release.forEach((qty, i) => { if(qty > 0) msg += `- Periode Minggu ${i+1}: *${qty} Unit*\n`; });
    msg += `\nMohon pesanan segera dikonfirmasi dan diproses. Terima kasih.`;
    window.open(`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const mintaRekomendasiFinansial = async () => {
    if (!mrpResult) return;
    setIsAnalisis(true);
    try {
      const payload = { matrix: JSON.stringify(mrpResult.perbandingan_ekotek) };
      const res = await axios.post(`${API_URL}/api/analisis-finansial`, payload);
      setRekomendasiFinansial(res.data.rekomendasi);
    } catch (e) { alert("Koneksi AI Advisor terputus."); }
    setIsAnalisis(false);
  };

  const SidebarBtn = ({ id, icon: Icon, label }: any) => (
    <button onClick={() => setActiveTab(id)} className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl font-medium transition-all duration-200 ${activeTab === id ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white'}`}>
      <div className="flex items-center gap-3"><Icon size={18} /> {label}</div>{activeTab === id && <ChevronRight size={16} />}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 font-sans flex overflow-hidden">
      
      {/* SIDEBAR PANEL */}
      <div className={`bg-zinc-950/80 backdrop-blur-xl w-72 flex flex-col border-r border-zinc-800/80 transition-transform z-30 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full absolute h-full'}`}>
        <div className="p-6 border-b border-zinc-800/80 flex flex-col items-center">
          <div className="w-24 h-24 bg-white rounded-full p-1.5 mb-3 flex items-center justify-center overflow-hidden border border-zinc-800">
            <img src="/logo-sandygraphia.jpeg" alt="Logo" className="w-full h-full object-contain rounded-full" onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/150/ffffff/000000?text=SANDY+GRAPHIA'; }} />
          </div>
          <h1 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300 tracking-wider">i-PPIC PRO</h1>
          <p className="text-[10px] text-zinc-400 font-bold tracking-widest mt-1 uppercase text-center">CV Sandy Graphia</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1.5">
          <SidebarBtn id="dashboard" icon={LayoutDashboard} label="Dasbor EWS" />
          <SidebarBtn id="forecast" icon={TrendingUp} label="AI Demand Forecast" />
          <SidebarBtn id="mrp" icon={Calculator} label="MRP & BOM Engine" />
          <SidebarBtn id="wa" icon={Smartphone} label="WA Gateway PO" />
          <SidebarBtn id="ekotek" icon={PieChart} label="Analisis Finansial" />
          <SidebarBtn id="scanner" icon={ScanBarcode} label="Scanner Gudang" />
        </nav>
        
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/30">
           <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider text-center">Sistem Kendali Operasional Riil</p>
        </div>
      </div>

      {/* WORKSPACE CONTENT */}
      <div className="flex-1 flex flex-col h-screen relative">
        <header className="h-20 border-b border-zinc-800/80 flex items-center justify-between px-8 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-20">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-zinc-400 hover:text-white bg-zinc-900/80 p-2.5 rounded-xl border border-zinc-800"><Menu size={20} /></button>
          <div className="flex items-center gap-4">
            <button onClick={fetchDashboardData} className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white bg-zinc-900 px-4 py-2 rounded-full border border-zinc-800"><RefreshCw size={14}/> Sync Data</button>
            <div className={`px-4 py-1.5 ${ewsData ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'} border rounded-full text-xs font-semibold flex items-center gap-2`}>
              <span className="relative flex h-2 w-2"><span className={`relative inline-flex rounded-full h-2 w-2 ${ewsData ? 'bg-emerald-500' : 'bg-red-500'}`}></span></span> 
              {ewsData ? 'PostgreSQL Cloud Connected' : 'AI Node Disconnected'}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 md:p-10">
          
          {/* TAB 1: DASBOR EWS */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div>
                <h2 className="text-3xl font-black tracking-tight text-white">CV Sandy Graphia Control Room</h2>
                <p className="text-zinc-400 mt-1">Pemantauan rantai pasok material produksi kertas dan tinta otomatis.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-zinc-900/40 border border-zinc-800 p-6 rounded-2xl"><h3 className="text-zinc-400 text-sm mb-2">Total SKU Bahan</h3><p className="text-4xl font-black text-white">{ewsData?.total_item || 0} Item</p></div>
                <div className="bg-red-950/10 border border-red-900/30 p-6 rounded-2xl"><h3 className="text-red-400 text-sm mb-2">Peringatan Kritis EWS</h3><p className="text-4xl font-black text-red-500">{ewsData?.item_kritis || 0} SKU Defisit</p></div>
                <div className="bg-zinc-900/40 border border-zinc-800 p-6 rounded-2xl"><h3 className="text-zinc-400 text-sm mb-2">Sinkronisasi Jaringan</h3><p className="text-2xl font-bold text-emerald-400 mt-2">Optimal (Hugging Face)</p></div>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-8">
                <h3 className="text-lg font-bold mb-6">Tabel Kontrol Inventori Lapangan</h3>
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50"><tr><th className="px-6 py-4">Kode SKU</th><th className="px-6 py-4">Nama Material</th><th className="px-6 py-4 text-right">Stok Aktual</th><th className="px-6 py-4 text-right">Safety Stock</th><th className="px-6 py-4 text-center">Validasi Logistik</th></tr></thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {ewsData?.detail_kritis.map((k:any, i:number) => (
                      <tr key={i} className="hover:bg-zinc-800/30"><td className="px-6 py-5 font-mono text-zinc-400">{k.kode_produk}</td><td className="px-6 py-5 font-semibold text-zinc-200">{k.nama_produk}</td><td className="px-6 py-5 text-right font-bold text-red-400 text-base">{k.stok_aktual}</td><td className="px-6 py-5 text-right text-zinc-500">{k.safety_stock}</td><td className="px-6 py-5 text-center"><span className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-bold uppercase">Restock Required</span></td></tr>
                    ))}
                    {ewsData?.item_kritis === 0 && <tr><td colSpan={5} className="text-center py-10 text-zinc-500">Seluruh komponen inventori pabrik tercukupi dengan aman.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: FORECAST MODEL */}
          {activeTab === 'forecast' && (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-3xl font-black text-white">AI Demand Forecasting Center</h2>
              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-12 lg:col-span-4 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl h-fit">
                  <label className="text-xs text-zinc-400 font-bold mb-2 block">HISTORI PENJUALAN (Separasi Koma)</label>
                  <textarea value={historiInput} onChange={(e)=>setHistoriInput(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-white mb-4 h-24 font-mono text-sm" />
                  <label className="text-xs text-zinc-400 font-bold mb-2 block">ALGORITMA INTELLIGENT</label>
                  <select value={metodeForecast} onChange={(e)=>setMetodeForecast(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-emerald-400 font-bold mb-6">
                    <option value="Linear Regression">Linear Regression (Trend Dasar)</option>
                    <option value="Holt-Winters">Holt-Winters Exponential Smoothing (Kebal Pola Musiman)</option>
                  </select>
                  <button onClick={handleForecast} disabled={isForecasting} className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-xl font-bold">{isForecasting ? 'Memproses Matriks...' : 'Jalankan Proyeksi AI'}</button>
                </div>
                <div className="col-span-12 lg:col-span-8 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl min-h-[500px] flex flex-col">
                  {forecastResult ? (
                    <>
                      <h3 className="text-xl font-bold mb-6">Visualisasi Tren Pengadaan Masatama ({metodeForecast})</h3>
                      <div className="flex-1 min-h-[300px]"><ResponsiveContainer><LineChart data={forecastResult.chart}><CartesianGrid strokeDasharray="3 3" stroke="#27272a"/><XAxis dataKey="minggu" stroke="#71717a"/><YAxis stroke="#71717a"/><Tooltip contentStyle={{backgroundColor:'#18181b', borderColor:'#27272a' }}/><Legend/><Line type="monotone" dataKey="aktual" stroke="#3b82f6" strokeWidth={3} name="Data Riil Penjualan"/><Line type="monotone" dataKey="prediksi" stroke="#10b981" strokeWidth={3} strokeDasharray="5 5" name="Proyeksi SCM"/></LineChart></ResponsiveContainer></div>
                      <div className="mt-8 bg-purple-900/10 border border-purple-500/20 p-6 rounded-2xl">
                        <p className="text-purple-400 font-bold flex items-center gap-2 mb-2"><Bot size={16}/> Gemini Executive Strategic Insight</p><p className="text-zinc-200 text-sm leading-relaxed">{forecastResult.insight}</p>
                      </div>
                    </>
                  ) : (<div className="flex-1 flex items-center justify-center text-zinc-600 font-medium">Sistem menunggu komparasi data historis lapangan...</div>)}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MRP ENGINE */}
          {activeTab === 'mrp' && (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-3xl font-black text-white">BOM Explosion & Material Requirement Planning</h2>
              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-12 lg:col-span-4 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl h-fit space-y-6">
                  <div><label className="text-xs text-zinc-400 font-bold block mb-2">TARGET BARANG JADI</label><select value={selectedProduk} onChange={(e) => setSelectedProduk(Number(e.target.value))} className="w-full bg-zinc-950 border border-zinc-800 p-3.5 rounded-xl font-medium">{produkJadi.map(p => <option key={p.id_produk} value={p.id_produk}>{p.nama_produk}</option>)}</select></div>
                  <div><label className="text-xs text-zinc-400 font-bold block mb-2">GROSS REQUIREMENTS (MPS DATA)</label><input type="text" value={kebutuhanKotor} onChange={(e)=>setKebutuhanKotor(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 p-3.5 rounded-xl font-mono text-emerald-400 font-bold" /></div>
                  <div className="grid grid-cols-2 gap-4"><div><label className="text-xs text-zinc-400 font-bold block mb-2">METODE LOT-SIZING</label><select value={metode} onChange={(e)=>setMetode(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 p-3.5 rounded-xl"><option value="L4L">L4L (Lot For Lot)</option><option value="EOQ">EOQ (Quantity Discount)</option><option value="POQ">POQ (Period Lotting)</option><option value="FPR">FPR (Fixed Period)</option></select></div><div><label className="text-xs text-zinc-400 font-bold block mb-2">ALLOWANCE SCRAP (%)</label><input type="number" value={scrapFactor} onChange={(e)=>setScrapFactor(Number(e.target.value))} className="w-full bg-zinc-950 border border-zinc-800 p-3.5 rounded-xl" /></div></div>
                  <div><label className="text-xs text-purple-400 font-bold flex items-center gap-2 mb-2"><Bot size={14}/> NATURAL LANGUAGE CONSTRAINT</label><textarea value={teksKendala} onChange={(e)=>setTeksKendala(e.target.value)} className="w-full bg-purple-950/10 border border-purple-900/30 p-3.5 rounded-xl h-24 text-sm" placeholder="Cth: Minggu 1 vendor sedang kehabisan kontainer pengiriman" /></div>
                  <button onClick={handleHitungMRP} className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-xl font-bold shadow-lg">Kalkulasi Struktur Dinamis MRP</button>
                </div>
                
                <div className="col-span-12 lg:col-span-8 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl min-h-[600px]">
                  <h3 className="text-xl font-bold mb-6">Lembar Analisis Jadwal Induksi Material</h3>
                  {!mrpResult ? <div className="h-[400px] flex items-center justify-center text-zinc-600"><Calculator size={64} className="opacity-20"/></div> : (
                    <div className="space-y-8">
                      <div className="bg-purple-950/10 p-4 rounded-xl border border-purple-900/30 text-purple-300 text-sm font-medium flex gap-2"><Bot size={18} className="shrink-0 mt-0.5"/> {mrpResult.pesan_ai}</div>
                      {mrpResult.detail_mrp.map((h:any, i:number) => (
                        <div key={i} className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-950/50">
                          <div className="bg-zinc-900 p-4 border-b border-zinc-800 flex justify-between items-center"><h4 className="text-emerald-400 font-black tracking-wide">Bahan Baku Turunan: {h.bahan_baku}</h4><span className="text-xs font-bold bg-zinc-800 border border-zinc-700 text-zinc-300 px-4 py-1.5 rounded-full">Total Cost: Rp {h.total_biaya.toLocaleString()}</span></div>
                          <div className="overflow-x-auto p-4">
                            <table className="w-full text-sm text-center">
                              <thead className="text-xs text-zinc-500 border-b border-zinc-800/50"><tr><th className="text-left pb-3">Parameter Induk Logistik</th>{h.keb_kotor_bom.map((_:any, idx:number)=><th key={idx} className="pb-3">M-{idx+1}</th>)}</tr></thead>
                              <tbody className="divide-y divide-zinc-800/30 font-mono text-xs">
                                <tr><td className="text-left py-3.5 text-zinc-400 font-sans">Kebutuhan Kotor (+Scrap Allowance)</td>{h.keb_kotor_bom.map((v:any, idx:number)=><td key={idx} className="text-amber-400 font-bold">{v}</td>)}</tr>
                                <tr><td className="text-left py-3.5 text-zinc-400 font-sans">Persediaan Tersisa (Projected Available)</td>{h.proj_avail.map((v:any, idx:number)=><td key={idx} className="text-zinc-400">{v}</td>)}</tr>
                                <tr><td className="text-left py-3.5 text-zinc-400 font-sans">Jadwal Penerimaan Pesanan (Receipt)</td>{h.plan_receipt.map((v:any, idx:number)=><td key={idx} className="text-emerald-400 font-black">{v||'-'}</td>)}</tr>
                                <tr className="bg-blue-950/20"><td className="text-left py-3.5 font-bold text-blue-400 font-sans">Pelepasan Rilis Pesanan (Release)</td>{h.plan_release.map((v:any, idx:number)=><td key={idx} className="text-blue-400 font-black">{v||'-'}</td>)}</tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: WA GATEWAY INTEGRATION */}
          {activeTab === 'wa' && (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-3xl font-black">WhatsApp Gateway SCM - CV Sandy Graphia</h2>
              {!mrpResult ? <p className="text-zinc-500">Selesaikan perhitungan MRP Engine terlebih dahulu.</p> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {mrpResult.detail_mrp.map((h:any, i:number) => (
                    <div key={i} className="bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl flex flex-col justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-white mb-2">{h.bahan_baku}</h3>
                        <p className="text-zinc-500 text-xs mb-4">Draf pengadaan logistik mingguan ter-enkripsi otomatis:</p>
                        <div className="bg-zinc-950 p-4 rounded-xl font-mono text-xs text-zinc-400 border border-zinc-800/80 mb-6">
                          {h.plan_release.map((qty:number, w:number) => qty > 0 && <p key={w} className="text-zinc-300"> minggu ke-{w+1} : <span className="text-emerald-400 font-bold">{qty} Unit</span></p>)}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {vendorList.map(v => (
                          <button key={v.id_vendor} onClick={() => handleKirimWA(h.bahan_baku, h.plan_release, v.nomor_whatsapp)} className="w-full bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/30 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2"><Smartphone size={18}/> Transmit PO ke {v.nama_vendor}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: ANALISIS FINANSIAL KOMPREHENSIF (EKOTEK MULTI-METHOD) */}
          {activeTab === 'ekotek' && (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-3xl font-black text-white">Ekonomi Teknik & Kelayakan Total Cost Inventory</h2>
              {!mrpResult ? <p className="text-zinc-500">Eksekusi perhitungan MRP terlebih dahulu untuk memicu visualisasi multi-metode.</p> : (
                <div className="grid grid-cols-12 gap-8">
                  <div className="col-span-12 lg:col-span-4 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-emerald-950/40 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-400 mb-4 font-bold text-xl">Rp</div>
                    <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Biaya Komponen Terpilih</h3>
                    <p className="text-4xl font-black text-emerald-400">Rp {mrpResult.detail_mrp.reduce((s:number, i:any)=> s + i.total_biaya, 0).toLocaleString('id-ID')}</p>
                    <button onClick={mintaRekomendasiFinansial} disabled={isAnalisis} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl mt-6 transition-all flex justify-center gap-2 shadow-md">{isAnalisis ? 'AI Mengaudit Kelayakan...' : 'Minta Hasil Audit Konsultan AI'}</button>
                  </div>
                  
                  <div className="col-span-12 lg:col-span-8 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl flex flex-col">
                    <h3 className="text-xl font-bold text-white mb-6">Grafik Komparasi Efisiensi Total Inventory Cost (4 Metode Sekaligus)</h3>
                    <div className="flex-1 min-h-[300px]">
                      <ResponsiveContainer>
                        <BarChart data={mrpResult.perbandingan_ekotek} margin={{top: 10, right: 10, left: 10, bottom: 5}}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a"/><XAxis dataKey="bahan" stroke="#a1a1aa"/><YAxis stroke="#a1a1aa"/><Tooltip contentStyle={{backgroundColor:'#18181b', borderColor:'#27272a' }}/><Legend />
                          <Bar dataKey="L4L" fill="#ef4444" name="Lot For Lot (L4L)" />
                          <Bar dataKey="EOQ" fill="#10b981" name="Economic Order Qty (EOQ)" />
                          <Bar dataKey="POQ" fill="#3b82f6" name="Period Order Qty (POQ)" />
                          <Bar dataKey="FPR" fill="#f59e0b" name="Fixed Period (FPR)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  
                  {rekomendasiFinansial && (
                    <div className="col-span-12 bg-purple-950/10 border border-purple-900/30 p-6 rounded-2xl border-l-4 border-l-purple-500">
                      <p className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><Bot size={16}/> AI Manajerial Advisor Decision Support System</p>
                      <p className="text-zinc-200 text-sm leading-relaxed font-medium">{rekomendasiFinansial}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: SCANNER BARCODE */}
          {activeTab === 'scanner' && (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-3xl font-black text-white">Automasi Pemindaian Barcode Material Masuk</h2>
              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-12 lg:col-span-6 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl flex flex-col items-center justify-center">
                  <div id="reader" className="w-full max-w-md bg-black rounded-2xl overflow-hidden border border-dashed border-emerald-500/40"></div>
                </div>
                <div className="col-span-12 lg:col-span-6 bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl flex flex-col justify-center">
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><CheckCircle2 className="text-emerald-400"/> Sistem Validasi Gudang Otomatis</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    Saat gulungan bahan cetak baru datang dari supplier, posisikan barcode **BB-01** (Flexi Banner) atau **BB-02** (Tinta Cyan) ke depan kamera laptop/smartphone. Sistem akan langsung memperbarui database cloud PostgreSQL secara seketika (*real-time*) tanpa input data manual komputer.
                  </p>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}