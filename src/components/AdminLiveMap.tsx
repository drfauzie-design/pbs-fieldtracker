import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapPin, Search } from 'lucide-react';
import { LightboxPhoto, LivePin } from '../types';
import { formatDateTimeWIB, formatTimeWIB } from '../utils/format';

interface AdminLiveMapProps {
  pins: LivePin[];
  onOpenPhoto: (photo: LightboxPhoto) => void;
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const AdminLiveMap: React.FC<AdminLiveMapProps> = ({ pins, onOpenPhoto }) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const [pinQuery, setPinQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'Karyawan' | 'Leader/SPV'>('all');

  const filteredPins = useMemo(() => {
    const q = pinQuery.trim().toLowerCase();
    return pins.filter((p) => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (!q) return true;
      return (
        p.fullName.toLowerCase().includes(q) ||
        (p.leaderName || '').toLowerCase().includes(q) ||
        p.lastStatusLabel.toLowerCase().includes(q)
      );
    });
  }, [pins, pinQuery, roleFilter]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-6.2088, 106.8456], // Default Indonesia / Jakarta center
      zoom: 11,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    filteredPins.forEach((pin) => {
      const bg = pin.role === 'Leader/SPV' ? '#1E3A8A' : '#EA580C';
      const border = pin.checkedInToday ? '#F59E0B' : '#FFFFFF';
      const initials = pin.fullName
        .split(' ')
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() || '')
        .join('');

      const icon = L.divIcon({
        className: 'pbs-map-pin',
        html: `<div style="width:36px;height:36px;border-radius:9999px;background:${bg};border:3px solid ${border};color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(15,23,42,0.35);font-family:'Plus Jakarta Sans',sans-serif;">${escapeHtml(
          initials
        )}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18],
      });

      const marker = L.marker([pin.lat, pin.lng], { icon });

      const popupEl = document.createElement('div');
      popupEl.style.minWidth = '220px';
      popupEl.style.maxWidth = '260px';

      popupEl.innerHTML = `
        <div style="font-family:'Plus Jakarta Sans',sans-serif;color:#0F172A;">
          <div style="font-weight:800;font-size:14px;">${escapeHtml(pin.fullName)}</div>
          <div style="font-size:11px;color:#475569;margin-top:2px;">
            ${escapeHtml(pin.role)}${pin.leaderName ? ` · SPV: ${escapeHtml(pin.leaderName)}` : ''}
          </div>
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #E2E8F0;font-size:12px;">
            <div><strong>Update Terakhir:</strong> ${escapeHtml(formatTimeWIB(pin.lastGpsAt))}</div>
            <div style="margin-top:2px;"><strong>Aktivitas:</strong> ${escapeHtml(
              pin.lastStatusLabel || '-'
            )}</div>
          </div>
        </div>
      `;

      if (pin.lastPhotoUrl) {
        const imgBtn = document.createElement('button');
        imgBtn.type = 'button';
        imgBtn.style.cssText =
          'margin-top:8px;width:100%;border-radius:8px;overflow:hidden;border:1px solid #CBD5E1;cursor:pointer;padding:0;background:#0F172A;display:block;';
        const img = document.createElement('img');
        img.src = pin.lastPhotoUrl;
        img.alt = pin.fullName;
        img.style.cssText = 'width:100%;height:110px;object-fit:cover;display:block;';
        imgBtn.appendChild(img);

        const caption = document.createElement('div');
        caption.textContent = 'Klik untuk perbesar foto bukti';
        caption.style.cssText =
          'font-size:11px;font-weight:700;color:#F8FAFC;padding:4px 6px;text-align:center;';
        imgBtn.appendChild(caption);

        imgBtn.addEventListener('click', () => {
          onOpenPhoto({
            url: pin.lastPhotoUrl!,
            title: `${pin.fullName} · Foto Bukti Terakhir`,
            subtitle: `${pin.lastStatusLabel} · ${formatDateTimeWIB(pin.lastPhotoCapturedAt)}`,
            lat: pin.lat,
            lng: pin.lng,
          });
        });

        popupEl.appendChild(imgBtn);
      } else {
        const noPhoto = document.createElement('div');
        noPhoto.textContent = 'Belum ada foto bukti hari ini.';
        noPhoto.style.cssText = 'margin-top:8px;font-size:11px;color:#64748B;font-style:italic;';
        popupEl.appendChild(noPhoto);
      }

      const mapLink = document.createElement('a');
      mapLink.href = `https://www.google.com/maps?q=${pin.lat},${pin.lng}`;
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.textContent = 'Buka di Google Maps →';
      mapLink.style.cssText =
        'display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:#EA580C;text-decoration:none;';
      popupEl.appendChild(mapLink);

      marker.bindPopup(popupEl);
      marker.addTo(group);
      bounds.push([pin.lat, pin.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 15 });
    }
  }, [filteredPins, onOpenPhoto]);

  const handleFocusPin = (pin: LivePin) => {
    if (mapRef.current) {
      mapRef.current.setView([pin.lat, pin.lng], 16, { animate: true });
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-amber-400" />
          <div>
            <h2 className="text-sm sm:text-base font-extrabold">
              Peta Monitoring GPS Real-Time
            </h2>
            <p className="text-xs text-slate-300">
              {filteredPins.length} posisi karyawan aktif ditampilkan (OpenStreetMap)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={pinQuery}
              onChange={(e) => setPinQuery(e.target.value)}
              placeholder="Cari karyawan / status..."
              className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 text-xs font-medium text-white placeholder:text-slate-400 focus:border-orange-500 focus:outline-none"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-bold text-white focus:border-orange-500 focus:outline-none"
          >
            <option value="all">Semua Peran</option>
            <option value="Karyawan">Karyawan</option>
            <option value="Leader/SPV">Leader/SPV</option>
          </select>
        </div>
      </div>

      <div className="relative">
        <div ref={mapContainerRef} className="h-[320px] sm:h-[380px] w-full bg-slate-100" />
        {filteredPins.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/15 p-4">
            <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-xs sm:text-sm font-bold text-slate-800 shadow-md">
              Belum ada titik GPS karyawan yang masuk sesuai filter saat ini.
            </div>
          </div>
        )}
      </div>

      {filteredPins.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-xs font-bold text-slate-600 shrink-0">Lompat ke pin:</span>
          {filteredPins.map((pin) => (
            <button
              key={pin.userId}
              type="button"
              onClick={() => handleFocusPin(pin)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 hover:border-orange-600 hover:text-orange-700 whitespace-nowrap shrink-0"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  pin.role === 'Leader/SPV' ? 'bg-blue-900' : 'bg-orange-600'
                }`}
              />
              <span>{pin.fullName}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
