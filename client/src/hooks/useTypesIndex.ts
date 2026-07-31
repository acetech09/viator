import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { api } from '../api';

/** [type_id, name] — a trailing 1 marks a demoted type (cosmetic/skin/blueprint). */
export type TypeIndexEntry = [number, string, number?];

export interface TypesIndex {
  entries: TypeIndexEntry[];
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
      // Two buckets, each keeping uFuzzy's relative order: ordinary matches, then demoted
      // ones (skins/apparel/blueprints). A hull whose name is shared by 40 SKINs must not be
      // pushed off the end of the list, so demoted hits only fill what's left over.
      const primary: Array<{ type_id: number; name: string }> = [];
      const demoted: Array<{ type_id: number; name: string }> = [];
      const push = (haystackIdx: number | undefined) => {
        const entry = haystackIdx === undefined ? undefined : entries[haystackIdx];
        if (entry) (entry[2] ? demoted : primary).push({ type_id: entry[0], name: entry[1] });
      };
      // Once both buckets can fill the limit on their own, nothing further can change the result.
      const enough = () => primary.length >= limit && demoted.length >= limit;
      if (idxs && info && order) {
        // Ranked: order indexes into info arrays; info.idx maps to the haystack index.
        for (let i = 0; i < order.length && !enough(); i++) {
          push(info.idx[order[i]!]);
        }
      } else if (idxs) {
        // Unranked (too many matches): idxs are haystack indices directly.
        for (let i = 0; i < idxs.length && !enough(); i++) {
          push(idxs[i]);
        }
      }
      return primary.concat(demoted).slice(0, limit);
    };

    return { entries, names, byName, search };
  }, [query.data]);

  return { index, isLoading: query.isLoading };
}
