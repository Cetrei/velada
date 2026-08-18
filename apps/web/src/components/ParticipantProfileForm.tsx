import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant, ParticipantStat } from "@velada/core";
import { PAGES, PARTICIPANT_MANAGER } from "@velada/core";

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

const copy = PAGES.inscripcion;

export default function ParticipantProfileForm({ existingParticipant }: ParticipantProfileFormProps) {
  const [form, setForm] = useState(formFromParticipant(existingParticipant));
  const [stats, setStats] = useState<StatWithKey[]>(
    (existingParticipant?.stats ?? []).map((s) => ({ ...s, _key: makeStatKey() }))
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [currentRank, setCurrentRank] = useState(existingParticipant?.lolRank ?? null);

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
    setStats((prev) => [...prev, { ...EMPTY_STAT, _key: makeStatKey() }]);
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
    if (form.country) data.set("country", form.country);
    if (form.countryFlag) data.set("countryFlag", form.countryFlag);
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
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-lol-cardBg border border-lol-border p-4 sm:p-6 rounded-xl space-y-4"
    >
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
        <Field label="País">
          <input
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            className="input"
          />
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
            <input
              value={form.lolUsername}
              onChange={(e) => updateField("lolUsername", e.target.value)}
              className={`input ${invalidFields.has("lolUsername") ? "input-invalid" : ""}`}
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
        </div>
        <p className="text-slate-500 text-xs mt-2">{copy.rankPendingHint}</p>
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
          <h3 className="text-sm uppercase text-slate-400">{PARTICIPANT_MANAGER.statsTitle}</h3>
          <button type="button" onClick={addStat} className="text-lol-gold hover:underline font-bold uppercase text-xs">
            {PARTICIPANT_MANAGER.addStatCta}
          </button>
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
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            className="input file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-lol-gold file:text-black file:font-bold file:uppercase file:text-xs"
          />
        </Field>
        <Field label={PARTICIPANT_MANAGER.fields.banner}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)}
            className="input file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-lol-gold file:text-black file:font-bold file:uppercase file:text-xs"
          />
        </Field>
      </div>

      <button
        type="submit"
        disabled={isBusy}
        className="w-full py-3 px-6 bg-lol-gold text-black font-bold uppercase tracking-wide hover:bg-yellow-400 disabled:opacity-50"
      >
        {existingParticipant ? copy.submitUpdateCta : copy.submitCreateCta}
      </button>

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
    </form>
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
