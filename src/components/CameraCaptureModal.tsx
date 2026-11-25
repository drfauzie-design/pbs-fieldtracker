import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { GpsPosition } from '../hooks/useGeolocation';
import { stampCanvasWithWatermark } from '../utils/watermark';

interface CameraCaptureModalProps {
  isOpen: boolean;
  title: string;
  userName: string;
  activityLabel: string;
  gpsPosition: GpsPosition | null;
  allowFileUpload?: boolean;
  onConfirm: (watermarkedDataUrl: string, capturedAtIso: string) => void;
  onClose: () => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  title,
  userName,
  activityLabel,
  gpsPosition,
  allowFileUpload = false,
  onConfirm,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string>('');
  const [cameraReady, setCameraReady] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [capturedIso, setCapturedIso] = useState<string>('');

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    stopStream();
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Browser tidak mendukung akses kamera langsung. Gunakan tombol Kamera Perangkat di bawah.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setCameraError(
        'Kamera langsung belum diizinkan atau sedang dipakai aplikasi lain. Anda tetap dapat mengambil foto langsung menggunakan tombol Kamera Perangkat di bawah.'
      );
    }
  }, [stopStream]);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      setPreviewDataUrl(null);
      setCameraError('');
      return;
    }
    if (!previewDataUrl) {
      startCamera(facingMode);
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, previewDataUrl, startCamera, stopStream]);

  const stampImageOnCanvas = useCallback(
    (source: HTMLVideoElement | HTMLImageElement, srcWidth: number, srcHeight: number) => {
      const { dataUrl, capturedAt } = stampCanvasWithWatermark(
        source,
        srcWidth,
        srcHeight,
        userName,
        activityLabel,
        gpsPosition
      );
      setCapturedIso(capturedAt);
      setPreviewDataUrl(dataUrl);
      stopStream();
    },
    [gpsPosition, userName, activityLabel, stopStream]
  );

  const handleLiveCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    stampImageOnCanvas(video, video.videoWidth, video.videoHeight);
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        stampImageOnCanvas(img, img.naturalWidth, img.naturalHeight);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white">{title}</h3>
            <p className="text-xs text-amber-400">
              {allowFileUpload
                ? 'Kamera / Lampiran Foto · Stempel Waktu & GPS Otomatis'
                : 'Kamera Langsung Wajib · Stempel Waktu & GPS Otomatis'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
            aria-label="Tutup Kamera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Viewport */}
        <div className="relative flex min-h-[280px] sm:min-h-[340px] items-center justify-center bg-black">
          {previewDataUrl ? (
            <img
              src={previewDataUrl}
              alt="Hasil foto bukti berstempel"
              className="max-h-[60vh] w-full object-contain"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className={`max-h-[60vh] w-full object-cover ${cameraReady ? 'block' : 'hidden'}`}
              />
              {!cameraReady && (
                <div className="p-6 text-center">
                  <Camera className="mx-auto h-10 w-10 text-orange-500" />
                  <p className="mt-3 text-sm text-slate-200">
                    {cameraError || 'Menghubungkan ke kamera perangkat...'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Hidden strict camera-only input fallback */}
        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture={facingMode === 'environment' ? 'environment' : 'user'}
          onChange={handleImageFile}
          className="hidden"
        />

        {/* Optional gallery/file input only when explicitly permitted */}
        {allowFileUpload && (
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageFile}
            className="hidden"
          />
        )}

        {/* Bottom Controls */}
        <div className="border-t border-slate-800 bg-slate-900 p-4">
          {previewDataUrl ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPreviewDataUrl(null)}
                className="flex flex-1 min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Foto Ulang</span>
              </button>
              <button
                type="button"
                onClick={() => onConfirm(previewDataUrl, capturedIso)}
                className="flex flex-1 min-h-[48px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-700"
              >
                <Check className="h-4 w-4" />
                <span>Gunakan Foto</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                  }
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-100 hover:bg-slate-700 shrink-0"
                >
                  <RefreshCw className="h-4 w-4 text-amber-400" />
                  <span>{facingMode === 'environment' ? 'Kamera Depan' : 'Kamera Belakang'}</span>
                </button>

                {cameraReady ? (
                  <button
                    type="button"
                    onClick={handleLiveCapture}
                    className="flex flex-1 min-h-[48px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg hover:bg-orange-700"
                  >
                    <Camera className="h-5 w-5" />
                    <span>Ambil Foto Bukti</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => captureInputRef.current?.click()}
                    className="flex flex-1 min-h-[48px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg hover:bg-orange-700"
                  >
                    <Camera className="h-5 w-5" />
                    <span>Buka Kamera HP</span>
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {cameraReady && (
                  <button
                    type="button"
                    onClick={() => captureInputRef.current?.click()}
                    className="text-center text-xs font-medium text-slate-400 hover:text-slate-200 underline underline-offset-2 py-1"
                  >
                    Kamera bawaan HP ({facingMode === 'environment' ? 'Belakang' : 'Depan'})
                  </button>
                )}
                {allowFileUpload && (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-slate-800 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-slate-700"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    <span>Unggah dari File / Galeri</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
