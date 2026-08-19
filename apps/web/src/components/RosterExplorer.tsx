import { useMemo, useState } from "react";
import type { Participant } from "@velada/core";
import { PAGES, rankIconPath } from "@velada/core";
import Dropdown from "./Dropdown";

interface RosterExplorerProps {
  participants: Participant[];
  votesById: Record<string, number>;
}

type SortMode = "nameAsc" | "votesDesc" | "votesAsc";

const ROLES: Array<Participant["mainRole"]> = ["Top", "Jungle", "Mid", "ADC", "Support"];
const copy = PAGES.fighters;

/** Ranked tiers in League of Legends, used to bucket free-text lolRank values like "Diamond II" into a filterable tier. */
const ELO_TIER_ORDER = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Emerald",
  "Diamond",
  "Master",
  "Grandmaster",
  "Challenger"
];

function eloTierOf(p: Participant): string {
  const firstWord = p.lolRank?.trim().split(/\s+/)[0];
  return firstWord && ELO_TIER_ORDER.includes(firstWord) ? firstWord : p.lolRank?.trim() || "Sin clasificar";
}

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/200x200/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname[0] ?? "?")}`;
}

export default function RosterExplorer({ participants, votesById }: RosterExplorerProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>("all");
  const [elo, setElo] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("nameAsc");

  const eloTiers = useMemo(() => {
    const present = new Set(participants.map(eloTierOf));
    return ELO_TIER_ORDER.filter((tier) => present.has(tier)).concat(
      [...present].filter((tier) => !ELO_TIER_ORDER.includes(tier)).sort()
    );
  }, [participants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = participants.filter((p) => {
      const matchesQuery =
        q.length === 0 || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q);
      const matchesRole = role === "all" || p.mainRole === role;
      const matchesElo = elo === "all" || eloTierOf(p) === elo;
      return matchesQuery && matchesRole && matchesElo;
    });

    list = [...list].sort((a, b) => {
      if (sortMode === "nameAsc") return a.name.localeCompare(b.name);
      const votesA = votesById[a.id] ?? 0;
      const votesB = votesById[b.id] ?? 0;
      return sortMode === "votesDesc" ? votesB - votesA : votesA - votesB;
    });

    return list;
  }, [participants, query, role, elo, sortMode, votesById]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-8 bg-lol-cardBg border border-lol-border p-4 rounded-xl">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.searchPlaceholder}
          className="flex-1 sm:min-w-[200px] bg-lol-darkBg border border-lol-border rounded px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-lol-gold outline-none text-sm"
        />

        <label className="flex items-center gap-2 text-xs uppercase text-slate-400 whitespace-nowrap">
          {copy.filterRoleLabel}
          <Dropdown
            className="w-[132px]"
            ariaLabel={copy.filterRoleLabel}
            value={role}
            onChange={setRole}
            options={[
              { value: "all", label: copy.filterRoleAll },
              ...ROLES.map((r) => ({ value: r, label: r }))
            ]}
          />
        </label>

        <label className="flex items-center gap-2 text-xs uppercase text-slate-400 whitespace-nowrap">
          {copy.filterEloLabel}
          <Dropdown
            className="w-[132px]"
            ariaLabel={copy.filterEloLabel}
            value={elo}
            onChange={setElo}
            options={[
              { value: "all", label: copy.filterEloAll },
              ...eloTiers.map((tier) => ({ value: tier, label: tier }))
            ]}
          />
        </label>

        <label className="flex items-center gap-2 text-xs uppercase text-slate-400 whitespace-nowrap">
          {copy.sortLabel}
          <Dropdown
            className="w-[168px]"
            ariaLabel={copy.sortLabel}
            value={sortMode}
            onChange={(v) => setSortMode(v as SortMode)}
            options={[
              { value: "nameAsc", label: copy.sortOptions.nameAsc },
              { value: "votesDesc", label: copy.sortOptions.votesDesc },
              { value: "votesAsc", label: copy.sortOptions.votesAsc }
            ]}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-slate-500 py-12">{copy.emptyState}</p>
      ) : (
        <div className="bg-lol-cardBg/60 border border-lol-border rounded-lg divide-y divide-lol-border/50 overflow-hidden">
          {filtered.map((p) => (
            <a
              key={p.id}
              href={`/peleadores/${p.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-lol-gold/5 transition-colors group"
            >
              <img
                src={p.photo ?? fallbackPhoto(p)}
                alt={p.name}
                loading="lazy"
                decoding="async"
                className="w-12 h-12 rounded object-cover border border-lol-border group-hover:border-lol-gold transition-colors"
              />
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-sm truncate">{p.name}</p>
                <p className="text-slate-500 text-xs truncate">"{p.nickname}"</p>
              </div>
              <span className="hidden sm:inline-block px-2 py-1 bg-lol-darkBg border border-lol-border text-slate-300 text-[11px] uppercase font-bold rounded-sm">
                {p.mainRole}
              </span>
              <span className="hidden md:inline-flex items-center justify-end gap-1.5 text-slate-400 text-xs w-24 text-right">
                <img
                  src={rankIconPath(p.lolRank)}
                  alt=""
                  className="w-4 h-4 object-contain"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {p.lolRank}
              </span>
              <span className="text-lol-gold text-xs font-bold w-16 text-right">
                {(votesById[p.id] ?? 0).toLocaleString("es")} 🗳
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
