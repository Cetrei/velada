import { useMemo, useState } from "react";
import type { Participant } from "@velada/core";
import { PAGES, rankIconPath, stepsFromRankString } from "@velada/core";
import Dropdown from "./Dropdown";

interface RosterExplorerProps {
  participants: Participant[];
  votesById: Record<string, number>;
}

type SortColumn = "name" | "mainRole" | "lolRank" | "votes" | "performance" | "duel";
type SortDirection = "asc" | "desc";

const ROLES: Array<Participant["mainRole"]> = ["Top", "Jungle", "Mid", "ADC", "Support"];
const copy = PAGES.fighters;

/** Mismo umbral que DuelRatingCard.tsx -- por debajo de esto se marca como poco confiable. */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

function performanceScoreOf(p: Participant): number | null {
  if (!p.performanceScores) return null;
  const values = Object.values(p.performanceScores);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

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

/**
 * Fuerza real de un rango (tier*4 + division, ver stepsFromRankString en
 * @velada/core) para ordenar por rango de verdad -- antes el sort de
 * "lolRank" usaba eloTierOf(a).localeCompare(eloTierOf(b)), que compara
 * solo el nombre del tier alfabeticamente ("Bronze" < "Diamond" <
 * "Emerald" < "Gold" < "Platinum"...) e ignora la division por completo,
 * dando un orden que no tiene nada que ver con la fuerza real del rango.
 * null (rango no reconocido / "Sin clasificar") se trata como -1 para que
 * quede siempre antes que cualquier rango real en orden ascendente.
 */
function rankStepsOf(p: Participant): number {
  return stepsFromRankString(p.lolRank) ?? -1;
}

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/200x200/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname[0] ?? "?")}`;
}

interface SortHeaderProps {
  label: string;
  column: SortColumn;
  active: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
  className?: string;
}

function SortHeader({ label, column, active, direction, onSort, className = "" }: SortHeaderProps) {
  const isActive = active === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`flex items-center gap-1 text-[11px] uppercase font-bold tracking-wide transition-colors ${
        isActive ? "text-lol-gold" : "text-slate-400 hover:text-slate-200"
      } ${className}`}
      aria-label={isActive ? `${label}: ${direction === "asc" ? copy.sortAscLabel : copy.sortDescLabel}` : label}
    >
      {label}
      <span className="text-[10px] leading-none">{isActive ? (direction === "asc" ? "▲" : "▼") : ""}</span>
    </button>
  );
}

export default function RosterExplorer({ participants, votesById }: RosterExplorerProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>("all");
  const [elo, setElo] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

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
      let cmp = 0;
      switch (sortColumn) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "mainRole":
          cmp = a.mainRole.localeCompare(b.mainRole);
          break;
        case "lolRank":
          cmp = rankStepsOf(a) - rankStepsOf(b);
          break;
        case "votes":
          cmp = (votesById[a.id] ?? 0) - (votesById[b.id] ?? 0);
          break;
        case "performance":
          cmp = (performanceScoreOf(a) ?? -1) - (performanceScoreOf(b) ?? -1);
          break;
        case "duel":
          cmp = (a.duelRating ?? -1) - (b.duelRating ?? -1);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return list;
  }, [participants, query, role, elo, sortColumn, sortDirection, votesById]);

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

      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-slate-500 py-12">{copy.emptyState}</p>
      ) : (
        <div className="bg-lol-cardBg/60 border border-lol-border rounded-lg overflow-hidden">
          <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-b border-lol-border/50 bg-lol-darkBg/60">
            <SortHeader className="flex-1" label={copy.columnName} column="name" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
            <SortHeader className="hidden sm:flex w-24 justify-center" label={copy.columnRole} column="mainRole" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
            <SortHeader className="hidden md:flex w-24 justify-end" label={copy.columnRank} column="lolRank" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
            <SortHeader className="hidden md:flex w-28 justify-end" label={copy.columnPerformance} column="performance" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
            <SortHeader className="hidden md:flex w-28 justify-end" label={copy.columnDuel} column="duel" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
            <SortHeader className="w-16 justify-end" label={copy.columnVotes} column="votes" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
          </div>

          <div className="divide-y divide-lol-border/50">
            {filtered.map((p) => {
              const score = performanceScoreOf(p);
              return (
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
                    className="w-12 h-12 rounded object-cover border border-lol-border group-hover:border-lol-gold transition-colors flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm truncate">{p.name}</p>
                    <p className="text-slate-500 text-xs truncate">"{p.nickname}"</p>
                  </div>
                  <span className="hidden sm:inline-block w-24 text-center px-2 py-1 bg-lol-darkBg border border-lol-border text-slate-300 text-[11px] uppercase font-bold rounded-sm">
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
                  <span className="hidden md:flex w-28 items-center justify-end gap-1.5">
                    {score !== null && (
                      <>
                        <span className="flex-1 h-1.5 rounded-full bg-black/40 border border-lol-border/40 overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-lol-blue to-lol-gold"
                            style={{ width: `${Math.min(100, score)}%` }}
                          />
                        </span>
                        <span className="text-slate-400 text-[10px] font-bold w-9 text-right flex-shrink-0 tabular-nums">
                          {Math.round(score)}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="hidden md:flex w-28 items-center justify-end gap-1.5">
                    {typeof p.duelRating === "number" && (
                      <>
                        <span className="flex-1 h-1.5 rounded-full bg-black/40 border border-red-500/30 overflow-hidden shadow-[0_0_6px_rgba(239,68,68,0.25)]">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.min(100, p.duelRating)}%`,
                              background: "linear-gradient(to right, #C8AA6E, #ef4444)"
                            }}
                          />
                        </span>
                        <span className="text-red-400 text-[10px] font-bold w-9 text-right flex-shrink-0 tabular-nums">
                          {Math.round(p.duelRating)}
                        </span>
                        <span className="w-2.5 flex-shrink-0 flex justify-center">
                          {typeof p.duelConfidence === "number" && p.duelConfidence < LOW_CONFIDENCE_THRESHOLD && (
                            <span className="text-slate-600 text-[9px] leading-none" title="Basado en pocas partidas">
                              ●
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="text-lol-gold text-xs font-bold w-16 text-right">
                    {(votesById[p.id] ?? 0).toLocaleString("es")} 🗳
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
