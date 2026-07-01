import React, { useState } from 'react';

export interface IntakeQuestion {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

/**
 * Reference intake wizard.
 * Production should add autosave, progress indicators, validation messages, and path-specific help text.
 */
export function IntakeWizard({ questions, onSubmit }: { questions: IntakeQuestion[]; onSubmit: (answers: Record<string, unknown>) => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  function update(key: string, value: unknown) {
    setAnswers(prev => ({ ...prev, [key]: value }));
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(answers); }}>
      {questions.map(q => (
        <label key={q.key} style={{ display: 'block', marginBottom: 16 }}>
          <span>{q.label}{q.required ? ' *' : ''}</span>
          {q.type === 'select' ? (
            <select onChange={e => update(q.key, e.target.value)}>
              <option value="">Select...</option>
              {q.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : q.type === 'textarea' ? (
            <textarea onChange={e => update(q.key, e.target.value)} />
          ) : (
            <input type={q.type === 'number' ? 'number' : 'text'} onChange={e => update(q.key, e.target.value)} />
          )}
        </label>
      ))}
      <button type="submit">Save Intake</button>
    </form>
  );
}
