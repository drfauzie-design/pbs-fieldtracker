export type UserRole = 'Karyawan' | 'Leader/SPV' | 'Admin';

export type EmployeeCategory =
  | 'Leader/SPV'
  | 'Sales Representatif'
  | 'SPG/SPB'
  | 'SMD'
  | 'Event'
  | 'Kolektor';

export const EMPLOYEE_CATEGORIES: EmployeeCategory[] = [
  'Leader/SPV',
  'Sales Representatif',
  'SPG/SPB',
  'SMD',
  'Event',
  'Kolektor',
];

export type DailyReportType = 'spg_stay' | 'spg_mobile' | 'event';

export type SalesRepSubType = 'penawaran' | 'po' | 'noo';

export type AbsenceType = 'Libur' | 'Sakit' | 'Izin' | 'Cuti';

export type AttachmentTargetType =
  | 'attendance'
  | 'daily_report'
  | 'collection'
  | 'sales_rep'
  | 'absence';

export interface AdminAttachment {
  id: number;
  targetType: AttachmentTargetType;
  targetId: number;
  photoFilename: string;
  photoUrl: string;
  note: string;
  uploadedByName: string;
  createdAt: string;
}

export type CollectionVisitStatus =
  | 'Bayar Lunas'
  | 'Bayar Sebagian'
  | 'Janji Bayar'
  | 'Toko Tutup'
  | 'Gagal Tagih';

export type PaymentMethod = 'Tunai' | 'Transfer' | 'Giro' | 'QRIS';

export type CollectionReason =
  | ''
  | 'Pemilik Tidak Ada'
  | 'Dana Belum Siap'
  | 'Barang Bermasalah'
  | 'Toko Tutup';

export interface User {
  id: number;
  fullName: string;
  phone: string;
  emailAlias: string;
  role: UserRole;
  employeeCategory: EmployeeCategory;
  leaderId: number | null;
  leaderName?: string | null;
  isActive: boolean;
  createdAt?: string;
}

export interface VisitRecord {
  id: number;
  userId?: number;
  recordType: 'check_in' | 'check_out' | 'visit';
  dateKey: string;
  clientName: string;
  visitStatus: string;
  notes: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  photoFilename: string;
  photoUrl: string;
  adminAttachments?: AdminAttachment[];
  capturedAt: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  isActive: boolean;
  createdAt?: string;
}

export interface SalesReport {
  id: number;
  productId: number;
  productSku: string;
  productName: string;
  productCategory: string;
  productUnit: string;
  quantity: number;
  unitPrice: number;
  appliedUnitPrice: number;
  totalAmount: number;
  clientName: string;
  notes: string;
  reportedAt: string;
  dailyReportId?: number | null;
  sourceType?: string;
}

export interface DailyReportPhoto {
  id: number;
  photoKind: 'activity' | 'transaction_proof';
  photoFilename: string;
  photoUrl: string;
  capturedAt: string;
}

export interface DailyReportSalesItem {
  productId: number;
  productSku: string;
  productName: string;
  productUnit: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

export interface EventExpenseItem {
  name: string;
  amount: number;
}

export interface DailyReport {
  id: number;
  userId: number;
  userName?: string;
  userPhone?: string;
  userRole?: UserRole;
  employeeCategory?: EmployeeCategory;
  leaderName?: string | null;
  reportType: DailyReportType;
  dateKey: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  clientName: string;
  visitStatus: string;
  offerNotes: string;
  notes: string;
  fieldNotes: string;
  eventName: string;
  targetSalesAmount: number;
  realizedSalesAmount: number;
  targetVisitors: number;
  realizedVisitors: number;
  expenses: EventExpenseItem[];
  totalExpense: number;
  obstacles: string;
  suggestions: string;
  totalQty: number;
  totalSalesAmount: number;
  salesItems: DailyReportSalesItem[];
  photos: DailyReportPhoto[];
  adminAttachments?: AdminAttachment[];
  reportedAt: string;
}

export interface SalesRepPhoto {
  photoFilename: string;
  photoUrl: string;
  capturedAt: string;
}

export interface SalesRepReport {
  id: number;
  userId: number;
  userName?: string;
  userPhone?: string;
  userRole?: UserRole;
  employeeCategory?: EmployeeCategory;
  leaderName?: string | null;
  subType: SalesRepSubType;
  dateKey: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  clientName: string;
  offerNotes: string;
  offerStatus: string;
  followUpDate: string;
  poItems: DailyReportSalesItem[];
  poTotalQty: number;
  poTotalAmount: number;
  outletName: string;
  outletAddress: string;
  outletOwner: string;
  outletPhone: string;
  outletType: string;
  outletPotential: string;
  notes: string;
  fieldNotes: string;
  photos: SalesRepPhoto[];
  adminAttachments?: AdminAttachment[];
  reportedAt: string;
}

export interface AbsenceReport {
  id: number;
  userId: number;
  userName?: string;
  userPhone?: string;
  userRole?: UserRole;
  employeeCategory?: EmployeeCategory;
  leaderName?: string | null;
  absenceType: AbsenceType;
  startDate: string;
  endDate: string;
  reason: string;
  fieldNotes: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  photoFilename: string;
  photoUrl: string;
  adminAttachments?: AdminAttachment[];
  dateKey: string;
  submittedAt: string;
}

export interface Customer {
  id: number;
  code: string;
  name: string;
  phone: string;
  address: string;
  isActive: boolean;
  unpaidCount?: number;
  totalRemaining?: number;
  createdAt?: string;
}

export interface Invoice {
  id: number;
  customerId: number;
  customerName?: string;
  customerCode?: string;
  invoiceNumber: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string;
  status: 'Belum Lunas' | 'Sebagian' | 'Lunas';
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollectionReport {
  id: number;
  userId: number;
  userName?: string;
  userPhone?: string;
  userRole?: UserRole;
  employeeCategory?: EmployeeCategory;
  leaderName?: string | null;
  customerId: number;
  customerName: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceTotal: number;
  visitStatus: CollectionVisitStatus;
  collectedAmount: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  promiseDate: string;
  reason: string;
  notes: string;
  fieldNotes: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  photoFilename: string;
  photoUrl: string;
  adminAttachments?: AdminAttachment[];
  dateKey: string;
  visitedAt: string;
}

export interface SpecificTargetProgress {
  id: number;
  period: 'harian' | 'mingguan' | 'bulanan';
  startDate: string;
  endDate: string;
  targetAmount: number;
  targetQty: number;
  productId: number | null;
  productName: string | null;
  productSku: string | null;
  productUnit: string | null;
  category: string | null;
  actualAmount: number;
  actualQty: number;
  pctAmount: number | null;
  pctQty: number | null;
}

export interface TargetsProgress {
  allowPriceAdjustment: boolean;
  globalTarget: {
    period: 'harian' | 'mingguan' | 'bulanan';
    startDate: string;
    endDate: string;
    targetAmount: number;
    targetQty: number;
    teamActualAmount: number;
    teamActualQty: number;
    myActualAmount: number;
    myActualQty: number;
    pct: number;
  };
  specificTargets: SpecificTargetProgress[];
}

export interface MyTodayResponse {
  dateKey: string;
  visits: VisitRecord[];
  sales: SalesReport[];
  dailyReports: DailyReport[];
  salesRepReports: SalesRepReport[];
  collectionReports: CollectionReport[];
  absenceReports: AbsenceReport[];
  salesSummary: {
    totalQty: number;
    totalAmount: number;
  };
  collectionSummary: {
    count: number;
    totalCollected: number;
    totalRemaining: number;
  };
  targets: TargetsProgress;
}

export interface LeaderTeamMember {
  id: number;
  fullName: string;
  phone: string;
  role: UserRole;
  employeeCategory: EmployeeCategory;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy: number | null;
  lastGpsAt: string | null;
  lastStatusLabel: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  visits: Array<{
    id: number;
    recordType: 'check_in' | 'check_out' | 'visit';
    clientName: string;
    visitStatus: string;
    notes: string;
    lat: number;
    lng: number;
    photoUrl: string;
    adminAttachments?: AdminAttachment[];
    capturedAt: string;
  }>;
  sales: Array<{
    id: number;
    productName: string;
    productUnit: string;
    quantity: number;
    totalAmount: number;
    clientName: string;
    reportedAt: string;
  }>;
  dailyReports: DailyReport[];
  salesRepReports: SalesRepReport[];
  collectionReports: CollectionReport[];
  absenceReports: AbsenceReport[];
  salesSummary: {
    totalQty: number;
    totalAmount: number;
  };
  collectionSummary: {
    count: number;
    totalCollected: number;
    totalRemaining: number;
  };
  specificTargets: SpecificTargetProgress[];
}

export interface LivePin {
  userId: number;
  fullName: string;
  role: UserRole;
  employeeCategory?: EmployeeCategory;
  phone: string;
  leaderName: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  lastGpsAt: string | null;
  lastStatusLabel: string;
  lastPhotoUrl: string | null;
  lastPhotoCapturedAt: string | null;
  checkedInToday: boolean;
}

export interface MonitoringRecord {
  id: number;
  userId: number;
  userName: string;
  userPhone: string;
  userRole: UserRole;
  employeeCategory?: EmployeeCategory;
  leaderName: string | null;
  recordType: 'check_in' | 'check_out' | 'visit';
  dateKey: string;
  clientName: string;
  visitStatus: string;
  notes: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  photoFilename: string;
  photoUrl: string;
  adminAttachments?: AdminAttachment[];
  capturedAt: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInPhotoUrl: string | null;
  checkOutPhotoUrl: string | null;
  salesQty: number;
  salesAmount: number;
  salesDetailText: string;
}

export interface AdminMonitoringResponse {
  summary: {
    checkedInToday: number;
    totalFieldUsers: number;
    completedVisits: number;
    totalSalesQty: number;
    totalSalesAmount: number;
    totalDailyReports: number;
    totalSalesRepReports: number;
    totalPoAmount: number;
    totalAbsenceReports: number;
    totalCollectionCount: number;
    totalCollectedAmount: number;
    totalCollectionRemaining: number;
    globalTarget: TargetsProgress['globalTarget'];
  };
  livePins: LivePin[];
  records: MonitoringRecord[];
  dailyReports: DailyReport[];
  salesRepReports: SalesRepReport[];
  collectionReports: CollectionReport[];
  absenceReports: AbsenceReport[];
  salesRows: Array<{
    id: number;
    userId: number;
    userName: string;
    dateKey: string;
    productSku: string;
    productName: string;
    productUnit: string;
    quantity: number;
    appliedUnitPrice: number;
    totalAmount: number;
    clientName: string;
    reportedAt: string;
  }>;
}

export interface LightboxPhoto {
  url: string;
  title: string;
  subtitle?: string;
  notes?: string;
  lat?: number;
  lng?: number;
}

export type AnnouncementPriority = 'Normal' | 'Penting' | 'Mendesak';

export interface Announcement {
  id: number;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  isPinned: boolean;
  isActive: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}
