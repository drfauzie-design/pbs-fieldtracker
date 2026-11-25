import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'visit-photos');
export const BRANDING_DIR = path.resolve(process.cwd(), 'storage', 'branding');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(BRANDING_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'pangan_berkah.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize relational schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email_alias TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Karyawan', 'Leader/SPV', 'Admin')),
    leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_lat REAL,
    last_lng REAL,
    last_accuracy REAL,
    last_gps_at TEXT,
    last_status_label TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL CHECK (record_type IN ('check_in', 'check_out', 'visit')),
    date_key TEXT NOT NULL,
    client_name TEXT NOT NULL,
    visit_status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    photo_filename TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date_user ON attendance_visits(date_key, user_id);

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_category TEXT NOT NULL,
    product_unit TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    applied_unit_price INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,
    client_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    date_key TEXT NOT NULL,
    reported_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sales_date_user ON sales_reports(date_key, user_id);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employee_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period TEXT NOT NULL CHECK (period IN ('harian', 'mingguan', 'bulanan')),
    target_amount INTEGER NOT NULL DEFAULT 0,
    target_qty INTEGER NOT NULL DEFAULT 0,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    category TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Penting', 'Mendesak')),
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, is_pinned, created_at);

  CREATE TABLE IF NOT EXISTS daily_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL CHECK (report_type IN ('spg_stay', 'spg_mobile', 'event')),
    date_key TEXT NOT NULL,
    lat REAL,
    lng REAL,
    accuracy REAL,
    client_name TEXT NOT NULL DEFAULT '',
    visit_status TEXT NOT NULL DEFAULT '',
    offer_notes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    event_name TEXT NOT NULL DEFAULT '',
    target_sales_amount INTEGER NOT NULL DEFAULT 0,
    realized_sales_amount INTEGER NOT NULL DEFAULT 0,
    target_visitors INTEGER NOT NULL DEFAULT 0,
    realized_visitors INTEGER NOT NULL DEFAULT 0,
    expenses_json TEXT NOT NULL DEFAULT '[]',
    total_expense INTEGER NOT NULL DEFAULT 0,
    obstacles TEXT NOT NULL DEFAULT '',
    suggestions TEXT NOT NULL DEFAULT '',
    total_qty INTEGER NOT NULL DEFAULT 0,
    total_sales_amount INTEGER NOT NULL DEFAULT 0,
    sales_items_json TEXT NOT NULL DEFAULT '[]',
    reported_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_daily_reports_date_user ON daily_reports(date_key, user_id);

  CREATE TABLE IF NOT EXISTS daily_report_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    photo_kind TEXT NOT NULL CHECK (photo_kind IN ('activity', 'transaction_proof')),
    photo_filename TEXT NOT NULL,
    captured_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_daily_report_photos_report ON daily_report_photos(report_id);

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    invoice_number TEXT UNIQUE NOT NULL,
    total_amount INTEGER NOT NULL,
    paid_amount INTEGER NOT NULL DEFAULT 0,
    remaining_amount INTEGER NOT NULL,
    due_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Belum Lunas' CHECK (status IN ('Belum Lunas', 'Sebagian', 'Lunas')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_customer_status ON invoices(customer_id, status);

  CREATE TABLE IF NOT EXISTS collection_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    customer_name TEXT NOT NULL,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    invoice_number TEXT NOT NULL,
    invoice_total INTEGER NOT NULL,
    visit_status TEXT NOT NULL CHECK (visit_status IN ('Bayar Lunas', 'Bayar Sebagian', 'Janji Bayar', 'Toko Tutup', 'Gagal Tagih')),
    collected_amount INTEGER NOT NULL DEFAULT 0,
    remaining_amount INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Tunai', 'Transfer', 'Giro', 'QRIS')),
    promise_date TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL,
    accuracy REAL,
    photo_filename TEXT NOT NULL DEFAULT '',
    date_key TEXT NOT NULL,
    visited_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_collection_date_user ON collection_reports(date_key, user_id);

  CREATE TABLE IF NOT EXISTS sales_rep_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_type TEXT NOT NULL CHECK (sub_type IN ('penawaran', 'po', 'noo')),
    date_key TEXT NOT NULL,
    lat REAL,
    lng REAL,
    accuracy REAL,
    client_name TEXT NOT NULL DEFAULT '',
    offer_notes TEXT NOT NULL DEFAULT '',
    offer_status TEXT NOT NULL DEFAULT '',
    follow_up_date TEXT NOT NULL DEFAULT '',
    po_items_json TEXT NOT NULL DEFAULT '[]',
    po_total_qty INTEGER NOT NULL DEFAULT 0,
    po_total_amount INTEGER NOT NULL DEFAULT 0,
    outlet_name TEXT NOT NULL DEFAULT '',
    outlet_address TEXT NOT NULL DEFAULT '',
    outlet_owner TEXT NOT NULL DEFAULT '',
    outlet_phone TEXT NOT NULL DEFAULT '',
    outlet_type TEXT NOT NULL DEFAULT '',
    outlet_potential TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    field_notes TEXT NOT NULL DEFAULT '',
    photos_json TEXT NOT NULL DEFAULT '[]',
    reported_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sales_rep_date_user ON sales_rep_reports(date_key, user_id);

  CREATE TABLE IF NOT EXISTS absence_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    absence_type TEXT NOT NULL CHECK (absence_type IN ('Libur', 'Sakit', 'Izin', 'Cuti')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    field_notes TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL,
    accuracy REAL,
    photo_filename TEXT NOT NULL DEFAULT '',
    date_key TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_absence_date_user ON absence_reports(date_key, user_id);

  CREATE TABLE IF NOT EXISTS report_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL CHECK (target_type IN ('attendance', 'daily_report', 'collection', 'sales_rep', 'absence')),
    target_id INTEGER NOT NULL,
    photo_filename TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_report_attachments_target ON report_attachments(target_type, target_id);
`);

// Safe migrations for pre-existing SQLite databases
const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
if (!userCols.some((c) => c.name === 'employee_category')) {
  db.exec("ALTER TABLE users ADD COLUMN employee_category TEXT NOT NULL DEFAULT 'Sales Representatif'");
}

const salesCols = db.prepare('PRAGMA table_info(sales_reports)').all() as Array<{ name: string }>;
if (!salesCols.some((c) => c.name === 'daily_report_id')) {
  db.exec('ALTER TABLE sales_reports ADD COLUMN daily_report_id INTEGER REFERENCES daily_reports(id) ON DELETE CASCADE');
}
if (!salesCols.some((c) => c.name === 'source_type')) {
  db.exec("ALTER TABLE sales_reports ADD COLUMN source_type TEXT NOT NULL DEFAULT 'direct'");
}

const dailyCols = db.prepare('PRAGMA table_info(daily_reports)').all() as Array<{ name: string }>;
if (!dailyCols.some((c) => c.name === 'field_notes')) {
  db.exec("ALTER TABLE daily_reports ADD COLUMN field_notes TEXT NOT NULL DEFAULT ''");
}

const colCols = db.prepare('PRAGMA table_info(collection_reports)').all() as Array<{ name: string }>;
if (!colCols.some((c) => c.name === 'field_notes')) {
  db.exec("ALTER TABLE collection_reports ADD COLUMN field_notes TEXT NOT NULL DEFAULT ''");
}

// Default settings initialization
const defaultSettings: Record<string, string> = {
  allow_price_adjustment: 'false',
  global_target_period: 'bulanan',
  global_target_amount: '50000000',
  global_target_qty: '500',
  company_logo_filename: '',
  company_logo_updated_at: '',
};

const insertSettingStmt = db.prepare(
  'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
);
for (const [k, v] of Object.entries(defaultSettings)) {
  insertSettingStmt.run(k, v);
}

// Ephemeral fallback secret per process when SESSION_SECRET env is not set
const SIGNING_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export function normalizePhone(raw: string): string {
  let digits = String(raw || '').replace(/\D+/g, '');
  if (digits.startsWith('62') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

export function phoneToDummyEmail(rawPhone: string): string {
  const normalized = normalizePhone(rawPhone);
  if (!normalized || normalized.length < 8) {
    throw new Error('Nomor HP tidak valid (minimal 8 digit angka).');
  }
  return `${normalized}@app.local`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function getJakartaDateKey(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

export function getPeriodDateRange(period: string, refDateKey?: string): { startDate: string; endDate: string } {
  const todayKey = refDateKey || getJakartaDateKey();
  const [yearStr, monthStr, dayStr] = todayKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (period === 'harian') {
    return { startDate: todayKey, endDate: todayKey };
  }

  if (period === 'mingguan') {
    const dt = new Date(Date.UTC(year, month - 1, day));
    const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(dt);
    mon.setUTCDate(dt.getUTCDate() + diffToMon);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return {
      startDate: mon.toISOString().slice(0, 10),
      endDate: sun.toISOString().slice(0, 10),
    };
  }

  // bulanan
  const start = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return { startDate: start, endDate: end };
}

export function signPhotoToken(filename: string, ttlSeconds = 60 * 60 * 24 * 30): { sig: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${filename}:${exp}`)
    .digest('hex');
  return { sig, exp };
}

export function verifyPhotoToken(filename: string, sig: string, expStr: string): boolean {
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${filename}:${exp}`)
    .digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function buildSignedPhotoUrl(filename: string): string {
  if (!filename) return '';
  const { sig, exp } = signPhotoToken(filename);
  return `/api/storage/visit-photos/${encodeURIComponent(filename)}?sig=${sig}&exp=${exp}`;
}
