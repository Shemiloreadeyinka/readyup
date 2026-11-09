import { useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Info,
  Lightbulb,
  MessageCircleQuestion,
  ShieldAlert,
} from 'lucide-react';
import { Alert, Badge, Card, CardHeader, ScoreBar, cx } from './ui.jsx';
import { MATCH_STATUS } from '../lib/constants.js';

const STATUS_ICONS = {
  strong: CircleCheck,
  partial: CircleDashed,
  missing: CircleAlert,
};

const STATUS_COLOURS = {
  strong: 'text-emerald-600',
  partial: 'text-amber-600',
  missing: 'text-red-500',
};

const scoreTone = (score) => (score >= 70 ? 'success' : score >= 45 ? 'warning' : 'error');

function MatchRow({ match }) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICONS[match.status] ?? CircleDashed;
  const hasEvidence = Boolean(match.evidence);

  return (
    <li className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        disabled={!hasEvidence}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'flex w-full items-start gap-2 px-3.5 py-2 text-left',
          hasEvidence && 'hover:bg-slate-50',
        )}
      >
        <Icon className={cx('mt-0.5 size-3.5 shrink-0', STATUS_COLOURS[match.status])} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-800">
            {match.requirement}
          </span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {MATCH_STATUS[match.status]?.label ?? match.status}
            {hasEvidence ? ' · tap for evidence' : ''}
          </span>
        </span>
      </button>

      {open && hasEvidence ? (
        <div className="border-l-2 border-brand-200 bg-slate-50 px-3.5 py-2">
          <p className="text-[11px] italic leading-snug text-slate-700">“{match.evidence}”</p>
          {match.evidenceSource ? (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
              {match.evidenceSource}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function MatchGroup({ title, matches }) {
  if (!matches?.length) return null;

  const counts = matches.reduce(
    (totals, match) => ({ ...totals, [match.status]: (totals[match.status] ?? 0) + 1 }),
    {},
  );

  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <div className="flex gap-1">
            {counts.strong ? <Badge tone="success">{counts.strong} strong</Badge> : null}
            {counts.partial ? <Badge tone="warning">{counts.partial} partial</Badge> : null}
            {counts.missing ? <Badge tone="error">{counts.missing} missing</Badge> : null}
          </div>
        }
      />
      <ul>
        {matches.map((match, index) => (
          <MatchRow key={`${match.requirement}-${index}`} match={match} />
        ))}
      </ul>
    </Card>
  );
}

function BulletCard({ icon, title, items, tone = 'neutral', renderItem }) {
  if (!items?.length) return null;
  return (
    <Card>
      <CardHeader icon={icon} title={title} />
      <ul className="space-y-1.5 px-3.5 py-2.5">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-xs leading-snug text-slate-700">
            <span
              className={cx(
                'mt-1.5 size-1 shrink-0 rounded-full',
                tone === 'warning' ? 'bg-amber-500' : tone === 'error' ? 'bg-red-500' : 'bg-brand-500',
              )}
            />
            <span className="min-w-0 flex-1">{renderItem ? renderItem(item) : item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The job match analysis screen.
 *
 * Every claim carries its evidence, and the score is presented as measured
 * alignment, never as a hiring probability.
 */
export function MatchAnalysis({ record }) {
  const { comparison, jobAnalysis, suggestions, flaggedForReview, questionsForUser, factCheck } =
    record;
  const score = comparison?.overallAlignment;

  return (
    <div className="space-y-2.5">
      <Card>
        <div className="px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Job match analysis
          </p>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">
            {record.jobTitle ?? jobAnalysis?.jobTitle ?? 'Role'}
          </h2>
          <p className="text-xs text-slate-500">
            {record.company ?? jobAnalysis?.company ?? 'Company not detected'}
          </p>

          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-medium text-slate-600">Overall alignment</span>
              <span className="text-lg font-semibold text-slate-900">
                {score === null || score === undefined ? '—' : `${score}%`}
              </span>
            </div>
            <ScoreBar value={score ?? 0} tone={scoreTone(score ?? 0)} />
          </div>

          {comparison?.scoreExplanation ? (
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              {comparison.scoreExplanation}
            </p>
          ) : null}
        </div>
      </Card>

      {flaggedForReview?.length ? (
        <Alert tone="warning" title={`${flaggedForReview.length} statement(s) to confirm`}>
          <ul className="mt-1 space-y-1.5">
            {flaggedForReview.slice(0, 5).map((flag, index) => (
              <li key={index}>
                <span className="block italic">“{flag.text}”</span>
                <span className="block text-[11px] opacity-80">{flag.concern}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {factCheck?.corrections?.length ? (
        <Alert tone="info" title={`${factCheck.corrections.length} automatic correction(s)`}>
          Facts the model changed were restored from your original CV.
          <ul className="mt-1 space-y-0.5">
            {factCheck.corrections.slice(0, 4).map((correction, index) => (
              <li key={index} className="text-[11px]">
                <span className="font-medium">{correction.field}</span>:{' '}
                {correction.to ? `restored "${correction.to}"` : `removed "${correction.from}"`}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <MatchGroup title="Technical skills" matches={comparison?.skillMatches} />
      <MatchGroup title="Experience" matches={comparison?.experienceMatches} />

      <BulletCard
        icon={CircleAlert}
        title="Missing requirements"
        tone="error"
        items={comparison?.missingRequirements}
      />

      <BulletCard
        icon={Info}
        title="Strengths you are underselling"
        tone="warning"
        items={comparison?.underrepresentedStrengths}
        renderItem={(item) => (
          <>
            <span className="font-medium text-slate-800">{item.item}</span>
            {item.why ? <span className="block text-slate-500">{item.why}</span> : null}
          </>
        )}
      />

      <BulletCard
        icon={Lightbulb}
        title="Recommended improvements"
        items={comparison?.recommendedImprovements}
      />

      {questionsForUser?.length ? (
        <Card>
          <CardHeader
            icon={MessageCircleQuestion}
            title="Questions from the analysis"
            description="These details would strengthen your CV. They were not invented for you."
          />
          <ul className="space-y-1.5 px-3.5 py-2.5">
            {questionsForUser.map((question, index) => (
              <li key={index} className="text-xs leading-snug text-slate-700">
                {question}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {suggestions ? (
        <>
          <BulletCard
            icon={Lightbulb}
            title="Skills worth highlighting"
            items={suggestions.skillsToHighlight}
          />
          <BulletCard
            icon={Lightbulb}
            title="Experience worth emphasising"
            items={suggestions.experienceToEmphasise}
          />
          <BulletCard
            icon={ShieldAlert}
            title="How to handle the gaps"
            tone="warning"
            items={suggestions.missingRequirements}
            renderItem={(item) => (
              <>
                <span className="font-medium text-slate-800">{item.requirement}</span>
                {item.suggestion ? (
                  <span className="block text-slate-500">{item.suggestion}</span>
                ) : null}
              </>
            )}
          />
          <BulletCard
            icon={MessageCircleQuestion}
            title="Interview preparation"
            items={suggestions.interviewPreparationTopics}
          />
        </>
      ) : null}

      {record.warnings?.length ? (
        <Alert tone="info" title="Notes from this run">
          <ul className="ml-3 list-disc space-y-0.5">
            {record.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

export default MatchAnalysis;
