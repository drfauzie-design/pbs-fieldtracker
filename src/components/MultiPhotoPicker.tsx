import React, { useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { GpsPosition } from '../hooks/useGeolocation';
import { LightboxPhoto } from '../types';
import { stampImageFileWithWatermark } from '../utils/watermark';

export interface StagedPhoto {
  dataUrl: string;
  capturedAt: string;
}

interface MultiPhotoPickerProps {
  label: string;
  helperText?: string;
  photos: StagedPhoto[];
  onChange: (next: StagedPhoto[]) => void;
  maxPhotos?: number;
  userName: string;
  activityLabel: string;
  gpsPosition: GpsPosition | null;
  onOpenCamera: () => void;
  onOpenPhoto?: (photo: LightboxPhoto) => void;
}

export const MultiPhotoPicker: React.FC<MultiPhotoPickerProps> = ({
  label,
  helperText,
  photos,
  onChange,
  maxPhotos = 8,
  userName,
  activityLabel,
  gpsPosition,
  onOpenCamera,
  onOpenPhoto,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const remainingSlots = Math.max(0, maxPhotos - photos.length);
    const chosen = files.slice(0, remainingSlots);
    if (chosen.length === 0) return;

    setProcessing(true);
    try {
      const stamped: StagedPhoto[] = [];
      for (const file of chosen) {
        const res = await stampImageFileWithWatermark(
          file,
          userName,
          activityLabel,
          gpsPosition
        );
        stamped.push(res);
      }
      onChange([...photos, ...stamped]);
    } catch {
      // Ignore invalid image file
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="block text-sm font-bold text-slate-900">
          {label}{' '}
          <span className="font-mono text-xs font-semibold text-slate-500">
            ({photos.length}/{maxPhotos})
          </span>
        </label>
        {helperText && <span className="text-xs text-slate-600">{helperText}</span>}
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
          {photos.map((p, idx) => (
            <div
              key={`${p.capturedAt}_${idx}`}
              className="group relative aspect-square overflow-hidden rounded-xl border border-slate-300 bg-slate-950"
            >
              <button
                type="button"
                onClick={() =>
                  onOpenPhoto?.({
                    url: p.dataUrl,
                    title: `${userName} · ${activityLabel}`,
                    subtitle: `Foto #${idx + 1}`,
                    lat: gpsPosition?.lat,
                    lng: gpsPosition?.lng,
                  })
                }
                className="h-full w-full"
              >
                <img
                  src={p.dataUrl}
                  alt={`Lampiran foto ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, i) => i !== idx))}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-red-600/90 text-white shadow-sm hover:bg-red-700"
                title="Hapus foto"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />

      {photos.length < maxPhotos && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onOpenCamera}
            className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50/60 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-orange-800 hover:bg-orange-100/70 transition"
          >
            <Camera className="h-4 w-4 text-orange-600" />
            <span>Ambil Foto Kamera</span>
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-60 transition"
          >
            <ImagePlus className="h-4 w-4 text-slate-700" />
            <span>{processing ? 'Memberi Stempel...' : 'Upload Multi-Foto (File)'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
