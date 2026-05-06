'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function PendingSuggestionsBadge() {
  const { data } = useQuery({
    queryKey: ['suggestions', 'count-pending'],
    queryFn: () => api<{ count: number }>('/suggestions/count-pending'),
    refetchInterval: 8_000,
  });
  if (!data || data.count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-teal px-2 py-0.5 text-[10px] font-bold text-white">
      {data.count}
    </span>
  );
}
