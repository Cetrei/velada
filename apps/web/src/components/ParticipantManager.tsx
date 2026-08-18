import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant } from "@velada/core";

interface ParticipantManagerProps {
  initialParticipants: Participant[];
}

const ROLES: Participant["mainRole"][] = ["Top", "Jungle", "Mid", "ADC", "Support"];
const SERVERS = ["LAN", "LAS", "NA", "BR", "EUW", "EUNE", "KR", "JP", "OCE"];

const EMPTY_FORM = {
  id: "",
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

type StatusMessage = { type: "success" | "error"; text: string } | null;

export default function ParticipantManager({ initialParticipants }: ParticipantManagerProps) {
  const [participants, setParticipants] = useState(initialParticipants);
  const [form, setForm] = useState(EMPTY_FORM);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLookingUpRank, setIsLookingUpRank] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function resetForm() {
    setForm(EMPTY_FORM);
    setPhotoFile(null);
    setEditingId(null);
  }

  function loadIntoForm(p: Participant) {
    setForm({
      id: p.id,
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
    setPhotoFile(null);
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleLookupRank() {
    if (!form.lolUsername || !form.lolServer) {
      setStatus({ type: "error", text: "Completa usuario de LoL y servidor primero." });
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
    setStatus({ type: "success", text: "Elo actualizado desde Riot API." });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.id || !form.name || !form.nickname || !form.lolRank || !form.favChampion) {
      setStatus({ type: "error", text: "Completa los campos obligatorios." });
      return;
    }

    setIsBusy(true);
    const data = new FormData();
    data.set("id", form.id);
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
    if (photoFile) data.set("photo", photoFile);

    const { data: result, error } = await actions.saveParticipant(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setStatus({ type: "success", text: `${form.name} guardado correctamente.` });

    setParticipants((prev) => {
      const next = prev.filter((p) => p.id !== result.id);
      return [
        ...next,
        {
          id: form.id,
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
          description: form.description || undefined
        }
      ];
    });

    resetForm();
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Borrar este participante?")) return;

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
    setStatus({ type: "success", text: "Participante eliminado." });
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

      <form
        onSubmit={handleSubmit}
        className="bg-lol-cardBg border border-lol-border p-6 rounded-xl space-y-4"
      >
        <h2 className="font-display text-xl font-bold text-white uppercase mb-2">
          {editingId ? `Editando: ${editingId}` : "Nuevo participante"}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="ID unico *">
            <input
              value={form.id}
              disabled={!!editingId}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              className="input"
              placeholder="p11"
            />
          </Field>
          <Field label="Nombre *">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Apodo *">
            <input
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Rol principal *">
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
          <Field label="Campeon favorito *">
            <input
              value={form.favChampion}
              onChange={(e) => setForm({ ...form, favChampion: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Edad">
            <input
              type="number"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Peso">
            <input
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              className="input"
              placeholder="75 kg"
            />
          </Field>
          <Field label="Altura">
            <input
              value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
              className="input"
              placeholder="178 cm"
            />
          </Field>
        </div>

        <div className="border-t border-lol-border/50 pt-4">
          <h3 className="text-sm uppercase text-slate-400 mb-3">League of Legends</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Usuario (Riot ID)">
              <input
                value={form.lolUsername}
                onChange={(e) => setForm({ ...form, lolUsername: e.target.value })}
                className="input"
                placeholder="Nombre#TAG"
              />
            </Field>
            <Field label="Servidor">
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
            <Field label="Rango *">
              <div className="flex gap-2">
                <input
                  value={form.lolRank}
                  onChange={(e) => setForm({ ...form, lolRank: e.target.value })}
                  className="input"
                  placeholder="Diamond II"
                />
                <button
                  type="button"
                  disabled={isLookingUpRank}
                  onClick={handleLookupRank}
                  className="px-3 bg-lol-blue/10 border border-lol-blue text-lol-blue text-xs uppercase font-bold whitespace-nowrap disabled:opacity-50"
                >
                  {isLookingUpRank ? "..." : "Consultar"}
                </button>
              </div>
            </Field>
          </div>
        </div>

        <Field label="Descripcion">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input min-h-24"
          />
        </Field>

        <Field label="Foto (desde archivos o camara del celular)">
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
            {editingId ? "Guardar cambios" : "Agregar participante"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="py-3 px-6 border border-lol-border text-slate-300 uppercase text-sm font-bold"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
        <h3 className="font-display text-xl font-bold text-white uppercase mb-4">
          Roster actual ({participants.length})
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
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={isBusy}
                  className="text-red-400 hover:underline font-bold uppercase text-xs disabled:opacity-50"
                >
                  Borrar
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
