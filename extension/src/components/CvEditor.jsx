import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Card, CardHeader, Field, Input, Textarea, Button } from './ui.jsx';
import { SECTION_LABELS } from '../lib/constants.js';

/**
 * Structured CV editor.
 *
 * Edits the structured CV directly rather than free text, so what the user
 * sees here is exactly what the PDF and DOCX renderers will receive.
 */

const linesToList = (value) =>
  value
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

const listToLines = (list) => (list ?? []).join('\n');

function SectionOrder({ order, onChange }) {
  const move = (index, delta) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Card>
      <CardHeader title="Section order" description="Put the most relevant sections first." />
      <ul className="divide-y divide-slate-100">
        {order.map((key, index) => (
          <li key={key} className="flex items-center justify-between px-3.5 py-1.5">
            <span className="text-xs text-slate-700">{SECTION_LABELS[key] ?? key}</span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                icon={ArrowUp}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${SECTION_LABELS[key]} up`}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={ArrowDown}
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${SECTION_LABELS[key]} down`}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CvEditor({ cv, sectionOrder, onChange, onSectionOrderChange }) {
  const update = (patch) => onChange({ ...cv, ...patch });

  const updateList = (key, index, patch) => {
    const next = [...(cv[key] ?? [])];
    next[index] = { ...next[index], ...patch };
    update({ [key]: next });
  };

  const removeFromList = (key, index) => {
    update({ [key]: (cv[key] ?? []).filter((_, position) => position !== index) });
  };

  return (
    <div className="space-y-2.5">
      <Card>
        <CardHeader title="Contact details" description="Copied from your original CV." />
        <div className="grid grid-cols-2 gap-2 p-3.5">
          {[
            ['fullName', 'Full name'],
            ['title', 'Headline'],
            ['email', 'Email'],
            ['phone', 'Phone'],
            ['location', 'Location'],
            ['linkedin', 'LinkedIn'],
            ['github', 'GitHub'],
            ['website', 'Website'],
          ].map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`personal-${key}`}>
              <Input
                id={`personal-${key}`}
                value={cv.personalInformation?.[key] ?? ''}
                onChange={(event) =>
                  update({
                    personalInformation: {
                      ...cv.personalInformation,
                      [key]: event.target.value || null,
                    },
                  })
                }
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Professional summary" />
        <div className="p-3.5">
          <Textarea
            rows={4}
            value={cv.professionalSummary ?? ''}
            onChange={(event) => update({ professionalSummary: event.target.value })}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Technical skills"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              onClick={() =>
                update({
                  technicalSkills: [...(cv.technicalSkills ?? []), { category: '', skills: [] }],
                })
              }
            >
              Group
            </Button>
          }
        />
        <div className="space-y-2.5 p-3.5">
          {(cv.technicalSkills ?? []).map((group, index) => (
            <div key={index} className="space-y-1.5 rounded-lg bg-slate-50 p-2.5">
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Category"
                  value={group.category ?? ''}
                  onChange={(event) =>
                    updateList('technicalSkills', index, { category: event.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  aria-label="Remove group"
                  onClick={() => removeFromList('technicalSkills', index)}
                />
              </div>
              <Input
                placeholder="Comma separated skills"
                value={(group.skills ?? []).join(', ')}
                onChange={(event) =>
                  updateList('technicalSkills', index, {
                    skills: event.target.value
                      .split(',')
                      .map((skill) => skill.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          ))}
          {!(cv.technicalSkills ?? []).length ? (
            <p className="text-xs text-slate-500">No skills section.</p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Work experience" />
        <div className="space-y-3 p-3.5">
          {(cv.workExperience ?? []).map((role, index) => (
            <div key={index} className="space-y-1.5 rounded-lg bg-slate-50 p-2.5">
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Job title"
                  value={role.jobTitle ?? ''}
                  onChange={(event) =>
                    updateList('workExperience', index, { jobTitle: event.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  aria-label="Remove role"
                  onClick={() => removeFromList('workExperience', index)}
                />
              </div>
              <Input
                placeholder="Company"
                value={role.company ?? ''}
                onChange={(event) =>
                  updateList('workExperience', index, { company: event.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Start"
                  value={role.startDate ?? ''}
                  onChange={(event) =>
                    updateList('workExperience', index, { startDate: event.target.value })
                  }
                />
                <Input
                  placeholder="End"
                  value={role.endDate ?? ''}
                  onChange={(event) =>
                    updateList('workExperience', index, { endDate: event.target.value })
                  }
                />
              </div>
              <Field label="Bullet points" hint="One per line">
                <Textarea
                  rows={4}
                  value={listToLines(role.responsibilities)}
                  onChange={(event) =>
                    updateList('workExperience', index, {
                      responsibilities: linesToList(event.target.value),
                    })
                  }
                />
              </Field>
              {role.achievements?.length ? (
                <Field label="Achievements" hint="One per line">
                  <Textarea
                    rows={2}
                    value={listToLines(role.achievements)}
                    onChange={(event) =>
                      updateList('workExperience', index, {
                        achievements: linesToList(event.target.value),
                      })
                    }
                  />
                </Field>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {(cv.projects ?? []).length ? (
        <Card>
          <CardHeader title="Projects" />
          <div className="space-y-3 p-3.5">
            {cv.projects.map((project, index) => (
              <div key={index} className="space-y-1.5 rounded-lg bg-slate-50 p-2.5">
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="Project name"
                    value={project.name ?? ''}
                    onChange={(event) =>
                      updateList('projects', index, { name: event.target.value })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    aria-label="Remove project"
                    onClick={() => removeFromList('projects', index)}
                  />
                </div>
                <Textarea
                  rows={2}
                  placeholder="Description"
                  value={project.description ?? ''}
                  onChange={(event) =>
                    updateList('projects', index, { description: event.target.value })
                  }
                />
                <Field label="Highlights" hint="One per line">
                  <Textarea
                    rows={2}
                    value={listToLines(project.highlights)}
                    onChange={(event) =>
                      updateList('projects', index, {
                        highlights: linesToList(event.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {(cv.achievements ?? []).length ? (
        <Card>
          <CardHeader title="Achievements" description="One per line" />
          <div className="p-3.5">
            <Textarea
              rows={3}
              value={listToLines(cv.achievements)}
              onChange={(event) => update({ achievements: linesToList(event.target.value) })}
            />
          </div>
        </Card>
      ) : null}

      {sectionOrder?.length ? (
        <SectionOrder order={sectionOrder} onChange={onSectionOrderChange} />
      ) : null}
    </div>
  );
}

export default CvEditor;
