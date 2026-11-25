import React, { useState } from 'react';
import { Lock, Phone, ShieldCheck, User as UserIcon } from 'lucide-react';
import { User } from '../types';
import { apiFetch, setAuthToken } from '../utils/api';
import { phoneToDummyEmailClient } from '../utils/format';
import { CompanyLogo } from './CompanyLogo';

interface AuthScreenProps {
  needsAdminSetup: boolean;
  logoUrl?: string | null;
  onAuthenticated: (user: User) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  needsAdminSetup,
  logoUrl,
  onAuthenticated,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resolvedAlias = phoneToDummyEmailClient(phone);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = needsAdminSetup ? '/api/auth/bootstrap-admin' : '/api/auth/login';
      const body = needsAdminSetup
        ? { fullName, phone, password }
        : { phone, password };

      const res = await apiFetch<{ token: string; user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Gagal masuk. Periksa Nomor HP dan Kata Sandi Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-6xl items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl lg:grid-cols-12">
        {/* Left Brand Context Panel */}
        <div className="flex flex-col justify-between bg-slate-900 p-6 sm:p-8 text-white lg:col-span-5">
          <div>
            <div className="flex items-center gap-3.5 border-b border-amber-500/40 pb-4">
              <CompanyLogo size="lg" logoUrl={logoUrl} />
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide text-amber-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Sistem Operasional Lapangan</span>
                </div>
                <div className="mt-0.5 text-sm font-extrabold text-white">
                  CV. Pangan Berkah Sentosa
                </div>
              </div>
            </div>
            <h1 className="mt-5 text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight text-balance">
              {needsAdminSetup
                ? 'Aktivasi Akun Admin Utama'
                : 'Masuk Portal Karyawan & Monitoring'}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              {needsAdminSetup
                ? 'Buat akun Admin pertama untuk mengelola karyawan lapangan, master produk, target penjualan, dan pemantauan GPS real-time.'
                : 'Masuk menggunakan Nomor HP dan Kata Sandi yang telah didaftarkan Admin. Tanpa OTP SMS, cepat dan siap digunakan di lapangan.'}
            </p>
          </div>

          <div className="mt-8 border-t border-slate-800 pt-4 text-xs text-slate-400">
            <p className="font-bold text-white">CV. Pangan Berkah Sentosa</p>
            <p className="mt-1">
              Kehadiran GPS · Foto Kamera Berstempel · Laporan Penjualan · Target Tim
            </p>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="p-6 sm:p-8 lg:col-span-7">
          <h2 className="text-xl font-extrabold text-slate-950">
            {needsAdminSetup ? 'Registrasi Admin Pertama' : 'Login Nomor HP'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {needsAdminSetup
              ? 'Form ini hanya muncul sekali saat sistem pertama kali disiapkan.'
              : 'Masukkan Nomor HP aktif Anda beserta kata sandi.'}
          </p>

          {error && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {needsAdminSetup && (
              <div>
                <label className="block text-sm font-bold text-slate-900">
                  Nama Lengkap Admin
                </label>
                <div className="relative mt-1.5">
                  <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-900">
                Nomor HP
              </label>
              <div className="relative mt-1.5">
                <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="tel"
                  inputMode="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Contoh: 081234567890"
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white pl-10 pr-4 font-mono text-sm font-medium text-slate-950 tabular-nums focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
                />
              </div>
              {resolvedAlias && (
                <p className="mt-1.5 text-xs text-slate-600 font-mono">
                  Identitas sistem otomatis: <span className="font-semibold text-slate-900">{resolvedAlias}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-900">
                Kata Sandi
              </label>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm font-medium text-slate-950 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full min-h-[50px] rounded-xl bg-orange-600 px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60 active:scale-[0.99] transition"
            >
              {loading
                ? 'Memproses...'
                : needsAdminSetup
                ? 'Aktifkan Akun Admin & Masuk'
                : 'Masuk Sekarang'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
