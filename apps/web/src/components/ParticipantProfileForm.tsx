import { useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import type { Participant, ParticipantStat, MmradarPerformanceScores } from "@velada/core";
import { PAGES, PARTICIPANT_MANAGER, COUNTRIES, flagForCountry, UNKNOWN_COUNTRY_FLAG, MAX_CUSTOM_STATS } from "@velada/core";
import { compressImageFile, PHOTO_COMPRESSION, BANNER_COMPRESSION } from "@velada/core/imageCompression";
import PlayerCard from "./PlayerCard";
import PerformancePreviewCard from "./PerformancePreviewCard";
import { saveDraft, loadDraft, clearDraft } from "../lib/formDraft";

type RiotCheckStatus = "idle" | "checking" | "found" | "not_found" | "invalid" | "error";

interface ParticipantProfileFormProps {
  existingParticipant: Participant | null;
}

const ROLES: Participant["mainRole"][] = ["Top", "Jungle", "Mid", "ADC", "Support"];
const SERVERS = ["LAN", "LAS", "NA", "BR", "EUW", "EUNE", "KR", "JP", "OCE"];

const EMPTY_FORM = {
  name: "",
  nickname: "",
  age: "",
  weight: "",
  height: "",
  country: "",
  countryFlag: "",
  instagramHandle: "",
  instagramFollowers: "",
  xHandle: "",
  xFollowers: "",
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

function formFromParticipant(p: Participant | null): typeof EMPTY_FORM {
  if (!p) return EMPTY_FORM;
  return {
    name: p.name,
    nickname: p.nickname,
    age: p.age?.toString() ?? "",
    weight: p.weight ?? "",
    height: p.height ?? "",
    country: p.country ?? "",
    countryFlag: p.countryFlag ?? "",
    instagramHandle: p.instagramHandle ?? "",
    instagramFollowers: p.instagramFollowers ?? "",
    xHandle: p.xHandle ?? "",
    xFollowers: p.xFollowers ?? "",
    lolUsername: p.lolUsername ?? "",
    lolServer: p.lolServer ?? "LAN",
    mainRole: p.mainRole,
    favChampion: p.favChampion,
    description: p.description ?? ""
  };
}

const copy = PAGES.miPerfil;

export default function ParticipantProfileForm({ existingParticipant }: ParticipantProfileFormProps) {
  // Scope del borrador en localStorage: el id ya existente si esta
  // editando un perfil guardado, "new" si es alta nueva (/inscripcion sin
  // fila propia todavia). Ver lib/formDraft.ts.
  const draftScopeId = existingParticipant?.id ?? "new";

  const [form, setForm] = useState(formFromParticipant(existingParticipant));
  // IMPORTANTE: el _key inicial de cada stat existente NO puede venir de
  // crypto.randomUUID()/Math.random() aca. Este useState corre tanto en el
  // render de servidor (SSR) como en el primer render del cliente durante
  // la hidratacion, y un valor no-determinista generaria un _key distinto
  // en cada lado -> React detecta el mismatch y descarta todo el arbol
  // hidratado (los errores #425/#423 en consola, que dejan el resto de la
  // pagina - incluido el boton de cerrar sesion - sin JS funcionando).
  // El indice es estable porque viene de datos ya guardados (mismo orden
  // en servidor y cliente). Los randomUUID de verdad siguen usandose en
  // addStat(), que solo corre en el cliente despues de la hidratacion.
  const [stats, setStats] = useState<StatWithKey[]>(
    (existingParticipant?.stats ?? []).map((s, i) => ({ ...s, _key: `existing-${i}` }))
  );
  const [draftRestored, setDraftRestored] = useState(false);
  const draftHydrated = useRef(false);

  // Restaura el borrador guardado en localStorage, si hay uno, DESPUES
  // del primer render (nunca en el useState inicial de arriba): igual que
  // el comentario de _key de justo encima, el valor inicial de
  // form/stats tiene que ser identico en servidor y cliente para que la
  // hidratacion no se rompa. localStorage no existe en el servidor, asi
  // que leerlo recien en un useEffect (que solo corre en el cliente,
  // despues de que la hidratacion ya matcheo) es el momento seguro.
  // Un borrador se restaura siempre que exista (tanto para alta nueva
  // como para edicion de un perfil ya guardado): lo peor que puede pasar
  // si el borrador esta desactualizado es que el jugador tenga que
  // retocar algun campo, nunca se pierde un guardado real (ese vive en
  // Supabase, no en localStorage).
  useEffect(() => {
    if (draftHydrated.current) return;
    draftHydrated.current = true;

    const draft = loadDraft<typeof EMPTY_FORM, ParticipantStat>(draftScopeId);
    if (!draft) return;

    setForm(draft.form);
    setStats(draft.stats.map((s, i) => ({ ...s, _key: `draft-${i}` })));
    setDraftRestored(true);
  }, [draftScopeId]);

  // Autoguarda el borrador en cada cambio de form/stats, con un pequeno
  // debounce (300ms) para no escribir a localStorage en cada tecla. Se
  // salta el primer render (antes de que el efecto de restauracion de
  // arriba corra) para no pisar un borrador real con el estado vacio
  // inicial del formulario.
  useEffect(() => {
    if (!draftHydrated.current) return;
    const timer = setTimeout(() => {
      saveDraft(draftScopeId, form, stats.map(({ _key, ...s }) => s));
    }, 300);
    return () => clearTimeout(timer);
  }, [draftScopeId, form, stats]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [compressingField, setCompressingField] = useState<"photo" | "banner" | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [currentRank, setCurrentRank] = useState(existingParticipant?.lolRank ?? null);
  const [riotCheck, setRiotCheck] = useState<{
    status: RiotCheckStatus;
    rank?: string;
    reason?: string;
    performanceRank?: string | null;
    performanceScores?: MmradarPerformanceScores | null;
  }>({
    status: "idle"
  });
  const riotCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riotCheckRequestId = useRef(0);

  // Debounced live check: pings checkRiotProfile ~600ms after the fighter
  // stops typing a Riot ID / server so the check/spinner/x icon updates
  // before they submit, instead of only finding out the profile doesn't
  // exist after clicking submit.
  //
  // Este mismo efecto es tambien el auto-fetch de performanceScores al
  // cargar /mi-perfil: form.lolUsername arranca poblado con el Riot ID ya
  // guardado (ver formFromParticipant mas arriba), asi que el primer
  // disparo de este efecto en el mount ya corre la consulta sola -- no
  // hace falta un segundo useEffect separado "solo para el mount". Antes,
  // PerformancePreviewCard se montaba con riotCheck.performanceScores en
  // null y existingParticipant?.performanceScores como unico fallback: si
  // esa columna estaba vacia en la fila guardada (perfil creado antes de
  // que existiera esta feature, o cuyo ultimo submit no encontro nada en
  // mmradar), la carta se quedaba en null hasta que el jugador retocara
  // el campo a mano. Con esto, en vez de depender de eso, ya alcanza con
  // abrir la pagina.
  useEffect(() => {
    if (riotCheckTimer.current) clearTimeout(riotCheckTimer.current);

    const username = form.lolUsername.trim();
    if (!username) {
      setRiotCheck({ status: "idle" });
      return;
    }

    setRiotCheck({ status: "checking" });
    const requestId = ++riotCheckRequestId.current;

    riotCheckTimer.current = setTimeout(async () => {
      try {
        const form2 = new FormData();
        form2.set("lolUsername", username);
        const { data, error } = await actions.checkRiotProfile(form2);
        if (requestId !== riotCheckRequestId.current) return;
        if (error) {
          setRiotCheck({ status: "error", reason: "network" });
          return;
        }
        if (data.status === "found") {
          setRiotCheck({
            status: "found",
            rank: data.rank,
            performanceRank: data.performanceRank,
            performanceScores: data.performanceScores
          });
        } else if (data.status === "error") {
          setRiotCheck({ status: "error", reason: data.reason });
        } else {
          setRiotCheck({ status: data.status });
        }
      } catch {
        if (requestId === riotCheckRequestId.current) setRiotCheck({ status: "error", reason: "network" });
      }
    }, 600);

    return () => {
      if (riotCheckTimer.current) clearTimeout(riotCheckTimer.current);
    };
  }, [form.lolUsername]);

  // Genera un object URL local para previsualizar la foto/banner elegidos
  // en la PlayerCard antes de subirlos de verdad (recien se suben al hacer
  // submit). Se revoca el URL anterior en cada cambio y al desmontar para
  // no filtrar memoria.
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    if (!bannerFile) {
      setBannerPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(bannerFile);
    setBannerPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);

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

  function addStat() {
    setStats((prev) => (prev.length >= MAX_CUSTOM_STATS ? prev : [...prev, { ...EMPTY_STAT, _key: makeStatKey() }]));
  }

  // Comprime la foto/banner elegida en el navegador antes de guardarla en
  // el estado (y por lo tanto antes de subirla) -- ver
  // packages/core/imageCompression.ts para el porque. El archivo original
  // nunca se usa mas alla de este punto; si la compresion falla por algun
  // motivo, compressImageFile devuelve el original tal cual, asi que el
  // formulario nunca se bloquea por esto.
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing = new Set<string>();
    if (!form.name) missing.add("name");
    if (!form.nickname) missing.add("nickname");
    if (!form.favChampion) missing.add("favChampion");
    if (!form.lolUsername) missing.add("lolUsername");
    if (!form.lolServer) missing.add("lolServer");
    if (missing.size > 0) {
      setInvalidFields(missing);
      setStatus({ type: "error", text: PARTICIPANT_MANAGER.errorRequiredFields });
      return;
    }
    setInvalidFields(new Set());

    setIsBusy(true);
    const data = new FormData();
    data.set("name", form.name);
    data.set("nickname", form.nickname);
    if (form.age) data.set("age", form.age);
    if (form.weight) data.set("weight", form.weight);
    if (form.height) data.set("height", form.height);
    if (form.country) {
      data.set("country", form.country);
      // La bandera se resuelve sola a partir del texto escrito (lista de
      // paises conocidos con fallback generico) — el jugador nunca la
      // completa a mano, asi que si el pais no matchea ningun conocido
      // no se manda ninguna bandera especifica (queda el fallback en el
      // resto del sitio, ver participant.countryFlag ?? UNKNOWN_COUNTRY_FLAG
      // donde se usa).
      const resolvedFlag = flagForCountry(form.country);
      data.set("countryFlag", resolvedFlag);
    }
    if (form.instagramHandle) data.set("instagramHandle", form.instagramHandle);
    if (form.instagramFollowers) data.set("instagramFollowers", form.instagramFollowers);
    if (form.xHandle) data.set("xHandle", form.xHandle);
    if (form.xFollowers) data.set("xFollowers", form.xFollowers);
    data.set("lolUsername", form.lolUsername);
    data.set("lolServer", form.lolServer);
    data.set("mainRole", form.mainRole);
    data.set("favChampion", form.favChampion);
    if (form.description) data.set("description", form.description);
    const validStats: ParticipantStat[] = stats
      .filter((s) => s.label.trim().length > 0)
      .map(({ _key, ...s }) => s);
    if (validStats.length > 0) data.set("stats", JSON.stringify(validStats));
    if (photoFile) data.set("photo", photoFile);
    if (bannerFile) data.set("banner", bannerFile);

    const { data: result, error } = await actions.saveOwnParticipant(data);
    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setCurrentRank(result.lolRank);
    setStatus({
      type: "success",
      text: existingParticipant ? copy.successUpdated : copy.successCreated
    });
    // El guardado exitoso ya vive en Supabase -- el borrador local queda
    // obsoleto y restaurarlo despues de esto solo pisaria datos ya
    // guardados con una version potencialmente vieja.
    clearDraft(draftScopeId);
    setDraftRestored(false);
  }

  const previewRank = riotCheck.status === "found" ? riotCheck.rank ?? currentRank : currentRank;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
      <form
        onSubmit={handleSubmit}
        className="bg-lol-cardBg border border-lol-border p-4 sm:p-6 rounded-xl space-y-4"
      >
        {draftRestored && (
          <div className="text-xs p-2.5 rounded bg-lol-gold/10 text-lol-gold border border-lol-gold/30 flex items-center justify-between gap-3">
            <span>Recuperamos un borrador que tenias sin guardar.</span>
            <button
              type="button"
              onClick={() => setDraftRestored(false)}
              className="underline hover:no-underline shrink-0"
            >
              Ok
            </button>
          </div>
        )}

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
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              País
              <CountryFlagBadge country={form.country} />
            </span>
          }
        >
          <input
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            className="input"
            list="country-options"
            placeholder="Escribí tu país"
            autoComplete="off"
          />
          <datalist id="country-options">
            {COUNTRIES.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="border-t border-lol-border/50 pt-4">
        <h3 className="text-sm uppercase text-slate-400 mb-3">Redes</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Instagram">
            <input
              value={form.instagramHandle}
              onChange={(e) => setForm({ ...form, instagramHandle: e.target.value })}
              className="input"
              placeholder="@usuario"
            />
          </Field>
          <Field label="X / Twitter">
            <input
              value={form.xHandle}
              onChange={(e) => setForm({ ...form, xHandle: e.target.value })}
              className="input"
              placeholder="@usuario"
            />
          </Field>
        </div>
      </div>

      <div className="border-t border-lol-border/50 pt-4">
        <h3 className="text-sm uppercase text-slate-400 mb-3">{PARTICIPANT_MANAGER.lolSectionTitle}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={PARTICIPANT_MANAGER.fields.lolUsername} invalid={invalidFields.has("lolUsername")}>
            <div className="relative">
              <input
                value={form.lolUsername}
                onChange={(e) => updateField("lolUsername", e.target.value)}
                className={`input pr-10 ${invalidFields.has("lolUsername") ? "input-invalid" : ""}`}
                placeholder={PARTICIPANT_MANAGER.placeholders.lolUsername}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center" aria-hidden="true">
                <RiotCheckIcon status={riotCheck.status} />
              </span>
            </div>
            <RiotCheckHint status={riotCheck.status} rank={riotCheck.rank} reason={riotCheck.reason} />
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
        </div>
        {currentRank && (
          <p className="text-sm mt-2">
            <span className="text-slate-400 uppercase text-xs">{copy.currentRankLabel}: </span>
            <span className="text-lol-gold font-bold">{currentRank}</span>
          </p>
        )}
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
            <button type="button" onClick={addStat} className="text-lol-gold hover:underline font-bold uppercase text-xs">
              {PARTICIPANT_MANAGER.addStatCta}
            </button>
          )}
        </div>
        {stats.length === 0 && <p className="text-slate-500 text-xs">{PARTICIPANT_MANAGER.statsEmptyHint}</p>}
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
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handlePhotoChange(e.target.files)}
            className="input file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-lol-gold file:text-black file:font-bold file:uppercase file:text-xs"
          />
          {compressingField === "photo" && <p className="text-xs text-slate-500 mt-1">Optimizando imagen...</p>}
        </Field>
        <Field label={PARTICIPANT_MANAGER.fields.banner}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleBannerChange(e.target.files)}
            className="input file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-lol-gold file:text-black file:font-bold file:uppercase file:text-xs"
          />
          {compressingField === "banner" && <p className="text-xs text-slate-500 mt-1">Optimizando imagen...</p>}
        </Field>
      </div>

      <button
        type="submit"
        disabled={isBusy || compressingField !== null}
        className="w-full py-3 px-6 bg-lol-gold text-black font-bold uppercase tracking-wide hover:bg-yellow-400 disabled:opacity-50"
      >
        {existingParticipant ? copy.submitUpdateCta : copy.submitCreateCta}
      </button>

      <style>{`
        .input {
          box-sizing: border-box;
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
        .riot-check-spinner {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid rgba(234, 179, 8, 0.3);
          border-top-color: #eab308;
          animation: riotCheckSpin 0.7s linear infinite;
        }
        @keyframes riotCheckSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      </form>

      <aside className="lg:sticky lg:top-24">
        <p className="text-xs uppercase text-slate-500 mb-2 text-center lg:text-left">Vista previa</p>
        <PlayerCard
          data={{
            name: form.name,
            nickname: form.nickname,
            mainRole: form.mainRole,
            favChampion: form.favChampion,
            lolRank: previewRank,
            photo: photoPreviewUrl ?? existingParticipant?.photo ?? null,
            banner: bannerPreviewUrl ?? existingParticipant?.banner ?? null,
            stats: stats.map(({ label, value }) => ({ label, value }))
          }}
        />
        <PerformancePreviewCard
          scores={riotCheck.performanceScores ?? existingParticipant?.performanceScores ?? null}
          performanceRank={riotCheck.performanceRank ?? existingParticipant?.performanceRank ?? null}
          status={riotCheck.status}
        />
      </aside>
    </div>
  );
}

function Field({
  label,
  children,
  invalid = false
}: {
  label: React.ReactNode;
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

/**
 * Bandera del pais escrito, mostrada al lado de la etiqueta "Pais" en vez
 * de superpuesta dentro del input (ahi se pisaba con el texto escrito --
 * algunas banderas emoji regional-indicator se renderizan mas anchas que
 * el padding reservado, ver captura del usuario con China). Cuando el
 * texto no matchea ningun pais conocido, en vez del emoji de bandera
 * blanca generico (UNKNOWN_COUNTRY_FLAG, "poco lindo" segun el pedido) se
 * muestra un globo en SVG propio, y directamente no se muestra nada si el
 * campo todavia esta vacio.
 */
function CountryFlagBadge({ country }: { country: string }) {
  if (!country.trim()) return null;
  const flag = flagForCountry(country);
  if (flag === UNKNOWN_COUNTRY_FLAG) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-slate-500"
        aria-label="País no reconocido"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" />
      </svg>
    );
  }
  return (
    <span className="text-sm normal-case" aria-hidden="true">
      {flag}
    </span>
  );
}

/**
 * Green check / yellow spinner / red X next to the Riot ID field, driven by
 * the debounced checkRiotProfile call in the parent. "error" (Riot API or
 * network failure, distinct from a legitimate not-found) reuses the same
 * red X as not_found — the field-level hint text below is what tells them
 * apart, since either way the fighter can't do anything but retry.
 */
function RiotCheckIcon({ status }: { status: RiotCheckStatus }) {
  if (status === "idle") return null;
  if (status === "checking") return <span className="riot-check-spinner" role="status" aria-label="Verificando..." />;
  if (status === "found") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#4ade80"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="status"
        aria-label="Perfil encontrado"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f87171"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="status"
      aria-label="Perfil no encontrado"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function RiotCheckHint({
  status,
  rank,
  reason
}: {
  status: RiotCheckStatus;
  rank?: string;
  reason?: string;
}) {
  if (status === "idle") return null;
  const errorText =
    reason === "riot_down"
      ? "No pudimos consultar tu rango ahora mismo. Se reintentará al guardar."
      : reason === "network"
        ? "No se pudo conectar para verificar. Se reintentará al guardar."
        : "No se pudo verificar ahora. Se reintentará al guardar.";
  const text =
    status === "checking"
      ? "Buscando el perfil en Riot..."
      : status === "found"
        ? `Perfil encontrado${rank ? ` — ${rank}` : ""}`
        : status === "not_found"
          ? "No encontramos ese Riot ID en ese servidor."
          : status === "invalid"
            ? 'Formato invalido. Usa "NombreDeInvocador#TAG".'
            : errorText;
  const color =
    status === "found" ? "text-green-400" : status === "checking" ? "text-slate-500" : "text-red-400";
  return <p className={`text-xs mt-1.5 ${color}`}>{text}</p>;
}
