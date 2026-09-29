import React from 'react';
import { AlertTriangle, Loader2, Inbox, type LucideIcon } from 'lucide-react';
import EmptyState from './EmptyState';
import SectionSkeleton from './SectionSkeleton';

interface QueryLike<T> {
    data: T | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
}

interface Props<T> {
    query: QueryLike<T>;
    /** Return true when the fetched data should render an empty state */
    isEmpty?: (data: T) => boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyIcon?: LucideIcon;
    loadingRows?: number;
    loadingHeight?: number;
    children: (data: T) => React.ReactNode;
}

function QueryBoundary<T>({
    query, isEmpty, emptyTitle = 'Nothing to show yet',
    emptyDescription, emptyIcon = Inbox,
    loadingRows = 3, loadingHeight = 56, children,
}: Props<T>) {
    if (query.isLoading) return <SectionSkeleton rows={loadingRows} height={loadingHeight} />;

    if (query.isError) {
        const msg = query.error instanceof Error ? query.error.message : 'Something went wrong loading this section.';
        return (
            <EmptyState
                icon={AlertTriangle}
                title="Couldn't load"
                description={msg}
                action={
                    <button
                        onClick={() => query.refetch()}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                        <Loader2 className="w-3.5 h-3.5" /> Retry
                    </button>
                }
            />
        );
    }

    const data = query.data as T;
    if (data === undefined || data === null) {
        return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
    }
    if (isEmpty && isEmpty(data)) {
        return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
    }

    return <>{children(data)}</>;
}

export default QueryBoundary;
