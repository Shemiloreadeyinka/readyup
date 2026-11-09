import { useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardPaste, RefreshCw, ScanLine } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Textarea } from './ui.jsx';

const MIN_DESCRIPTION_LENGTH = 120;

const confidenceTone = (confidence) =>
  confidence >= 70 ? 'success' : confidence >= 40 ? 'warning' : 'error';

const confidenceLabel = (confidence) =>
  confidence >= 70
    ? 'Looks like a job listing'
    : confidence >= 40
      ? 'Might be a job listing'
      : 'Probably not a job listing';

/**
 * The job description source.
 *
 * Scanning and pasting produce exactly the same editable job object, so the
 * manual path is a first-class alternative rather than a degraded one.
 */
export function JobSourcePanel({ tab, job, onChange, onScan, scanning, scanError }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState(null);

  const showManual = mode === 'manual' || (!job && mode === null && !tab?.scannable);
  const descriptionLength = job?.description?.length ?? 0;

  const update = (patch) => onChange({ ...(job ?? {}), ...patch });

  const startManual = () => {
    setMode('manual');
    setExpanded(true);
    if (!job) {
      onChange({
        url: tab?.url ?? null,
        pageTitle: tab?.title ?? null,
        site: 'Pasted manually',
        jobTitle: '',
        company: '',
        location: '',
        description: '',
        method: 'manual',
        confidence: null,
      });
    }
  };

  return (
    <Card>
      <CardHeader
        icon={ScanLine}
        title={tab?.title ? tab.title : 'No page detected'}
        description={
          tab?.url ? new URL(tab.url).hostname.replace(/^www\./, '') : 'Open a job listing to scan'
        }
        action={
          job ? (
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onScan} loading={scanning}>
              Rescan
            </Button>
          ) : null
        }
      />

      <div className="space-y-2.5 p-3.5">
        {!job ? (
          <>
            {tab?.scannable === false ? (
              <Alert tone="warning" title="This page cannot be scanned">
                Chrome blocks extensions on browser pages. Open the job listing in a normal tab, or
                paste the description below.
              </Alert>
            ) : (
              <p className="text-xs leading-snug text-slate-600">
                Scan this page to pull out the job title, company and requirements. Nothing is sent
                anywhere until you choose to tailor your CV.
              </p>
            )}

            {scanError ? (
              <Alert tone="error" title="Scan failed">
                {scanError}
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                icon={ScanLine}
                onClick={onScan}
                loading={scanning}
                disabled={!tab?.scannable}
                className="flex-1"
              >
                Scan job page
              </Button>
              <Button variant="secondary" icon={ClipboardPaste} onClick={startManual}>
                Paste
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="brand">{job.site ?? 'Unknown site'}</Badge>
              {job.confidence !== null && job.confidence !== undefined ? (
                <Badge tone={confidenceTone(job.confidence)}>
                  {confidenceLabel(job.confidence)} · {job.confidence}%
                </Badge>
              ) : null}
              <Badge>{descriptionLength.toLocaleString()} characters</Badge>
            </div>

            {job.confidence !== null &&
            job.confidence !== undefined &&
            job.confidence < 40 &&
            job.reasons?.length ? (
              <Alert tone="warning" title="Check what was captured">
                <ul className="ml-3 list-disc space-y-0.5">
                  {job.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Job title" htmlFor="job-title">
                <Input
                  id="job-title"
                  value={job.jobTitle ?? ''}
                  placeholder="e.g. Backend Engineer"
                  onChange={(event) => update({ jobTitle: event.target.value })}
                />
              </Field>
              <Field label="Company" htmlFor="job-company">
                <Input
                  id="job-company"
                  value={job.company ?? ''}
                  placeholder="e.g. Example Company"
                  onChange={(event) => update({ company: event.target.value })}
                />
              </Field>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <span>{expanded ? 'Hide' : 'Review'} extracted description</span>
                {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>

              {expanded ? (
                <Textarea
                  className="mt-2 font-mono text-[11px]"
                  rows={10}
                  value={job.description ?? ''}
                  placeholder="Paste the full job description here"
                  onChange={(event) => update({ description: event.target.value })}
                />
              ) : null}
            </div>

            {descriptionLength > 0 && descriptionLength < MIN_DESCRIPTION_LENGTH ? (
              <Alert tone="error" title="Not enough text">
                Only {descriptionLength} characters were captured. Review the description and add the
                missing parts before tailoring.
              </Alert>
            ) : null}

            {mode !== 'manual' ? (
              <Button variant="ghost" size="sm" icon={ClipboardPaste} onClick={startManual}>
                Replace with pasted text
              </Button>
            ) : null}
          </>
        )}

        {showManual && !job ? (
          <Textarea
            rows={8}
            autoFocus
            placeholder="Paste the full job description here"
            onChange={(event) => update({ description: event.target.value })}
          />
        ) : null}
      </div>
    </Card>
  );
}

export default JobSourcePanel;
