import { GpsPosition } from '../hooks/useGeolocation';

export function stampCanvasWithWatermark(
  source: HTMLVideoElement | HTMLImageElement,
  srcWidth: number,
  srcHeight: number,
  userName: string,
  activityLabel: string,
  gpsPosition: GpsPosition | null
): { dataUrl: string; capturedAt: string } {
  const maxWidth = 1080;
  const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
  const w = Math.max(1, Math.round(srcWidth * scale));
  const h = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal membuat kanvas gambar.');
  }

  ctx.drawImage(source, 0, 0, w, h);

  const now = new Date();
  const iso = now.toISOString();
  const dateTimeText =
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now) + ' WIB';

  const gpsText = gpsPosition
    ? `GPS: ${gpsPosition.lat.toFixed(6)}, ${gpsPosition.lng.toFixed(6)}${
        gpsPosition.accuracy !== null ? ` (±${gpsPosition.accuracy}m)` : ''
      }`
    : 'GPS: Koordinat sedang diperbarui';

  const barHeight = Math.max(96, Math.round(h * 0.16));
  ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
  ctx.fillRect(0, h - barHeight, w, barHeight);

  ctx.fillStyle = '#EA580C';
  ctx.fillRect(0, h - barHeight, w, 4);

  const padX = Math.round(w * 0.03);
  const baseFontSize = Math.max(14, Math.round(w * 0.022));

  ctx.fillStyle = '#F59E0B';
  ctx.font = `700 ${baseFontSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillText('CV. PANGAN BERKAH SENTOSA', padX, h - barHeight + baseFontSize + 10);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${Math.round(baseFontSize * 0.92)}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillText(
    `${userName} · ${activityLabel}`,
    padX,
    h - barHeight + baseFontSize * 2 + 16
  );

  ctx.fillStyle = '#E2E8F0';
  ctx.font = `500 ${Math.round(baseFontSize * 0.85)}px "JetBrains Mono", monospace`;
  ctx.fillText(
    `${dateTimeText} | ${gpsText}`,
    padX,
    h - barHeight + baseFontSize * 3 + 22
  );

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    capturedAt: iso,
  };
}

export function stampImageFileWithWatermark(
  file: File,
  userName: string,
  activityLabel: string,
  gpsPosition: GpsPosition | null
): Promise<{ dataUrl: string; capturedAt: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak valid.'));
      img.onload = () => {
        try {
          resolve(
            stampCanvasWithWatermark(
              img,
              img.naturalWidth,
              img.naturalHeight,
              userName,
              activityLabel,
              gpsPosition
            )
          );
        } catch (err) {
          reject(err);
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
