import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Archive,
  Building2,
  CalendarOff,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  FolderArchive,
  Image as ImageIcon,
  Map as MapIcon,
  Megaphone,
  Package,
  Paperclip,
  Pin,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Target,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  AdminAttachment,
  AdminMonitoringResponse,
  Announcement,
  AnnouncementPriority,
  AttachmentTargetType,
  Customer,
  DailyReportType,
  EMPLOYEE_CATEGORIES,
  EmployeeCategory,
  Invoice,
  LightboxPhoto,
  Product,
  User,
  UserRole,
} from '../types';
import { apiFetch } from '../utils/api';
import {
  formatDateID,
  formatDateTimeWIB,
  formatRupiah,
  formatTimeForZipFilename,
  formatTimeWIB,
  getTodayDateKeyJakarta,
  phoneToDummyEmailClient,
  sanitizeFilenamePart,
} from '../utils/format';
import { AdminLiveMap } from './AdminLiveMap';
import { CompanyLogo } from './CompanyLogo';

interface AdminDashboardProps {
  currentUser: User;
  logoUrl?: string | null;
  onLogoUpdated: (url: string | null) => void;
  onOpenPhoto: (photo: LightboxPhoto) => void;
}

type AdminTab = 'monitoring' | 'users' | 'products' | 'customers' | 'targets' | 'announcements';

function reportTypeLabel(rt: DailyReportType): string {
  if (rt === 'spg_stay') return 'SPG/SPB';
  if (rt === 'spg_mobile') return 'SMD / Lapangan';
  return 'Event';
}

interface ParsedImportRow {
  rowNum: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  error?: string;
  isDuplicateInFile?: boolean;
  existsInDb?: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  logoUrl,
  onLogoUpdated,
  onOpenPhoto,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('monitoring');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const todayKey = getTodayDateKeyJakarta();
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [filterUserId, setFilterUserId] = useState('');
  const [filterLeaderId, setFilterLeaderId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterReportType, setFilterReportType] = useState('');

  // Data
  const [monitoring, setMonitoring] = useState<AdminMonitoringResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [settingsData, setSettingsData] = useState<{
    settings: {
      allowPriceAdjustment: boolean;
      globalTargetPeriod: 'harian' | 'mingguan' | 'bulanan';
      globalTargetAmount: number;
      globalTargetQty: number;
    };
    employeeTargets: Array<{
      id: number;
      userId: number;
      userName: string;
      userRole: UserRole;
      period: 'harian' | 'mingguan' | 'bulanan';
      targetAmount: number;
      targetQty: number;
      productId: number | null;
      productName: string | null;
      productSku: string | null;
      productUnit: string | null;
      category: string | null;
      actualAmount: number;
      actualQty: number;
    }>;
    categories: string[];
  } | null>(null);

  const [loadingMonitoring, setLoadingMonitoring] = useState(true);
  const [zipping, setZipping] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purging, setPurging] = useState(false);

  // User Modal state
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [uName, setUName] = useState('');
  const [uPhone, setUPhone] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRole, setURole] = useState<UserRole>('Karyawan');
  const [uCategory, setUCategory] = useState<EmployeeCategory>('Sales Representatif');
  const [uLeaderId, setULeaderId] = useState('');
  const [uActive, setUActive] = useState(true);
  const [savingUser, setSavingUser] = useState(false);

  // Admin Form Attachment Modal state
  const [attachmentTarget, setAttachmentTarget] = useState<{
    targetType: AttachmentTargetType;
    targetId: number;
    title: string;
  } | null>(null);
  const [attStagedFiles, setAttStagedFiles] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [attNote, setAttNote] = useState('');
  const [savingAtt, setSavingAtt] = useState(false);
  const attFileInputRef = useRef<HTMLInputElement | null>(null);

  // Customer & Invoice Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cActive, setCActive] = useState(true);
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [iCustomerId, setICustomerId] = useState('');
  const [iNumber, setINumber] = useState('');
  const [iTotalAmount, setITotalAmount] = useState('');
  const [iPaidAmount, setIPaidAmount] = useState('0');
  const [iDueDate, setIDueDate] = useState('');
  const [iNotes, setINotes] = useState('');
  const [savingInvoice, setSavingInvoice] = useState(false);

  // Product Manual Modal & Excel Import Preview
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pSku, setPSku] = useState('');
  const [pName, setPName] = useState('');
  const [pCategory, setPCategory] = useState('Sembako');
  const [pUnit, setPUnit] = useState('pcs');
  const [pPrice, setPPrice] = useState('');
  const [pActive, setPActive] = useState(true);
  const [savingProduct, setSavingProduct] = useState(false);

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedImportRow[] | null>(null);
  const [importMode, setImportMode] = useState<'skip' | 'update'>('skip');
  const [importingProducts, setImportingProducts] = useState(false);

  // Target & Settings form state
  const [gPeriod, setGPeriod] = useState<'harian' | 'mingguan' | 'bulanan'>('bulanan');
  const [gAmount, setGAmount] = useState('50000000');
  const [gQty, setGQty] = useState('500');
  const [allowPriceAdj, setAllowPriceAdj] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);

  const [tUserId, setTUserId] = useState('');
  const [tPeriod, setTPeriod] = useState<'harian' | 'mingguan' | 'bulanan'>('bulanan');
  const [tAmount, setTAmount] = useState('');
  const [tQty, setTQty] = useState('');
  const [tScopeType, setTScopeType] = useState<'all' | 'product' | 'category'>('all');
  const [tProductId, setTProductId] = useState('');
  const [tCategory, setTCategory] = useState('');
  const [savingEmpTarget, setSavingEmpTarget] = useState(false);

  // Announcements state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annPriority, setAnnPriority] = useState<AnnouncementPriority>('Normal');
  const [annPinned, setAnnPinned] = useState(false);
  const [savingAnn, setSavingAnn] = useState(false);

  // Company Logo Modal state
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [logoPreviewDataUrl, setLogoPreviewDataUrl] = useState<string | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadMonitoring = useCallback(async () => {
    setLoadingMonitoring(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });
      if (filterUserId) params.set('userId', filterUserId);
      if (filterLeaderId) params.set('leaderId', filterLeaderId);
      if (filterStatus) params.set('status', filterStatus);
      if (filterReportType) params.set('reportType', filterReportType);

      const data = await apiFetch<AdminMonitoringResponse>(
        `/api/admin/monitoring?${params.toString()}`
      );
      setMonitoring(data);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal memuat data monitoring.' });
    } finally {
      setLoadingMonitoring(false);
    }
  }, [startDate, endDate, filterUserId, filterLeaderId, filterStatus, filterReportType]);

  const loadAdminMasterData = useCallback(async () => {
    try {
      const [uRes, pRes, stRes, annRes, cRes, iRes] = await Promise.all([
        apiFetch<{ users: User[] }>('/api/admin/users'),
        apiFetch<{ products: Product[] }>('/api/products?includeInactive=1'),
        apiFetch<NonNullable<typeof settingsData>>('/api/admin/settings-targets'),
        apiFetch<{ announcements: Announcement[] }>('/api/admin/announcements'),
        apiFetch<{ customers: Customer[] }>('/api/customers?includeInactive=1'),
        apiFetch<{ invoices: Invoice[] }>('/api/invoices'),
      ]);
      setUsers(uRes.users);
      setProducts(pRes.products);
      setSettingsData(stRes);
      setAnnouncements(annRes.announcements);
      setCustomers(cRes.customers);
      setInvoices(iRes.invoices);
      setGPeriod(stRes.settings.globalTargetPeriod);
      setGAmount(String(stRes.settings.globalTargetAmount));
      setGQty(String(stRes.settings.globalTargetQty));
      setAllowPriceAdj(stRes.settings.allowPriceAdjustment);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal memuat data master.' });
    }
  }, []);

  useEffect(() => {
    loadMonitoring();
  }, [loadMonitoring]);

  useEffect(() => {
    loadAdminMasterData();
  }, [loadAdminMasterData]);

  // Auto refresh live map every 30s on Monitoring tab
  useEffect(() => {
    if (activeTab !== 'monitoring') return;
    const timer = setInterval(() => {
      loadMonitoring();
    }, 30000);
    return () => clearInterval(timer);
  }, [activeTab, loadMonitoring]);

  const leadersList = useMemo(
    () =>
      users
        .filter((u) => u.role === 'Leader/SPV')
        .sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [users]
  );

  const downlineCountByLeader = useMemo(() => {
    const map = new Map<number, number>();
    users.forEach((u) => {
      if (u.role === 'Karyawan' && u.leaderId) {
        map.set(u.leaderId, (map.get(u.leaderId) || 0) + 1);
      }
    });
    return map;
  }, [users]);

  const fieldEmployeesList = useMemo(
    () => users.filter((u) => u.role === 'Karyawan' || u.role === 'Leader/SPV'),
    [users]
  );

  const activeAttachments = useMemo<AdminAttachment[]>(() => {
    if (!attachmentTarget || !monitoring) return [];
    const { targetType, targetId } = attachmentTarget;
    if (targetType === 'attendance') {
      return monitoring.records.find((r) => r.id === targetId)?.adminAttachments || [];
    }
    if (targetType === 'daily_report') {
      return monitoring.dailyReports.find((r) => r.id === targetId)?.adminAttachments || [];
    }
    if (targetType === 'collection') {
      return monitoring.collectionReports.find((r) => r.id === targetId)?.adminAttachments || [];
    }
    if (targetType === 'sales_rep') {
      return monitoring.salesRepReports.find((r) => r.id === targetId)?.adminAttachments || [];
    }
    return monitoring.absenceReports.find((r) => r.id === targetId)?.adminAttachments || [];
  }, [attachmentTarget, monitoring]);

  const openAttachmentModal = (
    targetType: AttachmentTargetType,
    targetId: number,
    title: string
  ) => {
    setAttStagedFiles([]);
    setAttNote('');
    setAttachmentTarget({ targetType, targetId, title });
  };

  const handleAttFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const validResults: Array<{ name: string; dataUrl: string }> = [];
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setFeedback({
          type: 'err',
          text: `File "${file.name}" melebihi batas maksimal 5MB.`,
        });
        continue;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      if (dataUrl) {
        validResults.push({ name: file.name, dataUrl });
      }
    }
    if (validResults.length > 0) {
      setAttStagedFiles((prev) => [...prev, ...validResults].slice(0, 10));
    }
  };

  const handleUploadAttachments = async () => {
    if (!attachmentTarget || attStagedFiles.length === 0) return;
    setSavingAtt(true);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/attachments', {
        method: 'POST',
        body: JSON.stringify({
          targetType: attachmentTarget.targetType,
          targetId: attachmentTarget.targetId,
          photos: attStagedFiles.map((f) => ({ dataUrl: f.dataUrl, note: attNote.trim() })),
          note: attNote.trim(),
        }),
      });
      setAttStagedFiles([]);
      setAttNote('');
      setFeedback({
        type: 'ok',
        text: `${attStagedFiles.length} foto lampiran form berhasil diunggah.`,
      });
      await loadMonitoring();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal mengunggah lampiran form.' });
    } finally {
      setSavingAtt(false);
    }
  };

  const handleDeleteAttachment = async (attId: number) => {
    try {
      await apiFetch(`/api/admin/attachments/${attId}`, { method: 'DELETE' });
      setFeedback({ type: 'ok', text: 'Lampiran foto form berhasil dihapus.' });
      await loadMonitoring();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menghapus lampiran.' });
    }
  };

  // ==================== CSV EXPORT ====================
  const handleDownloadCsv = () => {
    const records = monitoring?.records || [];
    const dailyReports = monitoring?.dailyReports || [];
    const salesRepReports = monitoring?.salesRepReports || [];
    const collectionReports = monitoring?.collectionReports || [];
    const absenceReports = monitoring?.absenceReports || [];
    if (
      records.length === 0 &&
      dailyReports.length === 0 &&
      salesRepReports.length === 0 &&
      collectionReports.length === 0 &&
      absenceReports.length === 0
    ) {
      setFeedback({ type: 'err', text: 'Tidak ada data pada filter aktif untuk diunduh.' });
      return;
    }

    const origin = window.location.origin;
    const headers = [
      'Tanggal',
      'Nama Karyawan',
      'Nomor HP',
      'Peran',
      'Kategori Karyawan',
      'Leader/SPV',
      'Jenis Aktivitas / Laporan',
      'Waktu Check-In',
      'Waktu Check-Out',
      'Waktu Tercatat',
      'Nama Lokasi / Klien / Customer / Event / Outlet',
      'Status',
      'Nomor Invoice',
      'Total Tagihan (Rp)',
      'Nominal Tertagih (Rp)',
      'Sisa Tagihan (Rp)',
      'Metode Pembayaran',
      'Tanggal Janji Bayar / Periode',
      'Alasan / Kendala / Saran',
      'Catatan Lapangan',
      'Detail Penjualan / PO / Penawaran / NOO / Event',
      'Total Qty Terjual',
      'Total Penjualan / PO / Realisasi (Rp)',
      'Koordinat GPS',
      'Link Google Maps',
      'Link Foto Check-In',
      'Link Foto Check-Out',
      'Link Foto Bukti / Kegiatan / Lampiran Admin',
    ];

    const csvEscape = (val: any) => {
      const str = String(val ?? '');
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows: string[] = [];

    for (const r of records) {
      const mapsUrl = `https://www.google.com/maps?q=${r.lat},${r.lng}`;
      const adminAttLinks = (r.adminAttachments || []).map((a) => `${origin}${a.photoUrl}`);
      const photoCombined = [r.photoUrl ? `${origin}${r.photoUrl}` : '', ...adminAttLinks]
        .filter(Boolean)
        .join(' | ');
      rows.push(
        [
          formatDateID(r.dateKey),
          r.userName,
          r.userPhone,
          r.userRole,
          r.employeeCategory || 'Sales Representatif',
          r.leaderName || '-',
          r.recordType === 'check_in'
            ? 'Absen Check-In'
            : r.recordType === 'check_out'
            ? 'Absen Check-Out'
            : 'Kunjungan',
          r.checkInTime ? formatTimeWIB(r.checkInTime) : '-',
          r.checkOutTime ? formatTimeWIB(r.checkOutTime) : '-',
          formatTimeWIB(r.capturedAt),
          r.clientName,
          r.visitStatus,
          '-',
          0,
          0,
          0,
          '-',
          '-',
          r.notes || '-',
          '-',
          r.salesDetailText || '-',
          r.salesQty,
          r.salesAmount,
          `${r.lat}, ${r.lng}`,
          mapsUrl,
          r.checkInPhotoUrl ? `${origin}${r.checkInPhotoUrl}` : '-',
          r.checkOutPhotoUrl ? `${origin}${r.checkOutPhotoUrl}` : '-',
          photoCombined || '-',
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    for (const dr of dailyReports) {
      const hasGps = dr.lat !== null && dr.lng !== null;
      const mapsUrl = hasGps ? `https://www.google.com/maps?q=${dr.lat},${dr.lng}` : '-';
      const detail =
        dr.reportType === 'event'
          ? `Target Sales: Rp${dr.targetSalesAmount}, Realisasi: Rp${dr.realizedSalesAmount}, Pengunjung: ${dr.realizedVisitors}/${dr.targetVisitors}, Biaya Event: Rp${dr.totalExpense} (${dr.expenses.map((e) => `${e.name}: Rp${e.amount}`).join('; ')})`
          : [
              dr.salesItems.map((it) => `${it.productName} (${it.quantity} ${it.productUnit} = Rp${it.totalAmount})`).join('; '),
              dr.offerNotes ? `Penawaran: ${dr.offerNotes}` : '',
            ]
              .filter(Boolean)
              .join(' | ');
      const extraNote =
        dr.reportType === 'event'
          ? [dr.obstacles ? `Kendala: ${dr.obstacles}` : '', dr.suggestions ? `Saran: ${dr.suggestions}` : '']
              .filter(Boolean)
              .join(' | ')
          : dr.notes || '-';
      const photoLinks = [
        ...dr.photos.map((p) => `${origin}${p.photoUrl}`),
        ...(dr.adminAttachments || []).map((a) => `${origin}${a.photoUrl}`),
      ]
        .join(' | ') || '-';

      rows.push(
        [
          formatDateID(dr.dateKey),
          dr.userName || '-',
          dr.userPhone || '-',
          dr.userRole || 'Karyawan',
          dr.employeeCategory || 'Sales Representatif',
          dr.leaderName || '-',
          `Laporan Harian - ${reportTypeLabel(dr.reportType)}`,
          '-',
          '-',
          formatTimeWIB(dr.reportedAt),
          dr.reportType === 'event' ? dr.eventName : dr.clientName,
          dr.visitStatus,
          '-',
          0,
          0,
          0,
          '-',
          '-',
          extraNote || '-',
          dr.fieldNotes || '-',
          detail || '-',
          dr.totalQty,
          dr.reportType === 'event' ? dr.realizedSalesAmount : dr.totalSalesAmount,
          hasGps ? `${dr.lat}, ${dr.lng}` : '-',
          mapsUrl,
          '-',
          '-',
          photoLinks,
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    for (const sr of salesRepReports) {
      const hasGps = sr.lat !== null && sr.lng !== null;
      const mapsUrl = hasGps ? `https://www.google.com/maps?q=${sr.lat},${sr.lng}` : '-';
      const detail =
        sr.subType === 'po'
          ? sr.poItems
              .map((it) => `${it.productName} (${it.quantity} ${it.productUnit} = Rp${it.totalAmount})`)
              .join('; ')
          : sr.subType === 'noo'
          ? `${sr.outletType} | Pemilik: ${sr.outletOwner || '-'} (${sr.outletPhone || '-'}) | Alamat: ${sr.outletAddress || '-'} | Potensi: ${sr.outletPotential || '-'}`
          : sr.offerNotes || '-';
      const photoLinks = [
        ...sr.photos.map((p) => `${origin}${p.photoUrl}`),
        ...(sr.adminAttachments || []).map((a) => `${origin}${a.photoUrl}`),
      ]
        .join(' | ') || '-';

      rows.push(
        [
          formatDateID(sr.dateKey),
          sr.userName || '-',
          sr.userPhone || '-',
          sr.userRole || 'Karyawan',
          sr.employeeCategory || 'Sales Representatif',
          sr.leaderName || '-',
          `Sales Rep - ${sr.subType.toUpperCase()}`,
          '-',
          '-',
          formatTimeWIB(sr.reportedAt),
          sr.subType === 'noo' ? sr.outletName : sr.clientName,
          sr.subType === 'penawaran' ? sr.offerStatus : sr.subType.toUpperCase(),
          '-',
          0,
          0,
          0,
          '-',
          sr.followUpDate ? formatDateID(sr.followUpDate) : '-',
          sr.notes || '-',
          sr.fieldNotes || '-',
          detail || '-',
          sr.poTotalQty,
          sr.poTotalAmount,
          hasGps ? `${sr.lat}, ${sr.lng}` : '-',
          mapsUrl,
          '-',
          '-',
          photoLinks,
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    for (const cr of collectionReports) {
      const hasGps = cr.lat !== null && cr.lng !== null;
      const mapsUrl = hasGps ? `https://www.google.com/maps?q=${cr.lat},${cr.lng}` : '-';
      const photoLinks = [
        cr.photoUrl ? `${origin}${cr.photoUrl}` : '',
        ...(cr.adminAttachments || []).map((a) => `${origin}${a.photoUrl}`),
      ]
        .filter(Boolean)
        .join(' | ') || '-';
      rows.push(
        [
          formatDateID(cr.dateKey),
          cr.userName || '-',
          cr.userPhone || '-',
          cr.userRole || 'Karyawan',
          'Kolektor',
          cr.leaderName || '-',
          'Laporan Kolektor',
          '-',
          '-',
          formatTimeWIB(cr.visitedAt),
          cr.customerName,
          cr.visitStatus,
          cr.invoiceNumber,
          cr.invoiceTotal,
          cr.collectedAmount,
          cr.remainingAmount,
          cr.paymentMethod,
          cr.promiseDate ? formatDateID(cr.promiseDate) : '-',
          [cr.reason, cr.notes].filter(Boolean).join(' · ') || '-',
          cr.fieldNotes || '-',
          '-',
          0,
          0,
          hasGps ? `${cr.lat}, ${cr.lng}` : '-',
          mapsUrl,
          '-',
          '-',
          photoLinks,
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    for (const ab of absenceReports) {
      const hasGps = ab.lat !== null && ab.lng !== null;
      const mapsUrl = hasGps ? `https://www.google.com/maps?q=${ab.lat},${ab.lng}` : '-';
      const photoLinks = [
        ab.photoUrl ? `${origin}${ab.photoUrl}` : '',
        ...(ab.adminAttachments || []).map((a) => `${origin}${a.photoUrl}`),
      ]
        .filter(Boolean)
        .join(' | ') || '-';
      rows.push(
        [
          formatDateID(ab.dateKey),
          ab.userName || '-',
          ab.userPhone || '-',
          ab.userRole || 'Karyawan',
          ab.employeeCategory || 'Sales Representatif',
          ab.leaderName || '-',
          `Tidak Masuk Kerja (${ab.absenceType})`,
          '-',
          '-',
          formatTimeWIB(ab.submittedAt),
          '-',
          ab.absenceType,
          '-',
          0,
          0,
          0,
          '-',
          `${formatDateID(ab.startDate)} s.d. ${formatDateID(ab.endDate)}`,
          ab.reason || '-',
          ab.fieldNotes || '-',
          '-',
          0,
          0,
          hasGps ? `${ab.lat}, ${ab.lng}` : '-',
          mapsUrl,
          '-',
          '-',
          photoLinks,
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    const csvContent = '\uFEFF' + [headers.map(csvEscape).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Laporan_Lapangan_${startDate}_sd_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==================== ZIP BULK PHOTO DOWNLOAD ====================
  const handleDownloadZip = async () => {
    const records = monitoring?.records || [];
    const dailyReports = monitoring?.dailyReports || [];
    const salesRepReports = monitoring?.salesRepReports || [];
    const collectionReports = monitoring?.collectionReports || [];
    const absenceReports = monitoring?.absenceReports || [];

    const photoItems: Array<{ url: string; fileName: string }> = [];

    const getExtFromUrl = (url: string) => {
      const m = url.match(/\.(png|webp|jpeg|jpg)(\?|$)/i);
      return m ? `.${m[1].toLowerCase()}` : '.jpg';
    };

    const pushAdminAttachments = (
      atts: AdminAttachment[] | undefined,
      prefix: string
    ) => {
      (atts || []).forEach((att, idx) => {
        photoItems.push({
          url: att.photoUrl,
          fileName: `${prefix}_LampiranAdmin_${idx + 1}${getExtFromUrl(att.photoUrl)}`,
        });
      });
    };

    for (const r of records) {
      const basePrefix = `${sanitizeFilenamePart(r.userName)}_${r.dateKey}_${formatTimeForZipFilename(r.capturedAt)}`;
      if (r.photoUrl) {
        const suffix =
          r.recordType === 'check_in'
            ? 'CheckIn'
            : r.recordType === 'check_out'
            ? 'CheckOut'
            : `Kunjungan_${r.id}`;
        photoItems.push({
          url: r.photoUrl,
          fileName: `${basePrefix}_${suffix}${getExtFromUrl(r.photoUrl)}`,
        });
      }
      pushAdminAttachments(r.adminAttachments, `${basePrefix}_Absen_${r.id}`);
    }

    for (const dr of dailyReports) {
      const basePrefix = `${sanitizeFilenamePart(dr.userName || 'User')}_${dr.dateKey}_${dr.reportType}_${dr.id}`;
      dr.photos.forEach((ph, idx) => {
        photoItems.push({
          url: ph.photoUrl,
          fileName: `${basePrefix}_${formatTimeForZipFilename(ph.capturedAt)}_${idx + 1}${getExtFromUrl(ph.photoUrl)}`,
        });
      });
      pushAdminAttachments(dr.adminAttachments, basePrefix);
    }

    for (const sr of salesRepReports) {
      const basePrefix = `${sanitizeFilenamePart(sr.userName || 'SalesRep')}_${sr.dateKey}_${sr.subType}_${sr.id}`;
      sr.photos.forEach((ph, idx) => {
        photoItems.push({
          url: ph.photoUrl,
          fileName: `${basePrefix}_${formatTimeForZipFilename(ph.capturedAt)}_${idx + 1}${getExtFromUrl(ph.photoUrl)}`,
        });
      });
      pushAdminAttachments(sr.adminAttachments, basePrefix);
    }

    for (const cr of collectionReports) {
      const basePrefix = `${sanitizeFilenamePart(cr.userName || 'Kolektor')}_${cr.dateKey}_Kolektor_${sanitizeFilenamePart(cr.invoiceNumber)}_${cr.id}`;
      if (cr.photoUrl) {
        photoItems.push({
          url: cr.photoUrl,
          fileName: `${basePrefix}_${formatTimeForZipFilename(cr.visitedAt)}${getExtFromUrl(cr.photoUrl)}`,
        });
      }
      pushAdminAttachments(cr.adminAttachments, basePrefix);
    }

    for (const ab of absenceReports) {
      const basePrefix = `${sanitizeFilenamePart(ab.userName || 'Karyawan')}_${ab.dateKey}_TidakMasuk_${ab.absenceType}_${ab.id}`;
      if (ab.photoUrl) {
        photoItems.push({
          url: ab.photoUrl,
          fileName: `${basePrefix}${getExtFromUrl(ab.photoUrl)}`,
        });
      }
      pushAdminAttachments(ab.adminAttachments, basePrefix);
    }

    if (photoItems.length === 0) {
      setFeedback({ type: 'err', text: 'Tidak ada foto bukti pada filter aktif untuk diunduh.' });
      return;
    }

    setZipping(true);
    setFeedback(null);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();

      for (const item of photoItems) {
        const res = await fetch(item.url);
        if (!res.ok) continue;
        const blob = await res.blob();

        let finalName = item.fileName;
        let counter = 2;
        while (usedNames.has(finalName)) {
          finalName = item.fileName.replace(/(\.[a-z0-9]+)$/i, `_${counter}$1`);
          counter++;
        }
        usedNames.add(finalName);
        zip.file(finalName, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Foto_Bukti_${startDate}_sd_${endDate}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({
        type: 'ok',
        text: `Berhasil mengunduh ${usedNames.size} foto bukti dalam arsip ZIP.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: 'Gagal membuat arsip ZIP foto: ' + (err.message || '') });
    } finally {
      setZipping(false);
    }
  };

  // ==================== PERMANENT PURGE ====================
  const handleConfirmPurge = async () => {
    setPurging(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ deletedRecords: number; deletedPhotos: number }>(
        '/api/admin/monitoring/purge',
        {
          method: 'DELETE',
          body: JSON.stringify({
            startDate,
            endDate,
            userId: filterUserId || null,
            leaderId: filterLeaderId || null,
            status: filterStatus || null,
            reportType: filterReportType || null,
          }),
        }
      );
      setShowPurgeModal(false);
      setFeedback({
        type: 'ok',
        text: `Berhasil menghapus permanen ${res.deletedRecords} data laporan dan ${res.deletedPhotos} file foto dari Storage.`,
      });
      await loadMonitoring();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menghapus data terfilter.' });
    } finally {
      setPurging(false);
    }
  };

  // ==================== USER CRUD ====================
  const openAddUserModal = () => {
    setEditingUser(null);
    setUName('');
    setUPhone('');
    setUPassword('');
    setURole('Karyawan');
    setUCategory('Sales Representatif');
    setULeaderId('');
    setUActive(true);
    setUserModalOpen(true);
  };

  const openEditUserModal = (u: User) => {
    setEditingUser(u);
    setUName(u.fullName);
    setUPhone(u.phone);
    setUPassword('');
    setURole(u.role);
    setUCategory(
      u.employeeCategory ||
        (u.role === 'Leader/SPV' ? 'Leader/SPV' : 'Sales Representatif')
    );
    setULeaderId(u.leaderId ? String(u.leaderId) : '');
    setUActive(u.isActive);
    setUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUser(true);
    setFeedback(null);
    const resolvedCategory: EmployeeCategory =
      uRole === 'Admin' ? 'Leader/SPV' : uCategory;
    try {
      if (editingUser) {
        await apiFetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            fullName: uName,
            phone: uPhone,
            password: uPassword || undefined,
            role: uRole,
            employeeCategory: resolvedCategory,
            leaderId: uRole === 'Karyawan' && uLeaderId ? Number(uLeaderId) : null,
            isActive: uActive,
          }),
        });
        setFeedback({ type: 'ok', text: `Akun ${uName} berhasil diperbarui.` });
      } else {
        const res = await apiFetch<{ id: number; emailAlias: string }>('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            fullName: uName,
            phone: uPhone,
            password: uPassword,
            role: uRole,
            employeeCategory: resolvedCategory,
            leaderId: uRole === 'Karyawan' && uLeaderId ? Number(uLeaderId) : null,
          }),
        });
        setFeedback({
          type: 'ok',
          text: `Karyawan ${uName} berhasil ditambahkan (Akun internal: ${res.emailAlias}).`,
        });
      }
      setUserModalOpen(false);
      await Promise.all([loadAdminMasterData(), loadMonitoring()]);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menyimpan data karyawan.' });
    } finally {
      setSavingUser(false);
    }
  };

  // ==================== CUSTOMER & INVOICE CRUD ====================
  const openAddCustomerModal = () => {
    setEditingCustomer(null);
    setCCode('');
    setCName('');
    setCPhone('');
    setCAddress('');
    setCActive(true);
    setCustomerModalOpen(true);
  };

  const openEditCustomerModal = (c: Customer) => {
    setEditingCustomer(c);
    setCCode(c.code);
    setCName(c.name);
    setCPhone(c.phone);
    setCAddress(c.address);
    setCActive(c.isActive);
    setCustomerModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCustomer(true);
    setFeedback(null);
    try {
      if (editingCustomer) {
        await apiFetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            code: cCode,
            name: cName,
            phone: cPhone,
            address: cAddress,
            isActive: cActive,
          }),
        });
        setFeedback({ type: 'ok', text: `Data customer ${cName} diperbarui.` });
      } else {
        await apiFetch('/api/customers', {
          method: 'POST',
          body: JSON.stringify({
            code: cCode || undefined,
            name: cName,
            phone: cPhone,
            address: cAddress,
          }),
        });
        setFeedback({ type: 'ok', text: `Customer ${cName} berhasil ditambahkan.` });
      }
      setCustomerModalOpen(false);
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menyimpan customer.' });
    } finally {
      setSavingCustomer(false);
    }
  };

  const openAddInvoiceModal = () => {
    setEditingInvoice(null);
    setICustomerId(customers[0] ? String(customers[0].id) : '');
    setINumber('');
    setITotalAmount('');
    setIPaidAmount('0');
    setIDueDate('');
    setINotes('');
    setInvoiceModalOpen(true);
  };

  const openEditInvoiceModal = (inv: Invoice) => {
    setEditingInvoice(inv);
    setICustomerId(String(inv.customerId));
    setINumber(inv.invoiceNumber);
    setITotalAmount(String(inv.totalAmount));
    setIPaidAmount(String(inv.paidAmount));
    setIDueDate(inv.dueDate || '');
    setINotes(inv.notes || '');
    setInvoiceModalOpen(true);
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingInvoice(true);
    setFeedback(null);
    try {
      if (editingInvoice) {
        await apiFetch(`/api/invoices/${editingInvoice.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            invoiceNumber: iNumber,
            totalAmount: Number(iTotalAmount),
            paidAmount: Number(iPaidAmount || 0),
            dueDate: iDueDate,
            notes: iNotes,
          }),
        });
        setFeedback({ type: 'ok', text: `Invoice ${iNumber} diperbarui.` });
      } else {
        await apiFetch('/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            customerId: Number(iCustomerId),
            invoiceNumber: iNumber,
            totalAmount: Number(iTotalAmount),
            dueDate: iDueDate,
            notes: iNotes,
          }),
        });
        setFeedback({ type: 'ok', text: `Invoice ${iNumber} berhasil ditambahkan.` });
      }
      setInvoiceModalOpen(false);
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menyimpan invoice.' });
    } finally {
      setSavingInvoice(false);
    }
  };

  // ==================== PRODUCT CRUD & EXCEL IMPORT ====================
  const openAddProductModal = () => {
    setEditingProduct(null);
    setPSku('');
    setPName('');
    setPCategory('Sembako');
    setPUnit('pcs');
    setPPrice('');
    setPActive(true);
    setProductModalOpen(true);
  };

  const openEditProductModal = (p: Product) => {
    setEditingProduct(p);
    setPSku(p.sku);
    setPName(p.name);
    setPCategory(p.category);
    setPUnit(p.unit);
    setPPrice(String(p.unitPrice));
    setPActive(p.isActive);
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);
    setFeedback(null);
    try {
      if (editingProduct) {
        await apiFetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            sku: pSku,
            name: pName,
            category: pCategory,
            unit: pUnit,
            unitPrice: Number(pPrice),
            isActive: pActive,
          }),
        });
        setFeedback({ type: 'ok', text: `Produk ${pName} berhasil diperbarui.` });
      } else {
        await apiFetch('/api/products', {
          method: 'POST',
          body: JSON.stringify({
            sku: pSku,
            name: pName,
            category: pCategory,
            unit: pUnit,
            unitPrice: Number(pPrice),
          }),
        });
        setFeedback({ type: 'ok', text: `Produk ${pName} berhasil ditambahkan.` });
      }
      setProductModalOpen(false);
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menyimpan produk.' });
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDownloadTemplateExcel = () => {
    const templateRows = [
      {
        'Kode/SKU Barang': 'BRS-001',
        'Nama Produk': 'Beras Premium Berkah 5kg',
        Kategori: 'Beras & Pangan Pokok',
        Satuan: 'sak',
        'Harga Satuan': 74000,
      },
      {
        'Kode/SKU Barang': 'MYK-002',
        'Nama Produk': 'Minyak Goreng Sentosa 2L',
        Kategori: 'Minyak Goreng',
        Satuan: 'pouch',
        'Harga Satuan': 36500,
      },
      {
        'Kode/SKU Barang': 'GLA-003',
        'Nama Produk': 'Gula Pasir Kristal 1kg',
        Kategori: 'Gula & Tepung',
        Satuan: 'pack',
        'Harga Satuan': 17500,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MasterProduk');
    XLSX.writeFile(wb, 'Template_Master_Produk_PBS.xlsx');
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: '' });

      const existingSkus = new Set(products.map((p) => p.sku.toUpperCase()));
      const seenInFile = new Set<string>();

      const parsed: ParsedImportRow[] = rawRows.map((row, idx) => {
        const keys = Object.keys(row);
        const pick = (candidates: string[]) => {
          for (const k of keys) {
            const lk = k.toLowerCase().trim();
            if (candidates.some((c) => lk.includes(c))) {
              return row[k];
            }
          }
          return '';
        };

        const sku = String(pick(['sku', 'kode']) || '').trim().toUpperCase();
        const name = String(pick(['nama', 'produk', 'barang']) || '').trim();
        const category = String(pick(['kategori', 'category']) || 'Umum').trim() || 'Umum';
        const unit = String(pick(['satuan', 'unit']) || 'pcs').trim() || 'pcs';
        const rawPrice = String(pick(['harga', 'price']) || '0').replace(/[^\d.-]/g, '');
        const unitPrice = Math.round(Number(rawPrice));

        let error: string | undefined;
        if (!sku) error = 'Kode/SKU kosong';
        else if (!name) error = 'Nama Produk kosong';
        else if (!Number.isFinite(unitPrice) || unitPrice < 0) error = 'Harga Satuan tidak valid';

        const isDuplicateInFile = Boolean(sku && seenInFile.has(sku));
        if (sku) seenInFile.add(sku);
        const existsInDb = Boolean(sku && existingSkus.has(sku));

        return {
          rowNum: idx + 2,
          sku,
          name,
          category,
          unit,
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
          error,
          isDuplicateInFile,
          existsInDb,
        };
      });

      setImportPreview(parsed);
    } catch {
      setFeedback({
        type: 'err',
        text: 'Gagal membaca file Excel/CSV. Pastikan format .xlsx, .xls, atau .csv valid.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    const validItems = importPreview.filter((r) => !r.error && !r.isDuplicateInFile);
    if (validItems.length === 0) {
      setFeedback({ type: 'err', text: 'Tidak ada baris produk valid untuk disimpan.' });
      return;
    }

    setImportingProducts(true);
    try {
      const res = await apiFetch<{ inserted: number; updated: number; skipped: number }>(
        '/api/products/bulk-import',
        {
          method: 'POST',
          body: JSON.stringify({
            mode: importMode,
            items: validItems,
          }),
        }
      );
      setImportPreview(null);
      setFeedback({
        type: 'ok',
        text: `Impor selesai: ${res.inserted} produk baru ditambahkan, ${res.updated} diperbarui, ${res.skipped} dilewati.`,
      });
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal mengimpor produk.' });
    } finally {
      setImportingProducts(false);
    }
  };

  // ==================== TARGETS & SETTINGS ====================
  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGlobal(true);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/settings-targets', {
        method: 'PUT',
        body: JSON.stringify({
          allowPriceAdjustment: allowPriceAdj,
          globalTargetPeriod: gPeriod,
          globalTargetAmount: Number(gAmount || 0),
          globalTargetQty: Number(gQty || 0),
        }),
      });
      setFeedback({ type: 'ok', text: 'Target Global & pengaturan harga berhasil disimpan.' });
      await Promise.all([loadAdminMasterData(), loadMonitoring()]);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menyimpan pengaturan.' });
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleCreateEmployeeTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmpTarget(true);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/employee-targets', {
        method: 'POST',
        body: JSON.stringify({
          userId: Number(tUserId),
          period: tPeriod,
          targetAmount: Number(tAmount || 0),
          targetQty: Number(tQty || 0),
          productId: tScopeType === 'product' && tProductId ? Number(tProductId) : null,
          category: tScopeType === 'category' && tCategory ? tCategory : null,
        }),
      });
      setTAmount('');
      setTQty('');
      setFeedback({ type: 'ok', text: 'Target spesifik karyawan berhasil ditambahkan.' });
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menambahkan target karyawan.' });
    } finally {
      setSavingEmpTarget(false);
    }
  };

  const handleDeleteEmployeeTarget = async (id: number) => {
    try {
      await apiFetch(`/api/admin/employee-targets/${id}`, { method: 'DELETE' });
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menghapus target.' });
    }
  };

  // ==================== ANNOUNCEMENT CRUD ====================
  const resetAnnouncementForm = () => {
    setEditingAnnId(null);
    setAnnTitle('');
    setAnnContent('');
    setAnnPriority('Normal');
    setAnnPinned(false);
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAnn(true);
    setFeedback(null);
    try {
      if (editingAnnId) {
        await apiFetch(`/api/admin/announcements/${editingAnnId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: annTitle,
            content: annContent,
            priority: annPriority,
            isPinned: annPinned,
          }),
        });
        setFeedback({ type: 'ok', text: 'Pengumuman berhasil diperbarui.' });
      } else {
        await apiFetch('/api/admin/announcements', {
          method: 'POST',
          body: JSON.stringify({
            title: annTitle,
            content: annContent,
            priority: annPriority,
            isPinned: annPinned,
          }),
        });
        setFeedback({ type: 'ok', text: 'Pengumuman baru dipublikasikan ke seluruh karyawan.' });
      }
      resetAnnouncementForm();
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menyimpan pengumuman.' });
    } finally {
      setSavingAnn(false);
    }
  };

  const handleToggleAnnField = async (
    ann: Announcement,
    patch: { isPinned?: boolean; isActive?: boolean }
  ) => {
    try {
      await apiFetch(`/api/admin/announcements/${ann.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal memperbarui status pengumuman.' });
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    try {
      await apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      setFeedback({ type: 'ok', text: 'Pengumuman berhasil dihapus.' });
      await loadAdminMasterData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal menghapus pengumuman.' });
    }
  };

  // ==================== COMPANY LOGO UPLOAD / RESET ====================
  const handleLogoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setFeedback({ type: 'err', text: 'Ukuran file logo maksimal 3MB.' });
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoPreviewDataUrl(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUploadCompanyLogo = async () => {
    if (!logoPreviewDataUrl) return;
    setSavingLogo(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ hasCustomLogo: boolean; logoUrl: string | null }>(
        '/api/admin/branding/logo',
        {
          method: 'POST',
          body: JSON.stringify({ dataUrl: logoPreviewDataUrl }),
        }
      );
      onLogoUpdated(res.logoUrl);
      setLogoPreviewDataUrl(null);
      setLogoModalOpen(false);
      setFeedback({
        type: 'ok',
        text: 'Logo asli perusahaan berhasil diperbarui di seluruh halaman.',
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal mengunggah logo perusahaan.' });
    } finally {
      setSavingLogo(false);
    }
  };

  const handleResetCompanyLogo = async () => {
    setSavingLogo(true);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/branding/logo', { method: 'DELETE' });
      onLogoUpdated(null);
      setLogoPreviewDataUrl(null);
      setLogoModalOpen(false);
      setFeedback({ type: 'ok', text: 'Logo perusahaan dikembalikan ke logo bawaan.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message || 'Gagal mereset logo.' });
    } finally {
      setSavingLogo(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-3 py-5 sm:px-6">
      {/* Top Admin Workspace Navigation */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1">
          {[
            { id: 'monitoring', label: 'Monitoring & Peta', icon: <MapIcon className="h-4 w-4" /> },
            { id: 'users', label: 'Karyawan & Tim', icon: <Users className="h-4 w-4" /> },
            { id: 'products', label: 'Master Produk', icon: <Package className="h-4 w-4" /> },
            { id: 'customers', label: 'Customer & Tagihan', icon: <Building2 className="h-4 w-4" /> },
            { id: 'targets', label: 'Target & Pengaturan', icon: <Target className="h-4 w-4" /> },
            { id: 'announcements', label: 'Pengumuman', icon: <Megaphone className="h-4 w-4" /> },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLogoPreviewDataUrl(null);
              setLogoModalOpen(true);
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-100"
          >
            <ImageIcon className="h-3.5 w-3.5 text-orange-600" />
            <span>Ganti Logo Perusahaan</span>
          </button>

          <button
            type="button"
            onClick={() => {
              loadMonitoring();
              loadAdminMasterData();
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Muat Ulang</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${
            feedback.type === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* ==================== TAB 1: MONITORING & LIVE MAP ==================== */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* Interactive Live Map */}
          <AdminLiveMap pins={monitoring?.livePins || []} onOpenPhoto={onOpenPhoto} />

          {/* Daily Summary Stat Cards (Gold Accent Borders) */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-2xl border border-amber-400 bg-white p-4 shadow-xs">
              <div className="text-xs font-bold text-slate-600">Check-In Hari Ini</div>
              <div className="mt-1.5 font-mono text-2xl font-extrabold text-slate-950 tabular-nums">
                {monitoring?.summary.checkedInToday ?? 0}
                <span className="text-sm font-semibold text-slate-500">
                  {' '}
                  / {monitoring?.summary.totalFieldUsers ?? 0}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-600">Karyawan lapangan</div>
            </div>

            <div className="rounded-2xl border border-amber-400 bg-white p-4 shadow-xs">
              <div className="text-xs font-bold text-slate-600">Kunjungan Selesai</div>
              <div className="mt-1.5 font-mono text-2xl font-extrabold text-slate-950 tabular-nums">
                {monitoring?.summary.completedVisits ?? 0}
              </div>
              <div className="mt-1 text-xs text-slate-600">Sesuai filter tanggal</div>
            </div>

            <div className="rounded-2xl border border-amber-400 bg-white p-4 shadow-xs">
              <div className="text-xs font-bold text-slate-600">Total Qty Terjual</div>
              <div className="mt-1.5 font-mono text-2xl font-extrabold text-slate-950 tabular-nums">
                {monitoring?.summary.totalSalesQty ?? 0}
              </div>
              <div className="mt-1 text-xs text-slate-600">Unit terjual terfilter</div>
            </div>

            <div className="rounded-2xl border border-amber-400 bg-white p-4 shadow-xs">
              <div className="text-xs font-bold text-slate-600">Total Penjualan (Rp)</div>
              <div className="mt-1.5 font-mono text-xl font-extrabold text-orange-700 tabular-nums">
                {formatRupiah(monitoring?.summary.totalSalesAmount ?? 0)}
              </div>
              <div className="mt-1 text-xs text-slate-600">Omzet pada filter aktif</div>
            </div>

            <div className="rounded-2xl border border-amber-500 bg-slate-900 p-4 text-white shadow-xs">
              <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                <span>Target Global ({monitoring?.summary.globalTarget.period || 'bulanan'})</span>
                <span className="font-mono tabular-nums">
                  {monitoring?.summary.globalTarget.pct ?? 0}%
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-orange-500"
                  style={{
                    width: `${Math.min(100, monitoring?.summary.globalTarget.pct ?? 0)}%`,
                  }}
                />
              </div>
              <div className="mt-2 font-mono text-xs text-slate-200 tabular-nums">
                {formatRupiah(monitoring?.summary.globalTarget.teamActualAmount ?? 0)} /{' '}
                {formatRupiah(monitoring?.summary.globalTarget.targetAmount ?? 0)}
              </div>
            </div>
          </div>

          {/* Secondary Strip: Daily Report, Sales Rep, Collector & Absence KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-600">Laporan Harian Terstruktur</div>
                <div className="mt-1 font-mono text-xl font-extrabold text-slate-950 tabular-nums">
                  {monitoring?.summary.totalDailyReports ?? 0} laporan
                </div>
                <div className="text-[11px] text-slate-500">SPG/SPB · SMD · Event</div>
              </div>
              <Package className="h-5 w-5 text-slate-700 shrink-0" />
            </div>

            <div className="rounded-2xl border border-amber-300 bg-amber-50/40 p-4 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-700">
                  Sales Rep ({monitoring?.summary.totalSalesRepReports ?? 0} laporan)
                </div>
                <div className="mt-1 font-mono text-lg font-extrabold text-orange-700 tabular-nums">
                  {formatRupiah(monitoring?.summary.totalPoAmount ?? 0)}
                </div>
                <div className="text-[11px] text-slate-600">Total nilai PO terfilter</div>
              </div>
              <ShoppingCart className="h-5 w-5 text-orange-600 shrink-0" />
            </div>

            <div className="rounded-2xl border border-emerald-300 bg-emerald-50/40 p-4 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-emerald-900">
                  Kolektor ({monitoring?.summary.totalCollectionCount ?? 0} kunjungan)
                </div>
                <div className="mt-1 font-mono text-lg font-extrabold text-emerald-700 tabular-nums">
                  {formatRupiah(monitoring?.summary.totalCollectedAmount ?? 0)}
                </div>
                <div className="text-[11px] text-slate-600">
                  Sisa: {formatRupiah(monitoring?.summary.totalCollectionRemaining ?? 0)}
                </div>
              </div>
              <CreditCard className="h-5 w-5 text-emerald-700 shrink-0" />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-600">Tidak Masuk Kerja</div>
                <div className="mt-1 font-mono text-xl font-extrabold text-slate-950 tabular-nums">
                  {monitoring?.summary.totalAbsenceReports ?? 0} catatan
                </div>
                <div className="text-[11px] text-slate-500">Libur · Sakit · Izin · Cuti</div>
              </div>
              <CalendarOff className="h-5 w-5 text-amber-700 shrink-0" />
            </div>
          </div>

          {/* Filter & Export / Purge Bar */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div>
                <label className="block text-xs font-bold text-slate-700">Tanggal Mulai</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700">Tanggal Akhir</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700">Jenis Laporan</label>
                <select
                  value={filterReportType}
                  onChange={(e) => setFilterReportType(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                >
                  <option value="">Semua Jenis Laporan</option>
                  <option value="attendance">Absensi &amp; Kunjungan</option>
                  <option value="sales_rep">Sales Representatif (Semua)</option>
                  <option value="sales_po">Sales Rep — PO</option>
                  <option value="sales_offer">Sales Rep — Penawaran</option>
                  <option value="sales_noo">Sales Rep — NOO</option>
                  <option value="spg_stay">Laporan SPG/SPB</option>
                  <option value="spg_mobile">Laporan SMD / Lapangan</option>
                  <option value="event">Laporan Event</option>
                  <option value="collector">Laporan Kolektor</option>
                  <option value="absence">Tidak Masuk Kerja</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700">Nama Karyawan</label>
                <select
                  value={filterUserId}
                  onChange={(e) => setFilterUserId(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                >
                  <option value="">Semua Karyawan</option>
                  {fieldEmployeesList.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.fullName} ({u.employeeCategory})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700">Leader / SPV</label>
                <select
                  value={filterLeaderId}
                  onChange={(e) => setFilterLeaderId(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                >
                  <option value="">Semua Tim</option>
                  {leadersList.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700">Status Aktivitas</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                >
                  <option value="">Semua Status</option>
                  <option value="Check-In">Check-In</option>
                  <option value="Check-Out">Check-Out</option>
                  <option value="Selesai">Selesai</option>
                  <option value="Tertunda">Tertunda</option>
                  <option value="Butuh Tindak Lanjut">Butuh Tindak Lanjut</option>
                  <option value="PO">PO</option>
                  <option value="NOO">NOO</option>
                  <option value="Diajukan">Penawaran: Diajukan</option>
                  <option value="Negosiasi">Penawaran: Negosiasi</option>
                  <option value="Tertarik / Follow-Up">Penawaran: Follow-Up</option>
                  <option value="Deal">Penawaran: Deal</option>
                  <option value="Ditolak">Penawaran: Ditolak</option>
                  <option value="Bayar Lunas">Bayar Lunas</option>
                  <option value="Bayar Sebagian">Bayar Sebagian</option>
                  <option value="Janji Bayar">Janji Bayar</option>
                  <option value="Toko Tutup">Toko Tutup</option>
                  <option value="Gagal Tagih">Gagal Tagih</option>
                  <option value="Libur">Libur</option>
                  <option value="Sakit">Sakit</option>
                  <option value="Izin">Izin</option>
                  <option value="Cuti">Cuti</option>
                </select>
              </div>
            </div>

            {/* 3 Storage & Export Buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-slate-800 transition"
              >
                <Download className="h-4 w-4 text-amber-400" />
                <span>Unduh Laporan (CSV)</span>
              </button>

              <button
                type="button"
                disabled={zipping}
                onClick={handleDownloadZip}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-60 transition"
              >
                <FolderArchive className="h-4 w-4" />
                <span>{zipping ? 'Membuat ZIP...' : 'Unduh Semua Foto (ZIP)'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPurgeModal(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-red-700 transition sm:ml-auto"
              >
                <Trash2 className="h-4 w-4" />
                <span>Hapus Foto &amp; Data Terfilter</span>
              </button>
            </div>

            {/* Monitoring Table */}
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3.5 py-3 font-bold whitespace-nowrap">Nama Karyawan</th>
                    <th className="px-3.5 py-3 font-bold whitespace-nowrap">
                      Waktu Check-In / Out
                    </th>
                    <th className="px-3.5 py-3 font-bold">Nama Lokasi / Klien</th>
                    <th className="px-3.5 py-3 font-bold whitespace-nowrap">Status</th>
                    <th className="px-3.5 py-3 font-bold whitespace-nowrap text-right">
                      Penjualan (Qty &amp; Rp)
                    </th>
                    <th className="px-3.5 py-3 font-bold whitespace-nowrap">Foto &amp; Lampiran</th>
                    <th className="px-3.5 py-3 font-bold whitespace-nowrap">GPS &amp; Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loadingMonitoring && !monitoring ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Memuat data monitoring...
                      </td>
                    </tr>
                  ) : !monitoring?.records.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Tidak ada catatan kehadiran atau kunjungan pada filter tanggal ini.
                      </td>
                    </tr>
                  ) : (
                    monitoring.records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-3.5 py-3 align-top">
                          <div className="font-bold text-slate-950">{r.userName}</div>
                          <div className="text-xs text-slate-600">
                            {r.employeeCategory || r.userRole}
                            {r.leaderName ? ` · SPV: ${r.leaderName}` : ''}
                          </div>
                        </td>

                        <td className="px-3.5 py-3 align-top font-mono text-xs tabular-nums text-slate-800 whitespace-nowrap">
                          <div>{formatDateID(r.dateKey)}</div>
                          <div>
                            In: <strong>{r.checkInTime ? formatTimeWIB(r.checkInTime) : '-'}</strong>
                          </div>
                          <div>
                            Out: <strong>{r.checkOutTime ? formatTimeWIB(r.checkOutTime) : '-'}</strong>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Foto: {formatTimeWIB(r.capturedAt)}
                          </div>
                        </td>

                        <td className="px-3.5 py-3 align-top max-w-[220px]">
                          <div className="font-bold text-slate-900">{r.clientName}</div>
                          {r.notes && (
                            <p className="mt-0.5 text-xs text-slate-600 line-clamp-2">{r.notes}</p>
                          )}
                        </td>

                        <td className="px-3.5 py-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 font-bold text-xs ${
                              r.visitStatus === 'Selesai' || r.visitStatus === 'Check-In'
                                ? 'text-emerald-700'
                                : r.visitStatus === 'Tertunda'
                                ? 'text-amber-700'
                                : r.visitStatus === 'Butuh Tindak Lanjut'
                                ? 'text-red-700'
                                : 'text-slate-800'
                            }`}
                          >
                            {r.visitStatus}
                          </span>
                        </td>

                        <td className="px-3.5 py-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-950">{r.salesQty} unit</div>
                          <div className="text-xs font-bold text-orange-700">
                            {formatRupiah(r.salesAmount)}
                          </div>
                        </td>

                        <td className="px-3.5 py-3 align-top">
                          <div className="flex flex-wrap gap-1.5 max-w-[140px]">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenPhoto({
                                  url: r.photoUrl,
                                  title: `${r.userName} · ${r.clientName}`,
                                  subtitle: `${r.visitStatus} · ${formatDateTimeWIB(r.capturedAt)}`,
                                  notes: r.notes,
                                  lat: r.lat,
                                  lng: r.lng,
                                })
                              }
                              className="group relative h-11 w-11 overflow-hidden rounded-lg border border-slate-300 bg-slate-100 hover:border-orange-600"
                              title="Klik untuk memperbesar foto"
                            >
                              <img
                                src={r.photoUrl}
                                alt={r.clientName}
                                className="h-full w-full object-cover"
                              />
                            </button>
                            {r.adminAttachments?.map((att) => (
                              <button
                                key={`att-${att.id}`}
                                type="button"
                                onClick={() =>
                                  onOpenPhoto({
                                    url: att.photoUrl,
                                    title: `Lampiran Admin · ${r.userName}`,
                                    subtitle: formatDateTimeWIB(att.createdAt),
                                    notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                  })
                                }
                                className="h-11 w-11 overflow-hidden rounded-lg border-2 border-amber-500"
                                title={att.note || 'Lampiran Admin'}
                              >
                                <img
                                  src={att.photoUrl}
                                  alt="Lampiran Admin"
                                  className="h-full w-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        </td>

                        <td className="px-3.5 py-3 align-top whitespace-nowrap space-y-1.5">
                          <div>
                            <a
                              href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 hover:border-orange-600 hover:text-orange-700"
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-orange-600" />
                              <span>Maps</span>
                            </a>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                openAttachmentModal(
                                  'attendance',
                                  r.id,
                                  `${r.userName} · ${r.visitStatus} (${formatDateID(r.dateKey)})`
                                )
                              }
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-950 hover:bg-amber-100"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-orange-600" />
                              <span>+ Foto Form ({r.adminAttachments?.length ?? 0})</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Structured Daily Reports Monitoring Table */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-950">
                  Monitoring Laporan Harian (SPG/SPB / SMD / Event)
                </h2>
                <p className="text-xs text-slate-600">
                  Menampilkan {monitoring?.dailyReports?.length ?? 0} laporan terstruktur sesuai filter aktif.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3.5 py-3 font-bold">Karyawan &amp; Jenis</th>
                    <th className="px-3.5 py-3 font-bold">Lokasi / Kegiatan</th>
                    <th className="px-3.5 py-3 font-bold">Detail Item &amp; Catatan Lapangan</th>
                    <th className="px-3.5 py-3 font-bold text-right">Penjualan</th>
                    <th className="px-3.5 py-3 font-bold">Foto &amp; Lampiran</th>
                    <th className="px-3.5 py-3 font-bold">GPS &amp; Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {!monitoring?.dailyReports?.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-7 text-center text-slate-500">
                        Tidak ada laporan SPG/SPB, SMD, atau Event pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    monitoring.dailyReports.map((dr) => (
                      <tr key={dr.id} className="hover:bg-slate-50">
                        <td className="px-3.5 py-3 align-top">
                          <div className="font-bold text-slate-950">{dr.userName}</div>
                          <span className="mt-0.5 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                            {reportTypeLabel(dr.reportType)}
                          </span>
                          <div className="mt-1 font-mono text-[11px] text-slate-500">
                            {formatDateTimeWIB(dr.reportedAt)}
                          </div>
                          {dr.leaderName && (
                            <div className="text-[11px] text-slate-600">SPV: {dr.leaderName}</div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top max-w-[200px]">
                          <div className="font-bold text-slate-900">
                            {dr.reportType === 'event' ? dr.eventName : dr.clientName}
                          </div>
                          <div className="text-xs font-semibold text-orange-700">{dr.visitStatus}</div>
                          {dr.notes && <p className="mt-0.5 text-xs text-slate-600">{dr.notes}</p>}
                        </td>
                        <td className="px-3.5 py-3 align-top max-w-[300px] text-xs text-slate-700 space-y-1">
                          {dr.salesItems.length > 0 && (
                            <div className="space-y-0.5">
                              {dr.salesItems.map((it, idx) => (
                                <div key={idx} className="font-mono text-[11px]">
                                  • {it.productName} ({it.quantity} {it.productUnit} ={' '}
                                  {formatRupiah(it.totalAmount)})
                                </div>
                              ))}
                            </div>
                          )}
                          {dr.offerNotes && (
                            <div>
                              <strong>Penawaran:</strong> {dr.offerNotes}
                            </div>
                          )}
                          {dr.reportType === 'event' && (
                            <div className="space-y-0.5">
                              <div>
                                Target Sales: {formatRupiah(dr.targetSalesAmount)} · Realisasi:{' '}
                                <strong>{formatRupiah(dr.realizedSalesAmount)}</strong>
                              </div>
                              <div>
                                Pengunjung: {dr.realizedVisitors}/{dr.targetVisitors} orang · Biaya:{' '}
                                <strong>{formatRupiah(dr.totalExpense)}</strong>
                              </div>
                              {dr.expenses.length > 0 && (
                                <div className="text-[11px] text-slate-500">
                                  Pos Biaya: {dr.expenses.map((e) => `${e.name} (${formatRupiah(e.amount)})`).join(', ')}
                                </div>
                              )}
                              {dr.obstacles && <div>Kendala: {dr.obstacles}</div>}
                              {dr.suggestions && <div>Saran: {dr.suggestions}</div>}
                            </div>
                          )}
                          {dr.fieldNotes && (
                            <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-950 border border-amber-200">
                              <strong>Catatan Lapangan:</strong> {dr.fieldNotes}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {dr.totalQty > 0 && (
                            <div className="text-xs font-bold text-slate-800">{dr.totalQty} unit</div>
                          )}
                          <div className="text-xs font-extrabold text-orange-700">
                            {formatRupiah(
                              dr.reportType === 'event'
                                ? dr.realizedSalesAmount
                                : dr.totalSalesAmount
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-3 align-top">
                          {dr.photos.length === 0 && !dr.adminAttachments?.length ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-w-[150px]">
                              {dr.photos.map((ph) => (
                                <button
                                  key={ph.id}
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: ph.photoUrl,
                                      title: `${dr.userName} · ${reportTypeLabel(dr.reportType)}`,
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
                                  className="h-10 w-10 overflow-hidden rounded-lg border border-slate-300 hover:border-orange-600"
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
                                  className="h-10 w-10 overflow-hidden rounded-lg border-2 border-amber-500"
                                  title={att.note || 'Lampiran Admin'}
                                >
                                  <img
                                    src={att.photoUrl}
                                    alt="Lampiran Admin"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top whitespace-nowrap space-y-1.5">
                          {dr.lat !== null && dr.lng !== null && (
                            <div>
                              <a
                                href={`https://www.google.com/maps?q=${dr.lat},${dr.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 hover:border-orange-600"
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-orange-600" />
                                <span>Maps</span>
                              </a>
                            </div>
                          )}
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                openAttachmentModal(
                                  'daily_report',
                                  dr.id,
                                  `${dr.userName} · ${reportTypeLabel(dr.reportType)} (${dr.eventName || dr.clientName})`
                                )
                              }
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-950 hover:bg-amber-100"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-orange-600" />
                              <span>+ Foto Form ({dr.adminAttachments?.length ?? 0})</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Sales Representatif Monitoring Table */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-950">
                  Monitoring Sales Representatif (Penawaran / PO / NOO)
                </h2>
                <p className="text-xs text-slate-600">
                  Menampilkan {monitoring?.salesRepReports?.length ?? 0} laporan Penawaran Produk, Purchase Order, &amp; Outlet Baru (NOO).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3.5 py-3 font-bold">Sales Rep &amp; Jenis</th>
                    <th className="px-3.5 py-3 font-bold">Toko / Outlet</th>
                    <th className="px-3.5 py-3 font-bold">Rincian &amp; Catatan Lapangan</th>
                    <th className="px-3.5 py-3 font-bold text-right">Nilai PO / Status</th>
                    <th className="px-3.5 py-3 font-bold">Foto &amp; Lampiran</th>
                    <th className="px-3.5 py-3 font-bold">GPS &amp; Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {!monitoring?.salesRepReports?.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-7 text-center text-slate-500">
                        Tidak ada laporan Sales Representatif pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    monitoring.salesRepReports.map((sr) => (
                      <tr key={sr.id} className="hover:bg-slate-50">
                        <td className="px-3.5 py-3 align-top">
                          <div className="font-bold text-slate-950">{sr.userName}</div>
                          <span className="mt-0.5 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
                            {sr.subType === 'po'
                              ? 'PO'
                              : sr.subType === 'noo'
                              ? 'NOO'
                              : 'Penawaran'}
                          </span>
                          <div className="mt-1 font-mono text-[11px] text-slate-500">
                            {formatDateTimeWIB(sr.reportedAt)}
                          </div>
                          {sr.leaderName && (
                            <div className="text-[11px] text-slate-600">SPV: {sr.leaderName}</div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top max-w-[200px]">
                          <div className="font-bold text-slate-900">
                            {sr.subType === 'noo' ? sr.outletName : sr.clientName}
                          </div>
                          {sr.subType === 'noo' && (
                            <div className="text-xs text-slate-600">
                              {sr.outletType}
                              {sr.outletOwner ? ` · ${sr.outletOwner}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top max-w-[310px] text-xs text-slate-700 space-y-1">
                          {sr.subType === 'po' && sr.poItems.length > 0 && (
                            <div className="space-y-0.5">
                              {sr.poItems.map((it, idx) => (
                                <div key={idx} className="font-mono text-[11px]">
                                  • {it.productName} ({it.quantity} {it.productUnit} ={' '}
                                  {formatRupiah(it.totalAmount)})
                                </div>
                              ))}
                              {sr.notes && <div className="text-slate-600">Catatan PO: {sr.notes}</div>}
                            </div>
                          )}
                          {sr.subType === 'penawaran' && (
                            <div>
                              <div>{sr.offerNotes}</div>
                              {sr.followUpDate && (
                                <div className="text-amber-800 font-semibold">
                                  Follow-Up: {formatDateID(sr.followUpDate)}
                                </div>
                              )}
                            </div>
                          )}
                          {sr.subType === 'noo' && (
                            <div className="space-y-0.5">
                              {sr.outletAddress && <div>Alamat: {sr.outletAddress}</div>}
                              {sr.outletPhone && <div>HP: {sr.outletPhone}</div>}
                              {sr.outletPotential && <div>Potensi: {sr.outletPotential}</div>}
                            </div>
                          )}
                          {sr.fieldNotes && (
                            <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-950 border border-amber-200">
                              <strong>Catatan Lapangan:</strong> {sr.fieldNotes}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {sr.subType === 'po' ? (
                            <>
                              <div className="text-xs font-bold text-slate-800">{sr.poTotalQty} unit</div>
                              <div className="text-xs font-extrabold text-orange-700">
                                {formatRupiah(sr.poTotalAmount)}
                              </div>
                            </>
                          ) : sr.subType === 'penawaran' ? (
                            <span className="font-sans text-xs font-extrabold text-blue-900">
                              {sr.offerStatus}
                            </span>
                          ) : (
                            <span className="font-sans text-xs font-extrabold text-emerald-700">
                              Outlet Baru
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top">
                          {sr.photos.length === 0 && !sr.adminAttachments?.length ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-w-[150px]">
                              {sr.photos.map((ph, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: ph.photoUrl,
                                      title: `${sr.userName} · ${sr.subType.toUpperCase()}`,
                                      subtitle: sr.outletName || sr.clientName,
                                      notes: sr.fieldNotes || sr.notes,
                                      lat: sr.lat ?? undefined,
                                      lng: sr.lng ?? undefined,
                                    })
                                  }
                                  className="h-10 w-10 overflow-hidden rounded-lg border border-slate-300 hover:border-orange-600"
                                >
                                  <img
                                    src={ph.photoUrl}
                                    alt="Foto Sales Rep"
                                    className="h-full w-full object-cover"
                                  />
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
                                  className="h-10 w-10 overflow-hidden rounded-lg border-2 border-amber-500"
                                  title={att.note || 'Lampiran Admin'}
                                >
                                  <img
                                    src={att.photoUrl}
                                    alt="Lampiran Admin"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top whitespace-nowrap space-y-1.5">
                          {sr.lat !== null && sr.lng !== null && (
                            <div>
                              <a
                                href={`https://www.google.com/maps?q=${sr.lat},${sr.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 hover:border-orange-600"
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-orange-600" />
                                <span>Maps</span>
                              </a>
                            </div>
                          )}
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                openAttachmentModal(
                                  'sales_rep',
                                  sr.id,
                                  `${sr.userName} · ${sr.subType.toUpperCase()} (${sr.outletName || sr.clientName})`
                                )
                              }
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-950 hover:bg-amber-100"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-orange-600" />
                              <span>+ Foto Form ({sr.adminAttachments?.length ?? 0})</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Collector Monitoring Table */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-950">
                  Monitoring Laporan Kolektor (Penagihan Piutang)
                </h2>
                <p className="text-xs text-slate-600">
                  Menampilkan {monitoring?.collectionReports?.length ?? 0} kunjungan penagihan sesuai filter aktif.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3.5 py-3 font-bold">Kolektor &amp; Waktu</th>
                    <th className="px-3.5 py-3 font-bold">Customer &amp; Invoice</th>
                    <th className="px-3.5 py-3 font-bold">Status &amp; Metode</th>
                    <th className="px-3.5 py-3 font-bold text-right">Tertagih / Sisa</th>
                    <th className="px-3.5 py-3 font-bold">Tindak Lanjut &amp; Catatan Lapangan</th>
                    <th className="px-3.5 py-3 font-bold">Foto &amp; Lampiran</th>
                    <th className="px-3.5 py-3 font-bold">GPS &amp; Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {!monitoring?.collectionReports?.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-7 text-center text-slate-500">
                        Tidak ada laporan kolektor pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    monitoring.collectionReports.map((cr) => (
                      <tr key={cr.id} className="hover:bg-slate-50">
                        <td className="px-3.5 py-3 align-top">
                          <div className="font-bold text-slate-950">{cr.userName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {formatDateTimeWIB(cr.visitedAt)}
                          </div>
                          {cr.leaderName && (
                            <div className="text-[11px] text-slate-600">SPV: {cr.leaderName}</div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top">
                          <div className="font-bold text-slate-900">{cr.customerName}</div>
                          <div className="font-mono text-xs text-slate-600">{cr.invoiceNumber}</div>
                        </td>
                        <td className="px-3.5 py-3 align-top whitespace-nowrap">
                          <div
                            className={`text-xs font-extrabold ${
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
                          </div>
                          <div className="text-xs text-slate-600">{cr.paymentMethod}</div>
                        </td>
                        <td className="px-3.5 py-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-xs font-extrabold text-emerald-700">
                            Tertagih: {formatRupiah(cr.collectedAmount)}
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Sisa: {formatRupiah(cr.remainingAmount)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Tagihan: {formatRupiah(cr.invoiceTotal)}
                          </div>
                        </td>
                        <td className="px-3.5 py-3 align-top max-w-[240px] text-xs text-slate-700 space-y-1">
                          {cr.promiseDate && (
                            <div className="font-bold text-amber-800">
                              Janji: {formatDateID(cr.promiseDate)}
                            </div>
                          )}
                          {cr.reason && <div className="font-semibold text-red-700">{cr.reason}</div>}
                          {cr.notes && <div className="text-slate-600">{cr.notes}</div>}
                          {cr.fieldNotes && (
                            <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-950 border border-amber-200">
                              <strong>Catatan Lapangan:</strong> {cr.fieldNotes}
                            </div>
                          )}
                          {!cr.promiseDate && !cr.reason && !cr.notes && !cr.fieldNotes && '-'}
                        </td>
                        <td className="px-3.5 py-3 align-top">
                          {!cr.photoUrl && !cr.adminAttachments?.length ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-w-[140px]">
                              {cr.photoUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: cr.photoUrl,
                                      title: `${cr.userName} · ${cr.customerName}`,
                                      subtitle: `${cr.invoiceNumber} (${cr.visitStatus}) · ${formatDateTimeWIB(cr.visitedAt)}`,
                                      notes: cr.fieldNotes || cr.notes || cr.reason,
                                      lat: cr.lat ?? undefined,
                                      lng: cr.lng ?? undefined,
                                    })
                                  }
                                  className="h-11 w-11 overflow-hidden rounded-lg border border-slate-300 hover:border-orange-600"
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
                                  className="h-11 w-11 overflow-hidden rounded-lg border-2 border-amber-500"
                                  title={att.note || 'Lampiran Admin'}
                                >
                                  <img
                                    src={att.photoUrl}
                                    alt="Lampiran Admin"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top whitespace-nowrap space-y-1.5">
                          {cr.lat !== null && cr.lng !== null && (
                            <div>
                              <a
                                href={`https://www.google.com/maps?q=${cr.lat},${cr.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 hover:border-orange-600"
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-orange-600" />
                                <span>Maps</span>
                              </a>
                            </div>
                          )}
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                openAttachmentModal(
                                  'collection',
                                  cr.id,
                                  `${cr.userName} · ${cr.customerName} (${cr.invoiceNumber})`
                                )
                              }
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-950 hover:bg-amber-100"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-orange-600" />
                              <span>+ Foto Form ({cr.adminAttachments?.length ?? 0})</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Absence (Libur / Sakit / Izin / Cuti) Monitoring Table */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-950">
                  Monitoring Tidak Masuk Kerja (Libur / Sakit / Izin / Cuti)
                </h2>
                <p className="text-xs text-slate-600">
                  Menampilkan {monitoring?.absenceReports?.length ?? 0} catatan tidak masuk kerja sesuai filter aktif.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3.5 py-3 font-bold">Karyawan &amp; Kategori</th>
                    <th className="px-3.5 py-3 font-bold">Status</th>
                    <th className="px-3.5 py-3 font-bold">Rentang Tanggal</th>
                    <th className="px-3.5 py-3 font-bold">Keterangan &amp; Catatan Lapangan</th>
                    <th className="px-3.5 py-3 font-bold">Bukti &amp; Lampiran</th>
                    <th className="px-3.5 py-3 font-bold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {!monitoring?.absenceReports?.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-7 text-center text-slate-500">
                        Tidak ada catatan Tidak Masuk Kerja pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    monitoring.absenceReports.map((ab) => (
                      <tr key={ab.id} className="hover:bg-slate-50">
                        <td className="px-3.5 py-3 align-top">
                          <div className="font-bold text-slate-950">{ab.userName}</div>
                          <div className="text-xs text-slate-600">
                            {ab.employeeCategory}
                            {ab.leaderName ? ` · SPV: ${ab.leaderName}` : ''}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {formatDateTimeWIB(ab.submittedAt)}
                          </div>
                        </td>
                        <td className="px-3.5 py-3 align-top whitespace-nowrap">
                          <span className="inline-block rounded bg-slate-900 px-2.5 py-1 text-xs font-extrabold text-amber-400">
                            {ab.absenceType}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 align-top font-mono text-xs font-bold text-slate-900 whitespace-nowrap">
                          {formatDateID(ab.startDate)}
                          {ab.endDate !== ab.startDate ? ` s.d. ${formatDateID(ab.endDate)}` : ''}
                        </td>
                        <td className="px-3.5 py-3 align-top max-w-[280px] text-xs text-slate-700 space-y-1">
                          <div>{ab.reason}</div>
                          {ab.fieldNotes && (
                            <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-950 border border-amber-200">
                              <strong>Catatan Lapangan:</strong> {ab.fieldNotes}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top">
                          {!ab.photoUrl && !ab.adminAttachments?.length ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-w-[140px]">
                              {ab.photoUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: ab.photoUrl,
                                      title: `${ab.userName} · ${ab.absenceType}`,
                                      subtitle: `${formatDateID(ab.startDate)} - ${formatDateID(ab.endDate)}`,
                                      notes: ab.fieldNotes || ab.reason,
                                    })
                                  }
                                  className="h-11 w-11 overflow-hidden rounded-lg border border-slate-300 hover:border-orange-600"
                                >
                                  <img
                                    src={ab.photoUrl}
                                    alt="Bukti tidak masuk"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              )}
                              {ab.adminAttachments?.map((att) => (
                                <button
                                  key={`att-${att.id}`}
                                  type="button"
                                  onClick={() =>
                                    onOpenPhoto({
                                      url: att.photoUrl,
                                      title: `Lampiran Admin · ${ab.userName}`,
                                      subtitle: formatDateTimeWIB(att.createdAt),
                                      notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                                    })
                                  }
                                  className="h-11 w-11 overflow-hidden rounded-lg border-2 border-amber-500"
                                  title={att.note || 'Lampiran Admin'}
                                >
                                  <img
                                    src={att.photoUrl}
                                    alt="Lampiran Admin"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 align-top whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              openAttachmentModal(
                                'absence',
                                ab.id,
                                `${ab.userName} · ${ab.absenceType} (${formatDateID(ab.startDate)})`
                              )
                            }
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-slate-950 hover:bg-amber-100"
                          >
                            <Paperclip className="h-3.5 w-3.5 text-orange-600" />
                            <span>+ Foto Form ({ab.adminAttachments?.length ?? 0})</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ==================== TAB 2: KARYAWAN & TIM ==================== */}
      {activeTab === 'users' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-950">
                Manajemen Akun Karyawan &amp; Struktur Tim
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Nomor HP otomatis dikonversi menjadi identitas internal <code className="font-mono">@app.local</code> tanpa OTP SMS.
              </p>
            </div>
            <button
              type="button"
              onClick={openAddUserModal}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm hover:bg-orange-700 transition"
            >
              <UserPlus className="h-4 w-4" />
              <span>+ Tambah Karyawan</span>
            </button>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="px-4 py-3 font-bold">Nama Lengkap</th>
                  <th className="px-4 py-3 font-bold">Nomor HP &amp; Alias Auth</th>
                  <th className="px-4 py-3 font-bold">Peran &amp; Kategori</th>
                  <th className="px-4 py-3 font-bold">Leader/SPV (Atasan)</th>
                  <th className="px-4 py-3 font-bold">Status Akun</th>
                  <th className="px-4 py-3 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-950">{u.fullName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      <div className="font-bold text-slate-950">{u.phone}</div>
                      <div className="text-slate-500">{u.emailAlias}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{u.role}</div>
                      {u.role !== 'Admin' && (
                        <div className="mt-0.5 text-[11px] font-semibold text-orange-700">
                          Kategori: {u.employeeCategory || 'Sales Representatif'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u.role === 'Karyawan' ? (
                        u.leaderName ? (
                          <span className="font-bold text-slate-900">{u.leaderName}</span>
                        ) : (
                          <span className="font-semibold text-amber-700">Belum ditentukan</span>
                        )
                      ) : u.role === 'Leader/SPV' ? (
                        <span className="font-semibold text-blue-900">
                          Atasan Tim ({downlineCountByLeader.get(u.id) || 0} downline)
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-bold text-xs ${
                          u.isActive ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {u.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditUserModal(u)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Edit / Mutasi</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== TAB 3: MASTER PRODUK & EXCEL ==================== */}
      {activeTab === 'products' && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Master Data Produk &amp; Impor Excel
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  Kelola katalog produk CV. Pangan Berkah Sentosa. Mendukung file <code className="font-mono">.xlsx</code>, <code className="font-mono">.xls</code>, dan <code className="font-mono">.csv</code>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadTemplateExcel}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:bg-slate-100"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                  <span>Unduh Template Excel</span>
                </button>

                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => excelInputRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-slate-800"
                >
                  <Upload className="h-4 w-4 text-amber-400" />
                  <span>Upload Data Barang (Excel)</span>
                </button>

                <button
                  type="button"
                  onClick={openAddProductModal}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-orange-700"
                >
                  <Plus className="h-4 w-4" />
                  <span>Tambah Produk</span>
                </button>
              </div>
            </div>

            {/* Excel Import Preview Panel */}
            {importPreview && (
              <div className="mt-5 rounded-2xl border-2 border-amber-400 bg-amber-50/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-950">
                      Preview Impor Produk ({importPreview.length} baris dibaca)
                    </h3>
                    <p className="text-xs text-slate-700">
                      Periksa peringatan duplikasi SKU atau baris tidak valid sebelum menyimpan ke database.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={importMode}
                      onChange={(e) => setImportMode(e.target.value as 'skip' | 'update')}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-900"
                    >
                      <option value="skip">Jika SKU sudah ada: Lewati</option>
                      <option value="update">Jika SKU sudah ada: Perbarui Data</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setImportPreview(null)}
                      className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={importingProducts}
                      onClick={handleConfirmImport}
                      className="min-h-[38px] rounded-lg bg-orange-600 px-4 text-xs font-extrabold text-white hover:bg-orange-700"
                    >
                      {importingProducts ? 'Menyimpan...' : 'Simpan Produk Valid'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-100 text-slate-900">
                      <tr>
                        <th className="px-3 py-2 font-bold">Baris</th>
                        <th className="px-3 py-2 font-bold">SKU</th>
                        <th className="px-3 py-2 font-bold">Nama Produk</th>
                        <th className="px-3 py-2 font-bold">Kategori</th>
                        <th className="px-3 py-2 font-bold">Satuan</th>
                        <th className="px-3 py-2 font-bold text-right">Harga Satuan</th>
                        <th className="px-3 py-2 font-bold">Validasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.map((r) => (
                        <tr
                          key={r.rowNum}
                          className={r.error || r.isDuplicateInFile ? 'bg-red-50' : ''}
                        >
                          <td className="px-3 py-2 font-mono">{r.rowNum}</td>
                          <td className="px-3 py-2 font-mono font-bold">{r.sku || '-'}</td>
                          <td className="px-3 py-2 font-semibold">{r.name || '-'}</td>
                          <td className="px-3 py-2">{r.category}</td>
                          <td className="px-3 py-2">{r.unit}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatRupiah(r.unitPrice)}
                          </td>
                          <td className="px-3 py-2 font-bold">
                            {r.error ? (
                              <span className="text-red-700">{r.error}</span>
                            ) : r.isDuplicateInFile ? (
                              <span className="text-red-700">Duplikat SKU dalam file</span>
                            ) : r.existsInDb ? (
                              <span className="text-amber-700">
                                SKU sudah ada ({importMode === 'update' ? 'akan diperbarui' : 'akan dilewati'})
                              </span>
                            ) : (
                              <span className="text-emerald-700">Siap Impor</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Products Table */}
            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 font-bold">Kode / SKU</th>
                    <th className="px-4 py-3 font-bold">Nama Produk</th>
                    <th className="px-4 py-3 font-bold">Kategori</th>
                    <th className="px-4 py-3 font-bold">Satuan</th>
                    <th className="px-4 py-3 font-bold text-right">Harga Satuan</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Belum ada produk di master data. Klik Upload Data Barang (Excel) atau Tambah Produk.
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-950">{p.sku}</td>
                        <td className="px-4 py-3 font-bold text-slate-900">{p.name}</td>
                        <td className="px-4 py-3 text-slate-700">{p.category}</td>
                        <td className="px-4 py-3 text-slate-700">{p.unit}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-950 tabular-nums">
                          {formatRupiah(p.unitPrice)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-bold text-xs ${
                              p.isActive ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {p.isActive ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditProductModal(p)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ==================== TAB 3B: MASTER CUSTOMER & TAGIHAN INVOICE ==================== */}
      {activeTab === 'customers' && (
        <div className="space-y-6">
          {/* Customer Master Section */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Master Customer / Toko (Kolektor)
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  Daftar customer yang muncul di dropdown kunjungan penagihan Kolektor.
                </p>
              </div>
              <button
                type="button"
                onClick={openAddCustomerModal}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs sm:text-sm font-extrabold text-white hover:bg-orange-700"
              >
                <Plus className="h-4 w-4" />
                <span>+ Tambah Customer</span>
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 font-bold">Kode</th>
                    <th className="px-4 py-3 font-bold">Nama Customer / Toko</th>
                    <th className="px-4 py-3 font-bold">No. HP &amp; Alamat</th>
                    <th className="px-4 py-3 font-bold text-right">Faktur Belum Lunas</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {customers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-7 text-center text-slate-500">
                        Belum ada data customer. Klik "+ Tambah Customer" untuk membuat data baru.
                      </td>
                    </tr>
                  ) : (
                    customers.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-950">{c.code}</td>
                        <td className="px-4 py-3 font-bold text-slate-900">{c.name}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div className="font-mono">{c.phone || '-'}</div>
                          <div>{c.address || '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          <div className="font-bold text-slate-900">{c.unpaidCount || 0} faktur</div>
                          <div className="text-orange-700 font-bold">
                            {formatRupiah(c.totalRemaining || 0)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-bold ${
                              c.isActive ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {c.isActive ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditCustomerModal(c)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-900 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Invoices Section */}
          <section className="rounded-2xl border border-amber-400 bg-white p-4 sm:p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Daftar Invoice / Tagihan Customer
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  Sisa tagihan otomatis berkurang dan status diperbarui setiap kali Kolektor mencatat pembayaran.
                </p>
              </div>
              <button
                type="button"
                disabled={customers.length === 0}
                onClick={openAddInvoiceModal}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs sm:text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4 text-amber-400" />
                <span>+ Tambah Invoice</span>
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 font-bold">No. Invoice</th>
                    <th className="px-4 py-3 font-bold">Customer</th>
                    <th className="px-4 py-3 font-bold text-right">Total Faktur</th>
                    <th className="px-4 py-3 font-bold text-right">Sudah Dibayar</th>
                    <th className="px-4 py-3 font-bold text-right">Sisa Tagihan</th>
                    <th className="px-4 py-3 font-bold">Jatuh Tempo &amp; Status</th>
                    <th className="px-4 py-3 font-bold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-7 text-center text-slate-500">
                        Belum ada tagihan invoice. Tambahkan customer lalu klik "+ Tambah Invoice".
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-950">
                          {inv.invoiceNumber}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {inv.customerName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                          {formatRupiah(inv.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 font-bold">
                          {formatRupiah(inv.paidAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-orange-700 font-extrabold">
                          {formatRupiah(inv.remainingAmount)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="font-mono text-slate-600">
                            {inv.dueDate ? formatDateID(inv.dueDate) : 'Tanpa JT'}
                          </div>
                          <span
                            className={`font-extrabold ${
                              inv.status === 'Lunas'
                                ? 'text-emerald-700'
                                : inv.status === 'Sebagian'
                                ? 'text-blue-900'
                                : 'text-red-700'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditInvoiceModal(inv)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-900 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ==================== TAB 4: TARGET PENJUALAN & PENGATURAN ==================== */}
      {activeTab === 'targets' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Global Target & Price Rule */}
          <section className="rounded-2xl border border-amber-400 bg-white p-5 shadow-xs lg:col-span-5">
            <h2 className="text-lg font-extrabold text-slate-950">
              Target Global &amp; Aturan Harga
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Tetapkan target penjualan keseluruhan tim dan izin penyesuaian harga promo.
            </p>

            <form onSubmit={handleSaveGlobalSettings} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-900">Periode Target</label>
                <select
                  value={gPeriod}
                  onChange={(e) => setGPeriod(e.target.value as any)}
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-950"
                >
                  <option value="harian">Harian</option>
                  <option value="mingguan">Mingguan</option>
                  <option value="bulanan">Bulanan</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Target Omzet Global (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={gAmount}
                  onChange={(e) => setGAmount(e.target.value)}
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm font-bold text-slate-950 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Target Total Quantity Global (Unit)
                </label>
                <input
                  type="number"
                  min={0}
                  value={gQty}
                  onChange={(e) => setGQty(e.target.value)}
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm font-bold text-slate-950 tabular-nums"
                />
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPriceAdj}
                  onChange={(e) => setAllowPriceAdj(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-orange-600"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Izinkan Karyawan / Leader menyesuaikan harga satuan promo atau diskon saat input laporan penjualan
                </span>
              </label>

              <button
                type="submit"
                disabled={savingGlobal}
                className="w-full min-h-[48px] rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-orange-700 disabled:opacity-60"
              >
                {savingGlobal ? 'Menyimpan...' : 'Simpan Target Global & Pengaturan'}
              </button>
            </form>
          </section>

          {/* Specific Per-Employee Targets */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
            <h2 className="text-lg font-extrabold text-slate-950">
              Target Spesifik per Karyawan
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Tetapkan target nominal (Rp), quantity, atau produk/kategori tertentu per karyawan.
            </p>

            <form
              onSubmit={handleCreateEmployeeTarget}
              className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
            >
              <div>
                <label className="block text-xs font-bold text-slate-800">Pilih Karyawan</label>
                <select
                  required
                  value={tUserId}
                  onChange={(e) => setTUserId(e.target.value)}
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold"
                >
                  <option value="">-- Pilih Karyawan --</option>
                  {fieldEmployeesList.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.fullName} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800">Periode</label>
                <select
                  value={tPeriod}
                  onChange={(e) => setTPeriod(e.target.value as any)}
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold"
                >
                  <option value="harian">Harian</option>
                  <option value="mingguan">Mingguan</option>
                  <option value="bulanan">Bulanan</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800">Target Nominal (Rp)</label>
                <input
                  type="number"
                  min={0}
                  value={tAmount}
                  onChange={(e) => setTAmount(e.target.value)}
                  placeholder="Contoh: 10000000"
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800">Target Quantity (Unit)</label>
                <input
                  type="number"
                  min={0}
                  value={tQty}
                  onChange={(e) => setTQty(e.target.value)}
                  placeholder="Contoh: 100"
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800">Cakupan Target</label>
                <select
                  value={tScopeType}
                  onChange={(e) => setTScopeType(e.target.value as any)}
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold"
                >
                  <option value="all">Semua Produk</option>
                  <option value="product">Produk Spesifik</option>
                  <option value="category">Kategori Spesifik</option>
                </select>
              </div>

              {tScopeType === 'product' && (
                <div>
                  <label className="block text-xs font-bold text-slate-800">Pilih Produk</label>
                  <select
                    required
                    value={tProductId}
                    onChange={(e) => setTProductId(e.target.value)}
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold"
                  >
                    <option value="">-- Pilih Produk --</option>
                    {products
                      .filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          [{p.sku}] {p.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {tScopeType === 'category' && (
                <div>
                  <label className="block text-xs font-bold text-slate-800">Pilih Kategori</label>
                  <select
                    required
                    value={tCategory}
                    onChange={(e) => setTCategory(e.target.value)}
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold"
                  >
                    <option value="">-- Pilih Kategori --</option>
                    {(settingsData?.categories || []).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={savingEmpTarget}
                  className="w-full min-h-[44px] rounded-xl bg-slate-900 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-slate-800"
                >
                  {savingEmpTarget ? 'Menambahkan...' : '+ Tetapkan Target Karyawan'}
                </button>
              </div>
            </form>

            {/* Existing Specific Targets List */}
            <div className="mt-5 space-y-3">
              {!settingsData?.employeeTargets.length ? (
                <p className="text-sm text-slate-500">
                  Belum ada target spesifik per karyawan yang ditetapkan.
                </p>
              ) : (
                settingsData.employeeTargets.map((et) => {
                  const pct =
                    et.targetAmount > 0
                      ? Math.min(999, Math.round((et.actualAmount / et.targetAmount) * 100))
                      : et.targetQty > 0
                      ? Math.min(999, Math.round((et.actualQty / et.targetQty) * 100))
                      : 0;
                  return (
                    <div
                      key={et.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-950">{et.userName}</span>
                          <span className="text-xs font-bold text-orange-700">
                            {et.period}
                            {et.productName
                              ? ` · ${et.productName}`
                              : et.category
                              ? ` · Kategori ${et.category}`
                              : ''}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-orange-600"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-xs text-slate-700 tabular-nums">
                          {et.targetAmount > 0 && (
                            <span>
                              Omzet: {formatRupiah(et.actualAmount)} / {formatRupiah(et.targetAmount)}
                            </span>
                          )}
                          {et.targetQty > 0 && (
                            <span>
                              Qty: {et.actualQty} / {et.targetQty} {et.productUnit || 'unit'}
                            </span>
                          )}
                          <span className="font-bold text-slate-950">({pct}%)</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteEmployeeTarget(et.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                        title="Hapus target"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}

      {/* ==================== TAB 5: PAPAN PENGUMUMAN ==================== */}
      {activeTab === 'announcements' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="rounded-2xl border border-amber-400 bg-white p-5 shadow-xs lg:col-span-5">
            <h2 className="text-lg font-extrabold text-slate-950">
              {editingAnnId ? 'Edit Pengumuman' : 'Buat Pengumuman Baru'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Pengumuman aktif langsung tampil di beranda seluruh Karyawan dan Leader/SPV.
            </p>

            <form onSubmit={handleSaveAnnouncement} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Judul Pengumuman
                </label>
                <input
                  type="text"
                  required
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="Contoh: Promo Harga Khusus Beras Minggu Ini"
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Prioritas
                </label>
                <select
                  value={annPriority}
                  onChange={(e) => setAnnPriority(e.target.value as AnnouncementPriority)}
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-950 focus:border-orange-600 focus:outline-none"
                >
                  <option value="Normal">Normal</option>
                  <option value="Penting">Penting</option>
                  <option value="Mendesak">Mendesak</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Isi Pengumuman
                </label>
                <textarea
                  rows={4}
                  required
                  value={annContent}
                  onChange={(e) => setAnnContent(e.target.value)}
                  placeholder="Tulis informasi, instruksi lapangan, atau pengingat target untuk tim..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 p-3.5 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={annPinned}
                  onChange={(e) => setAnnPinned(e.target.checked)}
                  className="h-4 w-4 accent-orange-600"
                />
                <span className="text-xs font-bold text-slate-800">
                  Sematkan di bagian paling atas papan pengumuman
                </span>
              </label>

              <div className="flex items-center gap-2.5">
                {editingAnnId && (
                  <button
                    type="button"
                    onClick={resetAnnouncementForm}
                    className="min-h-[46px] rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:bg-slate-100"
                  >
                    Batal
                  </button>
                )}
                <button
                  type="submit"
                  disabled={savingAnn}
                  className="flex-1 min-h-[46px] rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-orange-700 disabled:opacity-60"
                >
                  {savingAnn
                    ? 'Menyimpan...'
                    : editingAnnId
                    ? 'Simpan Perubahan'
                    : 'Publikasikan Pengumuman'}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold text-slate-950">
                Daftar Pengumuman ({announcements.length})
              </h2>
            </div>

            {announcements.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Belum ada pengumuman yang dibuat. Gunakan formulir di samping untuk mempublikasikan pengumuman pertama.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {announcements.map((ann) => (
                  <div
                    key={ann.id}
                    className={`rounded-xl border p-4 ${
                      !ann.isActive
                        ? 'border-slate-200 bg-slate-100/70 opacity-75'
                        : ann.priority === 'Mendesak'
                        ? 'border-red-300 bg-red-50/50'
                        : ann.priority === 'Penting'
                        ? 'border-amber-300 bg-amber-50/40'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm sm:text-base font-extrabold text-slate-950">
                            {ann.title}
                          </h3>
                          <span
                            className={`text-xs font-bold ${
                              ann.priority === 'Mendesak'
                                ? 'text-red-700'
                                : ann.priority === 'Penting'
                                ? 'text-amber-800'
                                : 'text-slate-700'
                            }`}
                          >
                            · {ann.priority}
                          </span>
                          {ann.isPinned && (
                            <span className="text-xs font-bold text-orange-700">· Disematkan</span>
                          )}
                          {!ann.isActive && (
                            <span className="text-xs font-bold text-slate-600">· Diarsipkan</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs font-mono text-slate-500">
                          {formatDateTimeWIB(ann.createdAt)} · oleh {ann.authorName}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleAnnField(ann, { isPinned: !ann.isPinned })
                          }
                          title={ann.isPinned ? 'Lepas Sematan' : 'Sematkan di Atas'}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
                            ann.isPinned
                              ? 'border-orange-400 bg-orange-50 text-orange-700'
                              : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <Pin className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleAnnField(ann, { isActive: !ann.isActive })
                          }
                          title={ann.isActive ? 'Arsipkan' : 'Aktifkan Kembali'}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAnnId(ann.id);
                            setAnnTitle(ann.title);
                            setAnnContent(ann.content);
                            setAnnPriority(ann.priority);
                            setAnnPinned(ann.isPinned);
                          }}
                          title="Edit Pengumuman"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAnnouncement(ann.id)}
                          title="Hapus Pengumuman"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <p className="mt-2 whitespace-pre-line text-xs sm:text-sm text-slate-800">
                      {ann.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================== MODAL: TAMBAH / EDIT KARYAWAN ==================== */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-950">
                {editingUser ? 'Edit / Mutasi Akun Karyawan' : 'Tambah Karyawan Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-900">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={uName}
                  onChange={(e) => setUName(e.target.value)}
                  placeholder="Contoh: Ahmad Fauzi"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900">Nomor HP</label>
                <input
                  type="tel"
                  required
                  value={uPhone}
                  onChange={(e) => setUPhone(e.target.value)}
                  placeholder="Contoh: 081234567890"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm font-medium"
                />
                {phoneToDummyEmailClient(uPhone) && (
                  <p className="mt-1 text-[11px] font-mono text-slate-600">
                    Email internal otomatis: <strong>{phoneToDummyEmailClient(uPhone)}</strong>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900">
                  {editingUser ? 'Kata Sandi Baru (Kosongkan jika tetap)' : 'Kata Sandi'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={6}
                  value={uPassword}
                  onChange={(e) => setUPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900">Peran</label>
                <select
                  value={uRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as UserRole;
                    setURole(nextRole);
                    if (nextRole === 'Leader/SPV') {
                      setULeaderId('');
                      setUCategory('Leader/SPV');
                    } else if (nextRole === 'Karyawan') {
                      setUCategory((prev) =>
                        prev === 'Leader/SPV' ? 'Sales Representatif' : prev
                      );
                    } else {
                      setULeaderId('');
                      setUCategory('Leader/SPV');
                    }
                  }}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold"
                >
                  <option value="Karyawan">Karyawan</option>
                  <option value="Leader/SPV">Leader/SPV</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>

              {(uRole === 'Karyawan' || uRole === 'Leader/SPV') && (
                <div>
                  <label className="block text-xs font-bold text-slate-900">
                    Kategori Karyawan
                  </label>
                  <select
                    value={uCategory}
                    onChange={(e) => setUCategory(e.target.value as EmployeeCategory)}
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold"
                  >
                    {EMPLOYEE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {uRole === 'Karyawan' && (
                <div>
                  <label className="block text-xs font-bold text-slate-900">
                    Pilih Leader/SPV (Atasan Downline)
                  </label>
                  <select
                    value={uLeaderId}
                    onChange={(e) => setULeaderId(e.target.value)}
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold"
                  >
                    <option value="">-- Tanpa Leader/SPV --</option>
                    {leadersList
                      .filter((l) => !editingUser || l.id !== editingUser.id)
                      .map((l) => (
                        <option key={l.id} value={String(l.id)}>
                          {l.fullName} ({l.phone}){!l.isActive ? ' [Nonaktif]' : ''}
                        </option>
                      ))}
                  </select>
                  {leadersList.length === 0 && (
                    <p className="mt-1 text-[11px] font-medium text-amber-700">
                      Belum ada pengguna dengan peran Leader/SPV. Buat akun Leader/SPV terlebih dahulu untuk menetapkan atasan.
                    </p>
                  )}
                </div>
              )}

              {editingUser && editingUser.id !== currentUser.id && (
                <label className="flex items-center gap-2.5 pt-1 text-sm font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={uActive}
                    onChange={(e) => setUActive(e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span>Akun Aktif (dapat login)</span>
                </label>
              )}

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="flex-1 min-h-[44px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700"
                >
                  {savingUser ? 'Menyimpan...' : 'Simpan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: TAMBAH / EDIT PRODUK ==================== */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-950">
                {editingProduct ? 'Edit Produk' : 'Tambah Produk Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-900">Kode / SKU Barang</label>
                <input
                  type="text"
                  required
                  value={pSku}
                  onChange={(e) => setPSku(e.target.value)}
                  placeholder="Contoh: BRS-001"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm font-bold uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900">Nama Produk</label>
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Contoh: Beras Premium 5kg"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-900">Kategori</label>
                  <input
                    type="text"
                    required
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value)}
                    placeholder="Sembako"
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900">Satuan</label>
                  <input
                    type="text"
                    required
                    value={pUnit}
                    onChange={(e) => setPUnit(e.target.value)}
                    placeholder="pcs / karton / sak"
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900">Harga Satuan (Rp)</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={pPrice}
                  onChange={(e) => setPPrice(e.target.value)}
                  placeholder="75000"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm font-bold"
                />
              </div>

              {editingProduct && (
                <label className="flex items-center gap-2.5 pt-1 text-sm font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={pActive}
                    onChange={(e) => setPActive(e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span>Produk Aktif</span>
                </label>
              )}

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="flex-1 min-h-[44px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700"
                >
                  {savingProduct ? 'Menyimpan...' : 'Simpan Produk'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: KONFIRMASI HAPUS PERMANEN ==================== */}
      {showPurgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-red-500 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-950">
                  Hapus Permanen Foto &amp; Data Terfilter?
                </h3>
                <p className="mt-2 text-sm text-slate-700 leading-relaxed">
                  Tindakan ini akan menghapus <strong>permanen</strong> sebanyak{' '}
                  <strong className="text-red-700 font-mono">
                    {(monitoring?.records.length ?? 0) +
                      (monitoring?.dailyReports?.length ?? 0) +
                      (monitoring?.salesRepReports?.length ?? 0) +
                      (monitoring?.collectionReports?.length ?? 0) +
                      (monitoring?.absenceReports?.length ?? 0)}{' '}
                    data laporan
                  </strong>{' '}
                  (Absensi/Kunjungan, Laporan Harian, Sales Rep, Kolektor, &amp; Tidak Masuk Kerja beserta lampiran admin) pada rentang tanggal{' '}
                  <strong className="font-mono">
                    {formatDateID(startDate)} s.d. {formatDateID(endDate)}
                  </strong>{' '}
                  dari Storage (<code className="font-mono">visit-photos</code>) dan Database untuk menghemat ruang penyimpanan.
                </p>
                <p className="mt-2 text-xs font-bold text-red-700">
                  Data yang sudah dihapus tidak dapat dikembalikan. Pastikan Anda telah mengunduh CSV / ZIP jika diperlukan.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                className="flex-1 min-h-[46px] rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-800 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={purging}
                onClick={handleConfirmPurge}
                className="flex-1 min-h-[46px] rounded-xl bg-red-600 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {purging ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: TAMBAH / EDIT CUSTOMER ==================== */}
      {customerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-950">
                {editingCustomer ? 'Edit Customer' : 'Tambah Customer Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setCustomerModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-900">
                  Kode Customer (Opsional, otomatis jika kosong)
                </label>
                <input
                  type="text"
                  value={cCode}
                  onChange={(e) => setCCode(e.target.value)}
                  placeholder="CUST-001"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-900">
                  Nama Customer / Toko *
                </label>
                <input
                  type="text"
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  placeholder="Contoh: Toko Sembako Berkah"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-900">Nomor HP</label>
                <input
                  type="tel"
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  placeholder="0812..."
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-900">Alamat</label>
                <textarea
                  rows={2}
                  value={cAddress}
                  onChange={(e) => setCAddress(e.target.value)}
                  placeholder="Alamat toko / customer"
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm"
                />
              </div>
              {editingCustomer && (
                <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={cActive}
                    onChange={(e) => setCActive(e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span>Customer Aktif</span>
                </label>
              )}
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setCustomerModalOpen(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingCustomer}
                  className="flex-1 min-h-[44px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700"
                >
                  {savingCustomer ? 'Menyimpan...' : 'Simpan Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: TAMBAH / EDIT INVOICE ==================== */}
      {invoiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-950">
                {editingInvoice ? 'Edit Invoice Tagihan' : 'Tambah Invoice Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setInvoiceModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveInvoice} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-900">Customer *</label>
                <select
                  required
                  disabled={Boolean(editingInvoice)}
                  value={iCustomerId}
                  onChange={(e) => setICustomerId(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold disabled:bg-slate-100"
                >
                  <option value="">-- Pilih Customer --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      [{c.code}] {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900">Nomor Invoice *</label>
                <input
                  type="text"
                  required
                  value={iNumber}
                  onChange={(e) => setINumber(e.target.value)}
                  placeholder="INV-2026-001"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm font-bold uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-900">
                    Total Tagihan (Rp) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={iTotalAmount}
                    onChange={(e) => setITotalAmount(e.target.value)}
                    placeholder="2500000"
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono text-sm font-bold"
                  />
                </div>
                {editingInvoice ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-900">
                      Sudah Dibayar (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={iPaidAmount}
                      onChange={(e) => setIPaidAmount(e.target.value)}
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono text-sm font-bold"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-900">Jatuh Tempo</label>
                    <input
                      type="date"
                      value={iDueDate}
                      onChange={(e) => setIDueDate(e.target.value)}
                      className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                    />
                  </div>
                )}
              </div>

              {editingInvoice && (
                <div>
                  <label className="block text-xs font-bold text-slate-900">Jatuh Tempo</label>
                  <input
                    type="date"
                    value={iDueDate}
                    onChange={(e) => setIDueDate(e.target.value)}
                    className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-900">Catatan</label>
                <input
                  type="text"
                  value={iNotes}
                  onChange={(e) => setINotes(e.target.value)}
                  placeholder="Keterangan tagihan (opsional)"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setInvoiceModalOpen(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingInvoice}
                  className="flex-1 min-h-[44px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700"
                >
                  {savingInvoice ? 'Menyimpan...' : 'Simpan Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: UPLOAD / GANTI LOGO PERUSAHAAN ==================== */}
      {logoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-extrabold text-slate-950">
                Upload / Ganti Logo Perusahaan
              </h3>
              <button
                type="button"
                onClick={() => setLogoModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Unggah logo resmi <strong>CV. Pangan Berkah Sentosa</strong> (PNG, JPG, WEBP, atau SVG, maks. 3MB). Logo langsung tampil di header semua halaman dan halaman Login.
            </p>

            <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-[11px] font-bold text-slate-500 mb-2">
                {logoPreviewDataUrl ? 'Preview Logo Baru' : 'Logo Aktif Saat Ini'}
              </div>
              <CompanyLogo
                size="lg"
                logoUrl={logoPreviewDataUrl || logoUrl}
              />
            </div>

            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={handleLogoFileSelect}
              className="hidden"
            />

            <div className="mt-4 space-y-2.5">
              <button
                type="button"
                onClick={() => logoFileInputRef.current?.click()}
                className="flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50/50 px-4 text-sm font-bold text-orange-800 hover:bg-orange-50"
              >
                <Upload className="h-4 w-4 text-orange-600" />
                <span>Pilih File Logo dari Perangkat</span>
              </button>

              <div className="flex items-center gap-2.5 pt-1">
                {logoUrl && (
                  <button
                    type="button"
                    disabled={savingLogo}
                    onClick={handleResetCompanyLogo}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset Default</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLogoModalOpen(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={!logoPreviewDataUrl || savingLogo}
                  onClick={handleUploadCompanyLogo}
                  className="flex-1 min-h-[44px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {savingLogo ? 'Menyimpan...' : 'Simpan Logo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: KELOLA LAMPIRAN FOTO FORM ADMIN ==================== */}
      {attachmentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-950">
                  Upload / Kelola Foto Lampiran Form
                </h3>
                <p className="mt-0.5 text-xs font-semibold text-orange-700">
                  {attachmentTarget.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachmentTarget(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Existing Admin Attachments */}
            <div className="space-y-2">
              <div className="text-xs font-extrabold text-slate-800">
                Lampiran Foto Tersimpan ({activeAttachments.length})
              </div>
              {activeAttachments.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  Belum ada foto lampiran tambahan dari Admin untuk form ini.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {activeAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50/40 p-2.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onOpenPhoto({
                            url: att.photoUrl,
                            title: `Lampiran Admin · ${attachmentTarget.title}`,
                            subtitle: formatDateTimeWIB(att.createdAt),
                            notes: att.note || `Diunggah oleh ${att.uploadedByName}`,
                          })
                        }
                        className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-300"
                      >
                        <img
                          src={att.photoUrl}
                          alt="Lampiran Admin"
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="font-bold text-slate-900 truncate">
                          {att.note || 'Foto lampiran tambahan Admin'}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {formatDateTimeWIB(att.createdAt)} · {att.uploadedByName}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAttachment(att.id)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50"
                        title="Hapus lampiran"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add New Attachments */}
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="text-xs font-extrabold text-slate-800">
                Tambah Foto Lampiran Baru (PNG / JPG / WEBP, maks. 5MB)
              </div>

              <input
                ref={attFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handleAttFileSelect}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => attFileInputRef.current?.click()}
                className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50/50 px-4 text-xs sm:text-sm font-bold text-orange-800 hover:bg-orange-50"
              >
                <Upload className="h-4 w-4 text-orange-600" />
                <span>Pilih 1 atau Lebih Foto dari Perangkat</span>
              </button>

              {attStagedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attStagedFiles.map((f, idx) => (
                    <div
                      key={idx}
                      className="relative h-16 w-16 overflow-hidden rounded-xl border border-slate-300"
                    >
                      <img src={f.dataUrl} alt={f.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          setAttStagedFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-800">
                  Catatan Lampiran (Opsional)
                </label>
                <input
                  type="text"
                  value={attNote}
                  onChange={(e) => setAttNote(e.target.value)}
                  placeholder="Contoh: Foto form revisi / bukti tambahan dari kantor"
                  className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-950 focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setAttachmentTarget(null)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={attStagedFiles.length === 0 || savingAtt}
                  onClick={handleUploadAttachments}
                  className="flex-1 min-h-[44px] rounded-xl bg-orange-600 text-sm font-extrabold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {savingAtt
                    ? 'Mengunggah...'
                    : `Unggah (${attStagedFiles.length}) Foto`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
