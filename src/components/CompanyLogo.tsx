import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface CompanyLogoProps {
  size?: 'sm' | 'md' | 'lg';
  logoUrl?: string | null;
  className?: string;
}

const DEFAULT_LOGO_PATH = '/src/assets/images/logo_pangan_berkah_1795567493935.jpg';

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  size = 'sm',
  logoUrl,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const src = logoUrl || DEFAULT_LOGO_PATH;

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const sizeClass =
    size === 'lg'
      ? 'h-14 w-auto max-w-[160px] rounded-xl p-1'
      : size === 'md'
      ? 'h-11 w-auto max-w-[140px] rounded-xl p-0.5'
      : 'h-8 sm:h-9 w-auto max-w-[110px] sm:max-w-[140px] rounded-lg p-0.5';

  const fallbackSizeClass =
    size === 'lg'
      ? 'h-14 w-14 rounded-2xl'
      : size === 'md'
      ? 'h-11 w-11 rounded-xl'
      : 'h-8 w-8 rounded-lg';

  if (imgFailed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center border border-amber-400 bg-slate-900 text-orange-500 ${fallbackSizeClass} ${className}`}
        aria-label="Logo CV. Pangan Berkah Sentosa"
      >
        <ShieldCheck
          className={size === 'lg' ? 'h-8 w-8' : size === 'md' ? 'h-6 w-6' : 'h-4 w-4'}
        />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt="Logo CV. Pangan Berkah Sentosa"
      referrerPolicy="no-referrer"
      onError={() => setImgFailed(true)}
      className={`shrink-0 border border-amber-400/80 bg-white object-contain shadow-xs ${sizeClass} ${className}`}
    />
  );
};
