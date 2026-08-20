import { useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import type { Participant, ParticipantStat } from "@velada/core";
import { PARTICIPANT_MANAGER, rankIconPath, MAX_CUSTOM_STATS } from "@velada/core";
import { compressImageFile, PHOTO_COMPRESSION, BANNER_COMPRESSION } from "@velada/core/imageCompression";
import { FileInput } from "./FileInput";

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
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [photoHasExisting, setPhotoHasExisting] = useState(false);
  const [bannerHasExisting, setBannerHasExisting] = useState(false);
  const [compressingField, setCompressingField] = useState<"photo" | "banner" | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLookingUpRank, setIsLookingUpRank] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  // Skipea el auto-lookup en el primer render de loadIntoForm/reset -- solo
  // debe dispararse cuando el ADMIN escribe un lolUsername nuevo, no cada
  // vez que se abre el modal con un valor ya cargado del participante
  // (eso pegaria a mmradar en cada click de "Editar" sin necesidad).
  const skipNextLookup = useRef(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupRequestId = useRef(0);

  function resetForm() {
    skipNextLookup.current = true;
    setForm(EMPTY_FORM);
    setStats([]);
    setPhotoFile(null);
    setBannerFile(null);
    setPhotoHasExisting(false);
    setBannerHasExisting(false);
    setEditingId(null);
    setInvalidFields(new Set());
  }

  function closeForm() {
    setIsFormOpen(false);
    resetForm();
  }

  function addStat() {
    setStats((prev) => (prev.length >= MAX_CUSTOM_STATS ? prev : [...prev, { ...EMPTY_STAT, _key: makeStatKey() }]));
  }

  // Mismo criterio que ParticipantProfileForm.tsx: comprime en el
  // navegador antes de guardar en el estado (ver
  // packages/core/imageCompression.ts). El panel tambien puede recibir
  // fotos sin comprimir de un admin subiendo desde el celular.
  async function handlePhotoChange(fileList: FileList | null) {
    const raw = fileList?.[0] ?? null;
    if (!raw) {
      setPhotoFile(null);
      return;
    }
    setCompressingField("photo");
    const compressed = await compressImageFile(raw, PHOTO_COMPRESSION);
    setCompressingField((current) => (current === "photo" ? null : current));
    setPhotoFile(compressed);
  }

  async function handleBannerChange(fileList: FileList | null) {
    const raw = fileList?.[0] ?? null;
    if (!raw) {
      setBannerFile(null);
      return;
    }
    setCompressingField("banner");
    const compressed = await compressImageFile(raw, BANNER_COMPRESSION);
    setCompressingField((current) => (current === "banner" ? null : current));
    setBannerFile(compressed);
  }

  function updateStat(key: string, patch: Partial<ParticipantStat>) {
    setStats((prev) => prev.map((s) => (s._key === key ? { ...s, ...patch } : s)));
  }

  function removeStat(key: string) {
    setStats((prev) => prev.filter((s) => s._key !== key));
  }

  function loadIntoForm(p: Participant) {
    skipNextLookup.current = true;
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
    setBannerFile(null);
    setPhotoHasExisting(Boolean(p.photo));
    setBannerHasExisting(Boolean(p.banner));
    setEditingId(p.id);
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

  async function runLookup(lolUsername: string) {
    setIsLookingUpRank(true);
    const requestId = ++lookupRequestId.current;
    const data = new FormData();
    data.set("lolUsername", lolUsername);

    try {
      const { data: result, error } = await actions.lookupRank(data);
      if (requestId !== lookupRequestId.current) return;
      setIsLookingUpRank(false);

      if (error) {
        setStatus({ type: "error", text: error.message });
        return;
      }

      setForm((prev) => ({ ...prev, lolRank: `${result.rank} (${result.lp} LP)` }));
      setStatus({ type: "success", text: PARTICIPANT_MANAGER.successRankUpdated });
    } catch {
      if (requestId === lookupRequestId.current) setIsLookingUpRank(false);
    }
  }

  // Auto-consulta el rango ~600ms despues de que el admin termina de
  // escribir el Riot ID, mismo patron que el debounce de
  // checkRiotProfile en ParticipantProfileForm.tsx (self-service) -- antes
  // el panel exigia apretar "Consultar" a mano, un flujo distinto al de
  // inscripcion que quedo desactualizado. El boton manual se deja ademas
  // por si el admin quiere forzar un reintento sin editar el campo.
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);

    if (skipNextLookup.current) {
      skipNextLookup.current = false;
      return;
    }

    const username = form.lolUsername.trim();
    if (!username) return;

    lookupTimer.current = setTimeout(() => {
      runLookup(username);
    }, 600);

    return () => {
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.lolUsername]);

  async function handleLookupRank() {
    if (!form.lolUsername) {
      setStatus({ type: "error", text: PARTICIPANT_MANAGER.errorLookupMissingFields });
      return;
    }
    await runLookup(form.lolUsername);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing = new Set<string>();
    if (!form.name) missing.add("name");
    if (!form.nickname) missing.add("nickname");
    if (!form.lolRank) missing.add("lolRank");
    if (!form.favChampion) missing.add("favChampion");
    if (missing.size > 0) {
      setInvalidFields(missing);
      setStatus({ type: "error", text: PARTICIPANT_MANAGER.errorRequiredFields });
      return;
    }
    setInvalidFields(new Set());

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
    if (bannerFile) data.set("banner", bannerFile);

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

      <p className="text-slate-500 text-xs">{PARTICIPANT_MANAGER.noManualCreateHint}</p>

      {isFormOpen && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeForm();
        }}
      >
      <form
        onSubmit={handleSubmit}
        className="bg-lol-cardBg border border-lol-border p-4 sm:p-6 rounded-xl space-y-4 w-full max-w-3xl min-w-0 box-border max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] overflow-y-auto"
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
          <Field label={PARTICIPANT_MANAGER.fields.name} invalid={invalidFields.has("name")}>
            <input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              className={`input ${invalidFields.has("name") ? "input-invalid" : ""}`}
            />
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.nickname} invalid={invalidFields.has("nickname")}>
            <input
              value={form.nickname}
              onChange={(e) => updateField("nickname", e.target.value)}
              className={`input ${invalidFields.has("nickname") ? "input-invalid" : ""}`}
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
          <Field label={PARTICIPANT_MANAGER.fields.favChampion} invalid={invalidFields.has("favChampion")}>
            <input
              value={form.favChampion}
              onChange={(e) => updateField("favChampion", e.target.value)}
              className={`input ${invalidFields.has("favChampion") ? "input-invalid" : ""}`}
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
            <Field label={PARTICIPANT_MANAGER.fields.lolRank} invalid={invalidFields.has("lolRank")}>
              <div className="flex flex-wrap gap-2">
                <input
                  value={form.lolRank}
                  onChange={(e) => updateField("lolRank", e.target.value)}
                  className={`input flex-1 min-w-[8rem] ${invalidFields.has("lolRank") ? "input-invalid" : ""}`}
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
              {isLookingUpRank && (
                <p className="text-xs mt-1.5 text-slate-500">Consultando rango automaticamente...</p>
              )}
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
            <h3 className="text-sm uppercase text-slate-400">
              {PARTICIPANT_MANAGER.statsTitle}{" "}
              <span className="text-slate-600 normal-case">
                ({stats.length}/{MAX_CUSTOM_STATS})
              </span>
            </h3>
            {stats.length < MAX_CUSTOM_STATS && (
              <button
                type="button"
                onClick={addStat}
                className="text-lol-gold hover:underline font-bold uppercase text-xs"
              >
                {PARTICIPANT_MANAGER.addStatCta}
              </button>
            )}
          </div>
          {stats.length === 0 && (
            <p className="text-slate-500 text-xs">{PARTICIPANT_MANAGER.statsEmptyHint}</p>
          )}
          <div className="space-y-2">
            {stats.map((stat) => (
              <div key={stat._key} className="flex flex-wrap gap-2 items-center">
                <input
                  value={stat.label}
                  onChange={(e) => updateStat(stat._key, { label: e.target.value })}
                  className="input flex-1 min-w-[8rem]"
                  placeholder={PARTICIPANT_MANAGER.placeholders.statLabel}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={stat.value}
                  onChange={(e) => updateStat(stat._key, { value: Number(e.target.value) })}
                  className="input w-20 sm:w-24"
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={PARTICIPANT_MANAGER.fields.photo}>
            <FileInput
              fileName={photoFile?.name ?? null}
              hasExisting={photoHasExisting}
              accept="image/*"
              onChange={handlePhotoChange}
            />
            {compressingField === "photo" && <p className="text-xs text-slate-500 mt-1">Optimizando imagen...</p>}
          </Field>
          <Field label={PARTICIPANT_MANAGER.fields.banner}>
            <FileInput
              fileName={bannerFile?.name ?? null}
              hasExisting={bannerHasExisting}
              accept="image/*"
              onChange={handleBannerChange}
            />
            {compressingField === "banner" && <p className="text-xs text-slate-500 mt-1">Optimizando imagen...</p>}
          </Field>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isBusy || compressingField !== null}
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
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={rankIconPath(p.lolRank)}
                  alt=""
                  className="w-6 h-6 object-contain flex-shrink-0"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <div className="min-w-0">
                  <span className="text-white font-bold">{p.name}</span>{" "}
                  <span className="text-slate-500 text-sm">
                    "{p.nickname}" &middot; {p.mainRole} &middot; {p.lolRank}
                  </span>
                </div>
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
        .input-invalid {
          border-color: rgba(248, 113, 113, 0.5);
        }
        .input-invalid:focus {
          border-color: rgba(248, 113, 113, 0.7);
        }
      `}</style>
    </div>
  );
}

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
