import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Eye, FileEdit, Save, Sparkles } from 'lucide-react';
import { Alert, Button, Card, CardHeader, Field, LoadingPane, Select, cx } from './ui.jsx';
import MatchAnalysis from './MatchAnalysis.jsx';
import CvEditor from './CvEditor.jsx';
import api from '../lib/api.js';
import { clearDraft, loadDraft, saveDraft } from '../lib/storage.js';
import { useApp } from '../lib/AppContext.jsx';

const VIEWS = [
  { id: 'analysis', label: 'Analysis', icon: Sparkles },
  { id: 'edit', label: 'Edit', icon: FileEdit },
  { id: 'preview', label: 'Preview', icon: Eye },
];

/** Renders the backend's HTML in a sandboxed frame, scaled to the popup. */
function PreviewFrame({ html, loading }) {
  if (loading) return <LoadingPane label="Rendering preview" />;
  if (!html) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="h-[420px] w-full overflow-auto">
        <iframe
          title="CV preview"
          sandbox=""
          srcDoc={html}
          className="h-[1180px] w-[840px] origin-top-left border-0"
          style={{ transform: 'scale(0.46)', transformOrigin: 'top left' }}
        />
      </div>
    </div>
  );
}

export function TailoredDetail({ record, onBack, onChanged }) {
  const { templates, notify } = useApp();

  const [view, setView] = useState('analysis');
  const [cv, setCv] = useState(record.cv);
  const [sectionOrder, setSectionOrder] = useState(record.sectionOrder ?? []);
  const [templateId, setTemplateId] = useState(record.templateId);
  const [customisation, setCustomisation] = useState(record.customisation ?? {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [preview, setPreview] = useState({ html: null, loading: false, error: null });

  const draftLoaded = useRef(false);

  // Restore an unsaved draft from a previous popup session.
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;

    loadDraft(record.id).then((stored) => {
      if (!stored?.draft) return;
      setCv(stored.draft.cv);
      setSectionOrder(stored.draft.sectionOrder ?? []);
      setTemplateId(stored.draft.templateId);
      setCustomisation(stored.draft.customisation ?? {});
      setDirty(true);
      notify('Restored your unsaved changes.', 'info');
    });
  }, [record.id, notify]);

  const markDirty = useCallback(
    (next) => {
      setDirty(true);
      saveDraft(record.id, next);
    },
    [record.id],
  );

  const handleCvChange = (nextCv) => {
    setCv(nextCv);
    markDirty({ cv: nextCv, sectionOrder, templateId, customisation });
  };

  const handleOrderChange = (nextOrder) => {
    setSectionOrder(nextOrder);
    markDirty({ cv, sectionOrder: nextOrder, templateId, customisation });
  };

  const handleTemplateChange = (nextTemplate) => {
    setTemplateId(nextTemplate);
    markDirty({ cv, sectionOrder, templateId: nextTemplate, customisation });
  };

  const handleCustomisation = (patch) => {
    const next = { ...customisation, ...patch };
    setCustomisation(next);
    markDirty({ cv, sectionOrder, templateId, customisation: next });
  };

  const renderPayload = useMemo(
    () => ({ tailoredId: record.id, cv, sectionOrder, templateId, customisation }),
    [record.id, cv, sectionOrder, templateId, customisation],
  );

  // Refresh the preview whenever the document that would be produced changes.
  useEffect(() => {
    if (view !== 'preview') return undefined;

    let cancelled = false;
    setPreview((current) => ({ ...current, loading: true, error: null }));

    const timer = setTimeout(async () => {
      try {
        const { html } = await api.previewDocument(renderPayload);
        if (!cancelled) setPreview({ html, loading: false, error: null });
      } catch (error) {
        if (!cancelled) setPreview({ html: null, loading: false, error: error.message });
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, renderPayload]);

  const save = async () => {
    setSaving(true);
    try {
      const { tailored } = await api.updateTailored(record.id, {
        cv,
        sectionOrder,
        templateId,
        customisation,
      });
      await clearDraft(record.id);
      setDirty(false);
      notify('Changes saved.', 'success');
      onChanged?.(tailored);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const download = async (format) => {
    setDownloading(format);
    try {
      const { fileName } = await api.downloadDocument({ ...renderPayload, format });
      notify(`Saved ${fileName ?? `CV.${format}`}.`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3.5 py-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-900">
              {record.jobTitle ?? 'Tailored CV'}
            </p>
            <p className="truncate text-[11px] text-slate-500">{record.company ?? 'No company'}</p>
          </div>
          {dirty ? (
            <Button size="sm" icon={Save} loading={saving} onClick={save}>
              Save
            </Button>
          ) : null}
        </div>

        <div className="mt-2 flex rounded-lg bg-slate-100 p-0.5">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cx(
                'flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium transition-colors',
                view === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <item.icon className="size-3" aria-hidden />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 p-3">
        {view === 'analysis' ? <MatchAnalysis record={record} /> : null}

        {view === 'edit' ? (
          <CvEditor
            cv={cv}
            sectionOrder={sectionOrder}
            onChange={handleCvChange}
            onSectionOrderChange={handleOrderChange}
          />
        ) : null}

        {view === 'preview' ? (
          <>
            <Card>
              <CardHeader title="Template and layout" />
              <div className="space-y-2 p-3.5">
                <Field label="Template" htmlFor="template">
                  <Select
                    id="template"
                    value={templateId}
                    onChange={(event) => handleTemplateChange(event.target.value)}
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Font" htmlFor="font">
                    <Select
                      id="font"
                      value={customisation.font ?? ''}
                      onChange={(event) =>
                        handleCustomisation({ font: event.target.value || undefined })
                      }
                    >
                      <option value="">Template default</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times-Roman">Times Roman</option>
                      <option value="Courier">Courier</option>
                    </Select>
                  </Field>

                  <Field label="Font size" htmlFor="font-size">
                    <Select
                      id="font-size"
                      value={customisation.fontSize ?? ''}
                      onChange={(event) =>
                        handleCustomisation({
                          fontSize: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                    >
                      <option value="">Default</option>
                      {[9, 9.5, 10, 10.5, 11, 11.5, 12].map((size) => (
                        <option key={size} value={size}>
                          {size} pt
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Margins" htmlFor="margins">
                    <Select
                      id="margins"
                      value={customisation.margins?.top ?? ''}
                      onChange={(event) => {
                        const value = event.target.value ? Number(event.target.value) : undefined;
                        handleCustomisation({
                          margins: value
                            ? { top: value, right: value, bottom: value, left: value }
                            : undefined,
                        });
                      }}
                    >
                      <option value="">Default</option>
                      <option value="36">Narrow</option>
                      <option value="54">Normal</option>
                      <option value="72">Wide</option>
                    </Select>
                  </Field>

                  <Field label="Section spacing" htmlFor="spacing">
                    <Select
                      id="spacing"
                      value={customisation.sectionSpacing ?? ''}
                      onChange={(event) =>
                        handleCustomisation({
                          sectionSpacing: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                    >
                      <option value="">Default</option>
                      <option value="8">Compact</option>
                      <option value="14">Normal</option>
                      <option value="20">Airy</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </Card>

            {preview.error ? (
              <Alert tone="error" title="Preview failed">
                {preview.error}
              </Alert>
            ) : (
              <PreviewFrame html={preview.html} loading={preview.loading} />
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                icon={Download}
                loading={downloading === 'pdf'}
                onClick={() => download('pdf')}
              >
                Download PDF
              </Button>
              <Button
                className="flex-1"
                variant="secondary"
                icon={Download}
                loading={downloading === 'docx'}
                onClick={() => download('docx')}
              >
                Download DOCX
              </Button>
            </div>

            {dirty ? (
              <Alert tone="info">
                Downloads use your current edits. Save to keep them in your history.
              </Alert>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default TailoredDetail;
