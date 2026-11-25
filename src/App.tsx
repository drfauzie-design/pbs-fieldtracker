import { useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AppHeader } from './components/AppHeader';
import { AuthScreen } from './components/AuthScreen';
import { FieldWorkspace } from './components/FieldWorkspace';
import { PhotoLightboxModal } from './components/PhotoLightboxModal';
import { LightboxPhoto, User } from './types';
import { apiFetch, setAuthToken } from './utils/api';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<LightboxPhoto | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [bootRes, logoRes] = await Promise.all([
          apiFetch<{ needsAdminSetup: boolean }>('/api/auth/bootstrap-status'),
          apiFetch<{ hasCustomLogo: boolean; logoUrl: string | null }>('/api/branding/logo'),
        ]);
        if (active) {
          setNeedsAdminSetup(bootRes.needsAdminSetup);
          setCustomLogoUrl(logoRes.logoUrl || null);
        }
      } catch {
        // ignore if offline on boot
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore network error on logout
    }
    setAuthToken(null);
    setUser(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      {/* Persistent Header on ALL pages with CV. Pangan Berkah Sentosa in top-right corner */}
      <AppHeader
        user={user}
        logoUrl={customLogoUrl}
        onLogout={user ? handleLogout : undefined}
      />

      {booting ? (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
          <div className="text-sm font-bold text-slate-600">Memuat sistem...</div>
        </div>
      ) : !user ? (
        <AuthScreen
          needsAdminSetup={needsAdminSetup}
          logoUrl={customLogoUrl}
          onAuthenticated={(loggedInUser) => {
            setNeedsAdminSetup(false);
            setUser(loggedInUser);
          }}
        />
      ) : user.role === 'Admin' ? (
        <AdminDashboard
          currentUser={user}
          logoUrl={customLogoUrl}
          onLogoUpdated={setCustomLogoUrl}
          onOpenPhoto={setLightboxPhoto}
        />
      ) : (
        <FieldWorkspace user={user} onOpenPhoto={setLightboxPhoto} />
      )}

      <PhotoLightboxModal photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
    </div>
  );
}
