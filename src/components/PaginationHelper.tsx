import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function PaginatedTbody({ items, renderItem, itemsPerPage = 10 }) {
  const [page, setPage] = useState(1);
  
  // Reset page if items change drastically
  useEffect(() => {
    setPage(1);
  }, [items.length]);

  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);

  if (items.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={100} className="text-center py-8 text-sm text-[var(--text-muted)] italic">No hay registros</td>
        </tr>
      </tbody>
    );
  }

  return (
    <>
      <tbody>
        {visibleItems.map((item, index) => renderItem(item, startIndex + index))}
      </tbody>
      {totalPages > 1 && (
        <tbody>
          <tr>
            <td colSpan={100} className="p-0 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between p-4 bg-[var(--bg-surface)]/95">
                <span className="text-sm text-[var(--text-muted)]">
                  Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, items.length)} de {items.length}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg bg-[var(--bg-base)] hover:bg-[var(--border-color)] disabled:opacity-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4 text-[var(--text-primary)]" />
                  </button>
                  <span className="text-sm font-medium text-[var(--text-primary)]">Pág {page} de {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg bg-[var(--bg-base)] hover:bg-[var(--border-color)] disabled:opacity-50 transition"
                  >
                    <ChevronRight className="w-4 h-4 text-[var(--text-primary)]" />
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      )}
    </>
  );
}

export function PaginatedGrid({ items, renderItem, itemsPerPage = 10, className = "" }) {
  const [page, setPage] = useState(1);
  
  useEffect(() => {
    setPage(1);
  }, [items.length]);

  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);

  if (items.length === 0) {
    return <div className="text-center py-8 text-sm text-[var(--text-muted)] italic w-full">No hay elementos</div>;
  }

  return (
    <div className="w-full flex flex-col space-y-4">
      <div className={className}>
        {visibleItems.map((item, index) => renderItem(item, startIndex + index))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-4 bg-[var(--bg-surface)]/95 border-t border-[var(--border-color)] rounded-b-2xl">
          <span className="text-sm text-[var(--text-muted)]">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, items.length)} de {items.length}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg bg-[var(--bg-base)] hover:bg-[var(--border-color)] disabled:opacity-50 transition"
            >
              <ChevronLeft className="w-4 h-4 text-[var(--text-primary)]" />
            </button>
            <span className="text-sm font-medium text-[var(--text-primary)]">Pág {page} de {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg bg-[var(--bg-base)] hover:bg-[var(--border-color)] disabled:opacity-50 transition"
            >
              <ChevronRight className="w-4 h-4 text-[var(--text-primary)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
