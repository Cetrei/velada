import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant, TeamMatch, TeamGenerationMode } from "@velada/core";
import { TEAM_MATCH_MANAGER, computeSkillRating } from "@velada/core";
import { participantIdsInTeamMatches } from "../lib/teamMatches";

interface TeamMatchManagerProps {
  initialTeamMatches: TeamMatch[];
  participants: Participant[];
}

type StatusMessage = { type: "success" | "error"; text: string } | null;

function participantName(participants: Participant[], id: string): string {
  return participants.find((p) => p.id === id)?.name ?? id;
}

function ratingOf(p: Participant): number {
  return Math.round(computeSkillRating({ performanceScores: p.performanceScores, lolRank: p.lolRank }));
}

const EMPTY_MANUAL_FORM = {
  name: "",
  teamAIds: [] as string[],
  teamBIds: [] as string[],
  winnerTeam: "" as "" | "A" | "B"
};

export default function TeamMatchManager({ initialTeamMatches, participants }: TeamMatchManagerProps) {
  const [teamMatches, setTeamMatches] = useState(initialTeamMatches);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [mode, setMode] = useState<TeamGenerationMode>("balanced");
  const [excludedIds, setExcludedIds] = useState<Set<string>>(
    () => participantIdsInTeamMatches(initialTeamMatches)
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);

  function toggleExcluded(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function markAll() {
    setExcludedIds(new Set(participants.map((p) => p.id)));
  }

  function unmarkAll() {
    setExcludedIds(new Set());
  }

  async function handleGenerate() {
    const availableIds = participants.filter((p) => !excludedIds.has(p.id)).map((p) => p.id);
    if (availableIds.length < 6) {
      setStatus({ type: "error", text: TEAM_MATCH_MANAGER.errorNotEnoughPlayers });
      return;
    }

    setIsBusy(true);
    const data = new FormData();
    data.set("participantIds", JSON.stringify(availableIds));
    data.set("mode", mode);

    const { data: result, error } = await actions.generateTeamMatchesAction(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    // generateTeamMatchesAction only returns created count + leftover ids,
    // not the full inserted rows (avoids a second round-trip server-side
    // just to shape them) -- simplest correct way to show the new rows in
    // this list is a full reload, same as landing on the tab fresh.
    setStatus({
      type: "success",
      text:
        TEAM_MATCH_MANAGER.successGenerated(result.created) +
        (result.leftOverIds.length > 0
          ? " " + TEAM_MATCH_MANAGER.leftOverHint(result.leftOverIds.map((id: string) => participantName(participants, id)).join(", "))
          : "")
    });
    window.location.reload();
  }

  function resetManualForm() {
    setManualForm(EMPTY_MANUAL_FORM);
    setEditingId(null);
  }

  function closeForm() {
    setIsFormOpen(false);
    resetManualForm();
  }

  function openNewForm() {
    resetManualForm();
    setIsFormOpen(true);
  }

  function loadIntoForm(tm: TeamMatch) {
    setManualForm({
      name: tm.name ?? "",
      teamAIds: tm.teamAIds,
      teamBIds: tm.teamBIds,
      winnerTeam: tm.winnerTeam ?? ""
    });
    setEditingId(tm.id ?? null);
    setIsFormOpen(true);
  }

  function toggleInTeam(team: "A" | "B", id: string) {
    setManualForm((prev) => {
      const key = team === "A" ? "teamAIds" : "teamBIds";
      const otherKey = team === "A" ? "teamBIds" : "teamAIds";
      const already = prev[key].includes(id);
      return {
        ...prev,
        [key]: already ? prev[key].filter((x) => x !== id) : [...prev[key], id],
        [otherKey]: prev[otherKey].filter((x) => x !== id)
      };
    });
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (manualForm.teamAIds.length !== manualForm.teamBIds.length) {
      setStatus({ type: "error", text: TEAM_MATCH_MANAGER.errorNeedEvenTeams });
      return;
    }
    if (manualForm.teamAIds.length === 0) {
      setStatus({ type: "error", text: TEAM_MATCH_MANAGER.errorNotEnoughPlayers });
      return;
    }

    setIsBusy(true);
    const data = new FormData();
    if (editingId) data.set("id", editingId);
    if (manualForm.name) data.set("name", manualForm.name);
    data.set("teamAIds", JSON.stringify(manualForm.teamAIds));
    data.set("teamBIds", JSON.stringify(manualForm.teamBIds));
    if (manualForm.winnerTeam) data.set("winnerTeam", manualForm.winnerTeam);
    data.set("generationMode", "manual");

    const { data: result, error } = await actions.saveTeamMatch(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    const saved: TeamMatch = {
      id: result.id,
      name: manualForm.name || null,
      teamAIds: manualForm.teamAIds,
      teamBIds: manualForm.teamBIds,
      winnerTeam: manualForm.winnerTeam || null,
      generationMode: "manual"
    };

    setTeamMatches((prev) => {
      const next = prev.filter((m) => m.id !== result.id);
      return [saved, ...next];
    });
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const id of [...manualForm.teamAIds, ...manualForm.teamBIds]) next.add(id);
      return next;
    });

    setStatus({ type: "success", text: TEAM_MATCH_MANAGER.successSaved });
    closeForm();
  }

  async function setWinner(tm: TeamMatch, winnerTeam: "A" | "B") {
    if (!tm.id) return;
    setIsBusy(true);
    const data = new FormData();
    data.set("id", tm.id);
    if (tm.name) data.set("name", tm.name);
    data.set("teamAIds", JSON.stringify(tm.teamAIds));
    data.set("teamBIds", JSON.stringify(tm.teamBIds));
    data.set("winnerTeam", winnerTeam);
    data.set("generationMode", tm.generationMode);

    const { error } = await actions.saveTeamMatch(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setTeamMatches((prev) => prev.map((m) => (m.id === tm.id ? { ...m, winnerTeam } : m)));
  }

  async function handleDelete(id: string | undefined) {
    if (!id) return;
    if (!confirm(TEAM_MATCH_MANAGER.confirmDelete)) return;

    setIsBusy(true);
    const data = new FormData();
    data.set("id", id);
    const { error } = await actions.deleteTeamMatch(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setTeamMatches((prev) => prev.filter((m) => m.id !== id));
    setStatus({ type: "success", text: TEAM_MATCH_MANAGER.successDeleted });
    if (editingId === id) resetManualForm();
  }

  const sortedTeamMatches = [...teamMatches].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );

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

      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl space-y-4">
        <div>
          <h3 className="font-display text-xl font-bold text-white uppercase">{TEAM_MATCH_MANAGER.title}</h3>
          <p className="text-slate-500 text-xs mt-1">{TEAM_MATCH_MANAGER.hint}</p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm uppercase text-slate-400 font-bold">
            {TEAM_MATCH_MANAGER.excludeListTitle}
          </span>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={markAll} className="text-lol-blue hover:underline font-bold uppercase">
              {TEAM_MATCH_MANAGER.markAllCta}
            </button>
            <button type="button" onClick={unmarkAll} className="text-lol-blue hover:underline font-bold uppercase">
              {TEAM_MATCH_MANAGER.unmarkAllCta}
            </button>
          </div>
        </div>

        <p className="text-slate-500 text-xs">
          {TEAM_MATCH_MANAGER.excludedHint(excludedIds.size, participants.length)}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
          {participants.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 bg-lol-darkBg border border-lol-border/50 rounded px-3 py-2 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={excludedIds.has(p.id)}
                onChange={() => toggleExcluded(p.id)}
                className="accent-lol-gold"
              />
              <span className="text-white truncate">{p.name}</span>
              <span className="text-slate-500 text-xs ml-auto flex-shrink-0">
                {TEAM_MATCH_MANAGER.ratingLabel} {ratingOf(p)}
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-lol-border/50">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 uppercase text-xs">{TEAM_MATCH_MANAGER.modeLabel}</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as TeamGenerationMode)}
              className="input !w-auto"
            >
              <option value="random">{TEAM_MATCH_MANAGER.modeRandom}</option>
              <option value="balanced">{TEAM_MATCH_MANAGER.modeBalanced}</option>
              <option value="unfair">{TEAM_MATCH_MANAGER.modeUnfair}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isBusy}
            className="px-4 py-2 bg-lol-gold text-black font-bold uppercase text-xs tracking-wide hover:bg-yellow-400 disabled:opacity-50"
          >
            {isBusy ? TEAM_MATCH_MANAGER.generateCtaBusy : TEAM_MATCH_MANAGER.generateCta}
          </button>
          <button
            type="button"
            onClick={openNewForm}
            className="px-4 py-2 border border-lol-border text-slate-300 uppercase text-xs font-bold hover:border-lol-gold hover:text-lol-gold"
          >
            {TEAM_MATCH_MANAGER.manualCta}
          </button>
        </div>
      </div>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <form
            onSubmit={handleManualSubmit}
            className="bg-lol-cardBg border border-lol-border p-4 sm:p-6 rounded-xl space-y-4 w-full max-w-3xl min-w-0 box-border max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-xl font-bold text-white uppercase">
                {editingId ? TEAM_MATCH_MANAGER.editCta : TEAM_MATCH_MANAGER.newTeamMatchTitle}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="text-slate-400 hover:text-white text-xl leading-none px-2"
              >
                &times;
              </button>
            </div>

            <input
              value={manualForm.name}
              onChange={(e) => setManualForm((prev) => ({ ...prev, name: e.target.value }))}
              className="input"
              placeholder="Nombre (opcional, ej: Grupo 1)"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TeamPicker
                label={TEAM_MATCH_MANAGER.teamALabel}
                participants={participants}
                selectedIds={manualForm.teamAIds}
                onToggle={(id) => toggleInTeam("A", id)}
              />
              <TeamPicker
                label={TEAM_MATCH_MANAGER.teamBLabel}
                participants={participants}
                selectedIds={manualForm.teamBIds}
                onToggle={(id) => toggleInTeam("B", id)}
              />
            </div>

            {editingId && (
              <label className="block">
                <span className="block text-xs uppercase mb-2 text-slate-400">
                  {TEAM_MATCH_MANAGER.winnerLabel}
                </span>
                <select
                  value={manualForm.winnerTeam}
                  onChange={(e) =>
                    setManualForm((prev) => ({ ...prev, winnerTeam: e.target.value as "" | "A" | "B" }))
                  }
                  className="input"
                >
                  <option value="">{TEAM_MATCH_MANAGER.noWinnerYet}</option>
                  <option value="A">{TEAM_MATCH_MANAGER.teamALabel}</option>
                  <option value="B">{TEAM_MATCH_MANAGER.teamBLabel}</option>
                </select>
              </label>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isBusy}
                className="flex-1 py-3 px-6 bg-lol-gold text-black font-bold uppercase tracking-wide hover:bg-yellow-400 disabled:opacity-50"
              >
                {TEAM_MATCH_MANAGER.saveCta}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="py-3 px-6 border border-lol-border text-slate-300 uppercase text-sm font-bold"
              >
                {TEAM_MATCH_MANAGER.cancelCta}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {sortedTeamMatches.length === 0 && (
          <p className="text-slate-500 text-sm">{TEAM_MATCH_MANAGER.emptyState}</p>
        )}
        {sortedTeamMatches.map((tm) => (
          <div
            key={tm.id}
            className="bg-lol-darkBg border border-lol-border/50 rounded px-4 py-3 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-white font-bold">
                  {tm.name ? `${tm.name} · ` : ""}
                  {tm.teamAIds.length}v{tm.teamBIds.length} · {tm.generationMode}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm flex-shrink-0">
                <button
                  onClick={() => loadIntoForm(tm)}
                  className="text-lol-blue hover:underline font-bold uppercase text-xs"
                >
                  {TEAM_MATCH_MANAGER.editCta}
                </button>
                <button
                  onClick={() => handleDelete(tm.id)}
                  disabled={isBusy}
                  className="text-red-400 hover:underline font-bold uppercase text-xs disabled:opacity-50"
                >
                  {TEAM_MATCH_MANAGER.deleteCta}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TeamSummary
                label={TEAM_MATCH_MANAGER.teamALabel}
                ids={tm.teamAIds}
                participants={participants}
                isWinner={tm.winnerTeam === "A"}
                onSetWinner={() => setWinner(tm, "A")}
                disabled={isBusy}
              />
              <TeamSummary
                label={TEAM_MATCH_MANAGER.teamBLabel}
                ids={tm.teamBIds}
                participants={participants}
                isWinner={tm.winnerTeam === "B"}
                onSetWinner={() => setWinner(tm, "B")}
                disabled={isBusy}
              />
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
      `}</style>
    </div>
  );
}

function TeamPicker({
  label,
  participants,
  selectedIds,
  onToggle
}: {
  label: string;
  participants: Participant[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <span className="block text-xs uppercase mb-2 text-slate-400">{label}</span>
      <div className="border border-lol-border/50 rounded max-h-48 overflow-y-auto">
        {participants.map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-2 px-3 py-2 text-sm border-b border-lol-border/30 last:border-b-0 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(p.id)}
              onChange={() => onToggle(p.id)}
              className="accent-lol-gold"
            />
            <span className="text-white truncate">{p.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TeamSummary({
  label,
  ids,
  participants,
  isWinner,
  onSetWinner,
  disabled
}: {
  label: string;
  ids: string[];
  participants: Participant[];
  isWinner: boolean;
  onSetWinner: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`rounded border p-3 ${
        isWinner ? "border-lol-gold bg-lol-gold/10" : "border-lol-border/50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
        <button
          type="button"
          onClick={onSetWinner}
          disabled={disabled}
          className={`text-xs uppercase font-bold px-2 py-1 rounded border disabled:opacity-50 ${
            isWinner ? "border-lol-gold text-lol-gold" : "border-lol-border text-slate-500"
          }`}
        >
          {isWinner ? "Ganador" : "Marcar ganador"}
        </button>
      </div>
      <ul className="text-sm text-slate-300 space-y-0.5">
        {ids.map((id) => (
          <li key={id} className="truncate">
            {participantName(participants, id)}
          </li>
        ))}
      </ul>
    </div>
  );
}
