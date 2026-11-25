import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  BRANDING_DIR,
  buildSignedPhotoUrl,
  db,
  getJakartaDateKey,
  getPeriodDateRange,
  hashPassword,
  normalizePhone,
  phoneToDummyEmail,
  STORAGE_DIR,
  verifyPassword,
  verifyPhotoToken,
} from './server/db.ts';

dotenv.config();

const VALID_EMPLOYEE_CATEGORIES = [
  'Leader/SPV',
  'Sales Representatif',
  'SPG/SPB',
  'SMD',
  'Event',
  'Kolektor',
] as const;

type EmployeeCategory = (typeof VALID_EMPLOYEE_CATEGORIES)[number];

function sanitizeCategory(raw: any, role?: string): EmployeeCategory {
  if (VALID_EMPLOYEE_CATEGORIES.includes(raw)) return raw;
  if (raw === 'SPG Stay') return 'SPG/SPB';
  if (raw === 'SPG/SMD Mobile') return 'SMD';
  if (role === 'Leader/SPV') return 'Leader/SPV';
  return 'Sales Representatif';
}

interface AuthUser {
  id: number;
  fullName: string;
  phone: string;
  emailAlias: string;
  role: 'Karyawan' | 'Leader/SPV' | 'Admin';
  employeeCategory: EmployeeCategory;
  leaderId: number | null;
  isActive: boolean;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
  authToken?: string;
}

function mapUserRow(row: any): AuthUser {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    emailAlias: row.email_alias,
    role: row.role,
    employeeCategory: sanitizeCategory(row.employee_category, row.role),
    leaderId: row.leader_id ?? null,
    isActive: Boolean(row.is_active),
  };
}

function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, expiresAt, now.toISOString());
  return token;
}

function getAuthFromHeader(req: Request): { user: AuthUser; token: string } | null {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (!row.is_active) return null;

  return { user: mapUserRow(row), token };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const auth = getAuthFromHeader(req);
  if (!auth) {
    res.status(401).json({ error: 'Sesi berakhir atau tidak terautentikasi.' });
    return;
  }
  req.user = auth.user;
  req.authToken = auth.token;
  next();
}

function requireRole(roles: Array<'Karyawan' | 'Leader/SPV' | 'Admin'>) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Anda tidak memiliki akses ke fitur ini.' });
      return;
    }
    next();
  };
}

function getAppSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function computeUserTargetsProgress(userId: number) {
  const settings = getAppSettings();
  const globalPeriod = settings.global_target_period || 'bulanan';
  const globalTargetAmount = Number(settings.global_target_amount || 0);
  const globalTargetQty = Number(settings.global_target_qty || 0);
  const globalRange = getPeriodDateRange(globalPeriod);

  const globalSalesActual = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS amount, COALESCE(SUM(quantity), 0) AS qty
       FROM sales_reports
       WHERE date_key >= ? AND date_key <= ?`
    )
    .get(globalRange.startDate, globalRange.endDate) as { amount: number; qty: number };

  const globalEventActual = db
    .prepare(
      `SELECT COALESCE(SUM(realized_sales_amount), 0) AS amount
       FROM daily_reports
       WHERE report_type = 'event' AND date_key >= ? AND date_key <= ?`
    )
    .get(globalRange.startDate, globalRange.endDate) as { amount: number };

  const globalActual = {
    amount: globalSalesActual.amount + globalEventActual.amount,
    qty: globalSalesActual.qty,
  };

  const userSalesActual = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS amount, COALESCE(SUM(quantity), 0) AS qty
       FROM sales_reports
       WHERE user_id = ? AND date_key >= ? AND date_key <= ?`
    )
    .get(userId, globalRange.startDate, globalRange.endDate) as { amount: number; qty: number };

  const userEventActual = db
    .prepare(
      `SELECT COALESCE(SUM(realized_sales_amount), 0) AS amount
       FROM daily_reports
       WHERE user_id = ? AND report_type = 'event' AND date_key >= ? AND date_key <= ?`
    )
    .get(userId, globalRange.startDate, globalRange.endDate) as { amount: number };

  const userGlobalActual = {
    amount: userSalesActual.amount + userEventActual.amount,
    qty: userSalesActual.qty,
  };

  const specificRows = db
    .prepare(
      `SELECT et.*, p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit
       FROM employee_targets et
       LEFT JOIN products p ON p.id = et.product_id
       WHERE et.user_id = ?
       ORDER BY et.updated_at DESC`
    )
    .all(userId) as any[];

  const specificTargets = specificRows.map((row) => {
    const range = getPeriodDateRange(row.period);
    let sql = `SELECT COALESCE(SUM(total_amount), 0) AS amount, COALESCE(SUM(quantity), 0) AS qty
               FROM sales_reports
               WHERE user_id = ? AND date_key >= ? AND date_key <= ?`;
    const params: any[] = [userId, range.startDate, range.endDate];

    if (row.product_id) {
      sql += ' AND product_id = ?';
      params.push(row.product_id);
    } else if (row.category) {
      sql += ' AND product_category = ?';
      params.push(row.category);
    }

    const salesPart = db.prepare(sql).get(...params) as { amount: number; qty: number };
    let extraEventAmount = 0;
    if (!row.product_id && !row.category) {
      const evPart = db
        .prepare(
          `SELECT COALESCE(SUM(realized_sales_amount), 0) AS amount
           FROM daily_reports
           WHERE user_id = ? AND report_type = 'event' AND date_key >= ? AND date_key <= ?`
        )
        .get(userId, range.startDate, range.endDate) as { amount: number };
      extraEventAmount = evPart.amount;
    }
    const actual = {
      amount: salesPart.amount + extraEventAmount,
      qty: salesPart.qty,
    };
    const pctAmount =
      row.target_amount > 0 ? Math.min(999, Math.round((actual.amount / row.target_amount) * 100)) : null;
    const pctQty =
      row.target_qty > 0 ? Math.min(999, Math.round((actual.qty / row.target_qty) * 100)) : null;

    return {
      id: row.id,
      period: row.period,
      startDate: range.startDate,
      endDate: range.endDate,
      targetAmount: row.target_amount,
      targetQty: row.target_qty,
      productId: row.product_id,
      productName: row.product_name || null,
      productSku: row.product_sku || null,
      productUnit: row.product_unit || null,
      category: row.category || null,
      actualAmount: actual.amount,
      actualQty: actual.qty,
      pctAmount,
      pctQty,
    };
  });

  const globalPct =
    globalTargetAmount > 0
      ? Math.min(999, Math.round((globalActual.amount / globalTargetAmount) * 100))
      : globalTargetQty > 0
      ? Math.min(999, Math.round((globalActual.qty / globalTargetQty) * 100))
      : 0;

  return {
    allowPriceAdjustment: settings.allow_price_adjustment === 'true',
    globalTarget: {
      period: globalPeriod,
      startDate: globalRange.startDate,
      endDate: globalRange.endDate,
      targetAmount: globalTargetAmount,
      targetQty: globalTargetQty,
      teamActualAmount: globalActual.amount,
      teamActualQty: globalActual.qty,
      myActualAmount: userGlobalActual.amount,
      myActualQty: userGlobalActual.qty,
      pct: globalPct,
    },
    specificTargets,
  };
}

function savePhotoFromDataUrl(
  dataUrl: string,
  userId: number,
  recordType: string,
  errorMsg = 'Format foto bukti tidak valid. Wajib menggunakan foto langsung dari kamera.'
): string {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(
    String(dataUrl || '').trim()
  );
  if (!match) {
    throw new Error(errorMsg);
  }
  const subtype = match[1].toLowerCase();
  const ext = subtype === 'png' ? 'png' : subtype === 'webp' ? 'webp' : 'jpg';
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length === 0 || buf.length > 5 * 1024 * 1024) {
    throw new Error('Ukuran foto melebihi batas maksimal 5MB.');
  }

  const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.randomBytes(4).toString('hex');
  const filename = `${recordType}_u${userId}_${safeStamp}_${rand}.${ext}`;
  const targetPath = path.resolve(STORAGE_DIR, filename);
  if (!targetPath.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error('Nama file foto tidak aman.');
  }

  fs.writeFileSync(targetPath, buf);
  return filename;
}

function deletePhotoFileSafe(filename: string): boolean {
  if (!filename || !/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) return false;
  const targetPath = path.resolve(STORAGE_DIR, filename);
  if (!targetPath.startsWith(STORAGE_DIR + path.sep)) return false;
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
    return true;
  }
  return false;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getAttachmentsForTarget(
  targetType: 'attendance' | 'daily_report' | 'collection' | 'sales_rep' | 'absence',
  targetId: number
) {
  const rows = db
    .prepare(
      `SELECT * FROM report_attachments
       WHERE target_type = ? AND target_id = ?
       ORDER BY id ASC`
    )
    .all(targetType, targetId) as any[];
  return rows.map((a) => ({
    id: a.id,
    targetType: a.target_type,
    targetId: a.target_id,
    photoFilename: a.photo_filename,
    photoUrl: buildSignedPhotoUrl(a.photo_filename),
    note: a.note || '',
    uploadedByName: a.uploaded_by_name || 'Admin',
    createdAt: a.created_at,
  }));
}

function mapDailyReportRow(row: any) {
  const photos = db
    .prepare('SELECT * FROM daily_report_photos WHERE report_id = ? ORDER BY id ASC')
    .all(row.id) as any[];

  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || undefined,
    userPhone: row.user_phone || undefined,
    userRole: row.user_role || undefined,
    employeeCategory: row.employee_category
      ? sanitizeCategory(row.employee_category, row.user_role)
      : undefined,
    leaderName: row.leader_name || null,
    reportType: row.report_type,
    dateKey: row.date_key,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    accuracy: row.accuracy ?? null,
    clientName: row.client_name,
    visitStatus: row.visit_status,
    offerNotes: row.offer_notes,
    notes: row.notes,
    fieldNotes: row.field_notes || '',
    eventName: row.event_name,
    targetSalesAmount: row.target_sales_amount,
    realizedSalesAmount: row.realized_sales_amount,
    targetVisitors: row.target_visitors,
    realizedVisitors: row.realized_visitors,
    expenses: safeJsonParse(row.expenses_json, []),
    totalExpense: row.total_expense,
    obstacles: row.obstacles,
    suggestions: row.suggestions,
    totalQty: row.total_qty,
    totalSalesAmount: row.total_sales_amount,
    salesItems: safeJsonParse(row.sales_items_json, []),
    photos: photos.map((p) => ({
      id: p.id,
      photoKind: p.photo_kind,
      photoFilename: p.photo_filename,
      photoUrl: buildSignedPhotoUrl(p.photo_filename),
      capturedAt: p.captured_at,
    })),
    adminAttachments: getAttachmentsForTarget('daily_report', row.id),
    reportedAt: row.reported_at,
  };
}

function mapCollectionReportRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || undefined,
    userPhone: row.user_phone || undefined,
    userRole: row.user_role || undefined,
    employeeCategory: row.employee_category
      ? sanitizeCategory(row.employee_category, row.user_role)
      : undefined,
    leaderName: row.leader_name || null,
    customerId: row.customer_id,
    customerName: row.customer_name,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    invoiceTotal: row.invoice_total,
    visitStatus: row.visit_status,
    collectedAmount: row.collected_amount,
    remainingAmount: row.remaining_amount,
    paymentMethod: row.payment_method,
    promiseDate: row.promise_date,
    reason: row.reason,
    notes: row.notes,
    fieldNotes: row.field_notes || '',
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    accuracy: row.accuracy ?? null,
    photoFilename: row.photo_filename || '',
    photoUrl: row.photo_filename ? buildSignedPhotoUrl(row.photo_filename) : '',
    adminAttachments: getAttachmentsForTarget('collection', row.id),
    dateKey: row.date_key,
    visitedAt: row.visited_at,
  };
}

function mapSalesRepRow(row: any) {
  const rawPhotos = safeJsonParse<Array<{ photoFilename: string; capturedAt: string }>>(
    row.photos_json,
    []
  );
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || undefined,
    userPhone: row.user_phone || undefined,
    userRole: row.user_role || undefined,
    employeeCategory: row.employee_category
      ? sanitizeCategory(row.employee_category, row.user_role)
      : undefined,
    leaderName: row.leader_name || null,
    subType: row.sub_type,
    dateKey: row.date_key,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    accuracy: row.accuracy ?? null,
    clientName: row.client_name,
    offerNotes: row.offer_notes,
    offerStatus: row.offer_status,
    followUpDate: row.follow_up_date,
    poItems: safeJsonParse(row.po_items_json, []),
    poTotalQty: row.po_total_qty,
    poTotalAmount: row.po_total_amount,
    outletName: row.outlet_name,
    outletAddress: row.outlet_address,
    outletOwner: row.outlet_owner,
    outletPhone: row.outlet_phone,
    outletType: row.outlet_type,
    outletPotential: row.outlet_potential,
    notes: row.notes,
    fieldNotes: row.field_notes || '',
    photos: rawPhotos.map((p) => ({
      photoFilename: p.photoFilename,
      photoUrl: buildSignedPhotoUrl(p.photoFilename),
      capturedAt: p.capturedAt,
    })),
    adminAttachments: getAttachmentsForTarget('sales_rep', row.id),
    reportedAt: row.reported_at,
  };
}

function mapAbsenceRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || undefined,
    userPhone: row.user_phone || undefined,
    userRole: row.user_role || undefined,
    employeeCategory: row.employee_category
      ? sanitizeCategory(row.employee_category, row.user_role)
      : undefined,
    leaderName: row.leader_name || null,
    absenceType: row.absence_type,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    fieldNotes: row.field_notes || '',
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    accuracy: row.accuracy ?? null,
    photoFilename: row.photo_filename || '',
    photoUrl: row.photo_filename ? buildSignedPhotoUrl(row.photo_filename) : '',
    adminAttachments: getAttachmentsForTarget('absence', row.id),
    dateKey: row.date_key,
    submittedAt: row.submitted_at,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // ==================== AUTH ROUTES ====================
  app.get('/api/auth/bootstrap-status', (_req: Request, res: Response) => {
    const row = db
      .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'Admin'")
      .get() as { cnt: number };
    res.json({ needsAdminSetup: row.cnt === 0 });
  });

  app.post('/api/auth/bootstrap-admin', (req: Request, res: Response) => {
    const { fullName, phone, password } = req.body || {};
    const existingAdmin = db
      .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'Admin'")
      .get() as { cnt: number };
    if (existingAdmin.cnt > 0) {
      res.status(403).json({ error: 'Akun Admin sudah aktif. Silakan login menggunakan Nomor HP.' });
      return;
    }

    if (!fullName || String(fullName).trim().length < 2) {
      res.status(400).json({ error: 'Nama lengkap wajib diisi minimal 2 karakter.' });
      return;
    }
    if (!password || String(password).length < 6) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    let normalized: string;
    let emailAlias: string;
    try {
      normalized = normalizePhone(phone);
      emailAlias = phoneToDummyEmail(phone);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    const now = new Date().toISOString();
    const passwordHash = hashPassword(String(password));

    try {
      const result = db
        .prepare(
          `INSERT INTO users (full_name, phone, email_alias, password_hash, role, leader_id, is_active, created_at)
           VALUES (?, ?, ?, ?, 'Admin', NULL, 1, ?)`
        )
        .run(String(fullName).trim(), normalized, emailAlias, passwordHash, now);

      const userRow = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(result.lastInsertRowid) as any;
      const token = createSession(userRow.id);
      res.status(201).json({ token, user: mapUserRow(userRow) });
    } catch (err: any) {
      res.status(400).json({ error: 'Gagal membuat akun Admin: ' + err.message });
    }
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { phone, password } = req.body || {};
    if (!phone || !password) {
      res.status(400).json({ error: 'Nomor HP dan kata sandi wajib diisi.' });
      return;
    }

    let emailAlias: string;
    let normalized: string;
    try {
      normalized = normalizePhone(phone);
      emailAlias = phoneToDummyEmail(phone);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE email_alias = ? OR phone = ?')
      .get(emailAlias, normalized) as any;

    if (!userRow || !verifyPassword(String(password), userRow.password_hash)) {
      res.status(401).json({ error: 'Nomor HP atau kata sandi salah.' });
      return;
    }
    if (!userRow.is_active) {
      res.status(403).json({ error: 'Akun Anda dinonaktifkan. Hubungi Admin CV. Pangan Berkah Sentosa.' });
      return;
    }

    const token = createSession(userRow.id);
    res.json({ token, user: mapUserRow(userRow) });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
    if (req.authToken) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.authToken);
    }
    res.json({ ok: true });
  });

  // ==================== STORAGE PHOTO SERVING ====================
  app.get('/api/storage/visit-photos/:filename', (req: Request, res: Response) => {
    const filename = String(req.params.filename || '');
    if (!/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
      res.status(400).send('Invalid filename');
      return;
    }

    const sig = String(req.query.sig || '');
    const exp = String(req.query.exp || '');
    const hasValidSig = sig && exp && verifyPhotoToken(filename, sig, exp);
    const hasBearer = Boolean(getAuthFromHeader(req));

    if (!hasValidSig && !hasBearer) {
      res.status(401).send('Unauthorized');
      return;
    }

    const resolved = path.resolve(STORAGE_DIR, filename);
    if (!resolved.startsWith(STORAGE_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).send('Not found');
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(resolved);
  });

  // ==================== FIELD GPS & ATTENDANCE / VISITS ====================
  app.post('/api/gps/ping', requireAuth, (req: AuthedRequest, res: Response) => {
    const { lat, lng, accuracy, statusLabel } = req.body || {};
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const accNum = accuracy !== undefined && accuracy !== null ? Number(accuracy) : null;

    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      res.status(400).json({ error: 'Koordinat GPS tidak valid.' });
      return;
    }

    const now = new Date().toISOString();
    const label = statusLabel ? String(statusLabel).slice(0, 80) : null;

    if (label) {
      db.prepare(
        `UPDATE users
         SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_gps_at = ?, last_status_label = ?
         WHERE id = ?`
      ).run(latNum, lngNum, accNum, now, label, req.user!.id);
    } else {
      db.prepare(
        `UPDATE users
         SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_gps_at = ?
         WHERE id = ?`
      ).run(latNum, lngNum, accNum, now, req.user!.id);
    }

    res.json({ ok: true, syncedAt: now });
  });

  app.post('/api/attendance/record', requireAuth, (req: AuthedRequest, res: Response) => {
    const {
      recordType,
      clientName,
      visitStatus,
      notes,
      lat,
      lng,
      accuracy,
      photoBase64,
      capturedAt,
    } = req.body || {};

    if (!['check_in', 'check_out', 'visit'].includes(recordType)) {
      res.status(400).json({ error: 'Tipe aktivitas tidak valid.' });
      return;
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      res.status(400).json({ error: 'Koordinat GPS wajib aktif dan valid.' });
      return;
    }

    const resolvedStatus =
      recordType === 'check_in'
        ? 'Check-In'
        : recordType === 'check_out'
        ? 'Check-Out'
        : ['Selesai', 'Tertunda', 'Butuh Tindak Lanjut'].includes(visitStatus)
        ? visitStatus
        : 'Selesai';

    const resolvedClient =
      String(clientName || '').trim() ||
      (recordType === 'check_in'
        ? 'Absen Masuk Lapangan'
        : recordType === 'check_out'
        ? 'Absen Pulang Lapangan'
        : 'Kunjungan Klien');

    let filename: string;
    try {
      filename = savePhotoFromDataUrl(photoBase64, req.user!.id, recordType);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    const capturedIso =
      capturedAt && !Number.isNaN(new Date(capturedAt).getTime())
        ? new Date(capturedAt).toISOString()
        : new Date().toISOString();
    const dateKey = getJakartaDateKey(capturedIso);
    const nowIso = new Date().toISOString();
    const accNum = accuracy !== undefined && accuracy !== null ? Number(accuracy) : null;

    const info = db
      .prepare(
        `INSERT INTO attendance_visits
         (user_id, record_type, date_key, client_name, visit_status, notes, lat, lng, accuracy, photo_filename, captured_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user!.id,
        recordType,
        dateKey,
        resolvedClient.slice(0, 160),
        resolvedStatus,
        String(notes || '').trim().slice(0, 500),
        latNum,
        lngNum,
        accNum,
        filename,
        capturedIso,
        nowIso
      );

    const statusLabel =
      recordType === 'visit' ? `Kunjungan: ${resolvedClient} (${resolvedStatus})` : resolvedStatus;

    db.prepare(
      `UPDATE users
       SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_gps_at = ?, last_status_label = ?
       WHERE id = ?`
    ).run(latNum, lngNum, accNum, nowIso, statusLabel.slice(0, 100), req.user!.id);

    const row = db
      .prepare('SELECT * FROM attendance_visits WHERE id = ?')
      .get(info.lastInsertRowid) as any;

    res.status(201).json({
      record: {
        id: row.id,
        userId: row.user_id,
        recordType: row.record_type,
        dateKey: row.date_key,
        clientName: row.client_name,
        visitStatus: row.visit_status,
        notes: row.notes,
        lat: row.lat,
        lng: row.lng,
        accuracy: row.accuracy,
        photoFilename: row.photo_filename,
        photoUrl: buildSignedPhotoUrl(row.photo_filename),
        capturedAt: row.captured_at,
      },
    });
  });

  app.get('/api/attendance/my-today', requireAuth, (req: AuthedRequest, res: Response) => {
    const todayKey = getJakartaDateKey();
    const visits = db
      .prepare(
        `SELECT * FROM attendance_visits
         WHERE user_id = ? AND date_key = ?
         ORDER BY captured_at DESC`
      )
      .all(req.user!.id, todayKey) as any[];

    const sales = db
      .prepare(
        `SELECT * FROM sales_reports
         WHERE user_id = ? AND date_key = ?
         ORDER BY reported_at DESC`
      )
      .all(req.user!.id, todayKey) as any[];

    const salesTotals = db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS totalQty, COALESCE(SUM(total_amount), 0) AS totalAmount
         FROM sales_reports
         WHERE user_id = ? AND date_key = ?`
      )
      .get(req.user!.id, todayKey) as { totalQty: number; totalAmount: number };

    const eventTotals = db
      .prepare(
        `SELECT COALESCE(SUM(realized_sales_amount), 0) AS totalAmount
         FROM daily_reports
         WHERE user_id = ? AND date_key = ? AND report_type = 'event'`
      )
      .get(req.user!.id, todayKey) as { totalAmount: number };

    const dailyReportRows = db
      .prepare(
        `SELECT * FROM daily_reports
         WHERE user_id = ? AND date_key = ?
         ORDER BY reported_at DESC`
      )
      .all(req.user!.id, todayKey) as any[];

    const salesRepRows = db
      .prepare(
        `SELECT * FROM sales_rep_reports
         WHERE user_id = ? AND date_key = ?
         ORDER BY reported_at DESC`
      )
      .all(req.user!.id, todayKey) as any[];

    const collectionRows = db
      .prepare(
        `SELECT * FROM collection_reports
         WHERE user_id = ? AND date_key = ?
         ORDER BY visited_at DESC`
      )
      .all(req.user!.id, todayKey) as any[];

    const absenceRows = db
      .prepare(
        `SELECT * FROM absence_reports
         WHERE user_id = ? AND (date_key = ? OR (start_date <= ? AND end_date >= ?))
         ORDER BY submitted_at DESC`
      )
      .all(req.user!.id, todayKey, todayKey, todayKey) as any[];

    const collectionTotals = db
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(collected_amount), 0) AS totalCollected,
                COALESCE(SUM(remaining_amount), 0) AS totalRemaining
         FROM collection_reports
         WHERE user_id = ? AND date_key = ?`
      )
      .get(req.user!.id, todayKey) as { count: number; totalCollected: number; totalRemaining: number };

    const targets = computeUserTargetsProgress(req.user!.id);

    res.json({
      dateKey: todayKey,
      visits: visits.map((v) => ({
        id: v.id,
        recordType: v.record_type,
        dateKey: v.date_key,
        clientName: v.client_name,
        visitStatus: v.visit_status,
        notes: v.notes,
        lat: v.lat,
        lng: v.lng,
        accuracy: v.accuracy,
        photoFilename: v.photo_filename,
        photoUrl: buildSignedPhotoUrl(v.photo_filename),
        adminAttachments: getAttachmentsForTarget('attendance', v.id),
        capturedAt: v.captured_at,
      })),
      sales: sales.map((s) => ({
        id: s.id,
        productId: s.product_id,
        productSku: s.product_sku,
        productName: s.product_name,
        productCategory: s.product_category,
        productUnit: s.product_unit,
        quantity: s.quantity,
        unitPrice: s.unit_price,
        appliedUnitPrice: s.applied_unit_price,
        totalAmount: s.total_amount,
        clientName: s.client_name,
        notes: s.notes,
        reportedAt: s.reported_at,
        dailyReportId: s.daily_report_id ?? null,
        sourceType: s.source_type || 'direct',
      })),
      dailyReports: dailyReportRows.map(mapDailyReportRow),
      salesRepReports: salesRepRows.map(mapSalesRepRow),
      collectionReports: collectionRows.map(mapCollectionReportRow),
      absenceReports: absenceRows.map(mapAbsenceRow),
      salesSummary: {
        totalQty: salesTotals.totalQty,
        totalAmount: salesTotals.totalAmount + eventTotals.totalAmount,
      },
      collectionSummary: collectionTotals,
      targets,
    });
  });

  // ==================== PRODUCTS ====================
  app.get('/api/products', requireAuth, (req: AuthedRequest, res: Response) => {
    const includeInactive = req.query.includeInactive === '1' && req.user!.role === 'Admin';
    const rows = db
      .prepare(
        includeInactive
          ? 'SELECT * FROM products ORDER BY name ASC'
          : 'SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC'
      )
      .all() as any[];

    res.json({
      products: rows.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit: p.unit,
        unitPrice: p.unit_price,
        isActive: Boolean(p.is_active),
        createdAt: p.created_at,
      })),
    });
  });

  app.post('/api/products', requireAuth, requireRole(['Admin']), (req: AuthedRequest, res: Response) => {
    const { sku, name, category, unit, unitPrice } = req.body || {};
    const cleanSku = String(sku || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    const cleanCategory = String(category || 'Umum').trim();
    const cleanUnit = String(unit || 'pcs').trim();
    const price = Math.round(Number(unitPrice));

    if (!cleanSku || !cleanName || !Number.isFinite(price) || price < 0) {
      res.status(400).json({ error: 'Kode SKU, Nama Produk, dan Harga Satuan wajib valid.' });
      return;
    }

    try {
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO products (sku, name, category, unit, unit_price, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`
        )
        .run(cleanSku, cleanName, cleanCategory, cleanUnit, price, now);

      const created = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid) as any;
      res.status(201).json({
        product: {
          id: created.id,
          sku: created.sku,
          name: created.name,
          category: created.category,
          unit: created.unit,
          unitPrice: created.unit_price,
          isActive: Boolean(created.is_active),
        },
      });
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) {
        res.status(409).json({ error: `Kode SKU "${cleanSku}" sudah terdaftar.` });
        return;
      }
      res.status(400).json({ error: 'Gagal menyimpan produk.' });
    }
  });

  app.put('/api/products/:id', requireAuth, requireRole(['Admin']), (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const { sku, name, category, unit, unitPrice, isActive } = req.body || {};
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Produk tidak ditemukan.' });
      return;
    }

    const cleanSku = sku !== undefined ? String(sku).trim().toUpperCase() : existing.sku;
    const cleanName = name !== undefined ? String(name).trim() : existing.name;
    const cleanCategory = category !== undefined ? String(category).trim() : existing.category;
    const cleanUnit = unit !== undefined ? String(unit).trim() : existing.unit;
    const price = unitPrice !== undefined ? Math.round(Number(unitPrice)) : existing.unit_price;
    const activeInt = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active;

    if (!cleanSku || !cleanName || !Number.isFinite(price) || price < 0) {
      res.status(400).json({ error: 'Data produk tidak valid.' });
      return;
    }

    try {
      db.prepare(
        `UPDATE products
         SET sku = ?, name = ?, category = ?, unit = ?, unit_price = ?, is_active = ?
         WHERE id = ?`
      ).run(cleanSku, cleanName, cleanCategory, cleanUnit, price, activeInt, id);
      res.json({ ok: true });
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) {
        res.status(409).json({ error: `Kode SKU "${cleanSku}" sudah digunakan produk lain.` });
        return;
      }
      res.status(400).json({ error: 'Gagal memperbarui produk.' });
    }
  });

  app.post('/api/products/bulk-import', requireAuth, requireRole(['Admin']), (req: AuthedRequest, res: Response) => {
    const { items, mode } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Daftar produk kosong.' });
      return;
    }

    const updateOnDuplicate = mode === 'update';
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const findStmt = db.prepare('SELECT id FROM products WHERE sku = ?');
    const insertStmt = db.prepare(
      `INSERT INTO products (sku, name, category, unit, unit_price, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );
    const updateStmt = db.prepare(
      `UPDATE products SET name = ?, category = ?, unit = ?, unit_price = ?, is_active = 1 WHERE id = ?`
    );

    const runTx = db.transaction((rows: any[]) => {
      for (const r of rows) {
        const sku = String(r.sku || '').trim().toUpperCase();
        const name = String(r.name || '').trim();
        const category = String(r.category || 'Umum').trim() || 'Umum';
        const unit = String(r.unit || 'pcs').trim() || 'pcs';
        const price = Math.round(Number(r.unitPrice));

        if (!sku || !name || !Number.isFinite(price) || price < 0) {
          skipped++;
          continue;
        }

        const existing = findStmt.get(sku) as { id: number } | undefined;
        if (existing) {
          if (updateOnDuplicate) {
            updateStmt.run(name, category, unit, price, existing.id);
            updated++;
          } else {
            skipped++;
          }
        } else {
          insertStmt.run(sku, name, category, unit, price, now);
          inserted++;
        }
      }
    });

    runTx(items);
    res.json({ inserted, updated, skipped });
  });

  // ==================== SALES REPORTS ====================
  app.post('/api/sales', requireAuth, (req: AuthedRequest, res: Response) => {
    const { productId, quantity, appliedUnitPrice, clientName, notes, reportedAt } = req.body || {};
    const pid = Number(productId);
    const qty = Math.round(Number(quantity));

    if (!Number.isInteger(pid) || !Number.isInteger(qty) || qty <= 0) {
      res.status(400).json({ error: 'Produk dan Quantity terjual (minimal 1) wajib valid.' });
      return;
    }

    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND is_active = 1')
      .get(pid) as any;

    if (!product) {
      res.status(404).json({ error: 'Produk tidak ditemukan atau nonaktif.' });
      return;
    }

    const settings = getAppSettings();
    const allowAdj = settings.allow_price_adjustment === 'true';

    let finalUnitPrice = product.unit_price;
    if (allowAdj && appliedUnitPrice !== undefined && appliedUnitPrice !== null && appliedUnitPrice !== '') {
      const customPrice = Math.round(Number(appliedUnitPrice));
      if (!Number.isFinite(customPrice) || customPrice < 0) {
        res.status(400).json({ error: 'Harga promo/penyesuaian tidak valid.' });
        return;
      }
      finalUnitPrice = customPrice;
    }

    const totalAmount = qty * finalUnitPrice;
    const repIso =
      reportedAt && !Number.isNaN(new Date(reportedAt).getTime())
        ? new Date(reportedAt).toISOString()
        : new Date().toISOString();
    const dateKey = getJakartaDateKey(repIso);

    const info = db
      .prepare(
        `INSERT INTO sales_reports
         (user_id, product_id, product_sku, product_name, product_category, product_unit, quantity, unit_price, applied_unit_price, total_amount, client_name, notes, date_key, reported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user!.id,
        product.id,
        product.sku,
        product.name,
        product.category,
        product.unit,
        qty,
        product.unit_price,
        finalUnitPrice,
        totalAmount,
        String(clientName || '').trim().slice(0, 160),
        String(notes || '').trim().slice(0, 400),
        dateKey,
        repIso
      );

    const created = db
      .prepare('SELECT * FROM sales_reports WHERE id = ?')
      .get(info.lastInsertRowid) as any;

    res.status(201).json({
      sale: {
        id: created.id,
        productId: created.product_id,
        productSku: created.product_sku,
        productName: created.product_name,
        productCategory: created.product_category,
        productUnit: created.product_unit,
        quantity: created.quantity,
        unitPrice: created.unit_price,
        appliedUnitPrice: created.applied_unit_price,
        totalAmount: created.total_amount,
        clientName: created.client_name,
        notes: created.notes,
        reportedAt: created.reported_at,
      },
    });
  });

  // ==================== STRUCTURED DAILY REPORTS (SPG STAY / MOBILE / EVENT) ====================
  app.post('/api/daily-reports', requireAuth, (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const reportType = String(body.reportType || '');
    if (!['spg_stay', 'spg_mobile', 'event'].includes(reportType)) {
      res.status(400).json({ error: 'Jenis laporan harian tidak valid.' });
      return;
    }

    const latNum = body.lat !== undefined && body.lat !== null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lngNum = body.lng !== undefined && body.lng !== null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    const accNum = body.accuracy !== undefined && body.accuracy !== null && Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null;

    const reportedIso =
      body.reportedAt && !Number.isNaN(new Date(body.reportedAt).getTime())
        ? new Date(body.reportedAt).toISOString()
        : new Date().toISOString();
    const dateKey = getJakartaDateKey(reportedIso);
    const nowIso = new Date().toISOString();

    const settings = getAppSettings();
    const allowAdj = settings.allow_price_adjustment === 'true';

    const rawItems: Array<{ productId: number; quantity: number; unitPrice?: number }> = Array.isArray(body.items)
      ? body.items
      : [];
    const activityPhotos: Array<{ dataUrl: string; capturedAt?: string }> = Array.isArray(body.activityPhotos)
      ? body.activityPhotos.slice(0, 10)
      : [];

    let clientName = String(body.clientName || '').trim().slice(0, 160);
    let visitStatus = String(body.visitStatus || '').trim();
    const offerNotes = String(body.offerNotes || '').trim().slice(0, 1000);
    const notes = String(body.notes || '').trim().slice(0, 1000);
    const fieldNotes = String(body.fieldNotes || '').trim().slice(0, 1000);
    const eventName = String(body.eventName || '').trim().slice(0, 180);
    const obstacles = String(body.obstacles || '').trim().slice(0, 1000);
    const suggestions = String(body.suggestions || '').trim().slice(0, 1000);

    if (reportType === 'spg_stay') {
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'Laporan SPG Stay wajib memuat minimal 1 item produk terjual.' });
        return;
      }
      if (!clientName) clientName = 'Outlet / Stand SPG Stay';
      visitStatus = 'SPG Stay';
    } else if (reportType === 'spg_mobile') {
      if (!clientName) {
        res.status(400).json({ error: 'Nama toko / klien wajib diisi untuk laporan SPG/SMD Mobile.' });
        return;
      }
      if (!['Selesai', 'Tertunda', 'Butuh Tindak Lanjut'].includes(visitStatus)) {
        visitStatus = 'Selesai';
      }
    } else if (reportType === 'event') {
      if (!eventName) {
        res.status(400).json({ error: 'Nama kegiatan event wajib diisi.' });
        return;
      }
      clientName = eventName;
      visitStatus = 'Event';
    }

    // Validate and resolve product line items
    const resolvedItems: Array<{
      product: any;
      quantity: number;
      appliedUnitPrice: number;
      totalAmount: number;
    }> = [];

    for (const item of rawItems) {
      const pid = Number(item.productId);
      const qty = Math.round(Number(item.quantity));
      if (!Number.isInteger(pid) || !Number.isInteger(qty) || qty <= 0) {
        res.status(400).json({ error: 'Setiap item produk harus memiliki produk valid dan Qty minimal 1.' });
        return;
      }
      const prod = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(pid) as any;
      if (!prod) {
        res.status(404).json({ error: `Produk dengan ID ${pid} tidak ditemukan atau nonaktif.` });
        return;
      }
      let unitPrice = prod.unit_price;
      if (allowAdj && item.unitPrice !== undefined && item.unitPrice !== null && String(item.unitPrice).trim() !== '') {
        const custom = Math.round(Number(item.unitPrice));
        if (!Number.isFinite(custom) || custom < 0) {
          res.status(400).json({ error: 'Harga satuan tidak valid.' });
          return;
        }
        unitPrice = custom;
      }
      resolvedItems.push({
        product: prod,
        quantity: qty,
        appliedUnitPrice: unitPrice,
        totalAmount: qty * unitPrice,
      });
    }

    const totalItemsQty = resolvedItems.reduce((sum, it) => sum + it.quantity, 0);
    const totalItemsAmount = resolvedItems.reduce((sum, it) => sum + it.totalAmount, 0);

    const targetSalesAmount = Math.max(0, Math.round(Number(body.targetSalesAmount || 0)));
    const realizedSalesAmount =
      reportType === 'event'
        ? Math.max(0, Math.round(Number(body.realizedSalesAmount || 0)))
        : totalItemsAmount;
    const targetVisitors = Math.max(0, Math.round(Number(body.targetVisitors || 0)));
    const realizedVisitors = Math.max(0, Math.round(Number(body.realizedVisitors || 0)));

    const rawExpenses: Array<{ name: string; amount: number }> = Array.isArray(body.expenses)
      ? body.expenses
      : [];
    const cleanExpenses = rawExpenses
      .map((ex) => ({
        name: String(ex.name || '').trim().slice(0, 120),
        amount: Math.max(0, Math.round(Number(ex.amount || 0))),
      }))
      .filter((ex) => ex.name.length > 0 || ex.amount > 0);
    const totalExpense = cleanExpenses.reduce((sum, ex) => sum + ex.amount, 0);

    const savedFilenames: string[] = [];
    const photoInserts: Array<{ kind: 'activity' | 'transaction_proof'; filename: string; capturedAt: string }> = [];

    try {
      if (reportType === 'event' && body.transactionProofPhoto?.dataUrl) {
        const fname = savePhotoFromDataUrl(body.transactionProofPhoto.dataUrl, req.user!.id, 'event_tx');
        savedFilenames.push(fname);
        photoInserts.push({
          kind: 'transaction_proof',
          filename: fname,
          capturedAt:
            body.transactionProofPhoto.capturedAt && !Number.isNaN(new Date(body.transactionProofPhoto.capturedAt).getTime())
              ? new Date(body.transactionProofPhoto.capturedAt).toISOString()
              : reportedIso,
        });
      }

      for (const ap of activityPhotos) {
        if (!ap?.dataUrl) continue;
        const fname = savePhotoFromDataUrl(ap.dataUrl, req.user!.id, reportType);
        savedFilenames.push(fname);
        photoInserts.push({
          kind: 'activity',
          filename: fname,
          capturedAt:
            ap.capturedAt && !Number.isNaN(new Date(ap.capturedAt).getTime())
              ? new Date(ap.capturedAt).toISOString()
              : reportedIso,
        });
      }
    } catch (err: any) {
      for (const f of savedFilenames) deletePhotoFileSafe(f);
      res.status(400).json({ error: err.message || 'Gagal memproses foto bukti.' });
      return;
    }

    const salesItemsSnapshot = resolvedItems.map((it) => ({
      productId: it.product.id,
      productSku: it.product.sku,
      productName: it.product.name,
      productUnit: it.product.unit,
      quantity: it.quantity,
      unitPrice: it.appliedUnitPrice,
      totalAmount: it.totalAmount,
    }));

    const insertReportStmt = db.prepare(
      `INSERT INTO daily_reports (
        user_id, report_type, date_key, lat, lng, accuracy, client_name, visit_status,
        offer_notes, notes, field_notes, event_name, target_sales_amount, realized_sales_amount,
        target_visitors, realized_visitors, expenses_json, total_expense, obstacles,
        suggestions, total_qty, total_sales_amount, sales_items_json, reported_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertPhotoStmt = db.prepare(
      `INSERT INTO daily_report_photos (report_id, photo_kind, photo_filename, captured_at)
       VALUES (?, ?, ?, ?)`
    );

    const insertSaleStmt = db.prepare(
      `INSERT INTO sales_reports
       (user_id, product_id, product_sku, product_name, product_category, product_unit, quantity, unit_price, applied_unit_price, total_amount, client_name, notes, date_key, reported_at, daily_report_id, source_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let newReportId = 0;
    const tx = db.transaction(() => {
      const info = insertReportStmt.run(
        req.user!.id,
        reportType,
        dateKey,
        latNum,
        lngNum,
        accNum,
        clientName,
        visitStatus,
        offerNotes,
        notes,
        fieldNotes,
        eventName,
        targetSalesAmount,
        realizedSalesAmount,
        targetVisitors,
        realizedVisitors,
        JSON.stringify(cleanExpenses),
        totalExpense,
        obstacles,
        suggestions,
        totalItemsQty,
        reportType === 'event' ? realizedSalesAmount : totalItemsAmount,
        JSON.stringify(salesItemsSnapshot),
        reportedIso,
        nowIso
      );
      newReportId = Number(info.lastInsertRowid);

      for (const p of photoInserts) {
        insertPhotoStmt.run(newReportId, p.kind, p.filename, p.capturedAt);
      }

      for (const it of resolvedItems) {
        insertSaleStmt.run(
          req.user!.id,
          it.product.id,
          it.product.sku,
          it.product.name,
          it.product.category,
          it.product.unit,
          it.quantity,
          it.product.unit_price,
          it.appliedUnitPrice,
          it.totalAmount,
          clientName,
          notes || offerNotes || fieldNotes,
          dateKey,
          reportedIso,
          newReportId,
          reportType
        );
      }

      if (latNum !== null && lngNum !== null) {
        const label =
          reportType === 'spg_stay'
            ? `SPG/SPB: ${clientName}`
            : reportType === 'spg_mobile'
            ? `SMD: ${clientName}`
            : `Event: ${eventName}`;
        db.prepare(
          `UPDATE users
           SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_gps_at = ?, last_status_label = ?
           WHERE id = ?`
        ).run(latNum, lngNum, accNum, nowIso, label.slice(0, 100), req.user!.id);
      }
    });

    tx();

    const createdRow = db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(newReportId) as any;
    res.status(201).json({ report: mapDailyReportRow(createdRow) });
  });

  // ==================== SALES REPRESENTATIF REPORTS (PENAWARAN / PO / NOO) ====================
  app.post('/api/sales-rep/reports', requireAuth, (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const subType = String(body.subType || '');
    if (!['penawaran', 'po', 'noo'].includes(subType)) {
      res.status(400).json({ error: 'Jenis laporan Sales Representatif tidak valid.' });
      return;
    }

    const latNum =
      body.lat !== undefined && body.lat !== null && Number.isFinite(Number(body.lat))
        ? Number(body.lat)
        : null;
    const lngNum =
      body.lng !== undefined && body.lng !== null && Number.isFinite(Number(body.lng))
        ? Number(body.lng)
        : null;
    const accNum =
      body.accuracy !== undefined && body.accuracy !== null && Number.isFinite(Number(body.accuracy))
        ? Number(body.accuracy)
        : null;

    const reportedIso =
      body.reportedAt && !Number.isNaN(new Date(body.reportedAt).getTime())
        ? new Date(body.reportedAt).toISOString()
        : new Date().toISOString();
    const dateKey = getJakartaDateKey(reportedIso);
    const nowIso = new Date().toISOString();

    const settings = getAppSettings();
    const allowAdj = settings.allow_price_adjustment === 'true';

    let clientName = String(body.clientName || '').trim().slice(0, 160);
    const offerNotes = String(body.offerNotes || '').trim().slice(0, 1000);
    const rawOfferStatus = String(body.offerStatus || '').trim();
    const offerStatus =
      subType === 'penawaran'
        ? ['Diajukan', 'Negosiasi', 'Tertarik / Follow-Up', 'Ditolak', 'Deal'].includes(
            rawOfferStatus
          )
          ? rawOfferStatus
          : 'Diajukan'
        : subType === 'po'
        ? 'PO'
        : 'NOO';
    const followUpDate = String(body.followUpDate || '').trim().slice(0, 20);
    const outletName = String(body.outletName || '').trim().slice(0, 160);
    const outletAddress = String(body.outletAddress || '').trim().slice(0, 300);
    const outletOwner = String(body.outletOwner || '').trim().slice(0, 120);
    const outletPhone = String(body.outletPhone || '').trim().slice(0, 40);
    const outletType = String(body.outletType || '').trim().slice(0, 80);
    const outletPotential = String(body.outletPotential || '').trim().slice(0, 200);
    const notes = String(body.notes || '').trim().slice(0, 1000);
    const fieldNotes = String(body.fieldNotes || '').trim().slice(0, 1000);

    if (subType === 'penawaran') {
      if (!clientName) {
        res.status(400).json({ error: 'Nama toko / klien wajib diisi untuk Penawaran Produk.' });
        return;
      }
      if (!offerNotes) {
        res.status(400).json({ error: 'Detail penawaran produk / promo wajib diisi.' });
        return;
      }
    } else if (subType === 'po') {
      if (!clientName) {
        res.status(400).json({ error: 'Nama toko / klien wajib diisi untuk Purchase Order (PO).' });
        return;
      }
    } else if (subType === 'noo') {
      if (!outletName) {
        res.status(400).json({ error: 'Nama outlet / toko baru wajib diisi untuk NOO.' });
        return;
      }
      clientName = outletName;
    }

    const rawItems: Array<{ productId: number; quantity: number; unitPrice?: number }> =
      Array.isArray(body.items) ? body.items : [];
    const poItemsSnapshot: Array<{
      productId: number;
      productSku: string;
      productName: string;
      productUnit: string;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
    }> = [];

    if (subType === 'po') {
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'PO wajib memuat minimal 1 item produk.' });
        return;
      }
      for (const item of rawItems) {
        const pid = Number(item.productId);
        const qty = Math.round(Number(item.quantity));
        if (!Number.isInteger(pid) || !Number.isInteger(qty) || qty <= 0) {
          res.status(400).json({ error: 'Setiap item PO harus memiliki produk valid dan Qty minimal 1.' });
          return;
        }
        const prod = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(pid) as any;
        if (!prod) {
          res.status(404).json({ error: `Produk dengan ID ${pid} tidak ditemukan atau nonaktif.` });
          return;
        }
        let unitPrice = prod.unit_price;
        if (
          allowAdj &&
          item.unitPrice !== undefined &&
          item.unitPrice !== null &&
          String(item.unitPrice).trim() !== ''
        ) {
          const custom = Math.round(Number(item.unitPrice));
          if (!Number.isFinite(custom) || custom < 0) {
            res.status(400).json({ error: 'Harga satuan PO tidak valid.' });
            return;
          }
          unitPrice = custom;
        }
        poItemsSnapshot.push({
          productId: prod.id,
          productSku: prod.sku,
          productName: prod.name,
          productUnit: prod.unit,
          quantity: qty,
          unitPrice,
          totalAmount: qty * unitPrice,
        });
      }
    }

    const poTotalQty = poItemsSnapshot.reduce((s, i) => s + i.quantity, 0);
    const poTotalAmount = poItemsSnapshot.reduce((s, i) => s + i.totalAmount, 0);

    const rawPhotos: Array<{ dataUrl: string; capturedAt?: string }> = Array.isArray(body.photos)
      ? body.photos.slice(0, 10)
      : [];
    const savedPhotos: Array<{ photoFilename: string; capturedAt: string }> = [];

    try {
      for (const ph of rawPhotos) {
        if (!ph?.dataUrl) continue;
        const fname = savePhotoFromDataUrl(
          ph.dataUrl,
          req.user!.id,
          `sales_${subType}`,
          'Format foto lampiran tidak valid.'
        );
        savedPhotos.push({
          photoFilename: fname,
          capturedAt:
            ph.capturedAt && !Number.isNaN(new Date(ph.capturedAt).getTime())
              ? new Date(ph.capturedAt).toISOString()
              : reportedIso,
        });
      }
    } catch (err: any) {
      for (const sp of savedPhotos) deletePhotoFileSafe(sp.photoFilename);
      res.status(400).json({ error: err.message || 'Gagal memproses foto lampiran.' });
      return;
    }

    const info = db
      .prepare(
        `INSERT INTO sales_rep_reports (
          user_id, sub_type, date_key, lat, lng, accuracy, client_name,
          offer_notes, offer_status, follow_up_date, po_items_json, po_total_qty, po_total_amount,
          outlet_name, outlet_address, outlet_owner, outlet_phone, outlet_type, outlet_potential,
          notes, field_notes, photos_json, reported_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user!.id,
        subType,
        dateKey,
        latNum,
        lngNum,
        accNum,
        clientName,
        offerNotes,
        offerStatus,
        followUpDate,
        JSON.stringify(poItemsSnapshot),
        poTotalQty,
        poTotalAmount,
        outletName,
        outletAddress,
        outletOwner,
        outletPhone,
        outletType,
        outletPotential,
        notes,
        fieldNotes,
        JSON.stringify(savedPhotos),
        reportedIso,
        nowIso
      );

    if (latNum !== null && lngNum !== null) {
      const label =
        subType === 'po'
          ? `Sales Rep (PO): ${clientName}`
          : subType === 'noo'
          ? `Sales Rep (NOO): ${outletName}`
          : `Sales Rep (Penawaran): ${clientName}`;
      db.prepare(
        `UPDATE users
         SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_gps_at = ?, last_status_label = ?
         WHERE id = ?`
      ).run(latNum, lngNum, accNum, nowIso, label.slice(0, 100), req.user!.id);
    }

    const createdRow = db
      .prepare('SELECT * FROM sales_rep_reports WHERE id = ?')
      .get(info.lastInsertRowid) as any;
    res.status(201).json({ report: mapSalesRepRow(createdRow) });
  });

  // ==================== TIDAK MASUK KERJA (LIBUR / SAKIT / IZIN / CUTI) ====================
  app.post('/api/absence-reports', requireAuth, (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const absenceType = String(body.absenceType || '');
    if (!['Libur', 'Sakit', 'Izin', 'Cuti'].includes(absenceType)) {
      res.status(400).json({ error: 'Status tidak masuk kerja harus Libur, Sakit, Izin, atau Cuti.' });
      return;
    }

    const startDate = String(body.startDate || '').trim();
    const endDate = String(body.endDate || startDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      res.status(400).json({ error: 'Format tanggal mulai / selesai tidak valid.' });
      return;
    }
    if (endDate < startDate) {
      res.status(400).json({ error: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.' });
      return;
    }

    const reason = String(body.reason || '').trim().slice(0, 1000);
    if (reason.length < 2) {
      res.status(400).json({ error: 'Keterangan / alasan tidak masuk kerja wajib diisi.' });
      return;
    }
    const fieldNotes = String(body.fieldNotes || '').trim().slice(0, 1000);

    const latNum =
      body.lat !== undefined && body.lat !== null && Number.isFinite(Number(body.lat))
        ? Number(body.lat)
        : null;
    const lngNum =
      body.lng !== undefined && body.lng !== null && Number.isFinite(Number(body.lng))
        ? Number(body.lng)
        : null;
    const accNum =
      body.accuracy !== undefined && body.accuracy !== null && Number.isFinite(Number(body.accuracy))
        ? Number(body.accuracy)
        : null;

    const submittedIso =
      body.submittedAt && !Number.isNaN(new Date(body.submittedAt).getTime())
        ? new Date(body.submittedAt).toISOString()
        : new Date().toISOString();
    const nowIso = new Date().toISOString();

    let photoFilename = '';
    if (body.photoDataUrl) {
      try {
        photoFilename = savePhotoFromDataUrl(
          body.photoDataUrl,
          req.user!.id,
          'absence',
          'Format foto bukti surat/izin tidak valid.'
        );
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }
    }

    const info = db
      .prepare(
        `INSERT INTO absence_reports (
          user_id, absence_type, start_date, end_date, reason, field_notes,
          lat, lng, accuracy, photo_filename, date_key, submitted_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user!.id,
        absenceType,
        startDate,
        endDate,
        reason,
        fieldNotes,
        latNum,
        lngNum,
        accNum,
        photoFilename,
        startDate,
        submittedIso,
        nowIso
      );

    const todayKey = getJakartaDateKey();
    if (todayKey >= startDate && todayKey <= endDate) {
      db.prepare(`UPDATE users SET last_status_label = ? WHERE id = ?`).run(
        `Tidak Masuk (${absenceType})`.slice(0, 100),
        req.user!.id
      );
    }

    const createdRow = db
      .prepare('SELECT * FROM absence_reports WHERE id = ?')
      .get(info.lastInsertRowid) as any;
    res.status(201).json({ report: mapAbsenceRow(createdRow) });
  });

  // ==================== ADMIN LAMPIRAN FOTO TAMBAHAN ====================
  app.post(
    '/api/admin/attachments',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const body = req.body || {};
      const targetType = String(body.targetType || '');
      const targetId = Number(body.targetId);

      const tableMap: Record<string, string> = {
        attendance: 'attendance_visits',
        daily_report: 'daily_reports',
        collection: 'collection_reports',
        sales_rep: 'sales_rep_reports',
        absence: 'absence_reports',
      };
      const tableName = tableMap[targetType];
      if (!tableName || !Number.isInteger(targetId) || targetId <= 0) {
        res.status(400).json({ error: 'Target laporan untuk lampiran tidak valid.' });
        return;
      }

      const targetRow = db
        .prepare(`SELECT id, user_id FROM ${tableName} WHERE id = ?`)
        .get(targetId) as { id: number; user_id: number } | undefined;
      if (!targetRow) {
        res.status(404).json({ error: 'Data laporan target tidak ditemukan.' });
        return;
      }

      const rawPhotos: Array<{ dataUrl: string; note?: string }> = Array.isArray(body.photos)
        ? body.photos.slice(0, 10)
        : body.dataUrl
        ? [{ dataUrl: body.dataUrl, note: body.note }]
        : [];

      if (rawPhotos.length === 0) {
        res.status(400).json({ error: 'Pilih minimal 1 file foto (PNG/JPG/WEBP) untuk dilampirkan.' });
        return;
      }

      const savedFiles: string[] = [];
      const createdList: any[] = [];
      const nowIso = new Date().toISOString();

      try {
        for (const p of rawPhotos) {
          const fname = savePhotoFromDataUrl(
            p.dataUrl,
            targetRow.user_id || req.user!.id,
            `admin_att_${targetType}`,
            'Format file lampiran harus PNG, JPG, atau WEBP.'
          );
          savedFiles.push(fname);
          const noteText = String(p.note ?? body.note ?? '').trim().slice(0, 300);
          const info = db
            .prepare(
              `INSERT INTO report_attachments (
                target_type, target_id, photo_filename, note, uploaded_by, uploaded_by_name, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(targetType, targetId, fname, noteText, req.user!.id, req.user!.fullName, nowIso);
          createdList.push({
            id: Number(info.lastInsertRowid),
            targetType,
            targetId,
            photoFilename: fname,
            photoUrl: buildSignedPhotoUrl(fname),
            note: noteText,
            uploadedByName: req.user!.fullName,
            createdAt: nowIso,
          });
        }
      } catch (err: any) {
        for (const f of savedFiles) deletePhotoFileSafe(f);
        res.status(400).json({ error: err.message || 'Gagal menyimpan foto lampiran.' });
        return;
      }

      res.status(201).json({ attachments: createdList });
    }
  );

  app.delete(
    '/api/admin/attachments/:id',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const row = db
        .prepare('SELECT * FROM report_attachments WHERE id = ?')
        .get(id) as { id: number; photo_filename: string } | undefined;
      if (!row) {
        res.status(404).json({ error: 'Lampiran tidak ditemukan.' });
        return;
      }
      db.prepare('DELETE FROM report_attachments WHERE id = ?').run(id);
      deletePhotoFileSafe(row.photo_filename);
      res.json({ ok: true });
    }
  );

  // ==================== CUSTOMERS, INVOICES & COLLECTOR REPORTS ====================
  app.get('/api/customers', requireAuth, (req: AuthedRequest, res: Response) => {
    const includeInactive =
      req.query.includeInactive === '1' && ['Admin', 'Leader/SPV'].includes(req.user!.role);

    const rows = db
      .prepare(
        includeInactive
          ? 'SELECT * FROM customers ORDER BY name ASC'
          : 'SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC'
      )
      .all() as any[];

    const unpaidStats = db
      .prepare(
        `SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(remaining_amount), 0) AS rem
         FROM invoices
         WHERE status != 'Lunas' AND remaining_amount > 0
         GROUP BY customer_id`
      )
      .all() as Array<{ customer_id: number; cnt: number; rem: number }>;

    const statMap = new Map(unpaidStats.map((s) => [s.customer_id, s]));

    res.json({
      customers: rows.map((c) => {
        const st = statMap.get(c.id);
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          phone: c.phone,
          address: c.address,
          isActive: Boolean(c.is_active),
          unpaidCount: st?.cnt || 0,
          totalRemaining: st?.rem || 0,
          createdAt: c.created_at,
        };
      }),
    });
  });

  app.post(
    '/api/customers',
    requireAuth,
    requireRole(['Admin', 'Leader/SPV']),
    (req: AuthedRequest, res: Response) => {
      const { code, name, phone, address } = req.body || {};
      const cleanName = String(name || '').trim();
      const cleanCode =
        String(code || '')
          .trim()
          .toUpperCase() || `CUST-${Date.now().toString().slice(-5)}`;
      if (cleanName.length < 2) {
        res.status(400).json({ error: 'Nama customer / toko wajib diisi.' });
        return;
      }

      try {
        const now = new Date().toISOString();
        const info = db
          .prepare(
            `INSERT INTO customers (code, name, phone, address, is_active, created_at)
             VALUES (?, ?, ?, ?, 1, ?)`
          )
          .run(
            cleanCode.slice(0, 40),
            cleanName.slice(0, 160),
            String(phone || '').trim().slice(0, 40),
            String(address || '').trim().slice(0, 300),
            now
          );
        const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid) as any;
        res.status(201).json({
          customer: {
            id: created.id,
            code: created.code,
            name: created.name,
            phone: created.phone,
            address: created.address,
            isActive: Boolean(created.is_active),
          },
        });
      } catch (err: any) {
        if (String(err.message).includes('UNIQUE')) {
          res.status(409).json({ error: `Kode customer "${cleanCode}" sudah terdaftar.` });
          return;
        }
        res.status(400).json({ error: 'Gagal menyimpan data customer.' });
      }
    }
  );

  app.put(
    '/api/customers/:id',
    requireAuth,
    requireRole(['Admin', 'Leader/SPV']),
    (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Customer tidak ditemukan.' });
        return;
      }

      const { code, name, phone, address, isActive } = req.body || {};
      const cleanCode = code !== undefined ? String(code).trim().toUpperCase() : existing.code;
      const cleanName = name !== undefined ? String(name).trim() : existing.name;
      const cleanPhone = phone !== undefined ? String(phone).trim() : existing.phone;
      const cleanAddr = address !== undefined ? String(address).trim() : existing.address;
      const activeInt = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active;

      if (!cleanCode || cleanName.length < 2) {
        res.status(400).json({ error: 'Kode dan nama customer wajib valid.' });
        return;
      }

      try {
        db.prepare(
          `UPDATE customers SET code = ?, name = ?, phone = ?, address = ?, is_active = ? WHERE id = ?`
        ).run(cleanCode, cleanName, cleanPhone, cleanAddr, activeInt, id);
        res.json({ ok: true });
      } catch (err: any) {
        if (String(err.message).includes('UNIQUE')) {
          res.status(409).json({ error: `Kode customer "${cleanCode}" sudah digunakan.` });
          return;
        }
        res.status(400).json({ error: 'Gagal memperbarui customer.' });
      }
    }
  );

  app.get('/api/invoices', requireAuth, (req: AuthedRequest, res: Response) => {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const unpaidOnly = req.query.unpaidOnly === '1';

    let where = '1=1';
    const params: any[] = [];
    if (customerId) {
      where += ' AND i.customer_id = ?';
      params.push(customerId);
    }
    if (unpaidOnly) {
      where += " AND i.status != 'Lunas' AND i.remaining_amount > 0";
    }

    const rows = db
      .prepare(
        `SELECT i.*, c.name AS customer_name, c.code AS customer_code
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE ${where}
         ORDER BY i.created_at DESC`
      )
      .all(...params) as any[];

    res.json({
      invoices: rows.map((i) => ({
        id: i.id,
        customerId: i.customer_id,
        customerName: i.customer_name,
        customerCode: i.customer_code,
        invoiceNumber: i.invoice_number,
        totalAmount: i.total_amount,
        paidAmount: i.paid_amount,
        remainingAmount: i.remaining_amount,
        dueDate: i.due_date,
        status: i.status,
        notes: i.notes,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      })),
    });
  });

  app.post(
    '/api/invoices',
    requireAuth,
    requireRole(['Admin', 'Leader/SPV']),
    (req: AuthedRequest, res: Response) => {
      const { customerId, invoiceNumber, totalAmount, dueDate, notes } = req.body || {};
      const cid = Number(customerId);
      const cleanInv = String(invoiceNumber || '').trim().toUpperCase();
      const total = Math.round(Number(totalAmount));

      if (!Number.isInteger(cid) || !cleanInv || !Number.isFinite(total) || total <= 0) {
        res.status(400).json({ error: 'Customer, Nomor Invoice, dan Total Tagihan (> 0) wajib valid.' });
        return;
      }

      const cust = db.prepare('SELECT id FROM customers WHERE id = ?').get(cid) as any;
      if (!cust) {
        res.status(404).json({ error: 'Customer tidak ditemukan.' });
        return;
      }

      try {
        const now = new Date().toISOString();
        const info = db
          .prepare(
            `INSERT INTO invoices (customer_id, invoice_number, total_amount, paid_amount, remaining_amount, due_date, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, 0, ?, ?, 'Belum Lunas', ?, ?, ?)`
          )
          .run(
            cid,
            cleanInv.slice(0, 80),
            total,
            total,
            String(dueDate || '').trim().slice(0, 20),
            String(notes || '').trim().slice(0, 400),
            now,
            now
          );
        res.status(201).json({ id: info.lastInsertRowid });
      } catch (err: any) {
        if (String(err.message).includes('UNIQUE')) {
          res.status(409).json({ error: `Nomor Invoice "${cleanInv}" sudah ada.` });
          return;
        }
        res.status(400).json({ error: 'Gagal menambahkan invoice.' });
      }
    }
  );

  app.put(
    '/api/invoices/:id',
    requireAuth,
    requireRole(['Admin', 'Leader/SPV']),
    (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Invoice tidak ditemukan.' });
        return;
      }

      const { invoiceNumber, totalAmount, paidAmount, dueDate, notes } = req.body || {};
      const cleanInv =
        invoiceNumber !== undefined ? String(invoiceNumber).trim().toUpperCase() : existing.invoice_number;
      const newTotal =
        totalAmount !== undefined ? Math.max(1, Math.round(Number(totalAmount))) : existing.total_amount;
      const newPaid =
        paidAmount !== undefined
          ? Math.max(0, Math.min(newTotal, Math.round(Number(paidAmount))))
          : Math.min(newTotal, existing.paid_amount);
      const newRemaining = Math.max(0, newTotal - newPaid);
      const newStatus = newRemaining === 0 ? 'Lunas' : newPaid > 0 ? 'Sebagian' : 'Belum Lunas';

      try {
        db.prepare(
          `UPDATE invoices
           SET invoice_number = ?, total_amount = ?, paid_amount = ?, remaining_amount = ?, due_date = ?, status = ?, notes = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          cleanInv,
          newTotal,
          newPaid,
          newRemaining,
          dueDate !== undefined ? String(dueDate).trim() : existing.due_date,
          newStatus,
          notes !== undefined ? String(notes).trim() : existing.notes,
          new Date().toISOString(),
          id
        );
        res.json({ ok: true });
      } catch (err: any) {
        if (String(err.message).includes('UNIQUE')) {
          res.status(409).json({ error: `Nomor Invoice "${cleanInv}" sudah digunakan.` });
          return;
        }
        res.status(400).json({ error: 'Gagal memperbarui invoice.' });
      }
    }
  );

  app.post('/api/collector/reports', requireAuth, (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const customerId = Number(body.customerId);
    const invoiceId = Number(body.invoiceId);
    const visitStatus = String(body.visitStatus || '');
    const paymentMethod = String(body.paymentMethod || 'Tunai');
    const promiseDate = String(body.promiseDate || '').trim().slice(0, 20);
    const reason = String(body.reason || '').trim().slice(0, 100);
    const notes = String(body.notes || '').trim().slice(0, 500);
    const fieldNotes = String(body.fieldNotes || '').trim().slice(0, 1000);

    if (!Number.isInteger(customerId) || !Number.isInteger(invoiceId)) {
      res.status(400).json({ error: 'Customer dan Nomor Invoice wajib dipilih.' });
      return;
    }
    if (!['Bayar Lunas', 'Bayar Sebagian', 'Janji Bayar', 'Toko Tutup', 'Gagal Tagih'].includes(visitStatus)) {
      res.status(400).json({ error: 'Status kunjungan kolektor tidak valid.' });
      return;
    }
    if (!['Tunai', 'Transfer', 'Giro', 'QRIS'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Metode pembayaran tidak valid.' });
      return;
    }
    if ((visitStatus === 'Janji Bayar' || visitStatus === 'Bayar Sebagian') && !promiseDate) {
      res.status(400).json({ error: 'Tanggal Janji Bayar wajib diisi untuk status Janji Bayar / Bayar Sebagian.' });
      return;
    }

    const latNum = body.lat !== undefined && body.lat !== null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lngNum = body.lng !== undefined && body.lng !== null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    const accNum = body.accuracy !== undefined && body.accuracy !== null && Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null;

    const visitedIso =
      body.visitedAt && !Number.isNaN(new Date(body.visitedAt).getTime())
        ? new Date(body.visitedAt).toISOString()
        : new Date().toISOString();
    const dateKey = getJakartaDateKey(visitedIso);
    const nowIso = new Date().toISOString();

    let photoFilename = '';
    if (body.photoDataUrl) {
      try {
        photoFilename = savePhotoFromDataUrl(body.photoDataUrl, req.user!.id, 'collector');
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }
    }

    try {
      let createdId = 0;
      const tx = db.transaction(() => {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
        const invoice = db
          .prepare('SELECT * FROM invoices WHERE id = ? AND customer_id = ?')
          .get(invoiceId, customerId) as any;

        if (!customer || !invoice) {
          throw Object.assign(new Error('Customer atau Invoice tidak ditemukan.'), { statusCode: 404 });
        }
        if (invoice.remaining_amount <= 0 || invoice.status === 'Lunas') {
          throw Object.assign(new Error(`Invoice ${invoice.invoice_number} sudah lunas.`), { statusCode: 400 });
        }

        const baselineTagihan = invoice.remaining_amount;
        let collected =
          body.collectedAmount === undefined || body.collectedAmount === null || String(body.collectedAmount).trim() === ''
            ? visitStatus === 'Bayar Lunas'
              ? baselineTagihan
              : 0
            : Math.round(Number(body.collectedAmount));

        if (!Number.isFinite(collected) || collected < 0) {
          throw Object.assign(new Error('Nominal tertagih tidak valid.'), { statusCode: 400 });
        }
        if (collected > baselineTagihan) {
          throw Object.assign(
            new Error('Nominal tertagih tidak boleh melebihi sisa tagihan invoice.'),
            { statusCode: 400 }
          );
        }

        const newRemaining = Math.max(0, baselineTagihan - collected);
        const newPaid = invoice.paid_amount + collected;
        const newInvStatus = newRemaining === 0 ? 'Lunas' : newPaid > 0 ? 'Sebagian' : 'Belum Lunas';

        db.prepare(
          `UPDATE invoices
           SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?
           WHERE id = ?`
        ).run(newPaid, newRemaining, newInvStatus, nowIso, invoice.id);

        const info = db
          .prepare(
            `INSERT INTO collection_reports (
              user_id, customer_id, customer_name, invoice_id, invoice_number, invoice_total,
              visit_status, collected_amount, remaining_amount, payment_method, promise_date,
              reason, notes, field_notes, lat, lng, accuracy, photo_filename, date_key, visited_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            req.user!.id,
            customer.id,
            customer.name,
            invoice.id,
            invoice.invoice_number,
            baselineTagihan,
            visitStatus,
            collected,
            newRemaining,
            paymentMethod,
            promiseDate,
            reason,
            notes,
            fieldNotes,
            latNum,
            lngNum,
            accNum,
            photoFilename,
            dateKey,
            visitedIso,
            nowIso
          );
        createdId = Number(info.lastInsertRowid);

        if (latNum !== null && lngNum !== null) {
          db.prepare(
            `UPDATE users
             SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_gps_at = ?, last_status_label = ?
             WHERE id = ?`
          ).run(
            latNum,
            lngNum,
            accNum,
            nowIso,
            `Kolektor: ${customer.name} (${visitStatus})`.slice(0, 100),
            req.user!.id
          );
        }
      });

      tx();
      const row = db.prepare('SELECT * FROM collection_reports WHERE id = ?').get(createdId) as any;
      res.status(201).json({ report: mapCollectionReportRow(row) });
    } catch (err: any) {
      if (photoFilename) deletePhotoFileSafe(photoFilename);
      res.status(err.statusCode || 400).json({ error: err.message || 'Gagal menyimpan laporan kolektor.' });
    }
  });

  // ==================== LEADER / SPV TEAM OVERVIEW ====================
  app.get(
    '/api/leader/team-overview',
    requireAuth,
    requireRole(['Leader/SPV', 'Admin']),
    (req: AuthedRequest, res: Response) => {
      const todayKey = getJakartaDateKey();
      const members =
        req.user!.role === 'Admin'
          ? (db
              .prepare(
                "SELECT * FROM users WHERE role IN ('Karyawan', 'Leader/SPV') AND is_active = 1 ORDER BY full_name ASC"
              )
              .all() as any[])
          : (db
              .prepare(
                "SELECT * FROM users WHERE leader_id = ? AND role = 'Karyawan' AND is_active = 1 ORDER BY full_name ASC"
              )
              .all(req.user!.id) as any[]);

      const teamData = members.map((m) => {
        const visits = db
          .prepare(
            `SELECT * FROM attendance_visits
             WHERE user_id = ? AND date_key = ?
             ORDER BY captured_at DESC`
          )
          .all(m.id, todayKey) as any[];

        const sales = db
          .prepare(
            `SELECT * FROM sales_reports
             WHERE user_id = ? AND date_key = ?
             ORDER BY reported_at DESC`
          )
          .all(m.id, todayKey) as any[];

        const salesSum = db
          .prepare(
            `SELECT COALESCE(SUM(quantity), 0) AS totalQty, COALESCE(SUM(total_amount), 0) AS totalAmount
             FROM sales_reports WHERE user_id = ? AND date_key = ?`
          )
          .get(m.id, todayKey) as { totalQty: number; totalAmount: number };

        const eventSum = db
          .prepare(
            `SELECT COALESCE(SUM(realized_sales_amount), 0) AS totalAmount
             FROM daily_reports WHERE user_id = ? AND date_key = ? AND report_type = 'event'`
          )
          .get(m.id, todayKey) as { totalAmount: number };

        const dailyReportRows = db
          .prepare(
            `SELECT * FROM daily_reports
             WHERE user_id = ? AND date_key = ?
             ORDER BY reported_at DESC`
          )
          .all(m.id, todayKey) as any[];

        const salesRepRows = db
          .prepare(
            `SELECT * FROM sales_rep_reports
             WHERE user_id = ? AND date_key = ?
             ORDER BY reported_at DESC`
          )
          .all(m.id, todayKey) as any[];

        const collectionRows = db
          .prepare(
            `SELECT * FROM collection_reports
             WHERE user_id = ? AND date_key = ?
             ORDER BY visited_at DESC`
          )
          .all(m.id, todayKey) as any[];

        const absenceRows = db
          .prepare(
            `SELECT * FROM absence_reports
             WHERE user_id = ? AND (date_key = ? OR (start_date <= ? AND end_date >= ?))
             ORDER BY submitted_at DESC`
          )
          .all(m.id, todayKey, todayKey, todayKey) as any[];

        const collectionSum = db
          .prepare(
            `SELECT COUNT(*) AS count,
                    COALESCE(SUM(collected_amount), 0) AS totalCollected,
                    COALESCE(SUM(remaining_amount), 0) AS totalRemaining
             FROM collection_reports WHERE user_id = ? AND date_key = ?`
          )
          .get(m.id, todayKey) as { count: number; totalCollected: number; totalRemaining: number };

        const checkIn = visits.find((v) => v.record_type === 'check_in');
        const checkOut = visits.find((v) => v.record_type === 'check_out');
        const targets = computeUserTargetsProgress(m.id);

        return {
          id: m.id,
          fullName: m.full_name,
          phone: m.phone,
          role: m.role,
          employeeCategory: sanitizeCategory(m.employee_category, m.role),
          lastLat: m.last_lat,
          lastLng: m.last_lng,
          lastAccuracy: m.last_accuracy,
          lastGpsAt: m.last_gps_at,
          lastStatusLabel: m.last_status_label,
          checkInTime: checkIn?.captured_at || null,
          checkOutTime: checkOut?.captured_at || null,
          visits: visits.map((v) => ({
            id: v.id,
            recordType: v.record_type,
            clientName: v.client_name,
            visitStatus: v.visit_status,
            notes: v.notes,
            lat: v.lat,
            lng: v.lng,
            photoUrl: buildSignedPhotoUrl(v.photo_filename),
            adminAttachments: getAttachmentsForTarget('attendance', v.id),
            capturedAt: v.captured_at,
          })),
          sales: sales.map((s) => ({
            id: s.id,
            productName: s.product_name,
            productUnit: s.product_unit,
            quantity: s.quantity,
            totalAmount: s.total_amount,
            clientName: s.client_name,
            reportedAt: s.reported_at,
          })),
          dailyReports: dailyReportRows.map(mapDailyReportRow),
          salesRepReports: salesRepRows.map(mapSalesRepRow),
          collectionReports: collectionRows.map(mapCollectionReportRow),
          absenceReports: absenceRows.map(mapAbsenceRow),
          salesSummary: {
            totalQty: salesSum.totalQty,
            totalAmount: salesSum.totalAmount + eventSum.totalAmount,
          },
          collectionSummary: collectionSum,
          specificTargets: targets.specificTargets,
        };
      });

      res.json({ dateKey: todayKey, team: teamData });
    }
  );

  // ==================== ADMIN USER MANAGEMENT ====================
  app.get('/api/admin/users', requireAuth, requireRole(['Admin']), (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT u.*, l.full_name AS leader_name
         FROM users u
         LEFT JOIN users l ON l.id = u.leader_id
         ORDER BY
           CASE u.role WHEN 'Admin' THEN 1 WHEN 'Leader/SPV' THEN 2 ELSE 3 END,
           u.full_name ASC`
      )
      .all() as any[];

    res.json({
      users: rows.map((u) => ({
        id: u.id,
        fullName: u.full_name,
        phone: u.phone,
        emailAlias: u.email_alias,
        role: u.role,
        employeeCategory: sanitizeCategory(u.employee_category, u.role),
        leaderId: u.leader_id ?? null,
        leaderName: u.leader_name ?? null,
        isActive: Boolean(u.is_active),
        createdAt: u.created_at,
      })),
    });
  });

  app.post('/api/admin/users', requireAuth, requireRole(['Admin']), (req: AuthedRequest, res: Response) => {
    const { fullName, phone, password, role, employeeCategory, leaderId } = req.body || {};

    if (!fullName || String(fullName).trim().length < 2) {
      res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
      return;
    }
    if (!password || String(password).length < 6) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }
    if (!['Karyawan', 'Leader/SPV', 'Admin'].includes(role)) {
      res.status(400).json({ error: 'Peran pengguna tidak valid.' });
      return;
    }

    const resolvedCategory =
      role === 'Admin'
        ? 'Leader/SPV'
        : employeeCategory
        ? sanitizeCategory(employeeCategory, role)
        : sanitizeCategory(undefined, role);

    let normalized: string;
    let emailAlias: string;
    try {
      normalized = normalizePhone(phone);
      emailAlias = phoneToDummyEmail(phone);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    let resolvedLeaderId: number | null = null;
    if (role === 'Karyawan' && leaderId !== undefined && leaderId !== null && leaderId !== '') {
      const lid = Number(leaderId);
      const leaderRow = db
        .prepare("SELECT id FROM users WHERE id = ? AND role = 'Leader/SPV'")
        .get(lid) as { id: number } | undefined;
      if (!leaderRow) {
        res.status(400).json({ error: 'Leader/SPV yang dipilih tidak valid.' });
        return;
      }
      resolvedLeaderId = lid;
    }

    const now = new Date().toISOString();
    const passwordHash = hashPassword(String(password));

    try {
      const info = db
        .prepare(
          `INSERT INTO users (full_name, phone, email_alias, password_hash, role, employee_category, leader_id, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          String(fullName).trim(),
          normalized,
          emailAlias,
          passwordHash,
          role,
          resolvedCategory,
          resolvedLeaderId,
          now
        );
      res.status(201).json({ id: info.lastInsertRowid, emailAlias });
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) {
        res.status(409).json({ error: `Nomor HP ${normalized} (${emailAlias}) sudah terdaftar.` });
        return;
      }
      res.status(400).json({ error: 'Gagal menambahkan akun karyawan.' });
    }
  });

  app.put('/api/admin/users/:id', requireAuth, requireRole(['Admin']), (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    const { fullName, phone, password, role, employeeCategory, leaderId, isActive } = req.body || {};

    // Prevent Admin from deactivating themselves accidentally
    if (id === req.user!.id && isActive === false) {
      res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Admin Anda sendiri.' });
      return;
    }

    const newName = fullName !== undefined ? String(fullName).trim() : existing.full_name;
    let newPhone = existing.phone;
    let newAlias = existing.email_alias;

    if (phone !== undefined && String(phone).trim() !== '') {
      try {
        newPhone = normalizePhone(phone);
        newAlias = phoneToDummyEmail(phone);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }
    }

    const newRole =
      role !== undefined && ['Karyawan', 'Leader/SPV', 'Admin'].includes(role)
        ? role
        : existing.role;

    const newCategory =
      newRole === 'Admin'
        ? 'Leader/SPV'
        : employeeCategory !== undefined
        ? sanitizeCategory(employeeCategory, newRole)
        : sanitizeCategory(existing.employee_category, newRole);

    let newLeaderId = existing.leader_id;
    if (newRole !== 'Karyawan') {
      newLeaderId = null;
    } else if (leaderId !== undefined) {
      if (leaderId === null || leaderId === '') {
        newLeaderId = null;
      } else {
        const lid = Number(leaderId);
        if (lid === id) {
          res.status(400).json({ error: 'Karyawan tidak dapat menjadi Leader dirinya sendiri.' });
          return;
        }
        const leaderRow = db
          .prepare("SELECT id FROM users WHERE id = ? AND role = 'Leader/SPV'")
          .get(lid) as { id: number } | undefined;
        if (!leaderRow) {
          res.status(400).json({ error: 'Leader/SPV yang dipilih tidak valid.' });
          return;
        }
        newLeaderId = lid;
      }
    }

    const newActive = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active;
    let newHash = existing.password_hash;
    if (password && String(password).length > 0) {
      if (String(password).length < 6) {
        res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
        return;
      }
      newHash = hashPassword(String(password));
    }

    try {
      db.prepare(
        `UPDATE users
         SET full_name = ?, phone = ?, email_alias = ?, password_hash = ?, role = ?, employee_category = ?, leader_id = ?, is_active = ?
         WHERE id = ?`
      ).run(newName, newPhone, newAlias, newHash, newRole, newCategory, newLeaderId, newActive, id);

      if (newActive === 0) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }

      res.json({ ok: true });
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) {
        res.status(409).json({ error: `Nomor HP ${newPhone} sudah digunakan akun lain.` });
        return;
      }
      res.status(400).json({ error: 'Gagal memperbarui akun.' });
    }
  });

  // ==================== ADMIN TARGETS & SETTINGS ====================
  app.get(
    '/api/admin/settings-targets',
    requireAuth,
    requireRole(['Admin']),
    (_req: AuthedRequest, res: Response) => {
      const settings = getAppSettings();
      const targets = db
        .prepare(
          `SELECT et.*, u.full_name AS user_name, u.role AS user_role, p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit
           FROM employee_targets et
           JOIN users u ON u.id = et.user_id
           LEFT JOIN products p ON p.id = et.product_id
           ORDER BY u.full_name ASC, et.updated_at DESC`
        )
        .all() as any[];

      const enrichedTargets = targets.map((t) => {
        const range = getPeriodDateRange(t.period);
        let sql = `SELECT COALESCE(SUM(total_amount), 0) AS amount, COALESCE(SUM(quantity), 0) AS qty
                   FROM sales_reports
                   WHERE user_id = ? AND date_key >= ? AND date_key <= ?`;
        const params: any[] = [t.user_id, range.startDate, range.endDate];
        if (t.product_id) {
          sql += ' AND product_id = ?';
          params.push(t.product_id);
        } else if (t.category) {
          sql += ' AND product_category = ?';
          params.push(t.category);
        }
        const actual = db.prepare(sql).get(...params) as { amount: number; qty: number };
        return {
          id: t.id,
          userId: t.user_id,
          userName: t.user_name,
          userRole: t.user_role,
          period: t.period,
          targetAmount: t.target_amount,
          targetQty: t.target_qty,
          productId: t.product_id,
          productName: t.product_name,
          productSku: t.product_sku,
          productUnit: t.product_unit,
          category: t.category,
          actualAmount: actual.amount,
          actualQty: actual.qty,
        };
      });

      const categories = db
        .prepare('SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category ASC')
        .all() as Array<{ category: string }>;

      res.json({
        settings: {
          allowPriceAdjustment: settings.allow_price_adjustment === 'true',
          globalTargetPeriod: settings.global_target_period || 'bulanan',
          globalTargetAmount: Number(settings.global_target_amount || 0),
          globalTargetQty: Number(settings.global_target_qty || 0),
        },
        employeeTargets: enrichedTargets,
        categories: categories.map((c) => c.category),
      });
    }
  );

  app.put(
    '/api/admin/settings-targets',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const { allowPriceAdjustment, globalTargetPeriod, globalTargetAmount, globalTargetQty } =
        req.body || {};

      const upsert = db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );

      if (allowPriceAdjustment !== undefined) {
        upsert.run('allow_price_adjustment', allowPriceAdjustment ? 'true' : 'false');
      }
      if (['harian', 'mingguan', 'bulanan'].includes(globalTargetPeriod)) {
        upsert.run('global_target_period', globalTargetPeriod);
      }
      if (globalTargetAmount !== undefined && Number.isFinite(Number(globalTargetAmount))) {
        upsert.run('global_target_amount', String(Math.max(0, Math.round(Number(globalTargetAmount)))));
      }
      if (globalTargetQty !== undefined && Number.isFinite(Number(globalTargetQty))) {
        upsert.run('global_target_qty', String(Math.max(0, Math.round(Number(globalTargetQty)))));
      }

      res.json({ ok: true });
    }
  );

  app.post(
    '/api/admin/employee-targets',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const { userId, period, targetAmount, targetQty, productId, category } = req.body || {};
      const uid = Number(userId);
      if (!Number.isInteger(uid)) {
        res.status(400).json({ error: 'Karyawan wajib dipilih.' });
        return;
      }
      if (!['harian', 'mingguan', 'bulanan'].includes(period)) {
        res.status(400).json({ error: 'Periode target tidak valid.' });
        return;
      }

      const amt = Math.max(0, Math.round(Number(targetAmount || 0)));
      const qty = Math.max(0, Math.round(Number(targetQty || 0)));
      if (amt === 0 && qty === 0) {
        res.status(400).json({ error: 'Isi minimal Target Nominal (Rp) atau Target Quantity.' });
        return;
      }

      const pid = productId ? Number(productId) : null;
      const cat = !pid && category ? String(category).trim() : null;
      const now = new Date().toISOString();

      const info = db
        .prepare(
          `INSERT INTO employee_targets (user_id, period, target_amount, target_qty, product_id, category, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(uid, period, amt, qty, pid, cat, now);

      res.status(201).json({ id: info.lastInsertRowid });
    }
  );

  app.delete(
    '/api/admin/employee-targets/:id',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      db.prepare('DELETE FROM employee_targets WHERE id = ?').run(id);
      res.json({ ok: true });
    }
  );

  // ==================== ADMIN MONITORING, MAP & PURGE ====================
  app.get('/api/admin/monitoring', requireAuth, requireRole(['Admin']), (req: AuthedRequest, res: Response) => {
    const todayKey = getJakartaDateKey();
    const startDate = String(req.query.startDate || todayKey);
    const endDate = String(req.query.endDate || startDate);
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const leaderId = req.query.leaderId ? Number(req.query.leaderId) : null;
    const status = req.query.status ? String(req.query.status) : '';
    const reportType = req.query.reportType ? String(req.query.reportType) : '';

    // 1. Live map pins (latest position for active field users today)
    const fieldUsers = db
      .prepare(
        `SELECT u.*, l.full_name AS leader_name
         FROM users u
         LEFT JOIN users l ON l.id = u.leader_id
         WHERE u.is_active = 1 AND u.role IN ('Karyawan', 'Leader/SPV')
         ORDER BY u.full_name ASC`
      )
      .all() as any[];

    const livePins = fieldUsers
      .filter((u) => u.last_lat !== null && u.last_lng !== null)
      .map((u) => {
        const latestVisitToday = db
          .prepare(
            `SELECT * FROM attendance_visits
             WHERE user_id = ? AND date_key = ?
             ORDER BY captured_at DESC LIMIT 1`
          )
          .get(u.id, todayKey) as any;

        return {
          userId: u.id,
          fullName: u.full_name,
          role: u.role,
          employeeCategory: sanitizeCategory(u.employee_category, u.role),
          phone: u.phone,
          leaderName: u.leader_name || null,
          lat: u.last_lat,
          lng: u.last_lng,
          accuracy: u.last_accuracy,
          lastGpsAt: u.last_gps_at,
          lastStatusLabel:
            u.last_status_label || latestVisitToday?.visit_status || 'Aktif GPS',
          lastPhotoUrl: latestVisitToday ? buildSignedPhotoUrl(latestVisitToday.photo_filename) : null,
          lastPhotoCapturedAt: latestVisitToday?.captured_at || null,
          checkedInToday: Boolean(
            db
              .prepare(
                "SELECT 1 FROM attendance_visits WHERE user_id = ? AND date_key = ? AND record_type = 'check_in' LIMIT 1"
              )
              .get(u.id, todayKey)
          ),
        };
      });

    // 2. Filtered attendance/visit records
    let where = 'av.date_key >= ? AND av.date_key <= ?';
    const params: any[] = [startDate, endDate];

    if (userId) {
      where += ' AND av.user_id = ?';
      params.push(userId);
    }
    if (leaderId) {
      where += ' AND u.leader_id = ?';
      params.push(leaderId);
    }
    if (status) {
      where += ' AND av.visit_status = ?';
      params.push(status);
    }

    const rawRecords =
      reportType && reportType !== 'attendance'
        ? []
        : (db
            .prepare(
              `SELECT av.*, u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role, u.employee_category AS employee_category, l.full_name AS leader_name
               FROM attendance_visits av
               JOIN users u ON u.id = av.user_id
               LEFT JOIN users l ON l.id = u.leader_id
               WHERE ${where}
               ORDER BY av.captured_at DESC`
            )
            .all(...params) as any[]);

    // 2b. Filtered Daily Reports (SPG Stay / SPG Mobile / Event)
    let dailyWhere = 'dr.date_key >= ? AND dr.date_key <= ?';
    const dailyParams: any[] = [startDate, endDate];
    if (userId) {
      dailyWhere += ' AND dr.user_id = ?';
      dailyParams.push(userId);
    }
    if (leaderId) {
      dailyWhere += ' AND u.leader_id = ?';
      dailyParams.push(leaderId);
    }
    if (status) {
      dailyWhere += ' AND dr.visit_status = ?';
      dailyParams.push(status);
    }
    if (['spg_stay', 'spg_mobile', 'event'].includes(reportType)) {
      dailyWhere += ' AND dr.report_type = ?';
      dailyParams.push(reportType);
    }

    const showDailySection =
      !reportType || ['spg_stay', 'spg_mobile', 'event'].includes(reportType);
    const rawDailyReports = !showDailySection
      ? []
      : (db
          .prepare(
            `SELECT dr.*, u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role, u.employee_category AS employee_category, l.full_name AS leader_name
             FROM daily_reports dr
             JOIN users u ON u.id = dr.user_id
             LEFT JOIN users l ON l.id = u.leader_id
             WHERE ${dailyWhere}
             ORDER BY dr.reported_at DESC`
          )
          .all(...dailyParams) as any[]);

    // 2c. Filtered Collector Reports
    let colWhere = 'cr.date_key >= ? AND cr.date_key <= ?';
    const colParams: any[] = [startDate, endDate];
    if (userId) {
      colWhere += ' AND cr.user_id = ?';
      colParams.push(userId);
    }
    if (leaderId) {
      colWhere += ' AND u.leader_id = ?';
      colParams.push(leaderId);
    }
    if (status) {
      colWhere += ' AND cr.visit_status = ?';
      colParams.push(status);
    }

    const rawCollectorReports =
      reportType && reportType !== 'collector'
        ? []
        : (db
            .prepare(
              `SELECT cr.*, u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role, u.employee_category AS employee_category, l.full_name AS leader_name
               FROM collection_reports cr
               JOIN users u ON u.id = cr.user_id
               LEFT JOIN users l ON l.id = u.leader_id
               WHERE ${colWhere}
               ORDER BY cr.visited_at DESC`
            )
            .all(...colParams) as any[]);

    // 2d. Filtered Sales Representatif Reports
    let srWhere = 'sr.date_key >= ? AND sr.date_key <= ?';
    const srParams: any[] = [startDate, endDate];
    if (userId) {
      srWhere += ' AND sr.user_id = ?';
      srParams.push(userId);
    }
    if (leaderId) {
      srWhere += ' AND u.leader_id = ?';
      srParams.push(leaderId);
    }
    if (status) {
      srWhere += ' AND sr.offer_status = ?';
      srParams.push(status);
    }
    if (reportType === 'sales_offer') {
      srWhere += " AND sr.sub_type = 'penawaran'";
    } else if (reportType === 'sales_po') {
      srWhere += " AND sr.sub_type = 'po'";
    } else if (reportType === 'sales_noo') {
      srWhere += " AND sr.sub_type = 'noo'";
    }

    const showSalesRepSection =
      !reportType || ['sales_rep', 'sales_offer', 'sales_po', 'sales_noo'].includes(reportType);
    const rawSalesRepReports = !showSalesRepSection
      ? []
      : (db
          .prepare(
            `SELECT sr.*, u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role, u.employee_category AS employee_category, l.full_name AS leader_name
             FROM sales_rep_reports sr
             JOIN users u ON u.id = sr.user_id
             LEFT JOIN users l ON l.id = u.leader_id
             WHERE ${srWhere}
             ORDER BY sr.reported_at DESC`
          )
          .all(...srParams) as any[]);

    // 2e. Filtered Absence Reports (Tidak Masuk Kerja)
    let absWhere = '((ar.date_key >= ? AND ar.date_key <= ?) OR (ar.start_date <= ? AND ar.end_date >= ?))';
    const absParams: any[] = [startDate, endDate, endDate, startDate];
    if (userId) {
      absWhere += ' AND ar.user_id = ?';
      absParams.push(userId);
    }
    if (leaderId) {
      absWhere += ' AND u.leader_id = ?';
      absParams.push(leaderId);
    }
    if (status) {
      absWhere += ' AND ar.absence_type = ?';
      absParams.push(status);
    }

    const rawAbsenceReports =
      reportType && reportType !== 'absence'
        ? []
        : (db
            .prepare(
              `SELECT ar.*, u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role, u.employee_category AS employee_category, l.full_name AS leader_name
               FROM absence_reports ar
               JOIN users u ON u.id = ar.user_id
               LEFT JOIN users l ON l.id = u.leader_id
               WHERE ${absWhere}
               ORDER BY ar.submitted_at DESC`
            )
            .all(...absParams) as any[]);

    // Pre-fetch check-in, check-out, and sales summaries per (user_id, date_key) in range
    const daySummaries = new Map<
      string,
      {
        checkInTime: string | null;
        checkOutTime: string | null;
        checkInPhotoUrl: string | null;
        checkOutPhotoUrl: string | null;
        salesQty: number;
        salesAmount: number;
        salesDetailText: string;
      }
    >();

    const allDayVisits = db
      .prepare(
        `SELECT user_id, date_key, record_type, photo_filename, captured_at
         FROM attendance_visits
         WHERE date_key >= ? AND date_key <= ?
         ORDER BY captured_at ASC`
      )
      .all(startDate, endDate) as any[];

    const allDaySales = db
      .prepare(
        `SELECT sr.*, u.full_name AS user_name, u.leader_id
         FROM sales_reports sr
         JOIN users u ON u.id = sr.user_id
         WHERE sr.date_key >= ? AND sr.date_key <= ?
         ORDER BY sr.reported_at DESC`
      )
      .all(startDate, endDate) as any[];

    const allDayEventSales = db
      .prepare(
        `SELECT dr.user_id, dr.date_key, dr.event_name, dr.realized_sales_amount
         FROM daily_reports dr
         WHERE dr.report_type = 'event' AND dr.date_key >= ? AND dr.date_key <= ?`
      )
      .all(startDate, endDate) as any[];

    for (const v of allDayVisits) {
      const key = `${v.user_id}:${v.date_key}`;
      if (!daySummaries.has(key)) {
        daySummaries.set(key, {
          checkInTime: null,
          checkOutTime: null,
          checkInPhotoUrl: null,
          checkOutPhotoUrl: null,
          salesQty: 0,
          salesAmount: 0,
          salesDetailText: '',
        });
      }
      const s = daySummaries.get(key)!;
      if (v.record_type === 'check_in' && !s.checkInTime) {
        s.checkInTime = v.captured_at;
        s.checkInPhotoUrl = buildSignedPhotoUrl(v.photo_filename);
      }
      if (v.record_type === 'check_out') {
        s.checkOutTime = v.captured_at;
        s.checkOutPhotoUrl = buildSignedPhotoUrl(v.photo_filename);
      }
    }

    const salesTextMap = new Map<string, string[]>();
    for (const sr of allDaySales) {
      const key = `${sr.user_id}:${sr.date_key}`;
      if (!daySummaries.has(key)) {
        daySummaries.set(key, {
          checkInTime: null,
          checkOutTime: null,
          checkInPhotoUrl: null,
          checkOutPhotoUrl: null,
          salesQty: 0,
          salesAmount: 0,
          salesDetailText: '',
        });
      }
      const s = daySummaries.get(key)!;
      s.salesQty += sr.quantity;
      s.salesAmount += sr.total_amount;
      if (!salesTextMap.has(key)) salesTextMap.set(key, []);
      salesTextMap.get(key)!.push(`${sr.product_name} (${sr.quantity} ${sr.product_unit} = Rp${sr.total_amount})`);
    }
    for (const ev of allDayEventSales) {
      if (!ev.realized_sales_amount) continue;
      const key = `${ev.user_id}:${ev.date_key}`;
      if (!daySummaries.has(key)) {
        daySummaries.set(key, {
          checkInTime: null,
          checkOutTime: null,
          checkInPhotoUrl: null,
          checkOutPhotoUrl: null,
          salesQty: 0,
          salesAmount: 0,
          salesDetailText: '',
        });
      }
      const s = daySummaries.get(key)!;
      s.salesAmount += ev.realized_sales_amount;
      if (!salesTextMap.has(key)) salesTextMap.set(key, []);
      salesTextMap.get(key)!.push(`Event ${ev.event_name} (Realisasi = Rp${ev.realized_sales_amount})`);
    }
    for (const [key, list] of salesTextMap.entries()) {
      const s = daySummaries.get(key);
      if (s) s.salesDetailText = list.join('; ');
    }

    const records = rawRecords.map((r) => {
      const key = `${r.user_id}:${r.date_key}`;
      const day = daySummaries.get(key);
      return {
        id: r.id,
        userId: r.user_id,
        userName: r.user_name,
        userPhone: r.user_phone,
        userRole: r.user_role,
        employeeCategory: sanitizeCategory(r.employee_category, r.user_role),
        leaderName: r.leader_name || null,
        recordType: r.record_type,
        dateKey: r.date_key,
        clientName: r.client_name,
        visitStatus: r.visit_status,
        notes: r.notes,
        lat: r.lat,
        lng: r.lng,
        accuracy: r.accuracy,
        photoFilename: r.photo_filename,
        photoUrl: buildSignedPhotoUrl(r.photo_filename),
        adminAttachments: getAttachmentsForTarget('attendance', r.id),
        capturedAt: r.captured_at,
        checkInTime: day?.checkInTime || null,
        checkOutTime: day?.checkOutTime || null,
        checkInPhotoUrl: day?.checkInPhotoUrl || null,
        checkOutPhotoUrl: day?.checkOutPhotoUrl || null,
        salesQty: day?.salesQty || 0,
        salesAmount: day?.salesAmount || 0,
        salesDetailText: day?.salesDetailText || '',
      };
    });

    const dailyReports = rawDailyReports.map(mapDailyReportRow);
    const salesRepReports = rawSalesRepReports.map(mapSalesRepRow);
    const collectionReports = rawCollectorReports.map(mapCollectionReportRow);
    const absenceReports = rawAbsenceReports.map(mapAbsenceRow);

    // 3. Summary stats
    const checkedInTodayRow = db
      .prepare(
        "SELECT COUNT(DISTINCT user_id) AS cnt FROM attendance_visits WHERE date_key = ? AND record_type = 'check_in'"
      )
      .get(todayKey) as { cnt: number };

    const completedVisitsRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM attendance_visits av
         JOIN users u ON u.id = av.user_id
         WHERE av.date_key >= ? AND av.date_key <= ?
         AND av.visit_status = 'Selesai'
         ${userId ? 'AND av.user_id = ?' : ''}
         ${leaderId ? 'AND u.leader_id = ?' : ''}`
      )
      .get(
        ...[
          startDate,
          endDate,
          ...(userId ? [userId] : []),
          ...(leaderId ? [leaderId] : []),
        ]
      ) as { cnt: number };

    let salesWhere = 'sr.date_key >= ? AND sr.date_key <= ?';
    const salesParams: any[] = [startDate, endDate];
    if (userId) {
      salesWhere += ' AND sr.user_id = ?';
      salesParams.push(userId);
    }
    if (leaderId) {
      salesWhere += ' AND u.leader_id = ?';
      salesParams.push(leaderId);
    }

    const salesTotalRow = db
      .prepare(
        `SELECT COALESCE(SUM(sr.quantity), 0) AS totalQty, COALESCE(SUM(sr.total_amount), 0) AS totalAmount
         FROM sales_reports sr
         JOIN users u ON u.id = sr.user_id
         WHERE ${salesWhere}`
      )
      .get(...salesParams) as { totalQty: number; totalAmount: number };

    const eventTotalRow = db
      .prepare(
        `SELECT COALESCE(SUM(dr.realized_sales_amount), 0) AS totalAmount
         FROM daily_reports dr
         JOIN users u ON u.id = dr.user_id
         WHERE dr.report_type = 'event' AND dr.date_key >= ? AND dr.date_key <= ?
         ${userId ? 'AND dr.user_id = ?' : ''}
         ${leaderId ? 'AND u.leader_id = ?' : ''}`
      )
      .get(
        ...[
          startDate,
          endDate,
          ...(userId ? [userId] : []),
          ...(leaderId ? [leaderId] : []),
        ]
      ) as { totalAmount: number };

    const totalCollectedAmount = collectionReports.reduce((sum, c) => sum + c.collectedAmount, 0);
    const totalCollectionRemaining = collectionReports.reduce((sum, c) => sum + c.remainingAmount, 0);
    const totalPoAmount = salesRepReports
      .filter((sr) => sr.subType === 'po')
      .reduce((sum, sr) => sum + sr.poTotalAmount, 0);

    const targetOverview = computeUserTargetsProgress(req.user!.id).globalTarget;

    res.json({
      summary: {
        checkedInToday: checkedInTodayRow.cnt,
        totalFieldUsers: fieldUsers.length,
        completedVisits: completedVisitsRow.cnt,
        totalSalesQty: salesTotalRow.totalQty,
        totalSalesAmount: salesTotalRow.totalAmount + eventTotalRow.totalAmount,
        totalDailyReports: dailyReports.length,
        totalSalesRepReports: salesRepReports.length,
        totalPoAmount,
        totalAbsenceReports: absenceReports.length,
        totalCollectionCount: collectionReports.length,
        totalCollectedAmount,
        totalCollectionRemaining,
        globalTarget: targetOverview,
      },
      livePins,
      records,
      dailyReports,
      salesRepReports,
      collectionReports,
      absenceReports,
      salesRows: allDaySales
        .filter((sr) => (!userId || sr.user_id === userId) && (!leaderId || sr.leader_id === leaderId))
        .map((sr) => ({
          id: sr.id,
          userId: sr.user_id,
          userName: sr.user_name,
          dateKey: sr.date_key,
          productSku: sr.product_sku,
          productName: sr.product_name,
          productUnit: sr.product_unit,
          quantity: sr.quantity,
          appliedUnitPrice: sr.applied_unit_price,
          totalAmount: sr.total_amount,
          clientName: sr.client_name,
          reportedAt: sr.reported_at,
        })),
    });
  });

  app.delete(
    '/api/admin/monitoring/purge',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const { startDate, endDate, userId, leaderId, status, reportType } = req.body || {};
      if (!startDate || !endDate) {
        res.status(400).json({ error: 'Rentang tanggal wajib ditentukan untuk penghapusan.' });
        return;
      }

      const rt = String(reportType || '');

      // 1. Attendance visits targets
      let where = 'av.date_key >= ? AND av.date_key <= ?';
      const params: any[] = [String(startDate), String(endDate)];
      if (userId) {
        where += ' AND av.user_id = ?';
        params.push(Number(userId));
      }
      if (leaderId) {
        where += ' AND u.leader_id = ?';
        params.push(Number(leaderId));
      }
      if (status) {
        where += ' AND av.visit_status = ?';
        params.push(String(status));
      }

      const visitTargets =
        rt && rt !== 'attendance'
          ? []
          : (db
              .prepare(
                `SELECT av.id, av.photo_filename
                 FROM attendance_visits av
                 JOIN users u ON u.id = av.user_id
                 WHERE ${where}`
              )
              .all(...params) as Array<{ id: number; photo_filename: string }>);

      // 2. Daily reports targets
      let drWhere = 'dr.date_key >= ? AND dr.date_key <= ?';
      const drParams: any[] = [String(startDate), String(endDate)];
      if (userId) {
        drWhere += ' AND dr.user_id = ?';
        drParams.push(Number(userId));
      }
      if (leaderId) {
        drWhere += ' AND u.leader_id = ?';
        drParams.push(Number(leaderId));
      }
      if (status) {
        drWhere += ' AND dr.visit_status = ?';
        drParams.push(String(status));
      }
      if (['spg_stay', 'spg_mobile', 'event'].includes(rt)) {
        drWhere += ' AND dr.report_type = ?';
        drParams.push(rt);
      }

      const showDr = !rt || ['spg_stay', 'spg_mobile', 'event'].includes(rt);
      const dailyTargets = !showDr
        ? []
        : (db
            .prepare(
              `SELECT dr.id
               FROM daily_reports dr
               JOIN users u ON u.id = dr.user_id
               WHERE ${drWhere}`
            )
            .all(...drParams) as Array<{ id: number }>);

      // 3. Collector reports targets
      let crWhere = 'cr.date_key >= ? AND cr.date_key <= ?';
      const crParams: any[] = [String(startDate), String(endDate)];
      if (userId) {
        crWhere += ' AND cr.user_id = ?';
        crParams.push(Number(userId));
      }
      if (leaderId) {
        crWhere += ' AND u.leader_id = ?';
        crParams.push(Number(leaderId));
      }
      if (status) {
        crWhere += ' AND cr.visit_status = ?';
        crParams.push(String(status));
      }

      const collectorTargets =
        rt && rt !== 'collector'
          ? []
          : (db
              .prepare(
                `SELECT cr.id, cr.photo_filename
                 FROM collection_reports cr
                 JOIN users u ON u.id = cr.user_id
                 WHERE ${crWhere}`
              )
              .all(...crParams) as Array<{ id: number; photo_filename: string }>);

      // 4. Sales Rep targets
      let srWhere = 'sr.date_key >= ? AND sr.date_key <= ?';
      const srParams: any[] = [String(startDate), String(endDate)];
      if (userId) {
        srWhere += ' AND sr.user_id = ?';
        srParams.push(Number(userId));
      }
      if (leaderId) {
        srWhere += ' AND u.leader_id = ?';
        srParams.push(Number(leaderId));
      }
      if (status) {
        srWhere += ' AND sr.offer_status = ?';
        srParams.push(String(status));
      }
      if (rt === 'sales_offer') srWhere += " AND sr.sub_type = 'penawaran'";
      else if (rt === 'sales_po') srWhere += " AND sr.sub_type = 'po'";
      else if (rt === 'sales_noo') srWhere += " AND sr.sub_type = 'noo'";

      const showSr = !rt || ['sales_rep', 'sales_offer', 'sales_po', 'sales_noo'].includes(rt);
      const salesRepTargets = !showSr
        ? []
        : (db
            .prepare(
              `SELECT sr.id, sr.photos_json
               FROM sales_rep_reports sr
               JOIN users u ON u.id = sr.user_id
               WHERE ${srWhere}`
            )
            .all(...srParams) as Array<{ id: number; photos_json: string }>);

      // 5. Absence targets
      let absWhere =
        '((ar.date_key >= ? AND ar.date_key <= ?) OR (ar.start_date <= ? AND ar.end_date >= ?))';
      const absParams: any[] = [String(startDate), String(endDate), String(endDate), String(startDate)];
      if (userId) {
        absWhere += ' AND ar.user_id = ?';
        absParams.push(Number(userId));
      }
      if (leaderId) {
        absWhere += ' AND u.leader_id = ?';
        absParams.push(Number(leaderId));
      }
      if (status) {
        absWhere += ' AND ar.absence_type = ?';
        absParams.push(String(status));
      }

      const absenceTargets =
        rt && rt !== 'absence'
          ? []
          : (db
              .prepare(
                `SELECT ar.id, ar.photo_filename
                 FROM absence_reports ar
                 JOIN users u ON u.id = ar.user_id
                 WHERE ${absWhere}`
              )
              .all(...absParams) as Array<{ id: number; photo_filename: string }>);

      let deletedPhotos = 0;
      const deleteVisitStmt = db.prepare('DELETE FROM attendance_visits WHERE id = ?');
      const selectDailyPhotosStmt = db.prepare(
        'SELECT photo_filename FROM daily_report_photos WHERE report_id = ?'
      );
      const deleteDailyStmt = db.prepare('DELETE FROM daily_reports WHERE id = ?');
      const deleteCollectorStmt = db.prepare('DELETE FROM collection_reports WHERE id = ?');
      const deleteSalesRepStmt = db.prepare('DELETE FROM sales_rep_reports WHERE id = ?');
      const deleteAbsenceStmt = db.prepare('DELETE FROM absence_reports WHERE id = ?');
      const selectAttStmt = db.prepare(
        'SELECT photo_filename FROM report_attachments WHERE target_type = ? AND target_id = ?'
      );
      const deleteAttStmt = db.prepare(
        'DELETE FROM report_attachments WHERE target_type = ? AND target_id = ?'
      );

      const purgeAttachments = (tType: string, tId: number) => {
        const atts = selectAttStmt.all(tType, tId) as Array<{ photo_filename: string }>;
        if (atts.length > 0) {
          deleteAttStmt.run(tType, tId);
          for (const a of atts) {
            if (deletePhotoFileSafe(a.photo_filename)) deletedPhotos++;
          }
        }
      };

      const tx = db.transaction(() => {
        for (const r of visitTargets) {
          purgeAttachments('attendance', r.id);
          deleteVisitStmt.run(r.id);
          if (deletePhotoFileSafe(r.photo_filename)) deletedPhotos++;
        }
        for (const dr of dailyTargets) {
          purgeAttachments('daily_report', dr.id);
          const photos = selectDailyPhotosStmt.all(dr.id) as Array<{ photo_filename: string }>;
          deleteDailyStmt.run(dr.id);
          for (const p of photos) {
            if (deletePhotoFileSafe(p.photo_filename)) deletedPhotos++;
          }
        }
        for (const cr of collectorTargets) {
          purgeAttachments('collection', cr.id);
          deleteCollectorStmt.run(cr.id);
          if (cr.photo_filename && deletePhotoFileSafe(cr.photo_filename)) deletedPhotos++;
        }
        for (const sr of salesRepTargets) {
          purgeAttachments('sales_rep', sr.id);
          const photos = safeJsonParse<Array<{ photoFilename: string }>>(sr.photos_json, []);
          deleteSalesRepStmt.run(sr.id);
          for (const p of photos) {
            if (p.photoFilename && deletePhotoFileSafe(p.photoFilename)) deletedPhotos++;
          }
        }
        for (const ar of absenceTargets) {
          purgeAttachments('absence', ar.id);
          deleteAbsenceStmt.run(ar.id);
          if (ar.photo_filename && deletePhotoFileSafe(ar.photo_filename)) deletedPhotos++;
        }
      });

      tx();

      res.json({
        deletedRecords:
          visitTargets.length +
          dailyTargets.length +
          collectorTargets.length +
          salesRepTargets.length +
          absenceTargets.length,
        deletedPhotos,
      });
    }
  );

  // ==================== ANNOUNCEMENT BOARD ====================
  app.get('/api/announcements', requireAuth, (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT a.*, u.full_name AS author_name
         FROM announcements a
         LEFT JOIN users u ON u.id = a.created_by
         WHERE a.is_active = 1
         ORDER BY a.is_pinned DESC, a.created_at DESC`
      )
      .all() as any[];

    res.json({
      announcements: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        priority: r.priority,
        isPinned: Boolean(r.is_pinned),
        isActive: Boolean(r.is_active),
        authorName: r.author_name || 'Admin',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.get(
    '/api/admin/announcements',
    requireAuth,
    requireRole(['Admin']),
    (_req: AuthedRequest, res: Response) => {
      const rows = db
        .prepare(
          `SELECT a.*, u.full_name AS author_name
           FROM announcements a
           LEFT JOIN users u ON u.id = a.created_by
           ORDER BY a.is_pinned DESC, a.created_at DESC`
        )
        .all() as any[];

      res.json({
        announcements: rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          priority: r.priority,
          isPinned: Boolean(r.is_pinned),
          isActive: Boolean(r.is_active),
          authorName: r.author_name || 'Admin',
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      });
    }
  );

  app.post(
    '/api/admin/announcements',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const { title, content, priority, isPinned } = req.body || {};
      const cleanTitle = String(title || '').trim();
      const cleanContent = String(content || '').trim();
      const validPriority = ['Normal', 'Penting', 'Mendesak'].includes(priority)
        ? priority
        : 'Normal';

      if (cleanTitle.length < 2 || cleanContent.length < 2) {
        res.status(400).json({ error: 'Judul dan isi pengumuman wajib diisi.' });
        return;
      }

      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO announcements (title, content, priority, is_pinned, is_active, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          cleanTitle.slice(0, 160),
          cleanContent.slice(0, 2000),
          validPriority,
          isPinned ? 1 : 0,
          req.user!.id,
          now,
          now
        );

      res.status(201).json({ id: info.lastInsertRowid });
    }
  );

  app.put(
    '/api/admin/announcements/:id',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        return;
      }

      const { title, content, priority, isPinned, isActive } = req.body || {};
      const newTitle =
        title !== undefined ? String(title).trim().slice(0, 160) : existing.title;
      const newContent =
        content !== undefined ? String(content).trim().slice(0, 2000) : existing.content;
      const newPriority =
        priority !== undefined && ['Normal', 'Penting', 'Mendesak'].includes(priority)
          ? priority
          : existing.priority;
      const newPinned = isPinned !== undefined ? (isPinned ? 1 : 0) : existing.is_pinned;
      const newActive = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active;

      if (!newTitle || !newContent) {
        res.status(400).json({ error: 'Judul dan isi pengumuman tidak boleh kosong.' });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE announcements
         SET title = ?, content = ?, priority = ?, is_pinned = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      ).run(newTitle, newContent, newPriority, newPinned, newActive, now, id);

      res.json({ ok: true });
    }
  );

  app.delete(
    '/api/admin/announcements/:id',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
      res.json({ ok: true });
    }
  );

  // ==================== COMPANY BRANDING / LOGO ====================
  app.get('/api/branding/logo', (_req: Request, res: Response) => {
    const settings = getAppSettings();
    const filename = settings.company_logo_filename || '';
    const updatedAt = settings.company_logo_updated_at || '';

    if (filename && /^[a-zA-Z0-9_.-]+$/.test(filename)) {
      const resolved = path.resolve(BRANDING_DIR, filename);
      if (resolved.startsWith(BRANDING_DIR + path.sep) && fs.existsSync(resolved)) {
        res.json({
          hasCustomLogo: true,
          logoUrl: `/api/branding/logo/file?v=${encodeURIComponent(updatedAt || '1')}`,
        });
        return;
      }
    }

    res.json({ hasCustomLogo: false, logoUrl: null });
  });

  app.get('/api/branding/logo/file', (_req: Request, res: Response) => {
    const settings = getAppSettings();
    const filename = settings.company_logo_filename || '';
    if (!filename || !/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      res.status(404).send('No custom logo');
      return;
    }

    const resolved = path.resolve(BRANDING_DIR, filename);
    if (!resolved.startsWith(BRANDING_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).send('Not found');
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
        ? 'image/webp'
        : ext === '.svg'
        ? 'image/svg+xml'
        : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (contentType === 'image/svg+xml') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolved);
  });

  app.post(
    '/api/admin/branding/logo',
    requireAuth,
    requireRole(['Admin']),
    (req: AuthedRequest, res: Response) => {
      const { dataUrl } = req.body || {};
      const match = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i.exec(
        String(dataUrl || '').trim()
      );
      if (!match) {
        res
          .status(400)
          .json({ error: 'Format file logo harus PNG, JPG, WEBP, atau SVG.' });
        return;
      }

      const subtype = match[1].toLowerCase();
      const buf = Buffer.from(match[2], 'base64');
      if (buf.length === 0 || buf.length > 3 * 1024 * 1024) {
        res.status(400).json({ error: 'Ukuran file logo maksimal 3MB.' });
        return;
      }

      const ext =
        subtype === 'png'
          ? 'png'
          : subtype === 'webp'
          ? 'webp'
          : subtype === 'svg+xml'
          ? 'svg'
          : 'jpg';

      const stamp = Date.now().toString();
      const filename = `company_logo_${stamp}.${ext}`;
      const targetPath = path.resolve(BRANDING_DIR, filename);
      if (!targetPath.startsWith(BRANDING_DIR + path.sep)) {
        res.status(400).json({ error: 'Nama file tidak valid.' });
        return;
      }

      // Remove old logo file if any
      const prev = getAppSettings().company_logo_filename || '';
      if (prev && /^[a-zA-Z0-9_.-]+$/.test(prev)) {
        const prevPath = path.resolve(BRANDING_DIR, prev);
        if (prevPath.startsWith(BRANDING_DIR + path.sep) && fs.existsSync(prevPath)) {
          fs.unlinkSync(prevPath);
        }
      }

      fs.writeFileSync(targetPath, buf);

      const upsert = db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('company_logo_filename', filename);
      upsert.run('company_logo_updated_at', stamp);

      res.json({
        hasCustomLogo: true,
        logoUrl: `/api/branding/logo/file?v=${encodeURIComponent(stamp)}`,
      });
    }
  );

  app.delete(
    '/api/admin/branding/logo',
    requireAuth,
    requireRole(['Admin']),
    (_req: AuthedRequest, res: Response) => {
      const prev = getAppSettings().company_logo_filename || '';
      if (prev && /^[a-zA-Z0-9_.-]+$/.test(prev)) {
        const prevPath = path.resolve(BRANDING_DIR, prev);
        if (prevPath.startsWith(BRANDING_DIR + path.sep) && fs.existsSync(prevPath)) {
          fs.unlinkSync(prevPath);
        }
      }

      const upsert = db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('company_logo_filename', '');
      upsert.run('company_logo_updated_at', '');

      res.json({ hasCustomLogo: false, logoUrl: null });
    }
  );

  const httpServer = http.createServer(app);

  // ==================== VITE / STATIC SERVING ====================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) {
          next();
          return;
        }
        const startIdx = result.code.indexOf('const transport = normalizeModuleRunnerTransport(');
        const endIdx = result.code.indexOf('let willUnload = false;');
        let safeCode = result.code;
        if (startIdx !== -1 && endIdx > startIdx) {
          safeCode =
            result.code.slice(0, startIdx) +
            'const transport = normalizeModuleRunnerTransport({ connect() {}, disconnect() {}, send() {} });\n' +
            result.code.slice(endIdx);
        }
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(safeCode);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CV. Pangan Berkah Sentosa server listening on http://localhost:${PORT}`);
  });
}

startServer();
