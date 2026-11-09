import { useCallback, useEffect, useState } from 'react';
import { Cloud, Cpu, FileText, Play, RotateCcw, ServerCrash, Wand2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  LoadingPane,
  Select,
  Spinner,
  cx,
} from '../components/ui.jsx';
import JobSourcePanel from '../components/JobSourcePanel.jsx';
import TailoredDetail from '../components/TailoredDetail.jsx';
import { useApp } from '../lib/AppContext.jsx';
import { sendMessage, onBackgroundMessage } from '../lib/messaging.js';
import { loadScan, preferences, saveScan } from '../lib/storage.js';

const MIN_DESCRIPTION_LENGTH = 120;

const STAGES = [
  { id: 'job-analysis', label: 'Analysing the job description' },
  { id: 'tailoring', label: 'Comparing and tailoring your CV' },
  { id: 'done', label: 'Finished' },
];

function RunProgress({ state }) {
  const activeIndex = STAGES.findIndex((stage) => stage.id === state.stage);
  const elapsed = state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0;

  return (
    <Card>
      <CardHeader
        icon={Wand2}
        title="Tailoring in progress"
        description="You can close this popup; the run continues in the background."
      />
      <ul className="space-y-2 p-3.5">
        {STAGES.map((stage, index) => {
          const isActive = index === activeIndex;
          const isDone = activeIndex > index;
          return (
            <li key={stage.id} className="flex items-center gap-2">
              {isActive ? (
                <Spinner className="size-3.5" />
              ) : (
                <span
                  className={cx(
                    'size-3.5 rounded-full border-2',
                    isDone ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300',
                  )}
                />
              )}
              <span
                className={cx(
                  'text-xs',
                  isActive ? 'font-medium text-slate-900' : isDone ? 'text-slate-500' : 'text-slate-400',
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-slate-100 px-3.5 py-2 text-[11px] text-slate-500">
        {elapsed}s elapsed. Local models can take a few minutes on a long CV.
      </p>
    </Card>
  );
}

export function Dashboard() {
  const { backend, connect, cvs, selectedCv, selectedCvId, chooseCv, aiSettings, templates, notify } =
    useApp();

  const [tab, setTab] = useState(null);
  const [job, setJob] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [runState, setRunState] = useState({ status: 'idle' });
  const [templateId, setTemplateId] = useState('modern-professional');
  const [starting, setStarting] = useState(false);

  /* -------------------------- initial page state ------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const activeTab = await sendMessage('GET_ACTIVE_TAB');
        if (cancelled) return;
        setTab(activeTab);

        // Restore a previous scan of this exact page.
        if (activeTab?.url) {
          const stored = await loadScan(activeTab.url);
          if (!cancelled && stored) setJob(stored);
        }
      } catch (error) {
        if (!cancelled) setScanError(error.message);
      }

      const state = await sendMessage('GET_TAILOR_STATE').catch(() => null);
      if (!cancelled && state) setRunState(state);
    })();

    preferences.selectedTemplate.get().then((stored) => {
      if (!cancelled && stored) setTemplateId(stored);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Live progress pushes from the background worker.
  useEffect(() => onBackgroundMessage('TAILOR_STATE', (message) => setRunState(message.state)), []);

  // Keep the elapsed counter moving while a run is active.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (runState.status !== 'running') return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [runState.status]);

  /* ------------------------------- actions ------------------------------- */

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await sendMessage('SCAN_ACTIVE_TAB');
      setJob(result);
      await saveScan(result);

      if (!result.ok) {
        setScanError(
          'Very little text was found on this page. Review the description, or paste it manually.',
        );
      }
    } catch (error) {
      setScanError(error.message);
    } finally {
      setScanning(false);
    }
  }, []);

  const updateJob = useCallback((next) => {
    setJob(next);
    if (next?.url) saveScan(next);
  }, []);

  const startTailoring = async () => {
    setStarting(true);
    try {
      await sendMessage('START_TAILOR', {
        payload: {
          cvId: selectedCvId,
          jobText: job.description,
          jobMeta: {
            jobTitle: job.jobTitle || null,
            company: job.company || null,
            location: job.location || null,
            url: job.url || null,
            pageTitle: job.pageTitle || null,
          },
          templateId,
        },
      });
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const reset = async () => {
    await sendMessage('CLEAR_TAILOR').catch(() => {});
    setRunState({ status: 'idle' });
  };

  /* -------------------------------- views -------------------------------- */

  if (backend.status === 'checking') return <LoadingPane label="Connecting to the local backend" />;

  if (backend.status === 'offline') {
    return (
      <div className="p-3">
        <Card>
          <CardHeader icon={ServerCrash} title="Backend not reachable" />
          <div className="space-y-2.5 p-3.5">
            <p className="text-xs leading-snug text-slate-600">{backend.error}</p>
            <ol className="ml-4 list-decimal space-y-1 text-xs text-slate-600">
              <li>Open a terminal in the project's <code>backend</code> folder.</li>
              <li>
                Run <code className="rounded bg-slate-100 px-1">npm start</code>.
              </li>
              <li>Come back and press Retry.</li>
            </ol>
            <Button icon={RotateCcw} onClick={connect} className="w-full">
              Retry connection
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (runState.status === 'done' && runState.result) {
    return (
      <TailoredDetail
        record={runState.result}
        onBack={reset}
        onChanged={(updated) => setRunState((current) => ({ ...current, result: updated }))}
      />
    );
  }

  const descriptionLength = job?.description?.trim().length ?? 0;
  const canTailor =
    Boolean(selectedCvId) && descriptionLength >= MIN_DESCRIPTION_LENGTH && runState.status !== 'running';

  const provider = aiSettings?.provider;
  const active = aiSettings?.activeProvider;

  // Whether data leaves the machine is decided by the backend from the whole
  // configuration: an Ollama "-cloud" model is cloud even though the request
  // goes to localhost.
  const isCloud = Boolean(active?.isCloud);
  const providerModel = active?.model;
  const cloudBlocked = isCloud && !aiSettings?.cloudConsent;
  const missingKey =
    (provider === 'openai' || provider === 'anthropic') && !aiSettings?.[provider]?.hasApiKey;

  const providerLabel =
    provider === 'ollama'
      ? isCloud
        ? 'Ollama Cloud'
        : 'Ollama (local)'
      : provider === 'openai'
        ? 'OpenAI'
        : 'Anthropic Claude';

  return (
    <div className="space-y-2.5 p-3">
      <JobSourcePanel
        tab={tab}
        job={job}
        onChange={updateJob}
        onScan={scan}
        scanning={scanning}
        scanError={scanError}
      />

      {runState.status === 'running' ? <RunProgress state={runState} /> : null}

      {runState.status === 'error' ? (
        <Alert
          tone="error"
          title="Tailoring failed"
          action={
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={reset}>
              Dismiss
            </Button>
          }
        >
          {runState.error?.message}
        </Alert>
      ) : null}

      <Card>
        <CardHeader icon={FileText} title="Your setup" />
        <div className="space-y-2 p-3.5">
          <Field label="CV to tailor" htmlFor="cv-select">
            {cvs.length ? (
              <Select
                id="cv-select"
                value={selectedCvId ?? ''}
                onChange={(event) => chooseCv(event.target.value)}
              >
                {cvs.map((cv) => (
                  <option key={cv.id} value={cv.id}>
                    {cv.name}
                    {cv.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <Alert tone="warning">
                No CV uploaded yet. Open the My CV tab and upload your PDF or DOCX first.
              </Alert>
            )}
          </Field>

          <Field label="Template" htmlFor="template-select">
            <Select
              id="template-select"
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                preferences.selectedTemplate.set(event.target.value);
              }}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="flex items-center gap-2">
              {isCloud ? (
                <Cloud className="size-3.5 text-slate-400" aria-hidden />
              ) : (
                <Cpu className="size-3.5 text-slate-400" aria-hidden />
              )}
              <div>
                <p className="text-xs font-medium text-slate-800">{providerLabel}</p>
                <p className="text-[11px] text-slate-500">{providerModel ?? 'No model selected'}</p>
              </div>
            </div>
            <Badge tone={isCloud ? 'warning' : 'success'}>{isCloud ? 'Cloud' : 'On device'}</Badge>
          </div>

          {isCloud && active?.cloudReason ? (
            <p className="px-0.5 text-[11px] leading-snug text-amber-700">{active.cloudReason}</p>
          ) : null}

          {cloudBlocked ? (
            <Alert tone="warning" title="Cloud processing is off">
              Turn on cloud consent in AI Settings, or pick a model that runs on this machine,
              before tailoring.
            </Alert>
          ) : null}

          {missingKey ? (
            <Alert tone="warning" title="No API key configured">
              Add your {provider === 'openai' ? 'OpenAI' : 'Anthropic'} key in AI Settings.
            </Alert>
          ) : null}
        </div>
      </Card>

      <Button
        className="w-full"
        size="lg"
        icon={Play}
        disabled={!canTailor}
        loading={starting || runState.status === 'running'}
        onClick={startTailoring}
      >
        Analyse &amp; tailor CV
      </Button>

      {!canTailor && runState.status !== 'running' ? (
        <p className="text-center text-[11px] text-slate-500">
          {!selectedCvId
            ? 'Upload a CV to continue.'
            : descriptionLength === 0
              ? 'Scan the page or paste a job description to continue.'
              : `The job description is too short (${descriptionLength} characters).`}
        </p>
      ) : null}
    </div>
  );
}

export default Dashboard;
