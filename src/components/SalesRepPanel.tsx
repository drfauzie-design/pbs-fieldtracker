import React, { useMemo, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  FileText,
  MapPin,
  Navigation,
  Plus,
  Send,
  ShoppingCart,
  Store,
  Tag,
  Trash2,
} from 'lucide-react';
import { GpsPosition } from '../hooks/useGeolocation';
import { QueuedAction } from '../hooks/useOfflineQueue';
import {
  LightboxPhoto,
  MyTodayResponse,
  Product,
  SalesRepReport,
  SalesRepSubType,
  User,
} from '../types';
import { apiFetch } from '../utils/api';
import { formatDateID, formatRupiah, formatTimeWIB, getTodayDateKeyJakarta } from '../utils/format';
import { CameraCaptureModal } from './CameraCaptureModal';
import { MultiPhotoPicker, StagedPhoto } from './MultiPhotoPicker';

interface SalesLineItem {
  key: string;
  productId: string;
  quantity: string;
  unitPrice: string;
}

interface SalesRepPanelProps {
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
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const SalesRepPanel: React.FC<SalesRepPanelProps> = ({
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
}) => {
  const [subMode, setSubMode] = useState<SalesRepSubType>('po');
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const allowPriceAdjustment = todayData?.targets.allowPriceAdjustment ?? false;

  const [camModal, setCamModal] = useState<{
    open: boolean;
    target: 'penawaran' | 'po' | 'noo';
    title: string;
    label: string;
  }>({ open: false, target: 'po', title: '', label: '' });

  // ===== 1. PENAWARAN PRODUK =====
  const [offerClient, setOfferClient] = useState('');
  const [offerNotes, setOfferNotes] = useState('');
  const [offerStatus, setOfferStatus] = useState('Diajukan');
  const [offerFollowUp, setOfferFollowUp] = useState('');
  const [offerFieldNotes, setOfferFieldNotes] = useState('');
  const [offerPhotos, setOfferPhotos] = useState<StagedPhoto[]>([]);

  // ===== 2. PURCHASE ORDER (PO) =====
  const [poClient, setPoClient] = useState('');
  const [poSearch, setPoSearch] = useState('');
  const [poItems, setPoItems] = useState<SalesLineItem[]>([
    { key: 'po_1', productId: '', quantity: '1', unitPrice: '' },
  ]);
  const [poNotes, setPoNotes] = useState('');
  const [poFieldNotes, setPoFieldNotes] = useState('');
  const [poPhotos, setPoPhotos] = useState<StagedPhoto[]>([]);

  // ===== 3. NOO (NEW OPEN OUTLET) =====
  const [nooName, setNooName] = useState('');
  const [nooAddress, setNooAddress] = useState('');
  const [nooOwner, setNooOwner] = useState('');
  const [nooPhone, setNooPhone] = useState('');
  const [nooType, setNooType] = useState('Toko Sembako');
  const [nooPotential, setNooPotential] = useState('');
  const [nooFieldNotes, setNooFieldNotes] = useState('');
  const [nooPhotos, setNooPhotos] = useState<StagedPhoto[]>([]);

  const productMap = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = poSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [products, poSearch]);

  const poResolved = useMemo(() => {
    const lines: Array<{
      sku: string;
      name: string;
      unit: string;
      qty: number;
      unitPrice: number;
      subtotal: number;
    }> = [];
    let totalQty = 0;
    let totalAmount = 0;
    for (const row of poItems) {
      const p = productMap.get(row.productId);
      if (!p) continue;
      const qty = Math.max(0, Math.round(Number(row.quantity || 0)));
      if (qty <= 0) continue;
      const price =
        allowPriceAdjustment && row.unitPrice !== ''
          ? Math.max(0, Math.round(Number(row.unitPrice || 0)))
          : p.unitPrice;
      const subtotal = qty * price;
      totalQty += qty;
      totalAmount += subtotal;
      lines.push({
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        qty,
        unitPrice: price,
        subtotal,
      });
    }
    return { lines, totalQty, totalAmount };
  }, [poItems, productMap, allowPriceAdjustment]);

  const updatePoRow = (key: string, patch: Partial<SalesLineItem>) => {
    setPoItems((prev) =>
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

  const buildWhatsAppPoText = (
    client: string,
    lines: Array<{
      sku: string;
      name: string;
      unit: string;
      qty: number;
      unitPrice: number;
      subtotal: number;
    }>,
    totalQty: number,
    totalAmount: number,
    notes: string,
    fieldNotes: string,
    dateStr?: string
  ) => {
    const tgl = formatDateID(dateStr || getTodayDateKeyJakarta());
    const itemLines = lines.map(
      (it, idx) =>
        `${idx + 1}. ${it.name} [${it.sku}]\n   ${it.qty} ${it.unit} x ${formatRupiah(
          it.unitPrice
        )} = ${formatRupiah(it.subtotal)}`
    );
    return [
      `*PURCHASE ORDER (PO) — CV. PANGAN BERKAH SENTOSA*`,
      `Tanggal: ${tgl}`,
      `Sales Rep: ${user.fullName} (${user.phone})`,
      `Toko / Klien: *${client || '-'}*`,
      ``,
      `*Rincian Item PO:*`,
      ...itemLines,
      ``,
      `Total Qty: ${totalQty}`,
      `*TOTAL PO: ${formatRupiah(totalAmount)}*`,
      notes ? `Catatan PO: ${notes}` : '',
      fieldNotes ? `Catatan Lapangan: ${fieldNotes}` : '',
    ]
      .filter((line) => line !== undefined && line !== null && !(line === '' && false))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  };

  const handleCopyDraftPoWa = async () => {
    if (!poClient.trim() || poResolved.lines.length === 0) {
      onFeedback({
        type: 'err',
        text: 'Isi Nama Toko/Klien dan pilih minimal 1 item PO terlebih dahulu sebelum menyalin teks WA.',
      });
      return;
    }
    const text = buildWhatsAppPoText(
      poClient.trim(),
      poResolved.lines,
      poResolved.totalQty,
      poResolved.totalAmount,
      poNotes.trim(),
      poFieldNotes.trim()
    );
    const ok = await copyTextSafe(text);
    if (ok) {
      setCopiedId('draft');
      setTimeout(() => setCopiedId((c) => (c === 'draft' ? null : c)), 2500);
      onFeedback({
        type: 'ok',
        text: 'Teks PO berhasil disalin ke clipboard! Siap di-paste ke WhatsApp.',
      });
    } else {
      onFeedback({
        type: 'err',
        text: 'Browser memblokir salin otomatis. Silakan periksa izin clipboard perangkat.',
      });
    }
  };

  const handleCopySavedPoWa = async (sr: SalesRepReport) => {
    const lines = sr.poItems.map((it) => ({
      sku: it.productSku,
      name: it.productName,
      unit: it.productUnit,
      qty: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: it.totalAmount,
    }));
    const text = buildWhatsAppPoText(
      sr.clientName,
      lines,
      sr.poTotalQty,
      sr.poTotalAmount,
      sr.notes,
      sr.fieldNotes,
      sr.dateKey
    );
    const ok = await copyTextSafe(text);
    if (ok) {
      setCopiedId(`saved_${sr.id}`);
      setTimeout(() => setCopiedId((c) => (c === `saved_${sr.id}` ? null : c)), 2500);
      onFeedback({
        type: 'ok',
        text: `Teks PO untuk ${sr.clientName} berhasil disalin! Siap di-paste ke WhatsApp.`,
      });
    }
  };

  const handleCameraConfirm = (dataUrl: string, capturedAt: string) => {
    const target = camModal.target;
    setCamModal((prev) => ({ ...prev, open: false }));
    const photo: StagedPhoto = { dataUrl, capturedAt };
    if (target === 'penawaran') setOfferPhotos((p) => [...p, photo]);
    else if (target === 'po') setPoPhotos((p) => [...p, photo]);
    else if (target === 'noo') setNooPhotos((p) => [...p, photo]);
  };

  const dispatchSalesRep = async (
    payload: Record<string, any>,
    label: string,
    resetFn: () => void
  ) => {
    setSubmitting(true);
    onFeedback(null);
    try {
      if (!isOnline) {
        enqueueOffline({ kind: 'sales_rep', payload, label });
        onFeedback({
          type: 'ok',
          text: `Mode Offline: "${label}" masuk antrean dan akan tersinkron otomatis saat online.`,
        });
        resetFn();
      } else {
        await apiFetch('/api/sales-rep/reports', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onFeedback({ type: 'ok', text: `${label} berhasil disimpan!` });
        resetFn();
        await onSubmitted();
      }
    } catch (err: any) {
      if (!err?.status) {
        enqueueOffline({ kind: 'sales_rep', payload, label });
        onFeedback({
          type: 'ok',
          text: `Koneksi bermasalah. "${label}" disimpan ke antrean offline.`,
        });
        resetFn();
      } else {
        onFeedback({ type: 'err', text: err.message || 'Gagal menyimpan laporan Sales Rep.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerClient.trim() || !offerNotes.trim()) {
      onFeedback({
        type: 'err',
        text: 'Nama toko / klien dan detail penawaran wajib diisi.',
      });
      return;
    }
    const pos = gpsPosition || (await refreshPosition().catch(() => null));
    await dispatchSalesRep(
      {
        subType: 'penawaran',
        clientName: offerClient.trim(),
        offerNotes: offerNotes.trim(),
        offerStatus,
        followUpDate: offerFollowUp,
        fieldNotes: offerFieldNotes.trim(),
        photos: offerPhotos,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy: pos?.accuracy ?? null,
        reportedAt: new Date().toISOString(),
      },
      `Penawaran Produk: ${offerClient.trim()}`,
      () => {
        setOfferClient('');
        setOfferNotes('');
        setOfferStatus('Diajukan');
        setOfferFollowUp('');
        setOfferFieldNotes('');
        setOfferPhotos([]);
      }
    );
  };

  const handleSubmitPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poClient.trim()) {
      onFeedback({ type: 'err', text: 'Nama toko / klien PO wajib diisi.' });
      return;
    }
    const validItems = poItems
      .filter((it) => it.productId && Math.round(Number(it.quantity)) > 0)
      .map((it) => ({
        productId: Number(it.productId),
        quantity: Math.round(Number(it.quantity)),
        unitPrice:
          allowPriceAdjustment && it.unitPrice !== '' ? Number(it.unitPrice) : undefined,
      }));
    if (validItems.length === 0) {
      onFeedback({ type: 'err', text: 'Pilih minimal 1 item produk PO dengan Qty minimal 1.' });
      return;
    }
    const pos = gpsPosition || (await refreshPosition().catch(() => null));
    await dispatchSalesRep(
      {
        subType: 'po',
        clientName: poClient.trim(),
        items: validItems,
        notes: poNotes.trim(),
        fieldNotes: poFieldNotes.trim(),
        photos: poPhotos,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy: pos?.accuracy ?? null,
        reportedAt: new Date().toISOString(),
      },
      `PO: ${poClient.trim()} (${formatRupiah(poResolved.totalAmount)})`,
      () => {
        setPoClient('');
        setPoItems([{ key: `po_${Date.now()}`, productId: '', quantity: '1', unitPrice: '' }]);
        setPoNotes('');
        setPoFieldNotes('');
        setPoPhotos([]);
      }
    );
  };

  const handleSubmitNoo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nooName.trim()) {
      onFeedback({ type: 'err', text: 'Nama Outlet / Toko Baru wajib diisi.' });
      return;
    }
    const pos = gpsPosition || (await refreshPosition().catch(() => null));
    await dispatchSalesRep(
      {
        subType: 'noo',
        outletName: nooName.trim(),
        outletAddress: nooAddress.trim(),
        outletOwner: nooOwner.trim(),
        outletPhone: nooPhone.trim(),
        outletType: nooType,
        outletPotential: nooPotential.trim(),
        fieldNotes: nooFieldNotes.trim(),
        photos: nooPhotos,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy: pos?.accuracy ?? null,
        reportedAt: new Date().toISOString(),
      },
      `NOO Outlet Baru: ${nooName.trim()}`,
      () => {
        setNooName('');
        setNooAddress('');
        setNooOwner('');
        setNooPhone('');
        setNooType('Toko Sembako');
        setNooPotential('');
        setNooFieldNotes('');
        setNooPhotos([]);
      }
    );
  };

  const todaySalesRepReports = todayData?.salesRepReports || [];
  const todayPoTotal = todaySalesRepReports
    .filter((r) => r.subType === 'po')
    .reduce((sum, r) => sum + r.poTotalAmount, 0);
  const todayNooCount = todaySalesRepReports.filter((r) => r.subType === 'noo').length;

  return (
    <div className="space-y-5">
      {/* Sub-mode Switcher for Sales Representatif */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-950">
              Laporan Kerja — Sales Representatif
            </h2>
            <p className="text-xs text-slate-600">
              Kelola Penawaran Produk, Purchase Order (PO + Salin ke WA), dan Pendaftaran Outlet Baru (NOO).
            </p>
          </div>
          <span className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-900">
            Kategori: Sales Representatif
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => setSubMode('po')}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              subMode === 'po'
                ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
            }`}
          >
            <ShoppingCart
              className={`h-5 w-5 shrink-0 ${subMode === 'po' ? 'text-amber-300' : 'text-orange-600'}`}
            />
            <div>
              <div className="text-sm font-extrabold">1. PO (Purchase Order)</div>
              <div className={`text-[11px] ${subMode === 'po' ? 'text-orange-100' : 'text-slate-600'}`}>
                Input item PO &amp; salin teks ke WhatsApp
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSubMode('penawaran')}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              subMode === 'penawaran'
                ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
            }`}
          >
            <Tag
              className={`h-5 w-5 shrink-0 ${
                subMode === 'penawaran' ? 'text-amber-300' : 'text-orange-600'
              }`}
            />
            <div>
              <div className="text-sm font-extrabold">2. Penawaran Produk</div>
              <div
                className={`text-[11px] ${
                  subMode === 'penawaran' ? 'text-orange-100' : 'text-slate-600'
                }`}
              >
                Catat promo, harga &amp; tindak lanjut klien
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSubMode('noo')}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              subMode === 'noo'
                ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
            }`}
          >
            <Store
              className={`h-5 w-5 shrink-0 ${subMode === 'noo' ? 'text-amber-300' : 'text-orange-600'}`}
            />
            <div>
              <div className="text-sm font-extrabold">3. NOO (New Open Outlet)</div>
              <div className={`text-[11px] ${subMode === 'noo' ? 'text-orange-100' : 'text-slate-600'}`}>
                Pendaftaran toko baru + GPS &amp; foto
              </div>
            </div>
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {/* ==================== SUB-MODE: PO (PURCHASE ORDER) ==================== */}
          {subMode === 'po' && (
            <form
              onSubmit={handleSubmitPo}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-950">
                    Input Purchase Order (PO)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Pilih produk dari master barang, hitung otomatis, simpan PO, dan salin ringkasan untuk WhatsApp.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyDraftPoWa}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3.5 py-2 text-xs font-extrabold text-emerald-900 hover:bg-emerald-100 transition"
                >
                  {copiedId === 'draft' ? (
                    <Check className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <ClipboardCopy className="h-4 w-4 text-emerald-700" />
                  )}
                  <span>{copiedId === 'draft' ? 'Tersalin!' : 'Salin Teks PO ke WA'}</span>
                </button>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Nama Toko / Klien *
                </label>
                <input
                  type="text"
                  required
                  value={poClient}
                  onChange={(e) => setPoClient(e.target.value)}
                  placeholder="Contoh: Toko Grosir Sumber Jaya"
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">Item Purchase Order</span>
                  <span className="font-mono text-xs font-bold text-orange-700">
                    {poResolved.totalQty} unit
                  </span>
                </div>

                {products.length === 0 ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
                    Master produk kosong. Minta Admin menambahkan master produk terlebih dahulu.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={poSearch}
                      onChange={(e) => setPoSearch(e.target.value)}
                      placeholder="Cari produk (SKU, nama, kategori)..."
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3.5 text-sm text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none"
                    />
                    {poItems.map((item, idx) => {
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
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold text-slate-700">
                              Item PO #{idx + 1}
                            </span>
                            {poItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPoItems((prev) => prev.filter((r) => r.key !== item.key))
                                }
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Hapus</span>
                              </button>
                            )}
                          </div>
                          <select
                            value={item.productId}
                            onChange={(e) => updatePoRow(item.key, { productId: e.target.value })}
                            className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                          >
                            <option value="">
                              -- Pilih Produk ({filteredProducts.length} tersedia) --
                            </option>
                            {filteredProducts.map((p) => (
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
                                onChange={(e) =>
                                  updatePoRow(item.key, { quantity: e.target.value })
                                }
                                className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-bold text-slate-950 tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-slate-700">
                                Harga Satuan {allowPriceAdjustment ? '(Bisa Edit)' : ''}
                              </label>
                              <input
                                type="number"
                                min={0}
                                disabled={!allowPriceAdjustment || !prod}
                                value={prod ? item.unitPrice : ''}
                                onChange={(e) =>
                                  updatePoRow(item.key, { unitPrice: e.target.value })
                                }
                                className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-bold text-slate-950 disabled:bg-slate-100 tabular-nums"
                              />
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex flex-col justify-end">
                              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                                <div className="text-[10px] font-bold text-slate-600">Subtotal PO</div>
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
                        setPoItems((prev) => [
                          ...prev,
                          {
                            key: `po_${Date.now()}_${Math.random()}`,
                            productId: '',
                            quantity: '1',
                            unitPrice: '',
                          },
                        ])
                      }
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-orange-400 bg-orange-50 px-4 py-2 text-xs sm:text-sm font-extrabold text-orange-800 hover:bg-orange-100"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Tambah Item PO</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-400 bg-slate-900 p-4 text-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-amber-400">Total Nilai Purchase Order</div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    Total Qty: <span className="font-mono font-bold">{poResolved.totalQty}</span> unit
                  </div>
                </div>
                <div className="font-mono text-xl sm:text-2xl font-extrabold text-white tabular-nums">
                  {formatRupiah(poResolved.totalAmount)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Catatan PO (Pengiriman / TOP / Lainnya)
                </label>
                <input
                  type="text"
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  placeholder="Contoh: Kirim besok pagi, pembayaran TOP 14 hari"
                  className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <label className="block text-sm font-extrabold text-slate-900">
                  Catatan Lapangan (Info Kompetitor / Stok Toko / Kondisi Pasar)
                </label>
                <textarea
                  rows={2}
                  value={poFieldNotes}
                  onChange={(e) => setPoFieldNotes(e.target.value)}
                  placeholder="Catat temuan lapangan penting dari kunjungan ini..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <MultiPhotoPicker
                label="Lampiran Foto PO / Nota / Toko (Opsional)"
                helperText="Stempel waktu & GPS otomatis"
                photos={poPhotos}
                onChange={setPoPhotos}
                userName={user.fullName}
                activityLabel={`PO Sales Rep: ${poClient || 'Toko'}`}
                gpsPosition={gpsPosition}
                onOpenCamera={() =>
                  setCamModal({
                    open: true,
                    target: 'po',
                    title: 'Foto Bukti PO / Toko',
                    label: `PO: ${poClient || 'Toko'}`,
                  })
                }
                onOpenPhoto={onOpenPhoto}
              />

              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleCopyDraftPoWa}
                  className="flex min-h-[50px] items-center justify-center gap-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-5 py-3 text-sm font-extrabold text-emerald-900 hover:bg-emerald-100 transition"
                >
                  <ClipboardCopy className="h-4 w-4" />
                  <span>Salin Teks PO ke WA</span>
                </button>
                <button
                  type="submit"
                  disabled={submitting || products.length === 0}
                  className="flex flex-1 min-h-[50px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
                >
                  <Send className="h-4 w-4" />
                  <span>{submitting ? 'Menyimpan...' : 'Simpan Purchase Order (PO)'}</span>
                </button>
              </div>
            </form>
          )}

          {/* ==================== SUB-MODE: PENAWARAN PRODUK ==================== */}
          {subMode === 'penawaran' && (
            <form
              onSubmit={handleSubmitOffer}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-lg font-extrabold text-slate-950">
                  Laporan Penawaran Produk
                </h3>
                <p className="text-xs text-slate-600">
                  Catat produk, harga/promo yang ditawarkan ke toko/klien beserta status tindak lanjut.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-bold text-slate-900">
                    Nama Toko / Klien *
                  </label>
                  <input
                    type="text"
                    required
                    value={offerClient}
                    onChange={(e) => setOfferClient(e.target.value)}
                    placeholder="Contoh: Minimarket Barokah"
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-900">
                    Status Penawaran
                  </label>
                  <select
                    value={offerStatus}
                    onChange={(e) => setOfferStatus(e.target.value)}
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-950 focus:border-orange-600 focus:outline-none"
                  >
                    <option value="Diajukan">Diajukan</option>
                    <option value="Negosiasi">Negosiasi</option>
                    <option value="Tertarik / Follow-Up">Tertarik / Follow-Up</option>
                    <option value="Deal">Deal</option>
                    <option value="Ditolak">Ditolak</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Detail Produk, Harga &amp; Promo yang Ditawarkan *
                </label>
                <textarea
                  rows={3}
                  required
                  value={offerNotes}
                  onChange={(e) => setOfferNotes(e.target.value)}
                  placeholder="Contoh: Penawaran Beras Premium 5kg harga grosir Rp72.000/sak min 20 sak + diskon 2%..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Jadwal Follow-Up Berikutnya (Opsional)
                </label>
                <input
                  type="date"
                  value={offerFollowUp}
                  onChange={(e) => setOfferFollowUp(e.target.value)}
                  className="mt-1.5 w-full sm:w-64 min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <label className="block text-sm font-extrabold text-slate-900">
                  Catatan Lapangan (Respon Pemilik / Harga Kompetitor / Peluang)
                </label>
                <textarea
                  rows={2}
                  value={offerFieldNotes}
                  onChange={(e) => setOfferFieldNotes(e.target.value)}
                  placeholder="Catat kondisi display, harga pesaing, atau catatan lapangan lainnya..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <MultiPhotoPicker
                label="Upload Foto Penawaran / Brosur / Toko"
                helperText="Stempel waktu & GPS otomatis"
                photos={offerPhotos}
                onChange={setOfferPhotos}
                userName={user.fullName}
                activityLabel={`Penawaran: ${offerClient || 'Klien'}`}
                gpsPosition={gpsPosition}
                onOpenCamera={() =>
                  setCamModal({
                    open: true,
                    target: 'penawaran',
                    title: 'Foto Penawaran Produk',
                    label: `Penawaran: ${offerClient || 'Klien'}`,
                  })
                }
                onOpenPhoto={onOpenPhoto}
              />

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
              >
                <Send className="h-4 w-4" />
                <span>{submitting ? 'Menyimpan...' : 'Kirim Laporan Penawaran'}</span>
              </button>
            </form>
          )}

          {/* ==================== SUB-MODE: NOO (NEW OPEN OUTLET) ==================== */}
          {subMode === 'noo' && (
            <form
              onSubmit={handleSubmitNoo}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-lg font-extrabold text-slate-950">
                  NOO — Pendaftaran Outlet / Toko Baru
                </h3>
                <p className="text-xs text-slate-600">
                  Daftarkan outlet baru lengkap dengan alamat, kontak pemilik, koordinat GPS, dan foto toko berstempel.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-mono text-slate-800">
                  <MapPin className="h-4 w-4 text-orange-600 shrink-0" />
                  {gpsPosition ? (
                    <span>
                      GPS Terkunci:{' '}
                      <strong>
                        {gpsPosition.lat.toFixed(6)}, {gpsPosition.lng.toFixed(6)}
                      </strong>
                    </span>
                  ) : (
                    <span className="text-amber-800 font-semibold">
                      Mengambil koordinat GPS...
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => refreshPosition().catch(() => {})}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-bold text-slate-900 hover:bg-slate-100"
                >
                  <Navigation className="h-3.5 w-3.5 text-orange-600" />
                  <span>Refresh GPS</span>
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-bold text-slate-900">
                    Nama Outlet / Toko Baru *
                  </label>
                  <input
                    type="text"
                    required
                    value={nooName}
                    onChange={(e) => setNooName(e.target.value)}
                    placeholder="Contoh: Toko Sembako Jaya Abadi"
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-900">Jenis Outlet</label>
                  <select
                    value={nooType}
                    onChange={(e) => setNooType(e.target.value)}
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-950 focus:border-orange-600 focus:outline-none"
                  >
                    <option value="Toko Sembako">Toko Sembako</option>
                    <option value="Warung / Retail">Warung / Retail</option>
                    <option value="Grosir / Agen">Grosir / Agen</option>
                    <option value="Minimarket">Minimarket</option>
                    <option value="Horeka (Hotel/Resto/Kafe)">Horeka (Hotel/Resto/Kafe)</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Alamat Lengkap Outlet
                </label>
                <textarea
                  rows={2}
                  value={nooAddress}
                  onChange={(e) => setNooAddress(e.target.value)}
                  placeholder="Jl. Raya Pasar Minggu No. 45, Kec. ..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-bold text-slate-900">Nama Pemilik / PIC</label>
                  <input
                    type="text"
                    value={nooOwner}
                    onChange={(e) => setNooOwner(e.target.value)}
                    placeholder="Bapak / Ibu ..."
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900">No. HP / WhatsApp</label>
                  <input
                    type="tel"
                    value={nooPhone}
                    onChange={(e) => setNooPhone(e.target.value)}
                    placeholder="0812..."
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono text-sm text-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900">
                    Potensi Order Awal
                  </label>
                  <input
                    type="text"
                    value={nooPotential}
                    onChange={(e) => setNooPotential(e.target.value)}
                    placeholder="Mis. ±Rp5 jt/bln"
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-slate-950"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <label className="block text-sm font-extrabold text-slate-900">
                  Catatan Lapangan (Akses Jalan / Produk Minat / Jadwal Kunjungan)
                </label>
                <textarea
                  rows={2}
                  value={nooFieldNotes}
                  onChange={(e) => setNooFieldNotes(e.target.value)}
                  placeholder="Catat potensi produk, jam buka toko, atau kendala akses..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <MultiPhotoPicker
                label="Foto Outlet Baru (Tampak Depan & Display)"
                helperText="Stempel waktu & koordinat GPS otomatis"
                photos={nooPhotos}
                onChange={setNooPhotos}
                userName={user.fullName}
                activityLabel={`NOO: ${nooName || 'Outlet Baru'}`}
                gpsPosition={gpsPosition}
                onOpenCamera={() =>
                  setCamModal({
                    open: true,
                    target: 'noo',
                    title: 'Foto Outlet Baru (NOO)',
                    label: `NOO: ${nooName || 'Outlet Baru'}`,
                  })
                }
                onOpenPhoto={onOpenPhoto}
              />

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
              >
                <Send className="h-4 w-4" />
                <span>{submitting ? 'Menyimpan...' : 'Daftarkan Outlet Baru (NOO)'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Right Summary Column */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-2xl border border-amber-400 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-950">
                Ringkasan Sales Rep Hari Ini
              </h3>
              <FileText className="h-5 w-5 text-orange-600" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-900 p-3.5 text-white">
                <div className="text-[11px] font-medium text-amber-400">Total Nilai PO</div>
                <div className="mt-1 font-mono text-base sm:text-lg font-extrabold tabular-nums">
                  {formatRupiah(todayPoTotal)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-[11px] font-medium text-slate-600">Outlet Baru (NOO)</div>
                <div className="mt-1 font-mono text-2xl font-extrabold text-slate-950 tabular-nums">
                  {todayNooCount}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="text-sm font-extrabold text-slate-950">
              Laporan Sales Rep Hari Ini ({todaySalesRepReports.length})
            </h3>
            {todaySalesRepReports.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Belum ada laporan Penawaran, PO, atau NOO hari ini.
              </p>
            ) : (
              <div className="mt-3 space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                {todaySalesRepReports.map((sr) => (
                  <div
                    key={sr.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                        {sr.subType === 'po'
                          ? 'PO'
                          : sr.subType === 'noo'
                          ? 'NOO'
                          : 'Penawaran'}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatTimeWIB(sr.reportedAt)}
                      </span>
                    </div>
                    <div className="font-extrabold text-slate-950">
                      {sr.subType === 'noo' ? sr.outletName : sr.clientName}
                    </div>
                    {sr.subType === 'po' && (
                      <>
                        <div className="font-mono font-bold text-orange-700">
                          {sr.poTotalQty} unit · {formatRupiah(sr.poTotalAmount)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopySavedPoWa(sr)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500 bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-900 hover:bg-emerald-100"
                        >
                          {copiedId === `saved_${sr.id}` ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <ClipboardCopy className="h-3 w-3" />
                          )}
                          <span>
                            {copiedId === `saved_${sr.id}` ? 'Tersalin!' : 'Salin Teks PO ke WA'}
                          </span>
                        </button>
                      </>
                    )}
                    {sr.subType === 'penawaran' && (
                      <div className="text-slate-700">
                        <span className="font-bold text-blue-900">[{sr.offerStatus}]</span>{' '}
                        {sr.offerNotes}
                      </div>
                    )}
                    {sr.subType === 'noo' && (
                      <div className="text-slate-700">
                        {sr.outletType} {sr.outletOwner ? `· ${sr.outletOwner}` : ''}
                      </div>
                    )}
                    {sr.fieldNotes && (
                      <div className="text-[11px] text-slate-600 italic">
                        Catatan Lapangan: {sr.fieldNotes}
                      </div>
                    )}
                    {sr.photos.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {sr.photos.map((ph, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() =>
                              onOpenPhoto({
                                url: ph.photoUrl,
                                title: `${user.fullName} · ${sr.clientName}`,
                                subtitle: sr.subType.toUpperCase(),
                                notes: sr.fieldNotes || sr.notes,
                                lat: sr.lat ?? undefined,
                                lng: sr.lng ?? undefined,
                              })
                            }
                            className="h-10 w-10 overflow-hidden rounded-lg border border-slate-300"
                          >
                            <img src={ph.photoUrl} alt="Lampiran" className="h-full w-full object-cover" />
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
