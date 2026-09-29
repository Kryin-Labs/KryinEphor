import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
    page: number;
    pageCount: number;
    total: number;
    onPageChange: (p: number) => void;
    isFetching?: boolean;
}

const Pagination: React.FC<Props> = ({ page, pageCount, total, onPageChange, isFetching }) => {
    if (total === 0) return null;
    return (
        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <p className="text-xs text-muted font-semibold">
                Page <span className="text-foreground">{page + 1}</span> of {pageCount}
                <span className="text-stone-400"> · {total} total{isFetching ? ' · updating…' : ''}</span>
            </p>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="w-9 h-9 rounded-lg border border-gray-200 bg-white hover:bg-stone-50 disabled:opacity-40 flex items-center justify-center transition"
                    aria-label="Previous page"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
                    disabled={page >= pageCount - 1}
                    className="w-9 h-9 rounded-lg border border-gray-200 bg-white hover:bg-stone-50 disabled:opacity-40 flex items-center justify-center transition"
                    aria-label="Next page"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default Pagination;
