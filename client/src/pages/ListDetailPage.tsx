import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ListTable } from '../components/list-table/ListTable';
import { AddTab } from '../components/AddTab';
import { AddFitsTab } from '../components/AddFitsTab';
import { ExistingStockTab } from '../components/existing-stock/ExistingStockTab';
import { HaulingCheckTab } from '../components/HaulingCheckTab';
import { EditableText } from '../components/EditableText';
import type { HaulingCheck, LoadedLine } from '../components/list-table/MissingView';

type SubTab = 'items' | 'fits' | 'stock' | 'hauling';

export function ListDetailPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams();
  const listId = Number(id);
  const [tab, setTab] = useState<SubTab>('items');

  // Hauling check: text + result live here (not in the tab) so they survive subtab switches;
  // ListTable consumes the result as its "Missing items" tab. The route component stays mounted
  // across list navigations, so reset per-list.
  const [haulingText, setHaulingText] = useState('');
  const [haulingCheck, setHaulingCheck] = useState<HaulingCheck | null>(null);
  useEffect(() => {
    setHaulingText('');
    setHaulingCheck(null);
  }, [listId]);

  const detail = useQuery({ queryKey: ['list-detail', listId], queryFn: () => api.listDetail(listId) });

  const rename = useMutation({
    mutationFn: (name: string) => api.renameList(listId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-detail', listId] });
      qc.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <button className="btn small" onClick={() => nav('/lists')}>
          ← Back
        </button>
        <h1>
          {detail.data ? (
            <EditableText
              value={detail.data.name}
              onCommit={(name) => rename.mutate(name)}
              className="editable-title"
              inputClassName="title-input"
            />
          ) : (
            'List'
          )}
        </h1>
      </div>

      <div className="detail" style={{ flex: 1, minHeight: 0 }}>
        <ListTable
          listId={listId}
          haulingCheck={haulingCheck}
          onClearHaulingCheck={() => setHaulingCheck(null)}
        />

        <div className="panel">
          <div className="subtabs">
            <button className={`tab ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>
              Add items
            </button>
            <button className={`tab ${tab === 'fits' ? 'active' : ''}`} onClick={() => setTab('fits')}>
              Add fits
            </button>
            <button className={`tab ${tab === 'stock' ? 'active' : ''}`} onClick={() => setTab('stock')}>
              Existing stock
            </button>
            <button className={`tab ${tab === 'hauling' ? 'active' : ''}`} onClick={() => setTab('hauling')}>
              Hauling check
            </button>
          </div>
          <div className="panel-body">
            {tab === 'items' && <AddTab listId={listId} />}
            {tab === 'fits' && <AddFitsTab listId={listId} />}
            {tab === 'stock' && <ExistingStockTab listId={listId} />}
            {tab === 'hauling' && (
              <HaulingCheckTab
                text={haulingText}
                onTextChange={setHaulingText}
                onCheck={(loaded: LoadedLine[]) =>
                  setHaulingCheck((prev) => ({ loaded, token: (prev?.token ?? 0) + 1 }))
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
