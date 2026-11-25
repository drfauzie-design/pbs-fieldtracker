import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CreditCard,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { GpsPosition } from '../hooks/useGeolocation';
import { QueuedAction } from '../hooks/useOfflineQueue';
import {
  CollectionReason,
  CollectionVisitStatus,
  Customer,
  Invoice,
  LightboxPhoto,
  MyTodayResponse,
  PaymentMethod,
  User,
} from '../types';
import { apiFetch } from '../utils/api';
import { formatDateID, formatDateTimeWIB, formatRupiah, formatTimeWIB } from '../utils/format';
import { CameraCaptureModal } from './CameraCaptureModal';
import { StagedPhoto } from './MultiPhotoPicker';

interface CollectorReportPanelProps {
  user: User;
  todayData: MyTodayResponse | null;
  gpsPosition: GpsPosition | null;
  refreshPosition: () => Promise<GpsPosition>;
  isOnline: boolean;
  enqueueOffline: (item: Omit<QueuedAction, 'id' | 'queuedAt'>) => void;
  onSubmitted: () => Promise<void>;
  onFeedback: (fb: { type: 'ok' | 'err'; text: string } | null) => void;
  onOpenPhoto: (photo: LightboxPhoto) => void;
}

export const CollectorReportPanel: React.FC<CollectorReportPanelProps> = ({
  user,
  todayData,
  gpsPosition,
  refreshPosition,
  isOnline,
  enqueueOffline,
  onSubmitted,
  onFeedback,
  onOpenPhoto,
}) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [visitStatus, setVisitStatus] = useState<CollectionVisitStatus>('Bayar Lunas');
  const [collectedAmount, setCollectedAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Tunai');
  const [promiseDate, setPromiseDate] = useState('');
  const [reason, setReason] = useState<CollectionReason>('');
  const [notes, setNotes] = useState('');
  const [fieldNotes, setFieldNotes] = useState('');
  const [proofPhoto, setProofPhoto] = useState<StagedPhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Quick Add Customer/Invoice modal for Admin / Leader testing
  const canManageMaster = user.role === 'Admin' || user.role === 'Leader/SPV';
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [qCustName, setQCustName] = useState('');
  const [qCustPhone, setQCustPhone] = useState('');
  const [qInvNum, setQInvNum] = useState('');
  const [qInvTotal, setQInvTotal] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);

  const loadMaster = useCallback(async () => {
    setLoadingMaster(true);
    try {
      const [cRes, iRes] = await Promise.all([
        apiFetch<{ customers: Customer[] }>('/api/customers'),
        apiFetch<{ invoices: Invoice[] }>('/api/invoices?unpaidOnly=1'),
      ]);
      setCustomers(cRes.customers);
      setInvoices(iRes.invoices);
    } catch {
      // keep existing if offline
    } finally {
      setLoadingMaster(false);
    }
  }, []);

  useEffect(() => {
    loadMaster();
  }, [loadMaster]);

  const customerInvoices = useMemo(() => {
    if (!selectedCustomerId) return [];
    return invoices.filter((inv) => String(inv.customerId) === selectedCustomerId);
  }, [invoices, selectedCustomerId]);

  const selectedInvoice = useMemo(
    () => customerInvoices.find((inv) => String(inv.id) === selectedInvoiceId) || null,
    [customerInvoices, selectedInvoiceId]
  );

  const invoiceTotalTagihan = selectedInvoice?.remainingAmount ?? 0;

  // Auto-fill nominal when status or selected invoice changes
  useEffect(() => {
    if (!selectedInvoice) {
      setCollectedAmount('');
      return;
    }
    if (visitStatus === 'Bayar Lunas') {
      setCollectedAmount(String(selectedInvoice.remainingAmount));
    } else if (
      visitStatus === 'Janji Bayar' ||
      visitStatus === 'Toko Tutup' ||
      visitStatus === 'Gagal Tagih'
    ) {
      setCollectedAmount('0');
    } else if (visitStatus === 'Bayar Sebagian' && Number(collectedAmount) >= selectedInvoice.remainingAmount) {
      setCollectedAmount('');
    }
  }, [visitStatus, selectedInvoice]);

  const numericCollected = useMemo(() => {
    const n = Math.round(Number(collectedAmount || 0));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [collectedAmount]);

  const remainingAfterPay = useMemo(
    () => Math.max(0, invoiceTotalTagihan - numericCollected),
    [invoiceTotalTagihan, numericCollected]
  );

  const needsFollowUpDate = visitStatus === 'Janji Bayar' || visitStatus === 'Bayar Sebagian';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onFeedback(null);

    if (!selectedCustomerId || !selectedInvoice) {
      onFeedback({ type: 'err', text: 'Customer dan Nomor Invoice belum lunas wajib dipilih.' });
      return;
    }
    if (numericCollected > invoiceTotalTagihan) {
      onFeedback({
        type: 'err',
        text: 'Nominal tertagih tidak boleh melebihi sisa tagihan faktur.',
      });
      return;
    }
    if (needsFollowUpDate && !promiseDate) {
      onFeedback({
        type: 'err',
        text: 'Tanggal Janji Bayar wajib diisi untuk status Janji Bayar atau Bayar Sebagian.',
      });
      return;
    }

    let pos = gpsPosition;
    if (!pos) {
      pos = await refreshPosition().catch(() => null);
    }

    const payload = {
      customerId: Number(selectedCustomerId),
      invoiceId: selectedInvoice.id,
      visitStatus,
      collectedAmount: numericCollected,
      paymentMethod,
      promiseDate: needsFollowUpDate ? promiseDate : '',
      reason,
      notes: notes.trim(),
      fieldNotes: fieldNotes.trim(),
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      accuracy: pos?.accuracy ?? null,
      photoDataUrl: proofPhoto?.dataUrl || '',
      visitedAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      if (!isOnline) {
        enqueueOffline({
          kind: 'collection',
          payload,
          label: `Kolektor: ${selectedInvoice.customerName || 'Customer'} (${selectedInvoice.invoiceNumber})`,
        });
        onFeedback({
          type: 'ok',
          text: 'Mode Offline: Laporan kolektor disimpan di antrean dan akan tersinkron otomatis saat online.',
        });
        setSelectedInvoiceId('');
        setCollectedAmount('');
        setPromiseDate('');
        setReason('');
        setNotes('');
        setFieldNotes('');
        setProofPhoto(null);
      } else {
        await apiFetch('/api/collector/reports', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onFeedback({
          type: 'ok',
          text: `Laporan penagihan ${selectedInvoice.invoiceNumber} berhasil dicatat!`,
        });
        setSelectedInvoiceId('');
        setCollectedAmount('');
        setPromiseDate('');
        setReason('');
        setNotes('');
        setFieldNotes('');
        setProofPhoto(null);
        await Promise.all([loadMaster(), onSubmitted()]);
      }
    } catch (err: any) {
      if (!err?.status) {
        enqueueOffline({
          kind: 'collection',
          payload,
          label: `Kolektor: ${selectedInvoice.invoiceNumber}`,
        });
        onFeedback({
          type: 'ok',
          text: 'Koneksi bermasalah. Laporan kolektor masuk antrean offline.',
        });
        setSelectedInvoiceId('');
        setCollectedAmount('');
        setPromiseDate('');
        setReason('');
        setNotes('');
        setFieldNotes('');
        setProofPhoto(null);
      } else {
        onFeedback({ type: 'err', text: err.message || 'Gagal menyimpan laporan kolektor.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickCreateMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qCustName.trim() || !qInvNum.trim() || Number(qInvTotal) <= 0) return;
    setSavingQuick(true);
    try {
      const custRes = await apiFetch<{ customer: Customer }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: qCustName.trim(),
          phone: qCustPhone.trim(),
        }),
      });
      await apiFetch('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId: custRes.customer.id,
          invoiceNumber: qInvNum.trim(),
          totalAmount: Number(qInvTotal),
        }),
      });
      setQuickAddOpen(false);
      setQCustName('');
      setQCustPhone('');
      setQInvNum('');
      setQInvTotal('');
      await loadMaster();
      setSelectedCustomerId(String(custRes.customer.id));
      onFeedback({ type: 'ok', text: 'Customer dan invoice baru berhasil ditambahkan.' });
    } catch (err: any) {
      onFeedback({ type: 'err', text: err.message || 'Gagal menambahkan data.' });
    } finally {
      setSavingQuick(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5 lg:col-span-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-950">
              Laporan Kolektor (Penagihan Lapangan)
            </h2>
            <p className="text-xs text-slate-600">
              Catat hasil penagihan faktur customer lengkap dengan koordinat GPS, timestamp otomatis, dan foto bukti.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManageMaster && (
              <button
                type="button"
                onClick={() => setQuickAddOpen(true)}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-amber-100"
              >
                <Plus className="h-3.5 w-3.5 text-orange-600" />
                <span>+ Customer &amp; Invoice</span>
              </button>
            )}
            <button
              type="button"
              onClick={loadMaster}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Muat Invoice</span>
            </button>
          </div>
        </div>

        {/* 1. Identitas & Waktu Kunjungan */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
            1. Identitas &amp; Validasi Lokasi
          </h3>
          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-500 font-medium">Nama Kolektor</div>
              <div className="mt-0.5 text-sm font-extrabold text-slate-950">{user.fullName}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-500 font-medium">Waktu Kunjungan</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-slate-900">
                Otomatis saat submit (WIB)
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-500 font-medium">Lokasi GPS</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-emerald-700 tabular-nums">
                {gpsPosition
                  ? `${gpsPosition.lat.toFixed(5)}, ${gpsPosition.lng.toFixed(5)}`
                  : 'Menunggu koordinat GPS'}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-900">
                Nama Customer / Toko *
              </label>
              <select
                required
                value={selectedCustomerId}
                onChange={(e) => {
                  setSelectedCustomerId(e.target.value);
                  setSelectedInvoiceId('');
                }}
                className="mt-1 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
              >
                <option value="">
                  {loadingMaster
                    ? 'Memuat daftar customer...'
                    : `-- Pilih Customer (${customers.length} tersedia) --`}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    [{c.code}] {c.name}{' '}
                    {c.unpaidCount ? `(${c.unpaidCount} faktur belum lunas)` : '(Lunas)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900">
                Nomor Invoice / Faktur (Belum Lunas) *
              </label>
              <select
                required
                disabled={!selectedCustomerId}
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                className="mt-1 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-950 disabled:bg-slate-100 focus:border-orange-600 focus:outline-none"
              >
                <option value="">
                  {!selectedCustomerId
                    ? '-- Pilih customer dahulu --'
                    : customerInvoices.length === 0
                    ? '-- Tidak ada faktur belum lunas --'
                    : `-- Pilih Invoice (${customerInvoices.length}) --`}
                </option>
                {customerInvoices.map((inv) => (
                  <option key={inv.id} value={String(inv.id)}>
                    {inv.invoiceNumber} — Sisa {formatRupiah(inv.remainingAmount)}
                    {inv.dueDate ? ` (JT ${formatDateID(inv.dueDate)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!loadingMaster && customers.length === 0 && (
            <p className="text-xs font-semibold text-amber-800">
              Belum ada data customer/invoice di database.{' '}
              {canManageMaster
                ? 'Klik tombol "+ Customer & Invoice" di atas untuk menambahkan data.'
                : 'Minta Admin menambahkan master customer & invoice terlebih dahulu.'}
            </p>
          )}
        </div>

        {/* 2. Data Tagihan & Pembayaran */}
        <div className="rounded-xl border border-amber-300 bg-amber-50/30 p-4 space-y-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
            2. Data Tagihan &amp; Pembayaran
          </h3>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-bold text-slate-500">Total Tagihan Invoice</div>
              <div className="mt-1 font-mono text-lg font-extrabold text-slate-950 tabular-nums">
                {formatRupiah(invoiceTotalTagihan)}
              </div>
              {selectedInvoice && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Faktur awal: {formatRupiah(selectedInvoice.totalAmount)}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900">
                Status Kunjungan *
              </label>
              <select
                value={visitStatus}
                onChange={(e) => setVisitStatus(e.target.value as CollectionVisitStatus)}
                className="mt-1 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 focus:border-orange-600 focus:outline-none"
              >
                <option value="Bayar Lunas">Bayar Lunas</option>
                <option value="Bayar Sebagian">Bayar Sebagian</option>
                <option value="Janji Bayar">Janji Bayar</option>
                <option value="Toko Tutup">Toko Tutup</option>
                <option value="Gagal Tagih">Gagal Tagih</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900">
                Metode Pembayaran
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="mt-1 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 focus:border-orange-600 focus:outline-none"
              >
                <option value="Tunai">Tunai</option>
                <option value="Transfer">Transfer</option>
                <option value="Giro">Giro</option>
                <option value="QRIS">QRIS</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-900">
                Nominal Tertagih (Rp)
              </label>
              <input
                type="number"
                min={0}
                max={invoiceTotalTagihan || undefined}
                value={collectedAmount}
                onChange={(e) => setCollectedAmount(e.target.value)}
                placeholder="0"
                className="mt-1 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 font-mono text-base font-extrabold text-slate-950 tabular-nums focus:border-orange-600 focus:outline-none"
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-white flex flex-col justify-center">
              <div className="text-[11px] font-bold text-amber-400">
                Sisa Tagihan (Otomatis)
              </div>
              <div className="mt-0.5 font-mono text-xl font-extrabold tabular-nums">
                {formatRupiah(remainingAfterPay)}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Tindak Lanjut */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
            3. Tindak Lanjut &amp; Alasan (Jika Belum Lunas)
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-900">
                Tanggal Janji Bayar {needsFollowUpDate ? '*' : '(Opsional)'}
              </label>
              <input
                type="date"
                required={needsFollowUpDate}
                value={promiseDate}
                onChange={(e) => setPromiseDate(e.target.value)}
                className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900">
                Alasan / Kendala
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as CollectionReason)}
                className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
              >
                <option value="">-- Tidak Ada / Lunas --</option>
                <option value="Pemilik Tidak Ada">Pemilik Tidak Ada</option>
                <option value="Dana Belum Siap">Dana Belum Siap</option>
                <option value="Barang Bermasalah">Barang Bermasalah</option>
                <option value="Toko Tutup">Toko Tutup</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-900">
              Catatan Tambahan
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Transfer ke rekening BCA perusahaan / Giro jatuh tempo minggu depan"
              className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-3.5">
            <label className="block text-xs font-extrabold text-slate-900">
              Catatan Lapangan (Kondisi Toko / Sikap Pemilik / Info Penting)
            </label>
            <textarea
              rows={2}
              value={fieldNotes}
              onChange={(e) => setFieldNotes(e.target.value)}
              placeholder="Catat situasi toko, jam buka/tutup, atau kendala penagihan di lapangan..."
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
            />
          </div>
        </div>

        {/* 4. Foto Bukti */}
        <div className="space-y-2">
          <label className="block text-sm font-bold text-slate-900">
            4. Foto Bukti Penagihan (Transfer / Giro / Tunai / Depan Toko)
          </label>
          {proofPhoto ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
              <button
                type="button"
                onClick={() =>
                  onOpenPhoto({
                    url: proofPhoto.dataUrl,
                    title: `Bukti Penagihan · ${selectedInvoice?.invoiceNumber || 'Kolektor'}`,
                    lat: gpsPosition?.lat,
                    lng: gpsPosition?.lng,
                  })
                }
                className="h-16 w-20 overflow-hidden rounded-lg border border-slate-300 bg-black shrink-0"
              >
                <img src={proofPhoto.dataUrl} alt="Bukti penagihan" className="h-full w-full object-cover" />
              </button>
              <div className="flex-1 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Foto bukti berstempel waktu &amp; GPS siap dikirim</span>
              </div>
              <button
                type="button"
                onClick={() => setProofPhoto(null)}
                className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Hapus</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await refreshPosition().catch(() => {});
                setCameraOpen(true);
              }}
              className="flex w-full min-h-[68px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50/50 p-3.5 text-xs sm:text-sm font-bold text-orange-800 hover:bg-orange-100/70 transition"
            >
              <Camera className="h-5 w-5 text-orange-600" />
              <span>Ambil Foto Kamera / Unggah Bukti Penagihan</span>
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedInvoice}
          className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 transition"
        >
          <Send className="h-4 w-4" />
          <span>{submitting ? 'Menyimpan...' : 'Simpan Laporan Kolektor'}</span>
        </button>
      </form>

      {/* Right Summary Column */}
      <div className="space-y-4 lg:col-span-4">
        <div className="rounded-2xl border border-amber-400 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-slate-950">
              Ringkasan Penagihan Hari Ini
            </h3>
            <CreditCard className="h-5 w-5 text-orange-600" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-900 p-3.5 text-white">
              <div className="text-[11px] font-medium text-amber-400">Total Tertagih</div>
              <div className="mt-1 font-mono text-base sm:text-lg font-extrabold tabular-nums">
                {formatRupiah(todayData?.collectionSummary?.totalCollected ?? 0)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
              <div className="text-[11px] font-medium text-slate-600">Total Sisa Tagihan</div>
              <div className="mt-1 font-mono text-base sm:text-lg font-extrabold text-slate-950 tabular-nums">
                {formatRupiah(todayData?.collectionSummary?.totalRemaining ?? 0)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-950">
              Penagihan Hari Ini ({todayData?.collectionReports?.length ?? 0})
            </h3>
            <Receipt className="h-4 w-4 text-slate-500" />
          </div>
          {!todayData?.collectionReports?.length ? (
            <p className="mt-3 text-xs text-slate-500">
              Belum ada aktivitas penagihan yang dicatat hari ini.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {todayData.collectionReports.map((cr) => (
                <div
                  key={cr.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-extrabold text-slate-950">{cr.customerName}</div>
                      <div className="font-mono text-[11px] text-slate-600">
                        {cr.invoiceNumber} · {cr.paymentMethod}
                      </div>
                    </div>
                    <span
                      className={`font-extrabold ${
                        cr.visitStatus === 'Bayar Lunas'
                          ? 'text-emerald-700'
                          : cr.visitStatus === 'Bayar Sebagian'
                          ? 'text-blue-900'
                          : cr.visitStatus === 'Janji Bayar'
                          ? 'text-amber-700'
                          : 'text-red-700'
                      }`}
                    >
                      {cr.visitStatus}
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-[11px] pt-1 border-t border-slate-200">
                    <span className="text-emerald-700 font-bold">
                      Tertagih: {formatRupiah(cr.collectedAmount)}
                    </span>
                    <span className="text-slate-700">
                      Sisa: {formatRupiah(cr.remainingAmount)}
                    </span>
                  </div>
                  {cr.promiseDate && (
                    <div className="text-[11px] font-semibold text-amber-800">
                      Janji Bayar: {formatDateID(cr.promiseDate)}
                    </div>
                  )}
                  {cr.fieldNotes && (
                    <div className="text-[11px] text-slate-600 italic">
                      Catatan Lapangan: {cr.fieldNotes}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="font-mono text-[11px] text-slate-500">
                      {formatTimeWIB(cr.visitedAt)}
                    </span>
                    <div className="flex items-center gap-2">
                      {cr.photoUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenPhoto({
                              url: cr.photoUrl,
                              title: `${cr.customerName} · ${cr.invoiceNumber}`,
                              subtitle: `${cr.visitStatus} · Tertagih ${formatRupiah(cr.collectedAmount)}`,
                              notes: cr.fieldNotes || cr.notes || cr.reason,
                              lat: cr.lat ?? undefined,
                              lng: cr.lng ?? undefined,
                            })
                          }
                          className="text-xs font-bold text-orange-700 hover:underline"
                        >
                          Lihat Bukti
                        </button>
                      )}
                      {cr.adminAttachments?.map((att) => (
                        <button
                          key={`att-${att.id}`}
                          type="button"
                          onClick={() =>
                            onOpenPhoto({
                              url: att.photoUrl,
                              title: `Lampiran Admin · ${cr.customerName}`,
                              subtitle: formatDateTimeWIB(att.createdAt),
                              notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                            })
                          }
                          className="h-7 w-7 overflow-hidden rounded border-2 border-amber-500"
                          title={att.note || 'Lampiran Admin'}
                        >
                          <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Camera / File Proof Modal */}
      <CameraCaptureModal
        isOpen={cameraOpen}
        title="Foto Bukti Penagihan Kolektor"
        userName={user.fullName}
        activityLabel={`Kolektor: ${selectedInvoice?.invoiceNumber || 'Penagihan'}`}
        gpsPosition={gpsPosition}
        allowFileUpload={true}
        onConfirm={(dataUrl, capturedAt) => {
          setCameraOpen(false);
          setProofPhoto({ dataUrl, capturedAt });
        }}
        onClose={() => setCameraOpen(false)}
      />

      {/* Quick Add Customer & Invoice Modal (Admin/Leader) */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <form
            onSubmit={handleQuickCreateMaster}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-extrabold text-slate-950">
              Tambah Cepat Customer &amp; Invoice
            </h3>
            <div>
              <label className="block text-xs font-bold text-slate-800">Nama Customer / Toko *</label>
              <input
                type="text"
                required
                value={qCustName}
                onChange={(e) => setQCustName(e.target.value)}
                placeholder="Contoh: Toko Sumber Rezeki"
                className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-800">No. HP Customer (Opsional)</label>
              <input
                type="tel"
                value={qCustPhone}
                onChange={(e) => setQCustPhone(e.target.value)}
                placeholder="0812..."
                className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800">Nomor Invoice *</label>
                <input
                  type="text"
                  required
                  value={qInvNum}
                  onChange={(e) => setQInvNum(e.target.value)}
                  placeholder="INV-2026-001"
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-800">Total Tagihan (Rp) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={qInvTotal}
                  onChange={(e) => setQInvTotal(e.target.value)}
                  placeholder="2500000"
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm font-bold"
                />
              </div>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setQuickAddOpen(false)}
                className="flex-1 min-h-[42px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingQuick}
                className="flex-1 min-h-[42px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700"
              >
                {savingQuick ? 'Menyimpan...' : 'Simpan Data'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
