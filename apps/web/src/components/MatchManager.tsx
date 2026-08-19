import { useState } from "react";
import { actions } from "astro:actions";
import type { Match, Participant } from "@velada/core";
import { ADMIN_CONTROL } from "@velada/core";

interface MatchManagerProps {
  initialMatches: Match[];
  participants: Participant[];
}

const EMPTY_FORM = {
  matchNumber: "",
  name: "",
  player1Id: "",
  player2Id: "",
  winnerId: "",
  decision: ""
};

type StatusMessage = { type: "success" | "error"; text: string } | null;

function participantName(participants: Participant[], id: string | null | undefined): string {
  if (!id) return "—";
  return participants.find((p) => p.id === id)?.name ?? id;
}

export default function MatchManager({ initialMatches, participants }: MatchManagerProps) {
  const [matches, setMatches] = useState(initialMatches);
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setInvalidFields(new Set());
  }

  function closeForm() {
    setIsFormOpen(false);
    resetForm();
  }

  function openNewForm() {
    resetForm();
    setIsFormOpen(true);
  }

  function loadIntoForm(m: Match) {
    setForm({
      matchNumber: m.matchNumber?.toString() ?? "",
      name: m.name ?? "",
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      winnerId: m.winnerId ?? "",
      decision: m.decision ?? ""
    });
    setEditingId(m.id ?? null);
    setInvalidFields(new Set());
    setIsFormOpen(true);
  }

  function updateField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (invalidFields.has(key)) {
      setInvalidFields((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const missing = new Set<string>();
    if (!form.player1Id) missing.add("player1Id");
    if (!form.player2Id) missing.add("player2Id");
    if (missing.size > 0) {
      setInvalidFields(missing);
      setStatus({ type: "error", text: PARTICIPANT_REQUIRED_TEXT });
      return;
    }
    if (form.player1Id === form.player2Id) {
      setInvalidFields(new Set(["player1Id", "player2Id"]));
      setStatus({ type: "error", text: ADMIN_CONTROL.errorNeedTwoDifferent });
      return;
    }
    setInvalidFields(new Set());

    setIsBusy(true);
    const data = new FormData();
    if (editingId) data.set("id", editingId);
    if (form.matchNumber) data.set("matchNumber", form.matchNumber);
    if (form.name) data.set("name", form.name);
    data.set("player1Id", form.player1Id);
    data.set("player2Id", form.player2Id);
    if (form.winnerId) data.set("winnerId", form.winnerId);
    if (form.decision) data.set("decision", form.decision);
    // predictionsOpen is managed via the per-row toggle, not this form —
    // preserve the existing value when editing so saving the form doesn't
    // silently close predictions.
    const existing = editingId ? matches.find((m) => m.id === editingId) : undefined;
    data.set("predictionsOpen", String(existing?.predictionsOpen ?? false));

    const { data: result, error } = await actions.saveMatch(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    const savedMatch: Match = {
      id: result.id,
      matchNumber: form.matchNumber ? Number(form.matchNumber) : undefined,
      name: form.name || null,
      player1Id: form.player1Id,
      player2Id: form.player2Id,
      winnerId: form.winnerId || null,
      decision: form.decision || null,
      judgeCards: existing?.judgeCards ?? null,
      predictionsOpen: existing?.predictionsOpen ?? false,
      isRandom: false,
      createdAt: existing?.createdAt
    };

    setMatches((prev) => {
      const next = prev.filter((m) => m.id !== result.id);
      return [...next, savedMatch];
    });

    setStatus({
      type: "success",
      text: editingId ? ADMIN_CONTROL.successMatchUpdated : ADMIN_CONTROL.successMatchCreated
    });
    closeForm();
  }

  async function handleDelete(id: string | undefined) {
    if (!id) return;
    if (!confirm(ADMIN_CONTROL.confirmDeleteMatch)) return;

    setIsBusy(true);
    const data = new FormData();
    data.set("id", id);
    const { error } = await actions.deleteMatch(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setMatches((prev) => prev.filter((m) => m.id !== id));
    setStatus({ type: "success", text: ADMIN_CONTROL.successMatchDeleted });
    if (editingId === id) resetForm();
  }

  async function togglePredictions(m: Match) {
    if (!m.id) return;
    setIsBusy(true);
    const data = new FormData();
    data.set("id", m.id);
    if (m.matchNumber) data.set("matchNumber", String(m.matchNumber));
    if (m.name) data.set("name", m.name);
    data.set("player1Id", m.player1Id);
    data.set("player2Id", m.player2Id);
    if (m.winnerId) data.set("winnerId", m.winnerId);
    if (m.decision) data.set("decision", m.decision);
    if (m.judgeCards) data.set("judgeCards", JSON.stringify(m.judgeCards));
    data.set("predictionsOpen", String(!m.predictionsOpen));

    const { error } = await actions.saveMatch(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setMatches((prev) =>
      prev.map((row) => (row.id === m.id ? { ...row, predictionsOpen: !m.predictionsOpen } : row))
    );
  }

  const sortedMatches = [...matches].sort((a, b) => {
    const an = a.matchNumber ?? Number.MAX_SAFE_INTEGER;
    const bn = b.matchNumber ?? Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  });

  return (
    <div className="space-y-8">
      {status && (
        <div
          className={`text-sm p-3 rounded ${
            status.type === "success"
              ? "bg-green-900/30 text-green-400 border border-green-800"
              : "bg-red-900/30 text-red-400 border border-red-800"
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-bold text-white uppercase">
          {ADMIN_CONTROL.matchesTitle}
        </h3>
        <button
          type="button"
          onClick={openNewForm}
          className="px-4 py-2 bg-lol-gold text-black font-bold uppercase text-xs tracking-wide hover:bg-yellow-400"
        >
          {ADMIN_CONTROL.newMatchCta}
        </button>
      </div>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <form
            onSubmit={handleSubmit}
            className="bg-lol-cardBg border border-lol-border p-4 sm:p-6 rounded-xl space-y-4 w-full max-w-2xl min-w-0 box-border max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-xl font-bold text-white uppercase">
                {editingId ? ADMIN_CONTROL.matchesTitle : ADMIN_CONTROL.newMatchCta}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="text-slate-400 hover:text-white text-xl leading-none px-2"
              >
                &times;
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={ADMIN_CONTROL.matchNumberLabel}>
                <input
                  type="number"
                  min={1}
                  value={form.matchNumber}
                  onChange={(e) => updateField("matchNumber", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Nombre del combate">
                <input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="input"
                  placeholder="Ej: Semifinal"
                />
              </Field>
              <Field label={ADMIN_CONTROL.player1Label} invalid={invalidFields.has("player1Id")}>
                <select
                  value={form.player1Id}
                  onChange={(e) => updateField("player1Id", e.target.value)}
                  className={`input ${invalidFields.has("player1Id") ? "input-invalid" : ""}`}
                >
                  <option value="">—</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={ADMIN_CONTROL.player2Label} invalid={invalidFields.has("player2Id")}>
                <select
                  value={form.player2Id}
                  onChange={(e) => updateField("player2Id", e.target.value)}
                  className={`input ${invalidFields.has("player2Id") ? "input-invalid" : ""}`}
                >
                  <option value="">—</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="border-t border-lol-border/50 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={ADMIN_CONTROL.winnerLabel}>
                <select
                  value={form.winnerId}
                  onChange={(e) => updateField("winnerId", e.target.value)}
                  className="input"
                >
                  <option value="">{ADMIN_CONTROL.noWinnerYet}</option>
                  {[form.player1Id, form.player2Id]
                    .filter((id) => id)
                    .map((id) => (
                      <option key={id} value={id}>
                        {participantName(participants, id)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={ADMIN_CONTROL.decisionLabel}>
                <input
                  value={form.decision}
                  onChange={(e) => updateField("decision", e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isBusy}
                className="flex-1 py-3 px-6 bg-lol-gold text-black font-bold uppercase tracking-wide hover:bg-yellow-400 disabled:opacity-50"
              >
                {editingId ? ADMIN_CONTROL.saveResultCta : ADMIN_CONTROL.createMatchCta}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="py-3 px-6 border border-lol-border text-slate-300 uppercase text-sm font-bold"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {sortedMatches.length === 0 && (
          <p className="text-slate-500 text-sm">No hay combates cargados todavia.</p>
        )}
        {sortedMatches.map((m) => (
          <div
            key={m.id}
            className="bg-lol-darkBg border border-lol-border/50 rounded px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-white font-bold">
                {m.matchNumber ? `#${m.matchNumber} · ` : ""}
                {m.name ? `${m.name} · ` : ""}
                {participantName(participants, m.player1Id)} vs {participantName(participants, m.player2Id)}
              </div>
              <div className="text-slate-500 text-xs mt-1">
                {m.winnerId ? (
                  <>
                    {ADMIN_CONTROL.winnerLabel}: {participantName(participants, m.winnerId)}
                    {m.decision ? ` · ${m.decision}` : ""}
                  </>
                ) : (
                  ADMIN_CONTROL.noWinnerYet
                )}
                {m.isRandom ? " · Sorteado" : ""}
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm flex-shrink-0">
              <button
                type="button"
                onClick={() => togglePredictions(m)}
                disabled={isBusy}
                className={`text-xs uppercase font-bold px-3 py-1.5 rounded border disabled:opacity-50 ${
                  m.predictionsOpen
                    ? "border-lol-gold text-lol-gold bg-lol-gold/10"
                    : "border-lol-border text-slate-400"
                }`}
                title={ADMIN_CONTROL.predictionsOpenLabel}
              >
                {m.predictionsOpen ? ADMIN_CONTROL.predictionsOpenLabel : ADMIN_CONTROL.togglePredictionsCta}
              </button>
              <button
                onClick={() => loadIntoForm(m)}
                className="text-lol-blue hover:underline font-bold uppercase text-xs"
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(m.id)}
                disabled={isBusy}
                className="text-red-400 hover:underline font-bold uppercase text-xs disabled:opacity-50"
              >
                {ADMIN_CONTROL.deleteMatchCta}
              </button>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .input {
          width: 100%;
          background: #0A1428;
          border: 1px solid rgba(200, 170, 110, 0.2);
          border-radius: 4px;
          padding: 0.65rem 1rem;
          color: white;
        }
        .input:focus {
          outline: none;
          border-color: #C8AA6E;
        }
        .input-invalid {
          border-color: rgba(248, 113, 113, 0.5);
        }
      `}</style>
    </div>
  );
}

const PARTICIPANT_REQUIRED_TEXT = "Elegi los dos peleadores del combate.";

function Field({
  label,
  children,
  invalid = false
}: {
  label: string;
  children: React.ReactNode;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className={`block text-xs uppercase mb-2 ${invalid ? "text-red-400/80" : "text-slate-400"}`}>
        {label}
      </span>
      {children}
    </label>
  );
}
