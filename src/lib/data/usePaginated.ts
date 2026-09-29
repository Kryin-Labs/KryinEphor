import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../supabase';

interface PaginatedOptions {
    key: readonly unknown[];
    table: string;
    columns?: string;
    pageSize?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apply?: (q: any) => any;
    enabled?: boolean;
}

/**
 * Generic server-side pagination hook using PostgREST `.range()` + exact count.
 * Keeps previous page data during navigation so UI doesn't flash.
 */
export function usePaginated<T>({ key, table, columns = '*', pageSize = 25, apply, enabled = true }: PaginatedOptions) {
    const [page, setPage] = useState(0);

    const query = useQuery({
        queryKey: [...key, page, pageSize],
        enabled,
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let q: any = supabase.from(table).select(columns, { count: 'exact' }).range(from, to);
            if (apply) q = apply(q);
            const { data, count, error } = await q;
            if (error) throw error;
            return { rows: (data ?? []) as T[], total: count ?? 0 };
        },
    });

    const total = query.data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    return {
        rows: query.data?.rows ?? [],
        total,
        page,
        pageSize,
        pageCount,
        setPage,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: query.error,
        refetch: query.refetch,
    };
}
