import React, { useState } from 'react';
import {
  CalendarOff,
  Camera,
  CheckCircle2,
  Send,
  Trash2,
} from 'lucide-react';
import { GpsPosition } from '../hooks/useGeolocation';
import { QueuedAction } from '../hooks/useOfflineQueue';
import { AbsenceType, LightboxPhoto, MyTodayResponse, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatDateID, formatTimeWIB, getTodayDateKeyJakarta } from '../utils/format';
import { CameraCaptureModal } from './CameraCaptureModal';
import { StagedPhoto } from './MultiPhotoPicker';

interface AbsencePanelProps {
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

const ABSENCE_TYPES: Array<{ value: AbsenceType; label: string; desc: string }> = [
  { value: 'Libur', label: 'Libur', desc: 'Jadwal libur / off resmi' },
  { value: 'Sakit', label: 'Sakit', desc: 'Lampirkan surat dokter bila ada' },
  { value: 'Izin', label: 'Izin', desc: 'Keperluan mendesak / keluarga' },
  { value: 'Cuti', label: 'Cuti', desc: 'Cuti tahunan / terencana' },
];

export const AbsencePanel: React.FC<AbsencePanelProps> = ({
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
  const todayKey = getTodayDateKeyJakarta();
  const [absenceType, setAbsenceType] = useState<AbsenceType>('Izin');
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [reason, setReason] = useState('');
  const [fieldNotes, setFieldNotes] = useState('');
  const [proofPhoto, setProofPhoto] = useState<StagedPhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onFeedback(null);

    if (!startDate || !endDate || endDate < startDate) {
      onFeedback({
        type: 'err',
        text: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.',
      });
      return;
    }
    if (reason.trim().length < 2) {
      onFeedback({
        type: 'err',
        text: 'Keterangan / alasan tidak masuk kerja wajib diisi.',
      });
      return;
    }

    const pos = gpsPosition || (await refreshPosition().catch(() => null));
    const payload = {
      absenceType,
      startDate,
      endDate,
      reason: reason.trim(),
      fieldNotes: fieldNotes.trim(),
      photoDataUrl: proofPhoto?.dataUrl || '',
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      accuracy: pos?.accuracy ?? null,
      submittedAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      if (!isOnline) {
        enqueueOffline({
          kind: 'absence',
          payload,
          label: `Tidak Masuk (${absenceType}): ${formatDateID(startDate)}`,
        });
        onFeedback({
          type: 'ok',
          text: `Mode Offline: Pencatatan ${absenceType} masuk antrean dan akan tersinkron saat sinyal kembali.`,
        });
        setReason('');
        setFieldNotes('');
        setProofPhoto(null);
      } else {
        await apiFetch('/api/absence-reports', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onFeedback({
          type: 'ok',
          text: `Status Tidak Masuk (${absenceType}) berhasil tercatat ke database.`,
        });
        setReason('');
        setFieldNotes('');
        setProofPhoto(null);
        await onSubmitted();
      }
    } catch (err: any) {
      if (!err?.status) {
        enqueueOffline({
          kind: 'absence',
          payload,
          label: `Tidak Masuk (${absenceType})`,
        });
        onFeedback({
          type: 'ok',
          text: 'Koneksi bermasalah. Data Tidak Masuk disimpan di antrean offline.',
        });
        setReason('');
        setFieldNotes('');
        setProofPhoto(null);
      } else {
        onFeedback({ type: 'err', text: err.message || 'Gagal mencatat status tidak masuk kerja.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const absenceReports = todayData?.absenceReports || [];

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5 lg:col-span-8"
      >
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-slate-950">
            Pengajuan &amp; Pencatatan Tidak Masuk Kerja
          </h2>
          <p className="text-xs text-slate-600">
            Catat status Libur, Sakit, Izin, atau Cuti beserta rentang tanggal, alasan, dan lampiran bukti/surat dokter bila diperlukan.
          </p>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-900 mb-2">
            Pilih Status Tidak Masuk *
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {ABSENCE_TYPES.map((item) => {
              const active = absenceType === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setAbsenceType(item.value)}
                  className={`rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-orange-400'
                  }`}
                >
                  <div className="text-sm font-extrabold">{item.label}</div>
                  <div className={`text-[11px] mt-0.5 ${active ? 'text-orange-100' : 'text-slate-600'}`}>
                    {item.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-bold text-slate-900">Tanggal Mulai *</label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-900">Tanggal Selesai *</label>
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-900">
            Keterangan / Alasan *
          </label>
          <textarea
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Demam tinggi, istirahat sesuai anjuran dokter klinik..."
            className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
          <label className="block text-sm font-extrabold text-slate-900">
            Catatan Lapangan / Serah Terima Tugas (Opsional)
          </label>
          <textarea
            rows={2}
            value={fieldNotes}
            onChange={(e) => setFieldNotes(e.target.value)}
            placeholder="Contoh: Kunjungan Toko Makmur dialihkan ke rekan tim / dijadwal ulang Senin."
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-bold text-slate-900">
            Lampiran Foto Bukti / Surat Dokter (Opsional)
          </label>
          {proofPhoto ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
              <button
                type="button"
                onClick={() =>
                  onOpenPhoto({
                    url: proofPhoto.dataUrl,
                    title: `Bukti ${absenceType} · ${user.fullName}`,
                    notes: reason,
                    lat: gpsPosition?.lat,
                    lng: gpsPosition?.lng,
                  })
                }
                className="h-16 w-20 overflow-hidden rounded-lg border border-slate-300 bg-black shrink-0"
              >
                <img src={proofPhoto.dataUrl} alt="Bukti tidak masuk" className="h-full w-full object-cover" />
              </button>
              <div className="flex-1 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Lampiran foto bukti siap dikirim</span>
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
              onClick={() => setCameraOpen(true)}
              className="flex w-full min-h-[60px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50/50 p-3.5 text-xs sm:text-sm font-bold text-orange-800 hover:bg-orange-100/70 transition"
            >
              <Camera className="h-5 w-5 text-orange-600" />
              <span>Ambil Foto / Unggah Surat Dokter &amp; Bukti</span>
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-slate-800 disabled:opacity-60 transition"
        >
          <Send className="h-4 w-4 text-amber-400" />
          <span>{submitting ? 'Menyimpan...' : `Kirim Catatan ${absenceType}`}</span>
        </button>
      </form>

      {/* Right Summary Column */}
      <div className="space-y-4 lg:col-span-4">
        <div className="rounded-2xl border border-amber-400 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-slate-950">
              Catatan Tidak Masuk Aktif ({absenceReports.length})
            </h3>
            <CalendarOff className="h-5 w-5 text-orange-600" />
          </div>
          {absenceReports.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              Tidak ada catatan Libur, Sakit, Izin, atau Cuti untuk hari ini.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {absenceReports.map((ab) => (
                <div
                  key={ab.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                      {ab.absenceType}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {formatTimeWIB(ab.submittedAt)}
                    </span>
                  </div>
                  <div className="font-mono font-bold text-slate-900">
                    {formatDateID(ab.startDate)}
                    {ab.endDate !== ab.startDate ? ` s.d. ${formatDateID(ab.endDate)}` : ''}
                  </div>
                  <p className="text-slate-700">{ab.reason}</p>
                  {ab.fieldNotes && (
                    <p className="text-[11px] text-slate-500 italic">
                      Catatan Lapangan: {ab.fieldNotes}
                    </p>
                  )}
                  {ab.photoUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenPhoto({
                          url: ab.photoUrl,
                          title: `${user.fullName} · ${ab.absenceType}`,
                          subtitle: `${formatDateID(ab.startDate)} - ${formatDateID(ab.endDate)}`,
                          notes: ab.reason,
                        })
                      }
                      className="text-xs font-bold text-orange-700 hover:underline"
                    >
                      Lihat Foto Bukti
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CameraCaptureModal
        isOpen={cameraOpen}
        title={`Bukti ${absenceType} — ${user.fullName}`}
        userName={user.fullName}
        activityLabel={`Tidak Masuk (${absenceType})`}
        gpsPosition={gpsPosition}
        allowFileUpload={true}
        onConfirm={(dataUrl, capturedAt) => {
          setCameraOpen(false);
          setProofPhoto({ dataUrl, capturedAt });
        }}
        onClose={() => setCameraOpen(false)}
      />
    </div>
  );
};
