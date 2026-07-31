import { useQueryClient } from '@tanstack/react-query';

/**
 * Returns a callback that invalidates every query a list mutation can stale: the priced view,
 * the list detail, and the lists index (item counts / updated_at). Use as the onSuccess of any
 * mutation that touches a list's items, groups, or fits.
 */
export function useInvalidateList(listId: number): () => void {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['priced', listId] });
    qc.invalidateQueries({ queryKey: ['list-detail', listId] });
    qc.invalidateQueries({ queryKey: ['lists'] });
  };
}
