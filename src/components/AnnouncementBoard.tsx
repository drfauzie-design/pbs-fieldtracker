import React, { useState } from 'react';
import { AlertCircle, Bell, ChevronDown, ChevronUp, Megaphone, Pin } from 'lucide-react';
import { Announcement } from '../types';
import { formatDateTimeWIB } from '../utils/format';

interface AnnouncementBoardProps {
  announcements: Announcement[];
  loading?: boolean;
}

export const AnnouncementBoard: React.FC<AnnouncementBoardProps> = ({
  announcements,
  loading,
}) => {
  const [expanded, setExpanded] = useState(true);

  if (loading && announcements.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-amber-400 bg-white shadow-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full min-h-[48px] items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-left text-white hover:bg-slate-800 transition"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Megaphone className="h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
              Papan Pengumuman Perusahaan
            </h2>
            <p className="text-[11px] text-slate-300">
              {announcements.length > 0
                ? `${announcements.length} pengumuman aktif dari Admin`
                : 'Belum ada pengumuman aktif saat ini'}
            </p>
          </div>
        </div>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-amber-400">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="p-4">
          {announcements.length === 0 ? (
            <p className="text-xs sm:text-sm text-slate-600">
              Belum ada pengumuman terbaru dari Admin CV. Pangan Berkah Sentosa.
            </p>
          ) : (
            <div className="space-y-3">
              {announcements.map((item) => {
                const isUrgent = item.priority === 'Mendesak';
                const isImportant = item.priority === 'Penting';

                return (
                  <article
                    key={item.id}
                    className={`rounded-xl border p-3.5 ${
                      isUrgent
                        ? 'border-red-300 bg-red-50/70'
                        : isImportant
                        ? 'border-amber-300 bg-amber-50/60'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isUrgent ? (
                          <AlertCircle className="h-4 w-4 shrink-0 text-red-700" />
                        ) : isImportant ? (
                          <Bell className="h-4 w-4 shrink-0 text-amber-700" />
                        ) : (
                          <Megaphone className="h-4 w-4 shrink-0 text-slate-700" />
                        )}
                        <h3 className="text-sm font-extrabold text-slate-950">{item.title}</h3>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-bold shrink-0">
                        {item.isPinned && (
                          <span className="inline-flex items-center gap-1 text-orange-700">
                            <Pin className="h-3.5 w-3.5" />
                            <span>Disematkan</span>
                          </span>
                        )}
                        <span
                          className={
                            isUrgent
                              ? 'text-red-700'
                              : isImportant
                              ? 'text-amber-800'
                              : 'text-slate-700'
                          }
                        >
                          {item.priority}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 whitespace-pre-line text-xs sm:text-sm leading-relaxed text-slate-800">
                      {item.content}
                    </p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
                      <span>Oleh: {item.authorName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatDateTimeWIB(item.createdAt)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
