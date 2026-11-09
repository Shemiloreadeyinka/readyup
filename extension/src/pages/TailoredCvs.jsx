import { useCallback, useEffect, useState } from 'react';
import { Building2, ExternalLink, History, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingPane,
  ScoreBar,
} from '../components/ui.jsx';
import TailoredDetail from '../components/TailoredDetail.jsx';
import api from '../lib/api.js';
import { useApp } from '../lib/AppContext.jsx';

const scoreTone = (score) => (score >= 70 ? 'success' : score >= 45 ? 'warning' : 'error');

const formatDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function HistoryCard({ item, onOpen, onDelete, deleting }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <div className="p-3.5">
        <button type="button" onClick={onOpen} className="w-full text-left">
          <p className="truncate text-[13px] font-semibold text-slate-900">{item.jobTitle}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">
            <Building2 className="size-3 shrink-0" aria-hidden />
            {item.company ?? 'Company not detected'}
          </p>

          {item.overallAlignment !== null && item.overallAlignment !== undefined ? (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Alignment</span>
                <span className="font-semibold text-slate-800">{item.overallAlignment}%</span>
              </div>
              <ScoreBar value={item.overallAlignment} tone={scoreTone(item.overallAlignment)} />
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-1">
            <Badge>{formatDate(item.createdAt)}</Badge>
            <Badge tone="brand">{item.aiProvider?.label ?? 'AI'}</Badge>
            {item.flaggedCount ? <Badge tone="warning">{item.flaggedCount} to review</Badge> : null}
          </div>
        </button>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Open
          </Button>
          {item.jobUrl ? (
            <Button
              size="sm"
              variant="ghost"
              icon={ExternalLink}
              onClick={() => chrome.tabs.create({ url: item.jobUrl })}
            >
              Job post
            </Button>
          ) : null}
          {confirming ? (
            <>
              <Button size="sm" variant="danger" loading={deleting} onClick={onDelete}>
                Confirm delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function TailoredCvs() {
  const { backend, notify } = useApp();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [openRecord, setOpenRecord] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { items: list } = await api.listTailored();
      setItems(list);
      setError(null);
    } catch (requestError) {
      setError(requestError.message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (backend.status === 'connected') refresh();
  }, [backend.status, refresh]);

  if (backend.status === 'offline') {
    return (
      <div className="p-3">
        <Alert tone="error" title="Backend not reachable">
          {backend.error}
        </Alert>
      </div>
    );
  }

  if (openRecord) {
    return (
      <TailoredDetail
        record={openRecord}
        onBack={() => {
          setOpenRecord(null);
          refresh();
        }}
        onChanged={(updated) => setOpenRecord(updated)}
      />
    );
  }

  if (items === null) return <LoadingPane label="Loading your tailored CVs" />;

  return (
    <div className="space-y-2.5 p-3">
      {error ? (
        <Alert tone="error" title="Could not load history">
          {error}
        </Alert>
      ) : null}

      {items.length ? (
        items.map((item) => (
          <HistoryCard
            key={item.id}
            item={item}
            deleting={deletingId === item.id}
            onOpen={async () => {
              setLoadingId(item.id);
              try {
                const { tailored } = await api.getTailored(item.id);
                setOpenRecord(tailored);
              } catch (openError) {
                notify(openError.message, 'error');
              } finally {
                setLoadingId(null);
              }
            }}
            onDelete={async () => {
              setDeletingId(item.id);
              try {
                await api.deleteTailored(item.id);
                await refresh();
                notify('Tailored CV deleted.', 'success');
              } catch (deleteError) {
                notify(deleteError.message, 'error');
              } finally {
                setDeletingId(null);
              }
            }}
          />
        ))
      ) : (
        <EmptyState
          icon={History}
          title="No tailored CVs yet"
          description="Scan a job listing from the Dashboard and tailor your CV. Every version you generate is kept here."
        />
      )}

      {loadingId ? <LoadingPane label="Opening" /> : null}
    </div>
  );
}

export default TailoredCvs;
