export function formatRupiah(amount: number): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatTimeWIB(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d) + ' WIB'
  );
}

export function formatDateID(isoOrKey: string | null | undefined): string {
  if (!isoOrKey) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrKey)) {
    const [y, m, d] = isoOrKey.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(isoOrKey);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatDateTimeWIB(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d) + ' WIB'
  );
}

export function getTodayDateKeyJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

export function normalizePhoneClient(raw: string): string {
  let digits = String(raw || '').replace(/\D+/g, '');
  if (digits.startsWith('62') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

export function phoneToDummyEmailClient(raw: string): string {
  const norm = normalizePhoneClient(raw);
  return norm ? `${norm}@app.local` : '';
}

export function sanitizeFilenamePart(text: string): string {
  return String(text || 'User')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

export function formatTimeForZipFilename(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '00-00-00';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/:/g, '-');
  return parts;
}
