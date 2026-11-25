import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';

export type GpsState = 'locating' | 'active' | 'denied' | 'unavailable';

export interface GpsPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  updatedAt: string;
}

export function useGeolocation(enabled: boolean, autoPingEnabled: boolean) {
  const [status, setStatus] = useState<GpsState>('locating');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [position, setPosition] = useState<GpsPosition | null>(null);
  const [lastPingAt, setLastPingAt] = useState<string | null>(null);
  const latestPosRef = useRef<GpsPosition | null>(null);

  const handleSuccess = useCallback((pos: GeolocationPosition) => {
    const next: GpsPosition = {
      lat: Number(pos.coords.latitude.toFixed(6)),
      lng: Number(pos.coords.longitude.toFixed(6)),
      accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
      updatedAt: new Date().toISOString(),
    };
    latestPosRef.current = next;
    setPosition(next);
    setStatus('active');
    setErrorMessage('');
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      setStatus('denied');
      setErrorMessage('Izin akses lokasi GPS ditolak. Aktifkan lokasi di pengaturan browser/HP.');
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      setStatus('unavailable');
      setErrorMessage('Sinyal GPS tidak tersedia. Pastikan GPS HP aktif di area terbuka.');
    } else {
      setStatus('unavailable');
      setErrorMessage('Waktu tunggu GPS habis. Tekan Muat Ulang GPS untuk mencoba lagi.');
    }
  }, []);

  const refreshPosition = useCallback((): Promise<GpsPosition> => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setStatus('unavailable');
        setErrorMessage('Perangkat/browser ini tidak mendukung GPS.');
        reject(new Error('GPS tidak didukung oleh perangkat.'));
        return;
      }
      setStatus((prev) => (prev === 'active' ? 'active' : 'locating'));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next: GpsPosition = {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
            updatedAt: new Date().toISOString(),
          };
          latestPosRef.current = next;
          setPosition(next);
          setStatus('active');
          setErrorMessage('');
          resolve(next);
        },
        (err) => {
          handleError(err);
          if (latestPosRef.current) {
            resolve(latestPosRef.current);
          } else {
            reject(new Error('Gagal mengambil koordinat GPS.'));
          }
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
      );
    });
  }, [handleError]);

  // Watch position while enabled
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setErrorMessage('Perangkat tidak mendukung GPS.');
      return;
    }

    setStatus('locating');
    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, handleSuccess, handleError]);

  // 30-second automatic GPS ping to database
  useEffect(() => {
    if (!enabled || !autoPingEnabled) return;

    const sendPing = async () => {
      const pos = latestPosRef.current;
      if (!pos || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      try {
        const res = await apiFetch<{ syncedAt: string }>('/api/gps/ping', {
          method: 'POST',
          body: JSON.stringify({
            lat: pos.lat,
            lng: pos.lng,
            accuracy: pos.accuracy,
          }),
        });
        setLastPingAt(res.syncedAt);
      } catch {
        // Silent retry on next 30s interval
      }
    };

    // Initial ping shortly after GPS locks, then every 30 seconds
    const initialTimer = setTimeout(sendPing, 2500);
    const interval = setInterval(sendPing, 30000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [enabled, autoPingEnabled]);

  return {
    status,
    errorMessage,
    position,
    lastPingAt,
    refreshPosition,
  };
}
