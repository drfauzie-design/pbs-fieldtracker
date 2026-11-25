import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  MapPin,
  Plus,
  Send,
  ShoppingBag,
  Store,
  Trash2,
} from 'lucide-react';
import { GpsPosition } from '../hooks/useGeolocation';
import { QueuedAction } from '../hooks/useOfflineQueue';
import {
  DailyReportType,
  LightboxPhoto,
  MyTodayResponse,
  Product,
  User,
} from '../types';
import { apiFetch } from '../utils/api';
import { formatDateTimeWIB, formatRupiah } from '../utils/format';
import { CameraCaptureModal } from './CameraCaptureModal';
import { MultiPhotoPicker, StagedPhoto } from './MultiPhotoPicker';

interface SalesLineItem {
  key: string;
  productId: string;
  quantity: string;
  unitPrice: string;
}

interface ExpenseLineItem {
  key: string;
  name: string;
  amount: string;
}

interface DailyReportPanelsProps {
  user: User;
  products: Product[];
  todayData: MyTodayResponse | null;
  gpsPosition: GpsPosition | null;
  refreshPosition: () => Promise<GpsPosition>;
  isOnline: boolean;
  enqueueOffline: (item: Omit<QueuedAction, 'id' | 'queuedAt'>) => void;
  onSubmitted: () => Promise<void>;
  onFeedback: (fb: { type: 'ok' | 'err'; text: string } | null) => void;
  onOpenPhoto: (photo: LightboxPhoto) => void;
  forcedMode?: DailyReportType;
  hideModeSelector?: boolean;
}

function getDefaultMode(category?: User['employeeCategory']): DailyReportType {
  if (category === 'SPG/SPB') return 'spg_stay';
  if (category === 'Event') return 'event';
  return 'spg_mobile';
}

export const DailyReportPanels: React.FC<DailyReportPanelsProps> = ({
  user,
  products,
  todayData,
  gpsPosition,
  refreshPosition,
  isOnline,
  enqueueOffline,
  onSubmitted,
  onFeedback,
  onOpenPhoto,
  forcedMode,
  hideModeSelector = false,
}) => {
  const [mode, setMode] = useState<DailyReportType>(
    () => forcedMode || getDefaultMode(user.employeeCategory)
  );
  useEffect(() => {
    if (forcedMode) {
      setMode(forcedMode);
    }
  }, [forcedMode]);

  const [submitting, setSubmitting] = useState(false);
  const allowPriceAdjustment = todayData?.targets.allowPriceAdjustment ?? false;

  // Camera modal for Multi-Photo or Event Transaction Proof
  const [camModal, setCamModal] = useState<{
    open: boolean;
    target: 'stay_activity' | 'mobile_activity' | 'event_activity' | 'event_tx';
    title: string;
    label: string;
  }>({ open: false, target: 'stay_activity', title: '', label: '' });

  // ===== 1. SPG/SPB STAY STATE =====
  const [stayOutlet, setStayOutlet] = useState('');
  const [stayNotes, setStayNotes] = useState('');
  const [stayFieldNotes, setStayFieldNotes] = useState('');
  const [stayProductSearch, setStayProductSearch] = useState('');
  const [stayItems, setStayItems] = useState<SalesLineItem[]>([
    { key: 'stay_1', productId: '', quantity: '1', unitPrice: '' },
  ]);
  const [stayPhotos, setStayPhotos] = useState<StagedPhoto[]>([]);

  // ===== 2. SMD / MOBILE STATE =====
  const [mobClient, setMobClient] = useState('');
  const [mobStatus, setMobStatus] = useState<'Selesai' | 'Tertunda' | 'Butuh Tindak Lanjut'>('Selesai');
  const [mobNotes, setMobNotes] = useState('');
  const [mobOfferNotes, setMobOfferNotes] = useState('');
  const [mobFieldNotes, setMobFieldNotes] = useState('');
  const [mobProductSearch, setMobProductSearch] = useState('');
  const [mobItems, setMobItems] = useState<SalesLineItem[]>([]);
  const [mobPhotos, setMobPhotos] = useState<StagedPhoto[]>([]);

  // ===== 3. EVENT STATE =====
  const [evName, setEvName] = useState('');
  const [evTargetSales, setEvTargetSales] = useState('');
  const [evRealizedSales, setEvRealizedSales] = useState('');
  const [evTargetVisitors, setEvTargetVisitors] = useState('');
  const [evRealizedVisitors, setEvRealizedVisitors] = useState('');
  const [evExpenses, setEvExpenses] = useState<ExpenseLineItem[]>([
    { key: 'exp_1', name: '', amount: '' },
  ]);
  const [evTxPhoto, setEvTxPhoto] = useState<StagedPhoto | null>(null);
  const [evActivityPhotos, setEvActivityPhotos] = useState<StagedPhoto[]>([]);
  const [evObstacles, setEvObstacles] = useState('');
  const [evSuggestions, setEvSuggestions] = useState('');
  const [evFieldNotes, setEvFieldNotes] = useState('');

  const productMap = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products]
  );

  const filterProducts = (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  };

  const stayFilteredProducts = useMemo(
    () => filterProducts(stayProductSearch),
    [products, stayProductSearch]
  );
  const mobFilteredProducts = useMemo(
    () => filterProducts(mobProductSearch),
    [products, mobProductSearch]
  );

  const computeLineTotals = (items: SalesLineItem[]) => {
    let totalQty = 0;
    let totalAmount = 0;
    for (const it of items) {
      const p = productMap.get(it.productId);
      if (!p) continue;
      const qty = Math.max(0, Math.round(Number(it.quantity || 0)));
      const price =
        allowPriceAdjustment && it.unitPrice !== ''
          ? Math.max(0, Math.round(Number(it.unitPrice || 0)))
          : p.unitPrice;
      totalQty += qty;
      totalAmount += qty * price;
    }
    return { totalQty, totalAmount };
  };

  const stayTotals = useMemo(
    () => computeLineTotals(stayItems),
    [stayItems, productMap, allowPriceAdjustment]
  );
  const mobTotals = useMemo(
    () => computeLineTotals(mobItems),
    [mobItems, productMap, allowPriceAdjustment]
  );

  const evTotalExpense = useMemo(
    () =>
      evExpenses.reduce(
        (sum, ex) => sum + Math.max(0, Math.round(Number(ex.amount || 0))),
        0
      ),
    [evExpenses]
  );

  const evSalesPct = useMemo(() => {
    const t = Number(evTargetSales || 0);
    const r = Number(evRealizedSales || 0);
    return t > 0 ? Math.round((r / t) * 100) : 0;
  }, [evTargetSales, evRealizedSales]);

  const evVisitorPct = useMemo(() => {
    const t = Number(evTargetVisitors || 0);
    const r = Number(evRealizedVisitors || 0);
    return t > 0 ? Math.round((r / t) * 100) : 0;
  }, [evTargetVisitors, evRealizedVisitors]);

  const updateLineItem = (
    setter: React.Dispatch<React.SetStateAction<SalesLineItem[]>>,
    key: string,
    patch: Partial<SalesLineItem>
  ) => {
    setter((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        if (patch.productId !== undefined) {
          const p = productMap.get(patch.productId);
          next.unitPrice = p ? String(p.unitPrice) : '';
        }
        return next;
      })
    );
  };

  const handleCameraConfirm = (dataUrl: string, capturedAt: string) => {
    const target = camModal.target;
    setCamModal((prev) => ({ ...prev, open: false }));
    const photo: StagedPhoto = { dataUrl, capturedAt };

    if (target === 'stay_activity') setStayPhotos((p) => [...p, photo]);
    else if (target === 'mobile_activity') setMobPhotos((p) => [...p, photo]);
    else if (target === 'event_activity') setEvActivityPhotos((p) => [...p, photo]);
    else if (target === 'event_tx') setEvTxPhoto(photo);
  };

  const dispatchDailyReport = async (payload: Record<string, any>, label: string, resetFn: () => void) => {
    setSubmitting(true);
    onFeedback(null);
    try {
      if (!isOnline) {
        enqueueOffline({ kind: 'daily_report', payload, label });
        onFeedback({
          type: 'ok',
          text: `Mode Offline: "${label}" masuk antrean dan akan tersinkron otomatis saat online.`,
        });
        resetFn();
      } else {
        await apiFetch('/api/daily-reports', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onFeedback({ type: 'ok', text: `${label} berhasil disimpan ke sistem!` });
        resetFn();
        await onSubmitted();
      }
    } catch (err: any) {
      if (!err?.status) {
        enqueueOffline({ kind: 'daily_report', payload, label });
        onFeedback({
          type: 'ok',
          text: `Koneksi tersendat. "${label}" disimpan ke antrean offline.`,
        });
        resetFn();
      } else {
        onFeedback({ type: 'err', text: err.message || 'Gagal mengirim laporan harian.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitStay = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = stayItems
      .filter((it) => it.productId && Math.round(Number(it.quantity)) > 0)
      .map((it) => ({
        productId: Number(it.productId),
        quantity: Math.round(Number(it.quantity)),
        unitPrice: allowPriceAdjustment && it.unitPrice !== '' ? Number(it.unitPrice) : undefined,
      }));

    if (validItems.length === 0) {
      onFeedback({ type: 'err', text: 'Pilih minimal 1 produk terjual dengan Qty minimal 1.' });
      return;
    }

    let pos = gpsPosition;
    if (!pos) {
      pos = await refreshPosition().catch(() => null);
    }

    await dispatchDailyReport(
      {
        reportType: 'spg_stay',
        clientName: stayOutlet.trim() || 'Outlet / Stand SPG/SPB',
        notes: stayNotes.trim(),
        fieldNotes: stayFieldNotes.trim(),
        items: validItems,
        activityPhotos: stayPhotos,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy: pos?.accuracy ?? null,
        reportedAt: new Date().toISOString(),
      },
      `Laporan SPG/SPB (${validItems.length} item · ${formatRupiah(stayTotals.totalAmount)})`,
      () => {
        setStayNotes('');
        setStayFieldNotes('');
        setStayItems([{ key: `stay_${Date.now()}`, productId: '', quantity: '1', unitPrice: '' }]);
        setStayPhotos([]);
      }
    );
  };

  const handleSubmitMobile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobClient.trim()) {
      onFeedback({ type: 'err', text: 'Nama toko / klien / lokasi tujuan wajib diisi.' });
      return;
    }

    let pos = gpsPosition;
    if (!pos) {
      pos = await refreshPosition().catch(() => null);
    }

    const validItems = mobItems
      .filter((it) => it.productId && Math.round(Number(it.quantity)) > 0)
      .map((it) => ({
        productId: Number(it.productId),
        quantity: Math.round(Number(it.quantity)),
        unitPrice: allowPriceAdjustment && it.unitPrice !== '' ? Number(it.unitPrice) : undefined,
      }));

    await dispatchDailyReport(
      {
        reportType: 'spg_mobile',
        clientName: mobClient.trim(),
        visitStatus: mobStatus,
        offerNotes: mobOfferNotes.trim(),
        notes: mobNotes.trim(),
        fieldNotes: mobFieldNotes.trim(),
        items: validItems,
        activityPhotos: mobPhotos,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy: pos?.accuracy ?? null,
        reportedAt: new Date().toISOString(),
      },
      `Laporan ${user.employeeCategory === 'Leader/SPV' ? 'Leader/SPV' : 'SMD'}: ${mobClient.trim()}`,
      () => {
        setMobClient('');
        setMobStatus('Selesai');
        setMobNotes('');
        setMobOfferNotes('');
        setMobFieldNotes('');
        setMobItems([]);
        setMobPhotos([]);
      }
    );
  };

  const handleSubmitEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evName.trim()) {
      onFeedback({ type: 'err', text: 'Nama Kegiatan Event wajib diisi.' });
      return;
    }

    let pos = gpsPosition;
    if (!pos) {
      pos = await refreshPosition().catch(() => null);
    }

    const cleanExpenses = evExpenses
      .filter((ex) => ex.name.trim() || Number(ex.amount) > 0)
      .map((ex) => ({
        name: ex.name.trim() || 'Biaya Lainnya',
        amount: Math.max(0, Math.round(Number(ex.amount || 0))),
      }));

    await dispatchDailyReport(
      {
        reportType: 'event',
        eventName: evName.trim(),
        targetSalesAmount: Math.max(0, Math.round(Number(evTargetSales || 0))),
        realizedSalesAmount: Math.max(0, Math.round(Number(evRealizedSales || 0))),
        targetVisitors: Math.max(0, Math.round(Number(evTargetVisitors || 0))),
        realizedVisitors: Math.max(0, Math.round(Number(evRealizedVisitors || 0))),
        expenses: cleanExpenses,
        transactionProofPhoto: evTxPhoto,
        activityPhotos: evActivityPhotos,
        obstacles: evObstacles.trim(),
        suggestions: evSuggestions.trim(),
        fieldNotes: evFieldNotes.trim(),
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy: pos?.accuracy ?? null,
        reportedAt: new Date().toISOString(),
      },
      `Laporan Event: ${evName.trim()}`,
      () => {
        setEvName('');
        setEvTargetSales('');
        setEvRealizedSales('');
        setEvTargetVisitors('');
        setEvRealizedVisitors('');
        setEvExpenses([{ key: `exp_${Date.now()}`, name: '', amount: '' }]);
        setEvTxPhoto(null);
        setEvActivityPhotos([]);
        setEvObstacles('');
        setEvSuggestions('');
        setEvFieldNotes('');
      }
    );
  };

  const renderProductLineRows = (
    items: SalesLineItem[],
    setter: React.Dispatch<React.SetStateAction<SalesLineItem[]>>,
    filteredList: Product[],
    searchVal: string,
    setSearchVal: (v: string) => void
  ) => (
    <div className="space-y-3">
      <input
        type="text"
        value={searchVal}
        onChange={(e) => setSearchVal(e.target.value)}
        placeholder="Filter produk berdasarkan SKU, nama, atau kategori..."
        className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3.5 text-sm text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none"
      />

      {items.map((item, idx) => {
        const prod = productMap.get(item.productId);
        const qty = Math.max(0, Math.round(Number(item.quantity || 0)));
        const price =
          prod && allowPriceAdjustment && item.unitPrice !== ''
            ? Math.max(0, Math.round(Number(item.unitPrice || 0)))
            : prod?.unitPrice || 0;
        const subtotal = qty * price;

        return (
          <div
            key={item.key}
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-slate-700">Item Produk #{idx + 1}</span>
              <button
                type="button"
                onClick={() => setter((prev) => prev.filter((r) => r.key !== item.key))}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Hapus</span>
              </button>
            </div>

            <select
              value={item.productId}
              onChange={(e) => updateLineItem(setter, item.key, { productId: e.target.value })}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
            >
              <option value="">-- Pilih Produk ({filteredList.length} tersedia) --</option>
              {filteredList.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  [{p.sku}] {p.name} — {formatRupiah(p.unitPrice)} / {p.unit}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700">
                  Qty {prod ? `(${prod.unit})` : ''}
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={item.quantity}
                  onChange={(e) => updateLineItem(setter, item.key, { quantity: e.target.value })}
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-bold text-slate-950 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700">
                  Harga Satuan {allowPriceAdjustment ? '(Promo/Edit)' : ''}
                </label>
                <input
                  type="number"
                  min={0}
                  disabled={!allowPriceAdjustment || !prod}
                  value={prod ? item.unitPrice : ''}
                  onChange={(e) => updateLineItem(setter, item.key, { unitPrice: e.target.value })}
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-bold text-slate-950 disabled:bg-slate-100 disabled:text-slate-600 tabular-nums"
                />
              </div>

              <div className="col-span-2 sm:col-span-1 flex flex-col justify-end">
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                  <div className="text-[10px] font-bold text-slate-600">Subtotal Item</div>
                  <div className="font-mono text-sm font-extrabold text-orange-700 tabular-nums">
                    {formatRupiah(subtotal)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() =>
          setter((prev) => [
            ...prev,
            { key: `item_${Date.now()}_${Math.random()}`, productId: '', quantity: '1', unitPrice: '' },
          ])
        }
        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-orange-400 bg-orange-50 px-4 py-2 text-xs sm:text-sm font-extrabold text-orange-800 hover:bg-orange-100"
      >
        <Plus className="h-4 w-4" />
        <span>Tambah Item Produk</span>
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Mode Selector Header */}
      {!hideModeSelector && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-950">
                Pilih Jenis Laporan Harian
              </h2>
              <p className="text-xs text-slate-600">
                Total penjualan dari SPG/SPB, SMD / Lapangan, dan Event otomatis terakumulasi ke target &amp; rekap harian.
              </p>
            </div>
            <span className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-900">
              Kategori Anda: {user.employeeCategory}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setMode('spg_stay')}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
                mode === 'spg_stay'
                  ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                  : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
              }`}
            >
              <Store className={`h-5 w-5 shrink-0 ${mode === 'spg_stay' ? 'text-amber-300' : 'text-orange-600'}`} />
              <div>
                <div className="text-sm font-extrabold">1. SPG/SPB (Stay / Outlet)</div>
                <div className={`text-[11px] ${mode === 'spg_stay' ? 'text-orange-100' : 'text-slate-600'}`}>
                  Multi-item produk &amp; multi-foto kegiatan
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode('spg_mobile')}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
                mode === 'spg_mobile'
                  ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                  : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
              }`}
            >
              <MapPin className={`h-5 w-5 shrink-0 ${mode === 'spg_mobile' ? 'text-amber-300' : 'text-orange-600'}`} />
              <div>
                <div className="text-sm font-extrabold">2. SMD / Lapangan</div>
                <div className={`text-[11px] ${mode === 'spg_mobile' ? 'text-orange-100' : 'text-slate-600'}`}>
                  Kunjungan, penawaran, penjualan &amp; multi-foto
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode('event')}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
                mode === 'event'
                  ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                  : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
              }`}
            >
              <CalendarCheck className={`h-5 w-5 shrink-0 ${mode === 'event' ? 'text-amber-300' : 'text-orange-600'}`} />
              <div>
                <div className="text-sm font-extrabold">3. Event</div>
                <div className={`text-[11px] ${mode === 'event' ? 'text-orange-100' : 'text-slate-600'}`}>
                  Target/realisasi, rincian biaya &amp; evaluasi
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Main Structured Form */}
        <div className="lg:col-span-8">
          {/* ========== MODE 1: SPG/SPB STAY ========== */}
          {mode === 'spg_stay' && (
            <form
              onSubmit={handleSubmitStay}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-950">
                    Laporan Harian — SPG/SPB (Stay / Outlet)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Catat penjualan multi-produk di outlet/stand beserta dokumentasi multi-foto kegiatan &amp; catatan lapangan.
                  </p>
                </div>
                <span className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-900">
                  {user.employeeCategory}
                </span>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Nama Outlet / Lokasi Stand
                </label>
                <input
                  type="text"
                  value={stayOutlet}
                  onChange={(e) => setStayOutlet(e.target.value)}
                  placeholder="Contoh: Supermarket Berkah Cabang Timur"
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">
                    Daftar Produk Terjual (Multi-Item)
                  </span>
                  <span className="font-mono text-xs font-bold text-orange-700">
                    {stayTotals.totalQty} unit
                  </span>
                </div>
                {products.length === 0 ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
                    Master produk kosong. Minta Admin menambahkan master produk terlebih dahulu.
                  </div>
                ) : (
                  renderProductLineRows(
                    stayItems,
                    setStayItems,
                    stayFilteredProducts,
                    stayProductSearch,
                    setStayProductSearch
                  )
                )}
              </div>

              <div className="rounded-xl border border-amber-400 bg-slate-900 p-4 text-white flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-amber-400">
                    Total Penjualan Keseluruhan (Otomatis)
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    Total Qty: <span className="font-mono font-bold">{stayTotals.totalQty}</span> unit
                  </div>
                </div>
                <div className="font-mono text-xl sm:text-2xl font-extrabold text-white tabular-nums">
                  {formatRupiah(stayTotals.totalAmount)}
                </div>
              </div>

              <MultiPhotoPicker
                label="Upload Multi-Foto Kegiatan SPG/SPB"
                helperText="Stempel waktu & GPS otomatis"
                photos={stayPhotos}
                onChange={setStayPhotos}
                userName={user.fullName}
                activityLabel={`SPG/SPB: ${stayOutlet || 'Stand'}`}
                gpsPosition={gpsPosition}
                onOpenCamera={() =>
                  setCamModal({
                    open: true,
                    target: 'stay_activity',
                    title: 'Foto Kegiatan SPG/SPB',
                    label: `SPG/SPB: ${stayOutlet || 'Stand'}`,
                  })
                }
                onOpenPhoto={onOpenPhoto}
              />

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Catatan Transaksi / Display (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={stayNotes}
                  onChange={(e) => setStayNotes(e.target.value)}
                  placeholder="Contoh: Stok display aman, promo bundling diminati."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <label className="block text-sm font-extrabold text-slate-900">
                  Catatan Lapangan (Respon Konsumen / Stok Kosong / Kompetitor)
                </label>
                <textarea
                  rows={2}
                  value={stayFieldNotes}
                  onChange={(e) => setStayFieldNotes(e.target.value)}
                  placeholder="Catat temuan lapangan penting dari outlet hari ini..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || products.length === 0}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
              >
                <Send className="h-4 w-4" />
                <span>{submitting ? 'Menyimpan...' : 'Kirim Laporan SPG/SPB'}</span>
              </button>
            </form>
          )}

          {/* ========== MODE 2: SMD / LEADER/SPV MOBILE ========== */}
          {mode === 'spg_mobile' && (
            <form
              onSubmit={handleSubmitMobile}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-950">
                    {user.employeeCategory === 'Leader/SPV'
                      ? 'Laporan Lapangan — Leader / SPV'
                      : 'Laporan Harian — SMD (Sales Merchandiser)'}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Mencakup Laporan Kunjungan, Penawaran, Penjualan Produk, Multi-Foto Kegiatan, dan Catatan Lapangan.
                  </p>
                </div>
                <span className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-900">
                  {user.employeeCategory}
                </span>
              </div>

              {/* 2A. Kunjungan */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
                  1. Laporan Kunjungan
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-900">
                      Nama Toko / Klien / Lokasi Tujuan *
                    </label>
                    <input
                      type="text"
                      required
                      value={mobClient}
                      onChange={(e) => setMobClient(e.target.value)}
                      placeholder="Contoh: Toko Sembako Makmur"
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-900">
                      Status Kunjungan
                    </label>
                    <select
                      value={mobStatus}
                      onChange={(e) => setMobStatus(e.target.value as any)}
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                    >
                      <option value="Selesai">Selesai</option>
                      <option value="Tertunda">Tertunda</option>
                      <option value="Butuh Tindak Lanjut">Butuh Tindak Lanjut</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900">
                    Catatan Kunjungan
                  </label>
                  <textarea
                    rows={2}
                    value={mobNotes}
                    onChange={(e) => setMobNotes(e.target.value)}
                    placeholder="Contoh: Display rak depan dirapikan, stok minyak goreng menipis."
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* 2B. Penawaran */}
              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
                  2. Laporan Penawaran
                </h4>
                <textarea
                  rows={2}
                  value={mobOfferNotes}
                  onChange={(e) => setMobOfferNotes(e.target.value)}
                  placeholder="Tuliskan produk / program promo / penawaran harga yang disampaikan ke klien..."
                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              {/* 2C. Penjualan */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
                    3. Laporan Penjualan (Opsional jika ada transaksi)
                  </h4>
                  <span className="font-mono text-xs font-extrabold text-orange-700">
                    {mobTotals.totalQty} unit · {formatRupiah(mobTotals.totalAmount)}
                  </span>
                </div>
                {products.length > 0 &&
                  renderProductLineRows(
                    mobItems,
                    setMobItems,
                    mobFilteredProducts,
                    mobProductSearch,
                    setMobProductSearch
                  )}
              </div>

              {/* 2D. Multi-Foto */}
              <MultiPhotoPicker
                label="4. Upload Multi-Foto Kegiatan (Kunjungan / Penawaran / Display)"
                helperText="Bisa lampirkan lebih dari 1 foto"
                photos={mobPhotos}
                onChange={setMobPhotos}
                userName={user.fullName}
                activityLabel={`SMD Mobile: ${mobClient || 'Klien'}`}
                gpsPosition={gpsPosition}
                onOpenCamera={() =>
                  setCamModal({
                    open: true,
                    target: 'mobile_activity',
                    title: 'Foto Kegiatan Lapangan',
                    label: `Lapangan: ${mobClient || 'Klien'}`,
                  })
                }
                onOpenPhoto={onOpenPhoto}
              />

              {/* 2E. Catatan Lapangan */}
              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <label className="block text-sm font-extrabold text-slate-900">
                  5. Catatan Lapangan (
                  {user.employeeCategory === 'Leader/SPV'
                    ? 'Pemantauan Tim / Kompetitor / Kondisi Pasar'
                    : 'Info Kompetitor / Kondisi Display / Peluang'}
                  )
                </label>
                <textarea
                  rows={2}
                  value={mobFieldNotes}
                  onChange={(e) => setMobFieldNotes(e.target.value)}
                  placeholder="Catat kondisi pasar, harga kompetitor, stok, atau tindak lanjut tim..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
              >
                <Send className="h-4 w-4" />
                <span>
                  {submitting
                    ? 'Menyimpan...'
                    : user.employeeCategory === 'Leader/SPV'
                    ? 'Kirim Laporan Lapangan'
                    : 'Kirim Laporan SMD'}
                </span>
              </button>
            </form>
          )}

          {/* ========== MODE 3: EVENT ========== */}
          {mode === 'event' && (
            <form
              onSubmit={handleSubmitEvent}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-950">
                    Laporan Harian — Event
                  </h3>
                  <p className="text-xs text-slate-600">
                    Catat target &amp; realisasi penjualan, pengunjung, rincian biaya, bukti transaksi, foto kegiatan, serta kendala/saran.
                  </p>
                </div>
                <span className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-900">
                  {user.employeeCategory}
                </span>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Nama Kegiatan Event *
                </label>
                <input
                  type="text"
                  required
                  value={evName}
                  onChange={(e) => setEvName(e.target.value)}
                  placeholder="Contoh: Bazaar Pangan Murah Lapangan Merdeka"
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              {/* Target & Realisasi Penjualan */}
              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
                    Penjualan Event (Rp)
                  </span>
                  <span className="font-mono text-xs font-extrabold text-orange-700">
                    Pencapaian: {evSalesPct}% (Selisih:{' '}
                    {formatRupiah(Number(evRealizedSales || 0) - Number(evTargetSales || 0))})
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-800">
                      Target Penjualan (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={evTargetSales}
                      onChange={(e) => setEvTargetSales(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm font-bold text-slate-950 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-800">
                      Realisasi Penjualan (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={evRealizedSales}
                      onChange={(e) => setEvRealizedSales(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm font-bold text-slate-950 tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {/* Target & Realisasi Pengunjung */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
                    Jumlah Pengunjung Event
                  </span>
                  <span className="font-mono text-xs font-extrabold text-blue-900">
                    Pencapaian: {evVisitorPct}%
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-800">
                      Target Pengunjung (Orang)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={evTargetVisitors}
                      onChange={(e) => setEvTargetVisitors(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm font-bold text-slate-950 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-800">
                      Realisasi Pengunjung (Orang)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={evRealizedVisitors}
                      onChange={(e) => setEvRealizedVisitors(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm font-bold text-slate-950 tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {/* Rincian Biaya Event */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-900">Rincian Biaya Event</label>
                  <span className="font-mono text-sm font-extrabold text-slate-950 tabular-nums">
                    Total Biaya: {formatRupiah(evTotalExpense)}
                  </span>
                </div>
                {evExpenses.map((ex, idx) => (
                  <div key={ex.key} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      value={ex.name}
                      onChange={(e) =>
                        setEvExpenses((prev) =>
                          prev.map((r) => (r.key === ex.key ? { ...r, name: e.target.value } : r))
                        )
                      }
                      placeholder={`Pos biaya #${idx + 1} (mis. Sewa Tenda / Banner)`}
                      className="col-span-6 sm:col-span-7 min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm text-slate-950"
                    />
                    <input
                      type="number"
                      min={0}
                      value={ex.amount}
                      onChange={(e) =>
                        setEvExpenses((prev) =>
                          prev.map((r) => (r.key === ex.key ? { ...r, amount: e.target.value } : r))
                        )
                      }
                      placeholder="Nominal Rp"
                      className="col-span-4 sm:col-span-4 min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm font-bold text-slate-950 tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEvExpenses((prev) => prev.filter((r) => r.key !== ex.key))
                      }
                      className="col-span-2 sm:col-span-1 flex h-[42px] items-center justify-center rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                      title="Hapus pos biaya"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setEvExpenses((prev) => [
                      ...prev,
                      { key: `exp_${Date.now()}_${Math.random()}`, name: '', amount: '' },
                    ])
                  }
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Tambah Pos Biaya</span>
                </button>
              </div>

              {/* Bukti Transaksi Foto */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-900">
                  Upload Bukti Transaksi Event (Foto)
                </label>
                {evTxPhoto ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenPhoto({
                          url: evTxPhoto.dataUrl,
                          title: `Bukti Transaksi · ${evName || 'Event'}`,
                          lat: gpsPosition?.lat,
                          lng: gpsPosition?.lng,
                        })
                      }
                      className="h-16 w-20 overflow-hidden rounded-lg border border-slate-300 bg-black shrink-0"
                    >
                      <img src={evTxPhoto.dataUrl} alt="Bukti transaksi" className="h-full w-full object-cover" />
                    </button>
                    <div className="flex-1 text-xs font-semibold text-emerald-800">
                      Foto bukti transaksi berstempel siap dikirim
                    </div>
                    <button
                      type="button"
                      onClick={() => setEvTxPhoto(null)}
                      className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                    >
                      Hapus
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setCamModal({
                        open: true,
                        target: 'event_tx',
                        title: 'Foto Bukti Transaksi Event',
                        label: `Bukti Transaksi: ${evName || 'Event'}`,
                      })
                    }
                    className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border border-dashed border-slate-400 bg-slate-50 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-800 hover:bg-slate-100"
                  >
                    <span>Ambil / Unggah Foto Bukti Transaksi</span>
                  </button>
                )}
              </div>

              {/* Multi-Foto Kegiatan Event */}
              <MultiPhotoPicker
                label="Upload Multi-Foto Kegiatan Event"
                helperText="Stempel waktu & GPS otomatis"
                photos={evActivityPhotos}
                onChange={setEvActivityPhotos}
                userName={user.fullName}
                activityLabel={`Event: ${evName || 'Kegiatan'}`}
                gpsPosition={gpsPosition}
                onOpenCamera={() =>
                  setCamModal({
                    open: true,
                    target: 'event_activity',
                    title: 'Foto Kegiatan Event',
                    label: `Event: ${evName || 'Kegiatan'}`,
                  })
                }
                onOpenPhoto={onOpenPhoto}
              />

              {/* Kendala & Saran Perbaikan */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-bold text-slate-900">Kendala</label>
                  <textarea
                    rows={3}
                    value={evObstacles}
                    onChange={(e) => setEvObstacles(e.target.value)}
                    placeholder="Catat kendala operasional, cuaca, stok, dll..."
                    className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-900">
                    Saran &amp; Perbaikan
                  </label>
                  <textarea
                    rows={3}
                    value={evSuggestions}
                    onChange={(e) => setEvSuggestions(e.target.value)}
                    placeholder="Masukan perbaikan untuk event berikutnya..."
                    className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <label className="block text-sm font-extrabold text-slate-900">
                  Catatan Lapangan Event (Antusiasme Pengunjung / Logistik / Kompetitor)
                </label>
                <textarea
                  rows={2}
                  value={evFieldNotes}
                  onChange={(e) => setEvFieldNotes(e.target.value)}
                  placeholder="Catat kondisi lapangan penting selama kegiatan event..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
              >
                <Send className="h-4 w-4" />
                <span>{submitting ? 'Menyimpan...' : 'Kirim Laporan Event'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Right Summary Panel */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-2xl border border-amber-400 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-950">
                Akumulasi Penjualan Hari Ini
              </h3>
              <ShoppingBag className="h-5 w-5 text-orange-600" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                <div className="text-xs font-medium text-slate-600">Total Qty</div>
                <div className="mt-1 font-mono text-2xl font-extrabold text-slate-950 tabular-nums">
                  {todayData?.salesSummary.totalQty ?? 0}
                </div>
              </div>
              <div className="rounded-xl bg-slate-900 p-3.5 text-white">
                <div className="text-xs font-medium text-amber-400">Total Omzet (Rp)</div>
                <div className="mt-1 font-mono text-base sm:text-lg font-extrabold tabular-nums">
                  {formatRupiah(todayData?.salesSummary.totalAmount ?? 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="text-sm font-extrabold text-slate-950">
              Laporan Harian Terkirim Hari Ini ({todayData?.dailyReports?.length ?? 0})
            </h3>
            {!todayData?.dailyReports?.length ? (
              <p className="mt-3 text-xs text-slate-500">
                Belum ada laporan SPG/SPB, SMD, atau Event hari ini.
              </p>
            ) : (
              <div className="mt-3 space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {todayData.dailyReports.map((dr) => (
                  <div
                    key={dr.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-orange-700">
                        {dr.reportType === 'spg_stay'
                          ? 'SPG/SPB'
                          : dr.reportType === 'spg_mobile'
                          ? 'SMD / Lapangan'
                          : 'Event'}
                      </span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatRupiah(
                          dr.reportType === 'event' ? dr.realizedSalesAmount : dr.totalSalesAmount
                        )}
                      </span>
                    </div>
                    <div className="font-bold text-slate-950">
                      {dr.eventName || dr.clientName}
                    </div>
                    {dr.fieldNotes && (
                      <div className="text-[11px] text-slate-600 italic">
                        Catatan Lapangan: {dr.fieldNotes}
                      </div>
                    )}
                    {(dr.photos.length > 0 || (dr.adminAttachments?.length ?? 0) > 0) && (
                      <div className="flex gap-1.5 pt-1 overflow-x-auto">
                        {dr.photos.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              onOpenPhoto({
                                url: p.photoUrl,
                                title: `${user.fullName} · ${dr.eventName || dr.clientName}`,
                                subtitle:
                                  p.photoKind === 'transaction_proof'
                                    ? 'Bukti Transaksi'
                                    : 'Foto Kegiatan',
                                notes: dr.fieldNotes || dr.notes,
                                lat: dr.lat ?? undefined,
                                lng: dr.lng ?? undefined,
                              })
                            }
                            className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-300"
                          >
                            <img src={p.photoUrl} alt="Foto laporan" className="h-full w-full object-cover" />
                          </button>
                        ))}
                        {dr.adminAttachments?.map((att) => (
                          <button
                            key={`att-${att.id}`}
                            type="button"
                            onClick={() =>
                              onOpenPhoto({
                                url: att.photoUrl,
                                title: `Lampiran Admin · ${dr.eventName || dr.clientName}`,
                                subtitle: formatDateTimeWIB(att.createdAt),
                                notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                              })
                            }
                            className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border-2 border-amber-500"
                            title={att.note || 'Lampiran Admin'}
                          >
                            <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CameraCaptureModal
        isOpen={camModal.open}
        title={camModal.title}
        userName={user.fullName}
        activityLabel={camModal.label}
        gpsPosition={gpsPosition}
        allowFileUpload={true}
        onConfirm={handleCameraConfirm}
        onClose={() => setCamModal((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};
