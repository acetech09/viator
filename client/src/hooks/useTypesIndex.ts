import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { api } from '../api';

export interface TypesIndex {
  entries: Array<[number, string]>; // [type_id, name]
  names: string[]; // parallel array for uFuzzy
  byName: Map<string, number>; // lowercased name -> type_id (exact resolution)
  search: (needle: string, limit?: number) => Array<{ type_id: number; name: string }>;
}

export function useTypesIndex() {
  const query = useQuery({
    queryKey: ['types-index'],
    queryFn: api.typesIndex,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const index = useMemo<TypesIndex | null>(() => {
    if (!query.data) return null;
    const entries = query.data;
    const names = entries.map((e) => e[1]);
    const byName = new Map<string, number>();
    for (const [id, name] of entries) byName.set(name.toLowerCase(), id);

    const uf = new uFuzzy({ intraMode: 1, intraIns: 1 });

    const search = (needle: string, limit = 12) => {
      const trimmed = needle.trim();
      if (trimmed.length < 2) return [];
      const [idxs, info, order] = uf.search(names, trimmed, 0, 1e6);
      const results: Array<{ type_id: number; name: string }> = [];
      const push = (haystackIdx: number | undefined) => {
        const entry = haystackIdx === undefined ? undefined : entries[haystackIdx];
        if (entry) results.push({ type_id: entry[0], name: entry[1] });
      };
      if (idxs && info && order) {
        // Ranked: order indexes into info arrays; info.idx maps to the haystack index.
        for (let i = 0; i < order.length && results.length < limit; i++) {
          push(info.idx[order[i]!]);
        }
      } else if (idxs) {
        // Unranked (too many matches): idxs are haystack indices directly.
        for (let i = 0; i < idxs.length && results.length < limit; i++) {
          push(idxs[i]);
        }
      }
      return results;
    };

    return { entries, names, byName, search };
  }, [query.data]);

  return { index, isLoading: query.isLoading };
}
