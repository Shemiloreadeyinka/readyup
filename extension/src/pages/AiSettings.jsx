import { useEffect, useState } from 'react';
import { Cloud, Cpu, KeyRound, Plug, RefreshCw, Save, Server } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  LoadingPane,
  Select,
  Toggle,
  cx,
} from '../components/ui.jsx';
import api, { getBackendUrl, setBackendUrl } from '../lib/api.js';
import { useApp } from '../lib/AppContext.jsx';

const PROVIDERS = [
  {
    id: 'ollama',
    name: 'Ollama',
    tagline: 'Runs on your machine. No subscription, nothing leaves your computer.',
    icon: Cpu,
    cloud: false,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'Cloud. Your CV and the job description are sent to OpenAI.',
    icon: Cloud,
    cloud: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    tagline: 'Cloud. Your CV and the job description are sent to Anthropic.',
    icon: Cloud,
    cloud: true,
  },
];

const CUSTOM_MODEL_OPTION = '__custom__';

/** Mirrors the backend rule so the warning appears before saving. */
const isCloudOllamaModel = (model) => /[-:]cloud$/i.test(String(model ?? '').trim());

export function AiSettings() {
  const { backend, aiSettings, refreshSettings, notify, connect } = useApp();

  const [draft, setDraft] = useState(null);
  const [apiKeys, setApiKeys] = useState({ openai: '', anthropic: '' });
  const [ollamaModels, setOllamaModels] = useState([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [backendUrl, setBackendUrlValue] = useState('');
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    if (aiSettings && !draft) setDraft(structuredClone(aiSettings));
  }, [aiSettings, draft]);

  useEffect(() => {
    getBackendUrl().then(setBackendUrlValue);
  }, []);

  // Offer the models Ollama actually has installed.
  useEffect(() => {
    if (draft?.provider !== 'ollama' || backend.status !== 'connected') return;
    api
      .listAiModels('ollama')
      .then(({ models }) => setOllamaModels(models))
      .catch(() => setOllamaModels([]));
  }, [draft?.provider, backend.status]);

  if (backend.status === 'offline') {
    return (
      <div className="space-y-2.5 p-3">
        <Alert tone="error" title="Backend not reachable">
          {backend.error}
        </Alert>
        <Card>
          <CardHeader icon={Server} title="Backend address" />
          <div className="space-y-2 p-3.5">
            <Field label="Local backend URL" htmlFor="backend-url">
              <Input
                id="backend-url"
                value={backendUrl}
                onChange={(event) => setBackendUrlValue(event.target.value)}
                placeholder="http://127.0.0.1:8787"
              />
            </Field>
            <Button
              className="w-full"
              icon={RefreshCw}
              onClick={async () => {
                try {
                  await setBackendUrl(backendUrl);
                  await connect();
                } catch {
                  notify('That is not a valid URL.', 'error');
                }
              }}
            >
              Save and reconnect
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!draft) return <LoadingPane label="Loading AI settings" />;

  const activeProvider = PROVIDERS.find((provider) => provider.id === draft.provider);
  const isOllamaCloudModel = draft.provider === 'ollama' && isCloudOllamaModel(draft.ollama.model);
  const isCloud = Boolean(activeProvider?.cloud) || isOllamaCloudModel;

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        provider: draft.provider,
        cloudConsent: draft.cloudConsent,
        ollama: draft.ollama,
        openai: {
          model: draft.openai.model,
          ...(apiKeys.openai ? { apiKey: apiKeys.openai } : {}),
        },
        anthropic: {
          model: draft.anthropic.model,
          ...(apiKeys.anthropic ? { apiKey: apiKeys.anthropic } : {}),
        },
      };

      await api.saveAiSettings(payload);
      await refreshSettings();
      setApiKeys({ openai: '', anthropic: '' });
      notify('AI settings saved.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testAiProvider({
        provider: draft.provider,
        model: draft.provider === 'ollama' ? draft.ollama.model : draft[draft.provider].model,
        baseUrl: draft.provider === 'ollama' ? draft.ollama.baseUrl : undefined,
        apiKey: apiKeys[draft.provider] || undefined,
      });
      setTestResult(result);
      if (result.models?.length) setOllamaModels(result.models);
    } catch (error) {
      setTestResult({ ok: false, message: error.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2.5 p-3">
      <Card>
        <CardHeader icon={Plug} title="AI provider" description="Switch at any time." />
        <div className="space-y-2 p-3.5">
          {PROVIDERS.map((provider) => {
            const Icon = provider.icon;
            const isActive = draft.provider === provider.id;
            const hasKey = provider.cloud ? aiSettings?.[provider.id]?.hasApiKey : true;

            // Ollama is only "private" while the selected model runs here.
            const runsRemotely = provider.id === 'ollama' && isOllamaCloudModel;
            const tagline = runsRemotely
              ? 'Cloud model selected: the local daemon forwards requests to ollama.com.'
              : provider.tagline;

            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => update({ provider: provider.id })}
                className={cx(
                  'flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                  isActive
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50',
                )}
              >
                <Icon
                  className={cx('mt-0.5 size-4 shrink-0', isActive ? 'text-brand-600' : 'text-slate-400')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-900">{provider.name}</span>
                    {provider.cloud ? (
                      <Badge tone={hasKey ? 'success' : 'neutral'}>
                        {hasKey ? 'Key saved' : 'No key'}
                      </Badge>
                    ) : runsRemotely ? (
                      <Badge tone="warning">Cloud</Badge>
                    ) : (
                      <Badge tone="success">Private</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    {tagline}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {draft.provider === 'ollama' ? (
        <Card>
          <CardHeader icon={Cpu} title="Ollama" />
          <div className="space-y-2 p-3.5">
            <Field label="Server URL" htmlFor="ollama-url" hint="Default: http://localhost:11434">
              <Input
                id="ollama-url"
                value={draft.ollama.baseUrl}
                onChange={(event) =>
                  update({ ollama: { ...draft.ollama, baseUrl: event.target.value } })
                }
              />
            </Field>

            <Field
              label="Model"
              htmlFor="ollama-model"
              hint={
                ollamaModels.length
                  ? `${ollamaModels.length} model(s) installed`
                  : 'Run "ollama pull llama3.1:8b" to install one'
              }
            >
              {ollamaModels.length && !customModel ? (
                <Select
                  id="ollama-model"
                  value={draft.ollama.model}
                  onChange={(event) => {
                    if (event.target.value === CUSTOM_MODEL_OPTION) {
                      setCustomModel(true);
                      return;
                    }
                    update({ ollama: { ...draft.ollama, model: event.target.value } });
                  }}
                >
                  {!ollamaModels.includes(draft.ollama.model) ? (
                    <option value={draft.ollama.model}>{draft.ollama.model} (not installed)</option>
                  ) : null}
                  {ollamaModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL_OPTION}>Enter a model name…</option>
                </Select>
              ) : (
                <Input
                  id="ollama-model"
                  autoFocus={customModel}
                  placeholder="llama3.1:8b or gpt-oss:120b-cloud"
                  value={draft.ollama.model}
                  onChange={(event) =>
                    update({ ollama: { ...draft.ollama, model: event.target.value } })
                  }
                />
              )}
            </Field>

            {isOllamaCloudModel ? (
              <Alert tone="warning" title="This model runs on Ollama's servers">
                The local daemon forwards "-cloud" models to ollama.com, so your CV leaves this
                machine. Cloud processing consent is required below.
              </Alert>
            ) : null}

            <Field
              label="Context window"
              htmlFor="ollama-ctx"
              hint="Bigger windows handle longer CVs but use more RAM. Ollama truncates silently when a prompt does not fit."
            >
              <Select
                id="ollama-ctx"
                value={draft.ollama.numCtx ?? 8192}
                onChange={(event) =>
                  update({ ollama: { ...draft.ollama, numCtx: Number(event.target.value) } })
                }
              >
                <option value={4096}>4,096 — very low RAM</option>
                <option value={8192}>8,192 — default, fits a 2-page CV</option>
                <option value={16384}>16,384 — long CVs, needs spare RAM</option>
                <option value={32768}>32,768 — cloud models only</option>
              </Select>
            </Field>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader icon={KeyRound} title={`${activeProvider.name} credentials`} />
          <div className="space-y-2 p-3.5">
            <Field
              label="API key"
              htmlFor="api-key"
              hint={
                aiSettings?.[draft.provider]?.keySource === 'env'
                  ? 'A key from the backend .env file is in use. Enter one here to override it.'
                  : aiSettings?.[draft.provider]?.hasApiKey
                    ? 'A key is already saved. Enter a new one to replace it.'
                    : 'Stored by the local backend only. It never enters the extension.'
              }
            >
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder={
                  aiSettings?.[draft.provider]?.hasApiKey ? '•••••••••••••••' : 'Paste your API key'
                }
                value={apiKeys[draft.provider]}
                onChange={(event) =>
                  setApiKeys((current) => ({ ...current, [draft.provider]: event.target.value }))
                }
              />
            </Field>

            <Field label="Model" htmlFor="cloud-model">
              <Input
                id="cloud-model"
                value={draft[draft.provider].model}
                onChange={(event) =>
                  update({
                    [draft.provider]: { ...draft[draft.provider], model: event.target.value },
                  })
                }
              />
            </Field>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Privacy" />
        <div className="space-y-2 p-3.5">
          <Toggle
            checked={draft.cloudConsent}
            onChange={(value) => update({ cloudConsent: value })}
            label="Allow cloud processing"
            description="Required before any CV content leaves this machine: OpenAI, Anthropic, an Ollama Cloud model, or an Ollama server on another host."
          />
          {isCloud && !draft.cloudConsent ? (
            <Alert tone="warning">
              Tailoring with{' '}
              {isOllamaCloudModel ? `"${draft.ollama.model}"` : activeProvider.name} is blocked
              until you turn this on.
            </Alert>
          ) : null}
        </div>
      </Card>

      {testResult ? (
        <Alert
          tone={testResult.ok ? 'success' : 'error'}
          title={testResult.ok ? 'Connection works' : 'Connection failed'}
        >
          {testResult.message}
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button className="flex-1" variant="secondary" icon={Plug} loading={testing} onClick={test}>
          Test connection
        </Button>
        <Button className="flex-1" icon={Save} loading={saving} onClick={save}>
          Save settings
        </Button>
      </div>

      <Card>
        <CardHeader icon={Server} title="Local backend" />
        <div className="space-y-2 p-3.5">
          <Field label="Backend URL" htmlFor="backend-url-connected">
            <Input
              id="backend-url-connected"
              value={backendUrl}
              onChange={(event) => setBackendUrlValue(event.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            className="w-full"
            icon={RefreshCw}
            onClick={async () => {
              try {
                await setBackendUrl(backendUrl);
                await connect();
                notify('Reconnected.', 'success');
              } catch {
                notify('That is not a valid URL.', 'error');
              }
            }}
          >
            Save and reconnect
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default AiSettings;
