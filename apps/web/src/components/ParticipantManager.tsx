import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant, ParticipantStat } from "@velada/core";
import { PARTICIPANT_MANAGER } from "@velada/core";

interface ParticipantManagerProps {
  initialParticipants: Participant[];
}

const ROLES: Participant["mainRole"][] = ["Top", "Jungle", "Mid", "ADC", "Support"];
const SERVERS = ["LAN", "LAS", "NA", "BR", "EUW", "EUNE", "KR", "JP", "OCE"];

const EMPTY_FORM = {
  name: "",
  nickname: "",
  age: "",
  weight: "",
  height: "",
  lolRank: "",
  lolUsername: "",
  lolServer: "LAN",
  mainRole: "Top" as Participant["mainRole"],
  favChampion: "",
  description: ""
};

const EMPTY_STAT: ParticipantStat = { label: "", value: 50 };

type StatWithKey = ParticipantStat & { _key: string };

function makeStatKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `stat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type StatusMessage = { type: "success" | "error"; text: string } | null;

export default function ParticipantManager({ initialParticipants }: ParticipantManagerProps) {
  const [participants, setParticipants] = useState(initialParticipants);
  const [form, setForm] = useState(EMPTY_FORM);
  const [stats, setStats] = useState<StatWithKey[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLookingUpRank, setIsLookingUpRank] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  function resetForm() {
    setForm(EMPTY_FORM);
    setStats([]);
    setPhotoFile(null);
    setEditingId(null);
  }

  function openNewForm() {
    resetForm();
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    resetForm();
  }

  function addStat() {
    setStats((prev) => [...prev, { ...EMPTY_STAT, _key: makeStatKey() }]);
  }

  function updateStat(key: string, patch: Partial<ParticipantStat>) {
    setStats((prev) => prev.map((s) => (s._key === key ? { ...s, ...patch } : s)));
  }

  function removeStat(key: string) {
    setStats((prev) => prev.filter((s) => s._key !== key));
  }

  function loadIntoForm(p: Participant) {
    setForm({
      name: p.name,
      nickname: p.nickname,
      age: p.age?.toString() ?? "",
      weight: p.weight ?? "",
      height: p.height ?? "",
      lolRank: p.lolRank,
      lolUsername: p.lolUsername ?? "",
      lolServer: p.lolServer ?? "LAN",
      mainRole: p.mainRole,
      favChampion: p.favChampion,
      description: p.description ?? ""
    });
    setStats((p.stats ?? []).map((s) => ({ ...s, _key: makeStatKey() })));
    setPhotoFile(null);
    setEditingId(p.id);
    setIsFormOpen(true);
  }

  async function handleLookupRank() {
    if (!form.lolUsername || !form.lolServer) {
      setStatus({ type: "error", text: PARTICIPANT_MANAGER.errorLookupMissingFields });
      return;
    }

    setIsLookingUpRank(true);
    const data = new FormData();
    data.set("lolUsername", form.lolUsername);
    data.set("lolServer", form.lolServer);

    const { data: result, error } = await actions.lookupRank(data);
    setIsLookingUpRank(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setForm((prev) => ({ ...prev, lolRank: `${result.rank} (${result.lp} LP)` }));
    setStatus({ type: "success", text: PARTICIPANT_MANAGER.successRankUpdated });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.nickname || !form.lolRank || !form.favChampion) {
      setStatus({ type: "error", text: PARTICIPANT_MANAGER.errorRequiredFields });
      return;
    }

    const participantId = editingId ?? crypto.randomUUID();

    setIsBusy(true);
    const data = new FormData();
    data.set("id", participantId);
    data.set("name", form.name);
    data.set("nickname", form.nickname);
    if (form.age) data.set("age", form.age);
    if (form.weight) data.set("weight", form.weight);
    if (form.height) data.set("height", form.height);
    data.set("lolRank", form.lolRank);
    if (form.lolUsername) data.set("lolUsername", form.lolUsername);
    if (form.lolServer) data.set("lolServer", form.lolServer);
    data.set("mainRole", form.mainRole);
    data.set("favChampion", form.favChampion);
    if (form.description) data.set("description", form.description);
    const validStats: ParticipantStat[] = stats
      .filter((s) => s.label.trim().length > 0)
      .map(({ _key, ...s }) => s);
    if (validStats.length > 0) data.set("stats", JSON.stringify(validStats));
    if (photoFile) data.set("photo", photoFile);

    const { data: result, error } = await actions.saveParticipant(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setStatus({ type: "success", text: PARTICIPANT_MANAGER.successSaved(form.name) });
    setIsFormOpen(false);

    setParticipants((prev) => {
      const next = prev.filter((p) => p.id !== result.id);
      return [
        ...next,
        {
          id: participantId,
          name: form.name,
          nickname: form.nickname,
          age: form.age ? Number(form.age) : undefined,
          weight: form.weight || undefined,
          height: form.height || undefined,
          lolRank: form.lolRank,
          lolUsername: form.lolUsername || undefined,
          lolServer: form.lolServer || undefined,
          mainRole: form.mainRole,
          favChampion: form.favChampion,
          description: form.description || undefined,
          stats: validStats.length > 0 ? validStats : undefined
        }
      ];
    });

    resetForm();
  }

  async function handleDelete(id: string) {
    if (!confirm(PARTICIPANT_MANAGER.confirmDelete)) return;

    setIsBusy(true);
    const data = new FormData();
    data.set("id", id);
    const { error } = await actions.deleteParticipant(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setParticipants((prev) => prev.filter((p) => p.id !== id));
    setStatus({ type: "success", text: PARTICIPANT_MANAGER.successDeleted });
    if (editingId === id) resetForm();
  }

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

      <div className="flex justify-end">
        <button
          type="button"
          onClick={openNewForm}
          className="py-3 px-6 bg-lol-gold text-black font-bold uppercase tracking-wide hover:bg-yellow-400 transition-all"
        >
          {PARTICIPANT_MANAGER.newParticipant}
        </button>
      </div>

      {isFormOpen && (
      <div
        className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 p-4 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeForm();
        }}
      >
      <form
        onSubmit={handleSubmit}
        className="bg-lol-cardBg border border-lol-border p-6 rounded-xl space-y-4 w-full max-w-3xl my-8"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-xl font-bold text-white uppercase">
            {editingId ? PARTICIPANT_MANAGER.editingParticipant(editingId) : PARTICIPANT_MANAGER.newParticipant}
          </h2>
          <button
            type="button"
            onClick={closeForm}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
            aria-label={PARTICIPANT_MANAGER.cancelCta}
          >
            &times;
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={PARTICIPANT_MANAGER.fields.name}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
            />
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.nickname}>
            <input
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              className="input"
            />
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.mainRole}>
            <select
              value={form.mainRole}
              onChange={(e) => setForm({ ...form, mainRole: e.target.value as Participant["mainRole"] })}
              className="input"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.favChampion}>
            <input
              value={form.favChampion}
              onChange={(e) => setForm({ ...form, favChampion: e.target.value })}
              className="input"
            />
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.age}>
            <input
              type="number"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
              className="input"
            />
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.weight}>
            <input
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              className="input"
              placeholder={PARTICIPANT_MANAGER.placeholders.weight}
            />
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.height}>
            <input
              value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
              className="input"
              placeholder={PARTICIPANT_MANAGER.placeholders.height}
            />
          </Field>
        </div>

        <div className="border-t border-lol-border/50 pt-4">
          <h3 className="text-sm uppercase text-slate-400 mb-3">{PARTICIPANT_MANAGER.lolSectionTitle}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label={PARTICIPANT_MANAGER.fields.lolUsername}>
              <input
                value={form.lolUsername}
                onChange={(e) => setForm({ ...form, lolUsername: e.target.value })}
                className="input"
                placeholder={PARTICIPANT_MANAGER.placeholders.lolUsername}
              />
            </Field>
            <Field label={PARTICIPANT_MANAGER.fields.lolServer}>
              <select
                value={form.lolServer}
                onChange={(e) => setForm({ ...form, lolServer: e.target.value })}
                className="input"
              >
                {SERVERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={PARTICIPANT_MANAGER.fields.lolRank}>
              <div className="flex gap-2">
                <input
                  value={form.lolRank}
                  onChange={(e) => setForm({ ...form, lolRank: e.target.value })}
                  className="input"
                  placeholder={PARTICIPANT_MANAGER.placeholders.lolRank}
                />
                <button
                  type="button"
                  disabled={isLookingUpRank}
                  onClick={handleLookupRank}
                  className="px-3 bg-lol-blue/10 border border-lol-blue text-lol-blue text-xs uppercase font-bold whitespace-nowrap disabled:opacity-50"
                >
                  {isLookingUpRank ? PARTICIPANT_MANAGER.lookupCtaBusy : PARTICIPANT_MANAGER.lookupCta}
                </button>
              </div>
            </Field>
          </div>
        </div>

        <Field label={PARTICIPANT_MANAGER.fields.description}>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input min-h-24"
          />
        </Field>

        <div className="border-t border-lol-border/50 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm uppercase text-slate-400">{PARTICIPANT_MANAGER.statsTitle}</h3>
            <button
              type="button"
              onClick={addStat}
              className="text-lol-gold hover:underline font-bold uppercase text-xs"
            >
              {PARTICIPANT_MANAGER.addStatCta}
            </button>
          </div>
          {stats.length === 0 && (
            <p className="text-slate-500 text-xs">{PARTICIPANT_MANAGER.statsEmptyHint}</p>
          )}
          <div className="space-y-2">
            {stats.map((stat) => (
              <div key={stat._key} className="flex gap-2 items-center">
                <input
                  value={stat.label}
                  onChange={(e) => updateStat(stat._key, { label: e.target.value })}
                  className="input flex-1"
                  placeholder={PARTICIPANT_MANAGER.placeholders.statLabel}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={stat.value}
                  onChange={(e) => updateStat(stat._key, { value: Number(e.target.value) })}
                  className="input w-24"
                />
                <button
                  type="button"
                  onClick={() => removeStat(stat._key)}
                  className="text-red-400 hover:underline font-bold uppercase text-xs whitespace-nowrap"
                >
                  {PARTICIPANT_MANAGER.removeStatCta}
                </button>
              </div>
            ))}
          </div>
        </div>

        <Field label={PARTICIPANT_MANAGER.fields.photo}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            className="input file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-lol-gold file:text-black file:font-bold file:uppercase file:text-xs"
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isBusy}
            className="flex-1 py-3 px-6 bg-lol-gold text-black font-bold uppercase tracking-wide hover:bg-yellow-400 disabled:opacity-50"
          >
            {editingId ? PARTICIPANT_MANAGER.submitEditCta : PARTICIPANT_MANAGER.submitNewCta}
          </button>
          <button
            type="button"
            onClick={closeForm}
            className="py-3 px-6 border border-lol-border text-slate-300 uppercase text-sm font-bold"
          >
            {PARTICIPANT_MANAGER.cancelCta}
          </button>
        </div>
      </form>
      </div>
      )}

      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
        <h3 className="font-display text-xl font-bold text-white uppercase mb-4">
          {PARTICIPANT_MANAGER.rosterTitle(participants.length)}
        </h3>
        <div className="space-y-2">
          {participants.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between bg-lol-darkBg border border-lol-border/50 rounded px-4 py-3"
            >
              <div>
                <span className="text-white font-bold">{p.name}</span>{" "}
                <span className="text-slate-500 text-sm">
                  "{p.nickname}" &middot; {p.mainRole} &middot; {p.lolRank}
                </span>
              </div>
              <div className="flex gap-3 text-sm">
                <button
                  onClick={() => loadIntoForm(p)}
                  className="text-lol-blue hover:underline font-bold uppercase text-xs"
                >
                  {PARTICIPANT_MANAGER.editCta}
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={isBusy}
                  className="text-red-400 hover:underline font-bold uppercase text-xs disabled:opacity-50"
                >
                  {PARTICIPANT_MANAGER.deleteCta}
                </button>
              </div>
            </div>
          ))}
        </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase text-slate-400 mb-2">{label}</span>
      {children}
    </label>
  );
}
