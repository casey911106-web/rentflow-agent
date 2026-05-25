'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type QuestionType = 'text' | 'number' | 'boolean' | 'enum' | 'multi_enum';

interface Question {
  id: string;
  key: string;
  label: string;
  helperText: string | null;
  type: QuestionType;
  options: string[] | null;
  isRequired: boolean;
  isActive: boolean;
  position: number;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  text: 'Texto libre',
  number: 'Número',
  boolean: 'Sí / No',
  enum: 'Una opción',
  multi_enum: 'Varias opciones',
};

export default function PropertyQuestionsPage() {
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Question | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Question[]>('/property-details/admin/questions');
      setItems(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(q: Question) {
    await api(`/property-details/admin/questions/${q.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !q.isActive }),
    });
    load();
  }

  async function remove(q: Question) {
    if (!confirm(`Eliminar "${q.label}"? La pregunta deja de aparecer en el form móvil.`)) return;
    await api(`/property-details/admin/questions/${q.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-deep">Preguntas para field agents</h1>
          <p className="text-sm text-gray-medium">
            Datos que el agente pregunta al dueño en la app móvil cuando confirma una publicación.
            Las respuestas alimentan la IA para que conteste FAQs de huéspedes sin escalar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal/90"
        >
          + Nueva pregunta
        </button>
      </header>

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-medium">Cargando…</p> : null}

      <div className="overflow-hidden rounded-md border border-gray-light bg-white">
        <table className="w-full text-sm">
          <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Pregunta</th>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Obligatoria</th>
              <th className="px-4 py-3">Activa</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id} className="border-t border-gray-light">
                <td className="px-4 py-3 font-mono text-xs text-gray-medium">{q.position}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-deep">{q.label}</p>
                  {q.helperText ? (
                    <p className="text-xs text-gray-medium">{q.helperText}</p>
                  ) : null}
                  {q.options && q.options.length > 0 ? (
                    <p className="mt-1 text-xs text-gray-medium">
                      Opciones: {q.options.join(', ')}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-medium">{q.key}</td>
                <td className="px-4 py-3 text-xs">{TYPE_LABEL[q.type]}</td>
                <td className="px-4 py-3 text-xs">{q.isRequired ? 'Sí' : 'No'}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleActive(q)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      q.isActive
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-light text-gray-medium'
                    }`}
                  >
                    {q.isActive ? 'Activa' : 'Inactiva'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right text-xs">
                  <button
                    type="button"
                    onClick={() => setEditing(q)}
                    className="mr-2 text-teal hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(q)}
                    className="text-rose-600 hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-medium">
                  Aún no hay preguntas. Añade la primera para que los agentes empiecen a llenar datos.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {(editing || creating) ? (
        <QuestionEditor
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function QuestionEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Question | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [helperText, setHelperText] = useState(initial?.helperText ?? '');
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'text');
  const [optionsCsv, setOptionsCsv] = useState((initial?.options ?? []).join(', '));
  const [isRequired, setIsRequired] = useState(initial?.isRequired ?? true);
  const [position, setPosition] = useState(initial?.position ?? 100);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsOptions = type === 'enum' || type === 'multi_enum';

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const options = needsOptions
        ? optionsCsv.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const body = {
        key,
        label,
        helperText: helperText || undefined,
        type,
        options,
        isRequired,
        position,
      };
      if (initial) {
        await api(`/property-details/admin/questions/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/property-details/admin/questions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-bold text-navy-deep">
          {initial ? 'Editar pregunta' : 'Nueva pregunta'}
        </h2>

        <div className="mt-4 space-y-3">
          <Field label="Etiqueta (lo que ve el agente)">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Key (identificador estable — sin espacios)">
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.replace(/[^a-z0-9_]/g, '_'))}
              disabled={!!initial}
              className="w-full rounded-md border border-gray-light px-3 py-2 font-mono text-xs disabled:bg-gray-50"
            />
          </Field>
          <Field label="Texto de ayuda (opcional)">
            <input
              type="text"
              value={helperText}
              onChange={(e) => setHelperText(e.target.value)}
              className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Tipo">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as QuestionType)}
              className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
            >
              {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          {needsOptions ? (
            <Field label="Opciones (separadas por coma)">
              <input
                type="text"
                value={optionsCsv}
                onChange={(e) => setOptionsCsv(e.target.value)}
                placeholder="private, shared"
                className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
              />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Orden">
              <input
                type="number"
                value={position}
                onChange={(e) => setPosition(Number(e.target.value))}
                className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Obligatoria">
              <select
                value={isRequired ? 'yes' : 'no'}
                onChange={(e) => setIsRequired(e.target.value === 'yes')}
                className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
              >
                <option value="yes">Sí</option>
                <option value="no">No</option>
              </select>
            </Field>
          </div>
        </div>

        {err ? <p className="mt-3 text-xs text-danger">{err}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-light px-4 py-2 text-sm text-gray-medium hover:bg-offwhite"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !label || !key}
            onClick={save}
            className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-medium">{label}</span>
      {children}
    </label>
  );
}
