import React from 'react';
import { LogOut } from 'lucide-react';
import { User } from '../types';
import { CompanyLogo } from './CompanyLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface AppHeaderProps {
  user: User | null;
  logoUrl?: string | null;
  onLogout?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ user, logoUrl, onLogout }) => {
  return (
    <header className="sticky top-0 z-30 w-full border-b-2 border-orange-600 bg-white shadow-xs">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6">
        {/* Left Zone: User Controls & PWA Install */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-extrabold text-amber-400">
                  {user.fullName
                    .split(' ')
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase() || '')
                    .join('')}
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-xs sm:text-sm font-bold text-slate-950 max-w-[120px] sm:max-w-[200px]">
                    {user.fullName}
                  </div>
                  <div className="text-[11px] font-semibold text-orange-700 whitespace-nowrap">
                    {user.role}
                  </div>
                </div>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title="Keluar Akun"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-200 transition whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5 text-slate-700" />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              )}
            </>
          ) : (
            <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
              Portal Lapangan
            </span>
          )}
          <PWAInstallButton />
        </div>

        {/* Right Zone (Pojok Kanan Atas): Company Logo + Name on ALL pages */}
        <div className="flex items-center gap-2 shrink-0 ml-auto text-right">
          <CompanyLogo size="sm" logoUrl={logoUrl} />
          <span className="text-xs sm:text-base font-extrabold tracking-tight text-slate-950 whitespace-nowrap shrink-0">
            CV. Pangan Berkah Sentosa
          </span>
        </div>
      </div>
    </header>
  );
};
