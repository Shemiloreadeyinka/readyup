import { useRef, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  RefreshCw,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingPane,
  cx,
} from '../components/ui.jsx';
import api from '../lib/api.js';
import { useApp } from '../lib/AppContext.jsx';

const MAX_UPLOAD_MB = 8;
const ACCEPTED = '.pdf,.docx,.txt';

function CvCard({ cv, isSelected, onSelect, onSetDefault, onReparse, onDelete, busy }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className={cx(isSelected && 'ring-1 ring-brand-500')}>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
            <p className="truncate text-[13px] font-semibold text-slate-900">{cv.name}</p>
            <p className="truncate text-[11px] text-slate-500">
              {cv.fileName} · {new Date(cv.createdAt).toLocaleDateString()}
            </p>
          </button>
          <div className="flex shrink-0 gap-1">
            {cv.isDefault ? (
              <Badge tone="brand">
                <Star className="size-2.5" /> Default
              </Badge>
            ) : null}
            {isSelected ? <Badge tone="success">Selected</Badge> : null}
          </div>
        </div>

        <dl className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-center">
          {[
            ['Roles', cv.counts.workExperience],
            ['Skills', cv.counts.skills],
            ['Projects', cv.counts.projects],
            ['Education', cv.counts.education],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
              <dd className="text-xs font-semibold text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>

        {cv.personalInformation?.fullName ? (
          <p className="mt-2 truncate text-[11px] text-slate-600">
            {cv.personalInformation.fullName}
            {cv.personalInformation.email ? ` · ${cv.personalInformation.email}` : ''}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-amber-700">
            No name or email was detected. Re-parse with AI enabled, or check the file.
          </p>
        )}

        {cv.notes?.length ? (
          <Alert tone="info" className="mt-2">
            {cv.notes[0]}
          </Alert>
        ) : null}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {!isSelected ? (
            <Button size="sm" variant="secondary" onClick={onSelect}>
              Use this CV
            </Button>
          ) : null}
          {!cv.isDefault ? (
            <Button size="sm" variant="ghost" icon={Star} onClick={onSetDefault}>
              Set default
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === 'reparse'} onClick={onReparse}>
            Re-parse
          </Button>
          {confirming ? (
            <>
              <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={onDelete}>
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

export function MyCv() {
  const { backend, cvs, refreshCvs, selectedCvId, chooseCv, notify } = useApp();
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const fileInput = useRef(null);

  if (backend.status === 'checking') return <LoadingPane label="Loading your CVs" />;
  if (backend.status === 'offline') {
    return (
      <div className="p-3">
        <Alert tone="error" title="Backend not reachable">
          {backend.error}
        </Alert>
      </div>
    );
  }

  const upload = async (file) => {
    if (!file) return;

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      notify(`That file is larger than the ${MAX_UPLOAD_MB}MB limit.`, 'error');
      return;
    }

    setUploading(true);
    try {
      const { cv } = await api.uploadCv(file, file.name.replace(/\.[^.]+$/, ''));
      await refreshCvs();
      await chooseCv(cv.id);
      notify(`${cv.name} uploaded and parsed.`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const withBusy = async (id, action, task) => {
    setBusyId(id);
    setBusyAction(action);
    try {
      await task();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-2.5 p-3">
      <Card>
        <CardHeader
          icon={Upload}
          title="Upload your CV"
          description="PDF, DOCX or plain text. Your original is never modified."
        />
        <div className="p-3.5">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <Button
            className="w-full"
            icon={Upload}
            loading={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {cvs.length ? 'Upload another CV' : 'Choose a file'}
          </Button>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            The file is parsed into structured sections on your machine. Scanned image PDFs cannot be
            read; export a text-based PDF instead.
          </p>
        </div>
      </Card>

      {cvs.length ? (
        cvs.map((cv) => (
          <CvCard
            key={cv.id}
            cv={cv}
            isSelected={cv.id === selectedCvId}
            busy={busyId === cv.id ? busyAction : null}
            onSelect={() => chooseCv(cv.id)}
            onSetDefault={() =>
              withBusy(cv.id, 'default', async () => {
                await api.updateCv(cv.id, { isDefault: true });
                await refreshCvs();
                notify(`${cv.name} is now your default CV.`, 'success');
              })
            }
            onReparse={() =>
              withBusy(cv.id, 'reparse', async () => {
                await api.reparseCv(cv.id);
                await refreshCvs();
                notify('CV re-parsed.', 'success');
              })
            }
            onDelete={() =>
              withBusy(cv.id, 'delete', async () => {
                await api.deleteCv(cv.id);
                await refreshCvs();
                notify('CV deleted.', 'success');
              })
            }
          />
        ))
      ) : (
        <EmptyState
          icon={FileText}
          title="No CV uploaded yet"
          description="Upload the CV you normally send out. Every tailored version is generated from it, and it is never overwritten."
        />
      )}

      {cvs.length ? (
        <p className="flex items-start gap-1.5 px-1 text-[11px] leading-snug text-slate-500">
          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" aria-hidden />
          Your original CVs are stored locally by the backend and are never overwritten by tailoring.
        </p>
      ) : null}
    </div>
  );
}

export default MyCv;
