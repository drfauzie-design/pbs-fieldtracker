import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { LightboxPhoto } from '../types';

interface PhotoLightboxModalProps {
  photo: LightboxPhoto | null;
  onClose: () => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({ photo, onClose }) => {
  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
          <div className="min-w-0">
            <h3 className="truncate text-sm sm:text-base font-bold">{photo.title}</h3>
            {photo.subtitle && (
              <p className="mt-0.5 text-xs text-amber-400 font-mono tabular-nums">
                {photo.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-slate-950 flex items-center justify-center max-h-[65vh]">
          <img
            src={photo.url}
            alt={photo.title}
            className="max-h-[65vh] w-full object-contain"
          />
        </div>

        {(photo.notes || (photo.lat !== undefined && photo.lng !== undefined)) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs sm:text-sm text-slate-800">
            <div className="min-w-0 flex-1">
              {photo.notes && (
                <p className="text-slate-700">
                  <span className="font-bold text-slate-950">Catatan:</span> {photo.notes}
                </p>
              )}
              {photo.lat !== undefined && photo.lng !== undefined && (
                <p className="mt-0.5 font-mono text-xs text-slate-600 tabular-nums">
                  Koordinat: {photo.lat.toFixed(6)}, {photo.lng.toFixed(6)}
                </p>
              )}
            </div>
            {photo.lat !== undefined && photo.lng !== undefined && (
              <a
                href={`https://www.google.com/maps?q=${photo.lat},${photo.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5 text-amber-400" />
                <span>Lihat di Google Maps</span>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
