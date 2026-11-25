import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarOff,
  Camera,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  History,
  Home,
  MapPin,
  Navigation,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Target,
  Users,
  WifiOff,
} from 'lucide-react';
import { useGeolocation } from '../hooks/useGeolocation';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import {
  Announcement,
  DailyReportType,
  EMPLOYEE_CATEGORIES,
  EmployeeCategory,
  LeaderTeamMember,
  LightboxPhoto,
  MyTodayResponse,
  Product,
  User,
} from '../types';
import { apiFetch } from '../utils/api';
import {
  formatDateID,
  formatDateTimeWIB,
  formatRupiah,
  formatTimeWIB,
} from '../utils/format';
import { AbsencePanel } from './AbsencePanel';
import { AnnouncementBoard } from './AnnouncementBoard';
import { CameraCaptureModal } from './CameraCaptureModal';
import { CollectorReportPanel } from './CollectorReportPanel';
import { DailyReportPanels } from './DailyReportPanels';
import { SalesRepPanel } from './SalesRepPanel';

interface FieldWorkspaceProps {
  user: User;
  onOpenPhoto: (photo: LightboxPhoto) => void;
}

type FieldTab = 'home' | 'report' | 'absence' | 'team' | 'history';

function reportTypeLabel(rt: DailyReportType): string {
  if (rt === 'spg_stay') return 'SPG/SPB';
  if (rt === 'spg_mobile') return 'SMD / Lapangan';
  return 'Event';
}

function quickReportLabel(cat?: EmployeeCategory): string {
  if (cat === 'Sales Representatif') return 'Laporan Sales Rep →';
  if (cat === 'Kolektor') return 'Penagihan Kolektor →';
  if (cat === 'SPG/SPB') return 'Laporan SPG/SPB →';
  if (cat === 'SMD') return 'Laporan SMD →';
  if (cat === 'Event') return 'Laporan Event →';
  return 'Laporan Kerja →';
}

export const FieldWorkspace: React.FC<FieldWorkspaceProps> = ({ user, onOpenPhoto }) => {
  const isLeader = user.role === 'Leader/SPV';
  const [activeTab, setActiveTab] = useState<FieldTab>('home');
  const [leaderPreviewCategory, setLeaderPreviewCategory] = useState<EmployeeCategory>(
    () => user.employeeCategory || 'Leader/SPV'
  );

  const [todayData, setTodayData] = useState<MyTodayResponse | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [teamMembers, setTeamMembers] = useState<LeaderTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // GPS + 30-second auto-ping
  const gps = useGeolocation(true, true);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [myRes, prodRes, annRes] = await Promise.all([
        apiFetch<MyTodayResponse>('/api/attendance/my-today'),
        apiFetch<{ products: Product[] }>('/api/products'),
        apiFetch<{ announcements: Announcement[] }>('/api/announcements'),
      ]);
      setTodayData(myRes);
      setProducts(prodRes.products);
      setAnnouncements(annRes.announcements);

      if (isLeader) {
        const teamRes = await apiFetch<{ team: LeaderTeamMember[] }>('/api/leader/team-overview');
        setTeamMembers(teamRes.team);
      }
    } catch {
      // Offline mode keeps last loaded data
    } finally {
      setLoading(false);
    }
  }, [isLeader]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  const offline = useOfflineQueue(user.id, loadWorkspaceData);

  // Camera modal state strictly for Check-In / Check-Out (camera-only)
  const [cameraMode, setCameraMode] = useState<{
    open: boolean;
    purpose: 'check_in' | 'check_out';
    title: string;
    activityLabel: string;
  }>({
    open: false,
    purpose: 'check_in',
    title: '',
    activityLabel: '',
  });
  const [submittingAttendance, setSubmittingAttendance] = useState(false);

  const hasCheckedInToday = Boolean(
    todayData?.visits.some((v) => v.recordType === 'check_in')
  );
  const hasCheckedOutToday = Boolean(
    todayData?.visits.some((v) => v.recordType === 'check_out')
  );

  const triggerCheckInOut = async (type: 'check_in' | 'check_out') => {
    setFeedback(null);
    try {
      await gps.refreshPosition();
    } catch {
      if (!gps.position) {
        setFeedback({
          type: 'err',
          text: 'Koordinat GPS wajib tersedia sebelum Check-In / Check-Out. Aktifkan GPS HP Anda.',
        });
        return;
      }
    }
    setCameraMode({
      open: true,
      purpose: type,
      title: type === 'check_in' ? 'Foto Bukti Check-In' : 'Foto Bukti Check-Out',
      activityLabel: type === 'check_in' ? 'Absen Check-In' : 'Absen Check-Out',
    });
  };

  const handleCameraConfirm = async (dataUrl: string, capturedAtIso: string) => {
    const purpose = cameraMode.purpose;
    setCameraMode((prev) => ({ ...prev, open: false }));

    const pos = gps.position;
    if (!pos) {
      setFeedback({ type: 'err', text: 'Koordinat GPS belum terkunci. Coba muat ulang GPS.' });
      return;
    }

    const payload = {
      recordType: purpose,
      clientName: purpose === 'check_in' ? 'Absen Masuk Lapangan' : 'Absen Pulang Lapangan',
      visitStatus: purpose === 'check_in' ? 'Check-In' : 'Check-Out',
      notes: '',
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      photoBase64: dataUrl,
      capturedAt: capturedAtIso,
    };

    setSubmittingAttendance(true);
    try {
      if (!offline.isOnline) {
        offline.enqueue({
          kind: 'attendance',
          payload,
          label: purpose === 'check_in' ? 'Check-In Lapangan' : 'Check-Out Lapangan',
        });
        setFeedback({
          type: 'ok',
          text: 'Sinyal terputus. Data dan foto disimpan di antrean offline dan akan terkirim otomatis.',
        });
      } else {
        await apiFetch('/api/attendance/record', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setFeedback({
          type: 'ok',
          text:
            purpose === 'check_in'
              ? 'Check-In berhasil dicatat dengan foto GPS berstempel!'
              : 'Check-Out berhasil dicatat dengan foto GPS berstempel!',
        });
        await loadWorkspaceData();
      }
    } catch (err: any) {
      if (!err?.status) {
        offline.enqueue({
          kind: 'attendance',
          payload,
          label: purpose === 'check_in' ? 'Check-In Lapangan' : 'Check-Out Lapangan',
        });
        setFeedback({
          type: 'ok',
          text: 'Koneksi bermasalah. Disimpan sementara ke antrean offline.',
        });
      } else {
        setFeedback({ type: 'err', text: err.message || 'Gagal mengirim data absen.' });
      }
    } finally {
      setSubmittingAttendance(false);
    }
  };

  const navItems: Array<{ id: FieldTab; label: string; icon: React.ReactNode }> = isLeader
    ? [
        { id: 'home', label: 'Absen & GPS', icon: <Home className="h-5 w-5" /> },
        { id: 'team', label: 'Tim Downline', icon: <Users className="h-5 w-5" /> },
        { id: 'report', label: 'Laporan Kerja', icon: <ClipboardList className="h-5 w-5" /> },
        { id: 'absence', label: 'Tidak Masuk', icon: <CalendarOff className="h-5 w-5" /> },
        { id: 'history', label: 'Riwayat', icon: <History className="h-5 w-5" /> },
      ]
    : [
        { id: 'home', label: 'Beranda', icon: <Home className="h-5 w-5" /> },
        { id: 'report', label: 'Laporan Kerja', icon: <ClipboardList className="h-5 w-5" /> },
        { id: 'absence', label: 'Tidak Masuk', icon: <CalendarOff className="h-5 w-5" /> },
        { id: 'history', label: 'Riwayat', icon: <History className="h-5 w-5" /> },
      ];

  const effectiveReportCategory: EmployeeCategory = isLeader
    ? leaderPreviewCategory
    : user.employeeCategory || 'Sales Representatif';

  return (
    <div className="mx-auto max-w-6xl px-3 pt-4 pb-24 sm:px-6 lg:pb-10">
      {/* Desktop Top Segmented Nav */}
      <div className="hidden lg:flex items-center justify-between gap-4 mb-5 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition whitespace-nowrap ${
                activeTab === item.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={loadWorkspaceData}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Segarkan Data</span>
        </button>
      </div>

      {/* Offline / Queue Banner */}
      {(!offline.isOnline || offline.queue.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            <WifiOff className="h-5 w-5 shrink-0 text-amber-700" />
            <span>
              {!offline.isOnline
                ? 'Mode Offline Aktif — Laporan akan disimpan sementara hingga sinyal kembali.'
                : `${offline.queue.length} laporan menunggu sinkronisasi ke server.`}
            </span>
          </div>
          {offline.isOnline && offline.queue.length > 0 && (
            <button
              type="button"
              onClick={offline.flushQueue}
              disabled={offline.syncing}
              className="min-h-[40px] rounded-lg bg-orange-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-700"
            >
              {offline.syncing ? 'Mengirim...' : 'Kirim Sekarang'}
            </button>
          )}
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${
            feedback.type === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline underline-offset-2 shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* TAB: HOME / ABSEN & GPS */}
      {activeTab === 'home' && (
        <div className="space-y-5">
          <AnnouncementBoard announcements={announcements} loading={loading} />
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left Column: GPS + Check-In / Check-Out + Quick Access */}
            <div className="space-y-5 lg:col-span-7">
              {/* Real-Time GPS Status Card */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-extrabold text-slate-950">
                        Status GPS Real-Time
                      </h2>
                      <span className="rounded-md border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-extrabold text-slate-900">
                        {user.employeeCategory}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Pembaruan koordinat otomatis setiap 30 detik selama halaman terbuka
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => gps.refreshPosition().catch(() => {})}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-200"
                  >
                    <Navigation className="h-3.5 w-3.5 text-orange-600" />
                    <span>Perbarui GPS</span>
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {gps.status === 'active' ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                        <span className="text-emerald-800">GPS Aktif</span>
                      </>
                    ) : gps.status === 'locating' ? (
                      <>
                        <RefreshCw className="h-5 w-5 animate-spin text-orange-600 shrink-0" />
                        <span className="text-orange-800">Mengambil Koordinat GPS...</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                        <span className="text-red-800">
                          {gps.status === 'denied' ? 'Izin GPS Ditolak' : 'Kendala Sinyal GPS'}
                        </span>
                      </>
                    )}
                    {gps.position?.accuracy !== null && gps.position?.accuracy !== undefined && (
                      <span className="ml-auto font-mono text-xs font-bold text-slate-700 tabular-nums">
                        Akurasi ±{gps.position.accuracy} m
                      </span>
                    )}
                  </div>

                  {gps.errorMessage && (
                    <p className="mt-2 text-xs font-medium text-red-700">{gps.errorMessage}</p>
                  )}

                  {gps.position && (
                    <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-slate-200 pt-2.5 text-xs font-mono tabular-nums text-slate-800">
                      <div>
                        <span className="text-slate-500">Lat:</span>{' '}
                        <span className="font-bold">{gps.position.lat.toFixed(6)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Lng:</span>{' '}
                        <span className="font-bold">{gps.position.lng.toFixed(6)}</span>
                      </div>
                    </div>
                  )}

                  {gps.lastPingAt && (
                    <p className="mt-2 text-[11px] font-medium text-slate-600">
                      Sinkronisasi peta terakhir: {formatTimeWIB(gps.lastPingAt)}
                    </p>
                  )}
                </div>
              </section>

              {/* Primary Check-In / Check-Out Action Panel */}
              <section className="rounded-2xl border border-amber-400 bg-white p-4 sm:p-5 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-extrabold text-slate-950">
                    Kehadiran Lapangan Hari Ini
                  </h2>
                  <span className="text-xs font-bold text-slate-600">
                    Kamera Langsung + GPS
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="text-slate-600 font-medium">Status Check-In</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-950 font-mono tabular-nums">
                      {hasCheckedInToday
                        ? formatTimeWIB(
                            todayData?.visits.find((v) => v.recordType === 'check_in')?.capturedAt
                          )
                        : 'Belum Absen'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="text-slate-600 font-medium">Status Check-Out</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-950 font-mono tabular-nums">
                      {hasCheckedOutToday
                        ? formatTimeWIB(
                            todayData?.visits.find((v) => v.recordType === 'check_out')?.capturedAt
                          )
                        : 'Belum Pulang'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={submittingAttendance}
                    onClick={() => triggerCheckInOut('check_in')}
                    className="flex min-h-[54px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 active:scale-[0.99] disabled:opacity-60 transition"
                  >
                    <Camera className="h-5 w-5" />
                    <span>{hasCheckedInToday ? 'Check-In Ulang' : 'Check-In Sekarang'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={submittingAttendance}
                    onClick={() => triggerCheckInOut('check_out')}
                    className="flex min-h-[54px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white shadow-md hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60 transition"
                  >
                    <Clock className="h-5 w-5 text-amber-400" />
                    <span>{hasCheckedOutToday ? 'Check-Out Ulang' : 'Check-Out Sekarang'}</span>
                  </button>
                </div>

                {/* Active Absence Notice if submitted today */}
                {todayData?.absenceReports && todayData.absenceReports.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-400 bg-amber-50 px-3.5 py-2.5 text-xs font-bold text-amber-950 flex items-center justify-between gap-2">
                    <span>
                      Status Tidak Masuk Hari Ini:{' '}
                      <strong className="text-orange-700">
                        {todayData.absenceReports[0].absenceType}
                      </strong>{' '}
                      ({todayData.absenceReports[0].reason})
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('absence')}
                      className="text-xs font-extrabold underline shrink-0"
                    >
                      Lihat
                    </button>
                  </div>
                )}

                {/* Quick Jump Buttons */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('report')}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-500 bg-amber-50 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-100 transition"
                  >
                    <ClipboardList className="h-4 w-4 text-orange-600" />
                    <span>{quickReportLabel(user.employeeCategory)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('absence')}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-900 hover:border-orange-500 hover:bg-orange-50 transition"
                  >
                    <CalendarOff className="h-4 w-4 text-orange-600" />
                    <span>Tidak Masuk (Libur/Sakit/Izin) →</span>
                  </button>
                </div>
              </section>

              {isLeader && (
                <section className="rounded-2xl border border-slate-300 bg-slate-900 p-4 text-white shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-amber-400">Ringkasan Leader / SPV</div>
                      <div className="mt-0.5 text-sm font-extrabold">
                        {teamMembers.length} Karyawan Downline Terdaftar
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('team')}
                      className="min-h-[40px] rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-orange-700"
                    >
                      Pantau Tim Downline →
                    </button>
                  </div>
                </section>
              )}
            </div>

            {/* Right Column: Target Penjualan Saya & Ringkasan */}
            <div className="space-y-5 lg:col-span-5">
              <section className="rounded-2xl border border-amber-400 bg-white p-4 sm:p-5 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-extrabold text-slate-950">
                    Target &amp; Pencapaian Saya
                  </h2>
                  <Target className="h-5 w-5 text-amber-600" />
                </div>

                {loading && !todayData ? (
                  <p className="mt-4 text-sm text-slate-500">Memuat target...</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {/* Global Target Card */}
                    {todayData?.targets.globalTarget && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            Target Global ({todayData.targets.globalTarget.period})
                          </span>
                          <span className="font-mono text-xs font-extrabold text-orange-700 tabular-nums">
                            {todayData.targets.globalTarget.pct}%
                          </span>
                        </div>
                        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-orange-600 transition-all"
                            style={{
                              width: `${Math.min(100, todayData.targets.globalTarget.pct)}%`,
                            }}
                          />
                        </div>
                        <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-xs text-slate-700 font-mono tabular-nums">
                          <span>
                            Tim: {formatRupiah(todayData.targets.globalTarget.teamActualAmount)} /{' '}
                            {formatRupiah(todayData.targets.globalTarget.targetAmount)}
                          </span>
                          <span>
                            Kontribusi Saya:{' '}
                            <strong className="text-slate-950">
                              {formatRupiah(todayData.targets.globalTarget.myActualAmount)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Specific Personal Targets */}
                    {todayData?.targets.specificTargets.length ? (
                      todayData.targets.specificTargets.map((st) => {
                        const pct = st.pctAmount ?? st.pctQty ?? 0;
                        return (
                          <div
                            key={st.id}
                            className="rounded-xl border border-amber-300 bg-amber-50/40 p-3.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-950">
                                Target Spesifik ({st.period})
                                {st.productName
                                  ? ` · ${st.productName}`
                                  : st.category
                                  ? ` · Kategori ${st.category}`
                                  : ''}
                              </span>
                              <span className="font-mono text-xs font-extrabold text-amber-800 tabular-nums">
                                {pct}%
                              </span>
                            </div>
                            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-amber-200/70">
                              <div
                                className="h-full rounded-full bg-amber-600 transition-all"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <div className="mt-2 space-y-0.5 text-xs font-mono tabular-nums text-slate-800">
                              {st.targetAmount > 0 && (
                                <div>
                                  Omzet: {formatRupiah(st.actualAmount)} /{' '}
                                  {formatRupiah(st.targetAmount)}
                                </div>
                              )}
                              {st.targetQty > 0 && (
                                <div>
                                  Quantity: {st.actualQty} / {st.targetQty} {st.productUnit || 'unit'}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-slate-600">
                        Belum ada target spesifik pribadi yang ditetapkan Admin.
                      </p>
                    )}

                    {/* Today's Sales Quick Box */}
                    <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                      <div>
                        <div className="text-xs font-medium text-slate-600">Qty Terjual Hari Ini</div>
                        <div className="mt-0.5 font-mono text-lg font-extrabold text-slate-950 tabular-nums">
                          {todayData?.salesSummary.totalQty ?? 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-600">Omzet Hari Ini</div>
                        <div className="mt-0.5 font-mono text-lg font-extrabold text-orange-700 tabular-nums">
                          {formatRupiah(todayData?.salesSummary.totalAmount ?? 0)}
                        </div>
                      </div>
                    </div>

                    {(user.employeeCategory === 'Sales Representatif' ||
                      (todayData?.salesRepReports?.length ?? 0) > 0) && (
                      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                        <div>
                          <div className="text-xs font-medium text-slate-600">
                            PO Sales Rep Hari Ini
                          </div>
                          <div className="mt-0.5 font-mono text-base font-extrabold text-orange-700 tabular-nums">
                            {formatRupiah(
                              (todayData?.salesRepReports || [])
                                .filter((r) => r.subType === 'po')
                                .reduce((s, r) => s + r.poTotalAmount, 0)
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-600">
                            Outlet Baru (NOO)
                          </div>
                          <div className="mt-0.5 font-mono text-base font-extrabold text-slate-950 tabular-nums">
                            {
                              (todayData?.salesRepReports || []).filter((r) => r.subType === 'noo')
                                .length
                            }{' '}
                            outlet
                          </div>
                        </div>
                      </div>
                    )}

                    {(user.employeeCategory === 'Kolektor' ||
                      (todayData?.collectionSummary?.count ?? 0) > 0) && (
                      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                        <div>
                          <div className="text-xs font-medium text-slate-600">Penagihan Hari Ini</div>
                          <div className="mt-0.5 font-mono text-base font-extrabold text-slate-950 tabular-nums">
                            {todayData?.collectionSummary?.count ?? 0} faktur
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-600">Total Tertagih</div>
                          <div className="mt-0.5 font-mono text-base font-extrabold text-emerald-700 tabular-nums">
                            {formatRupiah(todayData?.collectionSummary?.totalCollected ?? 0)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* TAB: AUTO-ADAPTED REPORT FORM BY EMPLOYEE CATEGORY */}
      {activeTab === 'report' && (
        <div className="space-y-4">
          {isLeader && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold text-slate-950">
                  Mode Formulir Leader / SPV
                </div>
                <p className="text-[11px] text-slate-600">
                  Pilih form laporan sesuai kategori tugas atau pendampingan tim Anda hari ini.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EMPLOYEE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setLeaderPreviewCategory(cat)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      leaderPreviewCategory === cat
                        ? 'border-orange-600 bg-orange-600 text-white'
                        : 'border-slate-300 bg-slate-50 text-slate-800 hover:border-orange-400'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {effectiveReportCategory === 'Sales Representatif' && (
            <SalesRepPanel
              user={user}
              products={products}
              todayData={todayData}
              gpsPosition={gps.position}
              refreshPosition={gps.refreshPosition}
              isOnline={offline.isOnline}
              enqueueOffline={offline.enqueue}
              onSubmitted={loadWorkspaceData}
              onFeedback={setFeedback}
              onOpenPhoto={onOpenPhoto}
            />
          )}

          {effectiveReportCategory === 'Kolektor' && (
            <CollectorReportPanel
              user={user}
              todayData={todayData}
              gpsPosition={gps.position}
              refreshPosition={gps.refreshPosition}
              isOnline={offline.isOnline}
              enqueueOffline={offline.enqueue}
              onSubmitted={loadWorkspaceData}
              onFeedback={setFeedback}
              onOpenPhoto={onOpenPhoto}
            />
          )}

          {effectiveReportCategory === 'SPG/SPB' && (
            <DailyReportPanels
              user={user}
              products={products}
              todayData={todayData}
              gpsPosition={gps.position}
              refreshPosition={gps.refreshPosition}
              isOnline={offline.isOnline}
              enqueueOffline={offline.enqueue}
              onSubmitted={loadWorkspaceData}
              onFeedback={setFeedback}
              onOpenPhoto={onOpenPhoto}
              forcedMode="spg_stay"
              hideModeSelector={true}
            />
          )}

          {effectiveReportCategory === 'SMD' && (
            <DailyReportPanels
              user={user}
              products={products}
              todayData={todayData}
              gpsPosition={gps.position}
              refreshPosition={gps.refreshPosition}
              isOnline={offline.isOnline}
              enqueueOffline={offline.enqueue}
              onSubmitted={loadWorkspaceData}
              onFeedback={setFeedback}
              onOpenPhoto={onOpenPhoto}
              forcedMode="spg_mobile"
              hideModeSelector={true}
            />
          )}

          {effectiveReportCategory === 'Event' && (
            <DailyReportPanels
              user={user}
              products={products}
              todayData={todayData}
              gpsPosition={gps.position}
              refreshPosition={gps.refreshPosition}
              isOnline={offline.isOnline}
              enqueueOffline={offline.enqueue}
              onSubmitted={loadWorkspaceData}
              onFeedback={setFeedback}
              onOpenPhoto={onOpenPhoto}
              forcedMode="event"
              hideModeSelector={true}
            />
          )}

          {effectiveReportCategory === 'Leader/SPV' && (
            <DailyReportPanels
              user={user}
              products={products}
              todayData={todayData}
              gpsPosition={gps.position}
              refreshPosition={gps.refreshPosition}
              isOnline={offline.isOnline}
              enqueueOffline={offline.enqueue}
              onSubmitted={loadWorkspaceData}
              onFeedback={setFeedback}
              onOpenPhoto={onOpenPhoto}
              forcedMode="spg_mobile"
              hideModeSelector={false}
            />
          )}
        </div>
      )}

      {/* TAB: TIDAK MASUK KERJA (LIBUR / SAKIT / IZIN / CUTI) */}
      {activeTab === 'absence' && (
        <AbsencePanel
          user={user}
          todayData={todayData}
          gpsPosition={gps.position}
          refreshPosition={gps.refreshPosition}
          isOnline={offline.isOnline}
          enqueueOffline={offline.enqueue}
          onSubmitted={loadWorkspaceData}
          onFeedback={setFeedback}
          onOpenPhoto={onOpenPhoto}
        />
      )}

      {/* TAB: LEADER / SPV DOWNLINE TEAM */}
      {activeTab === 'team' && isLeader && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-950">
                Pemantauan Tim Downline Hari Ini
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Pantau kehadiran, lokasi GPS, laporan harian (SPG Stay/Mobile/Event), penagihan kolektor, penjualan, dan target anggota tim Anda.
              </p>
            </div>
            <button
              type="button"
              onClick={loadWorkspaceData}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Muat Ulang Tim</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="rounded-xl border border-amber-400 bg-white p-3.5 shadow-xs">
              <div className="text-[11px] sm:text-xs font-bold text-slate-600">Total Downline</div>
              <div className="mt-1 font-mono text-xl sm:text-2xl font-extrabold text-slate-950 tabular-nums">
                {teamMembers.length}
              </div>
            </div>
            <div className="rounded-xl border border-amber-400 bg-white p-3.5 shadow-xs">
              <div className="text-[11px] sm:text-xs font-bold text-slate-600">Check-In Hari Ini</div>
              <div className="mt-1 font-mono text-xl sm:text-2xl font-extrabold text-emerald-700 tabular-nums">
                {teamMembers.filter((m) => Boolean(m.checkInTime)).length}
              </div>
            </div>
            <div className="rounded-xl border border-amber-400 bg-slate-900 p-3.5 text-white shadow-xs">
              <div className="text-[11px] sm:text-xs font-bold text-amber-400">Omzet Tim Hari Ini</div>
              <div className="mt-1 font-mono text-sm sm:text-lg font-extrabold tabular-nums">
                {formatRupiah(
                  teamMembers.reduce((sum, m) => sum + (m.salesSummary?.totalAmount || 0), 0)
                )}
              </div>
            </div>
            <div className="rounded-xl border border-amber-400 bg-white p-3.5 shadow-xs">
              <div className="text-[11px] sm:text-xs font-bold text-slate-600">Tertagih Kolektor</div>
              <div className="mt-1 font-mono text-sm sm:text-lg font-extrabold text-emerald-700 tabular-nums">
                {formatRupiah(
                  teamMembers.reduce((sum, m) => sum + (m.collectionSummary?.totalCollected || 0), 0)
                )}
              </div>
            </div>
          </div>

          {teamMembers.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
              Belum ada karyawan yang ditetapkan sebagai downline Anda oleh Admin.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {teamMembers.map((m) => (
                <div
                  key={m.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-extrabold text-slate-950">{m.fullName}</h3>
                        <span className="rounded-md border border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-900">
                          {m.employeeCategory}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-600">
                        {m.phone} · {m.lastStatusLabel || 'Menunggu aktivitas'}
                      </p>
                    </div>
                    {m.lastLat !== null && m.lastLng !== null && (
                      <a
                        href={`https://www.google.com/maps?q=${m.lastLat},${m.lastLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800 shrink-0"
                      >
                        <MapPin className="h-3.5 w-3.5 text-amber-400" />
                        <span>Peta GPS</span>
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                      <span className="text-slate-500">Check-In / Out:</span>
                      <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                        {m.checkInTime ? formatTimeWIB(m.checkInTime) : '-'} /{' '}
                        {m.checkOutTime ? formatTimeWIB(m.checkOutTime) : '-'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-amber-50/60 p-2.5 border border-amber-300">
                      <span className="text-slate-600">Penjualan Hari Ini:</span>
                      <div className="mt-0.5 font-mono font-bold text-orange-700 tabular-nums">
                        {m.salesSummary.totalQty} unit · {formatRupiah(m.salesSummary.totalAmount)}
                      </div>
                    </div>
                  </div>

                  {(m.collectionSummary?.count > 0 || m.employeeCategory === 'Kolektor') && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs flex items-center justify-between">
                      <span className="font-bold text-emerald-900">
                        Penagihan Kolektor ({m.collectionSummary?.count || 0} faktur):
                      </span>
                      <span className="font-mono font-extrabold text-emerald-800 tabular-nums">
                        Tertagih {formatRupiah(m.collectionSummary?.totalCollected || 0)}
                      </span>
                    </div>
                  )}

                  {m.lastGpsAt && (
                    <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                      Update GPS terakhir: {formatTimeWIB(m.lastGpsAt)} (
                      {m.lastLat?.toFixed(5)}, {m.lastLng?.toFixed(5)})
                    </div>
                  )}

                  {m.specificTargets.length > 0 && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                      <div className="text-xs font-bold text-slate-800">Target Spesifik:</div>
                      {m.specificTargets.map((st) => (
                        <div key={st.id} className="text-xs font-mono text-slate-700 tabular-nums">
                          {st.period}:{' '}
                          {st.targetAmount > 0
                            ? `${formatRupiah(st.actualAmount)} / ${formatRupiah(st.targetAmount)}`
                            : ''}{' '}
                          {st.targetQty > 0 ? `(${st.actualQty}/${st.targetQty} unit)` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Downline Absence Reports (Libur / Sakit / Izin / Cuti) */}
                  {m.absenceReports && m.absenceReports.length > 0 && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                      <div className="text-xs font-bold text-amber-800">
                        Status Tidak Masuk ({m.absenceReports.length})
                      </div>
                      {m.absenceReports.map((ab) => (
                        <div
                          key={ab.id}
                          className="rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                              {ab.absenceType}
                            </span>
                            <span className="font-mono text-[11px] text-slate-700">
                              {formatDateID(ab.startDate)}
                              {ab.endDate !== ab.startDate ? ` - ${formatDateID(ab.endDate)}` : ''}
                            </span>
                          </div>
                          <div className="text-slate-800">{ab.reason}</div>
                          {ab.fieldNotes && (
                            <div className="text-[11px] text-slate-600 italic">
                              Catatan Lapangan: {ab.fieldNotes}
                            </div>
                          )}
                          {(ab.photoUrl || (ab.adminAttachments?.length ?? 0) > 0) && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {ab.photoUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: ab.photoUrl,
                                      title: `${m.fullName} · ${ab.absenceType}`,
                                      subtitle: `${formatDateID(ab.startDate)} s.d. ${formatDateID(ab.endDate)}`,
                                      notes: ab.fieldNotes || ab.reason,
                                    })
                                  }
                                  className="h-10 w-10 overflow-hidden rounded-md border border-slate-300"
                                >
                                  <img src={ab.photoUrl} alt="Bukti tidak masuk" className="h-full w-full object-cover" />
                                </button>
                              )}
                              {ab.adminAttachments?.map((att) => (
                                <button
                                  key={`att-${att.id}`}
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: att.photoUrl,
                                      title: `Lampiran Admin · ${m.fullName}`,
                                      subtitle: formatDateTimeWIB(att.createdAt),
                                      notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                    })
                                  }
                                  className="h-10 w-10 overflow-hidden rounded-md border-2 border-amber-500"
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

                  {/* Downline Sales Representatif Reports (Penawaran / PO / NOO) */}
                  {m.salesRepReports && m.salesRepReports.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-2">
                      <div className="text-xs font-bold text-slate-800">
                        Laporan Sales Representatif ({m.salesRepReports.length})
                      </div>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {m.salesRepReports.map((sr) => (
                          <div
                            key={sr.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-slate-950">
                                [{sr.subType.toUpperCase()}] {sr.subType === 'noo' ? sr.outletName : sr.clientName}
                              </span>
                              {sr.subType === 'po' ? (
                                <span className="font-mono font-bold text-orange-700">
                                  {formatRupiah(sr.poTotalAmount)}
                                </span>
                              ) : (
                                <span className="font-mono text-[11px] text-slate-500">
                                  {formatTimeWIB(sr.reportedAt)}
                                </span>
                              )}
                            </div>
                            {sr.subType === 'po' && (
                              <div className="text-[11px] text-slate-600 font-mono">
                                {sr.poTotalQty} unit ({sr.poItems.length} SKU)
                              </div>
                            )}
                            {sr.subType === 'penawaran' && (
                              <div className="text-[11px] text-slate-700">
                                Status: <strong>{sr.offerStatus}</strong> · {sr.offerNotes}
                              </div>
                            )}
                            {sr.subType === 'noo' && (
                              <div className="text-[11px] text-slate-700">
                                {sr.outletType}
                                {sr.outletOwner ? ` · ${sr.outletOwner}` : ''}
                                {sr.outletAddress ? ` · ${sr.outletAddress}` : ''}
                              </div>
                            )}
                            {sr.fieldNotes && (
                              <div className="text-[11px] text-slate-600 italic">
                                Catatan Lapangan: {sr.fieldNotes}
                              </div>
                            )}
                            {(sr.photos.length > 0 || (sr.adminAttachments?.length ?? 0) > 0) && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {sr.photos.map((ph, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() =>
                                      onOpenPhoto({
                                        url: ph.photoUrl,
                                        title: `${m.fullName} · ${sr.subType.toUpperCase()}`,
                                        subtitle: sr.clientName || sr.outletName,
                                        notes: sr.fieldNotes || sr.notes,
                                        lat: sr.lat ?? undefined,
                                        lng: sr.lng ?? undefined,
                                      })
                                    }
                                    className="h-10 w-10 overflow-hidden rounded-md border border-slate-300"
                                  >
                                    <img src={ph.photoUrl} alt="Foto Sales Rep" className="h-full w-full object-cover" />
                                  </button>
                                ))}
                                {sr.adminAttachments?.map((att) => (
                                  <button
                                    key={`att-${att.id}`}
                                    type="button"
                                    onClick={() =>
                                      onOpenPhoto({
                                        url: att.photoUrl,
                                        title: `Lampiran Admin · ${sr.clientName || sr.outletName}`,
                                        subtitle: formatDateTimeWIB(att.createdAt),
                                        notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                      })
                                    }
                                    className="h-10 w-10 overflow-hidden rounded-md border-2 border-amber-500"
                                  >
                                    <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Downline Daily Reports (SPG/SPB / SMD / Event) */}
                  {m.dailyReports && m.dailyReports.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-2">
                      <div className="text-xs font-bold text-slate-800">
                        Laporan Harian ({m.dailyReports.length})
                      </div>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {m.dailyReports.map((dr) => (
                          <div
                            key={dr.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-slate-950">
                                {reportTypeLabel(dr.reportType)} ·{' '}
                                {dr.reportType === 'event' ? dr.eventName : dr.clientName}
                              </span>
                              <span className="font-mono font-bold text-orange-700">
                                {formatRupiah(
                                  dr.reportType === 'event'
                                    ? dr.realizedSalesAmount
                                    : dr.totalSalesAmount
                                )}
                              </span>
                            </div>
                            {dr.reportType === 'event' ? (
                              <div className="text-[11px] text-slate-600">
                                Pengunjung: {dr.realizedVisitors}/{dr.targetVisitors} · Biaya:{' '}
                                {formatRupiah(dr.totalExpense)}
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-600">
                                {dr.totalQty} unit terjual
                                {dr.offerNotes ? ` · Penawaran: ${dr.offerNotes}` : ''}
                              </div>
                            )}
                            {dr.fieldNotes && (
                              <div className="text-[11px] text-slate-600 italic">
                                Catatan Lapangan: {dr.fieldNotes}
                              </div>
                            )}
                            {(dr.photos.length > 0 || (dr.adminAttachments?.length ?? 0) > 0) && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {dr.photos.map((ph) => (
                                  <button
                                    key={ph.id}
                                    type="button"
                                    onClick={() =>
                                      onOpenPhoto({
                                        url: ph.photoUrl,
                                        title: `${m.fullName} · ${reportTypeLabel(dr.reportType)}`,
                                        subtitle: `${
                                          ph.photoKind === 'transaction_proof'
                                            ? 'Bukti Transaksi'
                                            : 'Foto Kegiatan'
                                        } · ${formatDateTimeWIB(ph.capturedAt)}`,
                                        notes: dr.fieldNotes || dr.notes || dr.obstacles,
                                        lat: dr.lat ?? undefined,
                                        lng: dr.lng ?? undefined,
                                      })
                                    }
                                    className="h-10 w-10 overflow-hidden rounded-md border border-slate-300"
                                  >
                                    <img
                                      src={ph.photoUrl}
                                      alt="Foto laporan"
                                      className="h-full w-full object-cover"
                                    />
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
                                    className="h-10 w-10 overflow-hidden rounded-md border-2 border-amber-500"
                                  >
                                    <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Downline Collector Reports */}
                  {m.collectionReports && m.collectionReports.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-2">
                      <div className="text-xs font-bold text-slate-800">
                        Laporan Kolektor ({m.collectionReports.length})
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {m.collectionReports.map((cr) => (
                          <div
                            key={cr.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-bold text-slate-900">
                                {cr.customerName} · {cr.invoiceNumber}
                              </div>
                              <div className="text-[11px] font-mono text-slate-600">
                                {cr.visitStatus} ({cr.paymentMethod}) · Tertagih{' '}
                                <strong className="text-emerald-700">
                                  {formatRupiah(cr.collectedAmount)}
                                </strong>{' '}
                                · Sisa {formatRupiah(cr.remainingAmount)}
                              </div>
                              {cr.fieldNotes && (
                                <div className="text-[11px] text-slate-600 italic">
                                  Catatan Lapangan: {cr.fieldNotes}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {cr.photoUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: cr.photoUrl,
                                      title: `${m.fullName} · ${cr.customerName}`,
                                      subtitle: `${cr.invoiceNumber} (${cr.visitStatus})`,
                                      notes: cr.fieldNotes || cr.notes || cr.reason,
                                      lat: cr.lat ?? undefined,
                                      lng: cr.lng ?? undefined,
                                    })
                                  }
                                  className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-slate-300"
                                >
                                  <img
                                    src={cr.photoUrl}
                                    alt={cr.customerName}
                                    className="h-full w-full object-cover"
                                  />
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
                                  className="h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 border-amber-500"
                                >
                                  <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Attendance / Check-in / Check-out */}
                  {m.visits.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-2">
                      <div className="text-xs font-bold text-slate-800">
                        Absensi &amp; Foto Bukti ({m.visits.length})
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {m.visits.map((v) => (
                          <div
                            key={v.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-bold text-slate-900">
                                {v.clientName} ({v.visitStatus})
                              </div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {formatTimeWIB(v.capturedAt)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenPhoto({
                                    url: v.photoUrl,
                                    title: `${m.fullName} · ${v.clientName}`,
                                    subtitle: `${v.visitStatus} · ${formatDateTimeWIB(v.capturedAt)}`,
                                    notes: v.notes,
                                    lat: v.lat,
                                    lng: v.lng,
                                  })
                                }
                                className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-300"
                              >
                                <img
                                  src={v.photoUrl}
                                  alt={v.clientName}
                                  className="h-full w-full object-cover"
                                />
                              </button>
                              {v.adminAttachments?.map((att) => (
                                <button
                                  key={`att-${att.id}`}
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: att.photoUrl,
                                      title: `Lampiran Admin · ${m.fullName}`,
                                      subtitle: formatDateTimeWIB(att.createdAt),
                                      notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                    })
                                  }
                                  className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border-2 border-amber-500"
                                >
                                  <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: PERSONAL HISTORY TODAY */}
      {activeTab === 'history' && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Absensi */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h2 className="text-base font-extrabold text-slate-950">
                Riwayat Absensi &amp; GPS Hari Ini
              </h2>
              {!todayData?.visits.length ? (
                <p className="mt-4 text-sm text-slate-500">
                  Belum ada catatan Check-In atau Check-Out hari ini.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {todayData.visits.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onOpenPhoto({
                            url: v.photoUrl,
                            title: `${user.fullName} · ${v.clientName}`,
                            subtitle: `${v.visitStatus} · ${formatDateTimeWIB(v.capturedAt)}`,
                            notes: v.notes,
                            lat: v.lat,
                            lng: v.lng,
                          })
                        }
                        className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-slate-200"
                      >
                        <img
                          src={v.photoUrl}
                          alt={v.clientName}
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-bold text-slate-950">{v.clientName}</span>
                          <span className="text-xs font-extrabold text-orange-700">
                            {v.visitStatus}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs font-mono text-slate-600 tabular-nums">
                          {formatTimeWIB(v.capturedAt)} · GPS: {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                        </div>
                        {v.notes && <p className="mt-1 text-xs text-slate-700">{v.notes}</p>}
                        {v.adminAttachments && v.adminAttachments.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {v.adminAttachments.map((att) => (
                              <button
                                key={`att-${att.id}`}
                                type="button"
                                onClick={() =>
                                  onOpenPhoto({
                                    url: att.photoUrl,
                                    title: `Lampiran Admin · ${v.clientName}`,
                                    subtitle: formatDateTimeWIB(att.createdAt),
                                    notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                  })
                                }
                                className="h-10 w-10 overflow-hidden rounded-lg border-2 border-amber-500"
                              >
                                <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        )}
                        <a
                          href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-blue-900 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>Lihat di Google Maps</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rincian Item Penjualan */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h2 className="text-base font-extrabold text-slate-950">
                Riwayat Item Penjualan Hari Ini
              </h2>
              {!todayData?.sales.length ? (
                <p className="mt-4 text-sm text-slate-500">
                  Belum ada item produk terjual hari ini.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-slate-100">
                  {todayData.sales.map((s) => (
                    <div key={s.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-slate-950">
                            [{s.productSku}] {s.productName}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-600">
                            Qty: <strong className="font-mono">{s.quantity}</strong> {s.productUnit} ×{' '}
                            <span className="font-mono">{formatRupiah(s.appliedUnitPrice)}</span>
                            {s.clientName ? ` · ${s.clientName}` : ''}
                          </div>
                          {s.notes && <p className="mt-0.5 text-xs text-slate-500">{s.notes}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-sm font-extrabold text-orange-700 tabular-nums">
                            {formatRupiah(s.totalAmount)}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {formatTimeWIB(s.reportedAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Laporan Sales Representatif (Penawaran / PO / NOO) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-950">
                Riwayat Laporan Sales Representatif (Penawaran / PO / NOO)
              </h2>
              <ShoppingCart className="h-4 w-4 text-orange-600" />
            </div>
            {!todayData?.salesRepReports?.length ? (
              <p className="mt-3 text-sm text-slate-500">
                Belum ada laporan Penawaran, PO, atau NOO hari ini.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {todayData.salesRepReports.map((sr) => (
                  <div
                    key={sr.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                          {sr.subType === 'po'
                            ? 'PO (Purchase Order)'
                            : sr.subType === 'noo'
                            ? 'NOO (Outlet Baru)'
                            : 'Penawaran Produk'}
                        </span>
                        <h3 className="mt-1 text-sm font-extrabold text-slate-950">
                          {sr.subType === 'noo' ? sr.outletName : sr.clientName}
                        </h3>
                      </div>
                      <div className="text-right">
                        {sr.subType === 'po' && (
                          <div className="font-mono text-sm font-extrabold text-orange-700">
                            {formatRupiah(sr.poTotalAmount)}
                          </div>
                        )}
                        <div className="font-mono text-[11px] text-slate-500">
                          {formatTimeWIB(sr.reportedAt)}
                        </div>
                      </div>
                    </div>

                    {sr.subType === 'po' && sr.poItems.length > 0 && (
                      <div className="text-xs text-slate-700 space-y-0.5 border-t border-slate-200 pt-2">
                        {sr.poItems.map((it, idx) => (
                          <div key={idx} className="flex justify-between font-mono text-[11px]">
                            <span>
                              {it.productName} ({it.quantity} {it.productUnit})
                            </span>
                            <span>{formatRupiah(it.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {sr.subType === 'penawaran' && (
                      <div className="text-xs text-slate-700">
                        <strong className="text-blue-900">[{sr.offerStatus}]</strong> {sr.offerNotes}
                        {sr.followUpDate ? ` · Follow-Up: ${formatDateID(sr.followUpDate)}` : ''}
                      </div>
                    )}

                    {sr.subType === 'noo' && (
                      <div className="text-xs text-slate-700 space-y-0.5">
                        <div>
                          {sr.outletType}
                          {sr.outletOwner ? ` · Pemilik: ${sr.outletOwner}` : ''}
                          {sr.outletPhone ? ` (${sr.outletPhone})` : ''}
                        </div>
                        {sr.outletAddress && <div>Alamat: {sr.outletAddress}</div>}
                        {sr.outletPotential && <div>Potensi: {sr.outletPotential}</div>}
                      </div>
                    )}

                    {sr.notes && (
                      <div className="text-xs text-slate-600">
                        <strong>Catatan:</strong> {sr.notes}
                      </div>
                    )}
                    {sr.fieldNotes && (
                      <div className="text-xs text-amber-900 bg-amber-50/80 rounded-lg px-2.5 py-1.5 border border-amber-200">
                        <strong>Catatan Lapangan:</strong> {sr.fieldNotes}
                      </div>
                    )}

                    {(sr.photos.length > 0 || (sr.adminAttachments?.length ?? 0) > 0) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {sr.photos.map((ph, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() =>
                              onOpenPhoto({
                                url: ph.photoUrl,
                                title: `${sr.subType.toUpperCase()} · ${sr.outletName || sr.clientName}`,
                                subtitle: formatDateTimeWIB(ph.capturedAt),
                                notes: sr.fieldNotes || sr.notes,
                                lat: sr.lat ?? undefined,
                                lng: sr.lng ?? undefined,
                              })
                            }
                            className="h-12 w-12 overflow-hidden rounded-lg border border-slate-300 bg-black"
                          >
                            <img src={ph.photoUrl} alt="Foto Sales Rep" className="h-full w-full object-cover" />
                          </button>
                        ))}
                        {sr.adminAttachments?.map((att) => (
                          <button
                            key={`att-${att.id}`}
                            type="button"
                            onClick={() =>
                              onOpenPhoto({
                                url: att.photoUrl,
                                title: `Lampiran Admin · ${sr.outletName || sr.clientName}`,
                                subtitle: formatDateTimeWIB(att.createdAt),
                                notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                              })
                            }
                            className="h-12 w-12 overflow-hidden rounded-lg border-2 border-amber-500"
                          >
                            <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}

                    {sr.lat !== null && sr.lng !== null && (
                      <a
                        href={`https://www.google.com/maps?q=${sr.lat},${sr.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-900 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>Lokasi GPS</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Laporan Harian Terstruktur */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-base font-extrabold text-slate-950">
              Riwayat Laporan Harian (SPG/SPB / SMD / Event)
            </h2>
            {!todayData?.dailyReports?.length ? (
              <p className="mt-3 text-sm text-slate-500">
                Belum ada laporan harian terstruktur hari ini.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {todayData.dailyReports.map((dr) => (
                  <div
                    key={dr.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                          {reportTypeLabel(dr.reportType)}
                        </span>
                        <h3 className="mt-1 text-sm font-extrabold text-slate-950">
                          {dr.reportType === 'event' ? dr.eventName : dr.clientName}
                        </h3>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-extrabold text-orange-700">
                          {formatRupiah(
                            dr.reportType === 'event'
                              ? dr.realizedSalesAmount
                              : dr.totalSalesAmount
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {formatTimeWIB(dr.reportedAt)}
                        </div>
                      </div>
                    </div>

                    {dr.salesItems.length > 0 && (
                      <div className="text-xs text-slate-700 space-y-0.5 border-t border-slate-200 pt-2">
                        {dr.salesItems.map((it, idx) => (
                          <div key={idx} className="flex justify-between font-mono text-[11px]">
                            <span>
                              {it.productName} ({it.quantity} {it.productUnit})
                            </span>
                            <span>{formatRupiah(it.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {dr.offerNotes && (
                      <div className="text-xs text-slate-700">
                        <strong>Penawaran:</strong> {dr.offerNotes}
                      </div>
                    )}
                    {dr.notes && (
                      <div className="text-xs text-slate-600">
                        <strong>Catatan:</strong> {dr.notes}
                      </div>
                    )}
                    {dr.fieldNotes && (
                      <div className="text-xs text-amber-900 bg-amber-50/80 rounded-lg px-2.5 py-1.5 border border-amber-200">
                        <strong>Catatan Lapangan:</strong> {dr.fieldNotes}
                      </div>
                    )}

                    {dr.reportType === 'event' && (
                      <div className="text-xs text-slate-700 space-y-1 border-t border-slate-200 pt-2">
                        <div>
                          Target / Realisasi Sales: {formatRupiah(dr.targetSalesAmount)} /{' '}
                          <strong>{formatRupiah(dr.realizedSalesAmount)}</strong>
                        </div>
                        <div>
                          Pengunjung: {dr.realizedVisitors} / {dr.targetVisitors} orang · Total
                          Biaya: <strong>{formatRupiah(dr.totalExpense)}</strong>
                        </div>
                        {dr.obstacles && <div>Kendala: {dr.obstacles}</div>}
                        {dr.suggestions && <div>Saran: {dr.suggestions}</div>}
                      </div>
                    )}

                    {(dr.photos.length > 0 || (dr.adminAttachments?.length ?? 0) > 0) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {dr.photos.map((ph) => (
                          <button
                            key={ph.id}
                            type="button"
                            onClick={() =>
                              onOpenPhoto({
                                url: ph.photoUrl,
                                title: `${reportTypeLabel(dr.reportType)} · ${
                                  dr.reportType === 'event' ? dr.eventName : dr.clientName
                                }`,
                                subtitle: `${
                                  ph.photoKind === 'transaction_proof'
                                    ? 'Bukti Transaksi'
                                    : 'Foto Kegiatan'
                                } · ${formatDateTimeWIB(ph.capturedAt)}`,
                                notes: dr.fieldNotes || dr.notes,
                                lat: dr.lat ?? undefined,
                                lng: dr.lng ?? undefined,
                              })
                            }
                            className="h-12 w-12 overflow-hidden rounded-lg border border-slate-300 bg-black"
                          >
                            <img
                              src={ph.photoUrl}
                              alt="Foto kegiatan"
                              className="h-full w-full object-cover"
                            />
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
                            className="h-12 w-12 overflow-hidden rounded-lg border-2 border-amber-500"
                          >
                            <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}

                    {dr.lat !== null && dr.lng !== null && (
                      <a
                        href={`https://www.google.com/maps?q=${dr.lat},${dr.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-900 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>Lokasi GPS</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Riwayat Kolektor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-950">
                Riwayat Penagihan Kolektor Hari Ini
              </h2>
              <Receipt className="h-4 w-4 text-slate-500" />
            </div>
            {!todayData?.collectionReports?.length ? (
              <p className="mt-3 text-sm text-slate-500">
                Belum ada riwayat penagihan kolektor hari ini.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {todayData.collectionReports.map((cr) => (
                  <div
                    key={cr.id}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5"
                  >
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
                        className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-black"
                      >
                        <img
                          src={cr.photoUrl}
                          alt={cr.customerName}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    )}
                    <div className="min-w-0 flex-1 text-xs space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-extrabold text-slate-950">
                            {cr.customerName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-600">
                            {cr.invoiceNumber} · {cr.paymentMethod}
                          </div>
                        </div>
                        <span className="font-extrabold text-orange-700">{cr.visitStatus}</span>
                      </div>
                      <div className="font-mono text-xs">
                        Tertagih:{' '}
                        <strong className="text-emerald-700">
                          {formatRupiah(cr.collectedAmount)}
                        </strong>{' '}
                        · Sisa: <strong>{formatRupiah(cr.remainingAmount)}</strong>
                      </div>
                      {cr.promiseDate && (
                        <div className="text-amber-800 font-semibold">
                          Janji Bayar: {formatDateID(cr.promiseDate)}
                        </div>
                      )}
                      {(cr.reason || cr.notes) && (
                        <div className="text-slate-600">
                          {cr.reason ? `[${cr.reason}] ` : ''}
                          {cr.notes}
                        </div>
                      )}
                      {cr.fieldNotes && (
                        <div className="text-xs text-amber-900 bg-amber-50/80 rounded-lg px-2 py-1 border border-amber-200">
                          <strong>Catatan Lapangan:</strong> {cr.fieldNotes}
                        </div>
                      )}
                      {cr.adminAttachments && cr.adminAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {cr.adminAttachments.map((att) => (
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
                              className="h-10 w-10 overflow-hidden rounded-lg border-2 border-amber-500"
                            >
                              <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span className="font-mono">{formatTimeWIB(cr.visitedAt)}</span>
                        {cr.lat !== null && cr.lng !== null && (
                          <a
                            href={`https://www.google.com/maps?q=${cr.lat},${cr.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-blue-900 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>Peta GPS</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Riwayat Tidak Masuk Kerja */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-950">
                Riwayat Tidak Masuk Kerja (Libur / Sakit / Izin / Cuti)
              </h2>
              <CalendarOff className="h-4 w-4 text-orange-600" />
            </div>
            {!todayData?.absenceReports?.length ? (
              <p className="mt-3 text-sm text-slate-500">
                Tidak ada catatan Tidak Masuk Kerja yang aktif hari ini.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {todayData.absenceReports.map((ab) => (
                  <div
                    key={ab.id}
                    className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/40 p-3.5"
                  >
                    {ab.photoUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenPhoto({
                            url: ab.photoUrl,
                            title: `${user.fullName} · ${ab.absenceType}`,
                            subtitle: `${formatDateID(ab.startDate)} - ${formatDateID(ab.endDate)}`,
                            notes: ab.fieldNotes || ab.reason,
                          })
                        }
                        className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-black"
                      >
                        <img src={ab.photoUrl} alt={ab.absenceType} className="h-full w-full object-cover" />
                      </button>
                    )}
                    <div className="min-w-0 flex-1 text-xs space-y-1">
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
                      <div className="text-slate-700">{ab.reason}</div>
                      {ab.fieldNotes && (
                        <div className="text-amber-900 italic">
                          Catatan Lapangan: {ab.fieldNotes}
                        </div>
                      )}
                      {ab.adminAttachments && ab.adminAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {ab.adminAttachments.map((att) => (
                            <button
                              key={`att-${att.id}`}
                              type="button"
                              onClick={() =>
                                onOpenPhoto({
                                  url: att.photoUrl,
                                  title: `Lampiran Admin · ${ab.absenceType}`,
                                  subtitle: formatDateTimeWIB(att.createdAt),
                                  notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                })
                              }
                              className="h-10 w-10 overflow-hidden rounded-lg border-2 border-amber-500"
                            >
                              <img src={att.photoUrl} alt="Lampiran Admin" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Thumb Navigation Bar (56px height + safe area) */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md lg:hidden">
        <div
          className={`mx-auto grid h-14 max-w-lg items-center pb-safe ${
            isLeader ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 transition ${
                  active ? 'text-orange-600' : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {item.icon}
                <span className="text-[10px] font-bold tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Camera Modal (Camera-Only for Check-In / Check-Out) */}
      <CameraCaptureModal
        isOpen={cameraMode.open}
        title={cameraMode.title}
        userName={user.fullName}
        activityLabel={cameraMode.activityLabel}
        gpsPosition={gps.position}
        allowFileUpload={false}
        onConfirm={handleCameraConfirm}
        onClose={() => setCameraMode((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};
