import type { Match, Participant, PredictionTally, TeamMatch, TeamPredictionTally } from "@velada/core";
import { PAGES } from "@velada/core";

interface PredictionsInsightsProps {
  matches: Match[];
  teamMatches: TeamMatch[];
  participantsById: Record<string, Participant>;
  tallies: Record<string, PredictionTally>;
  teamTallies: Record<string, TeamPredictionTally>;
}

const copy = PAGES.predictions;

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/100x100/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname[0] ?? "?")}`;
}

/**
 * Analiticas de la comunidad para /pronosticos -- pedido del usuario
 * 2026-08-21: "una lista de los votos de la comunidad para cada persona y
 * combate, mostrando cosas como peleadores mas votados, diferencia de
 * votos mas grande entre rivales/equipos, etc". Se calcula 100% en el
 * cliente a partir de los tallies que la pagina ya carga (no pega a
 * Supabase de nuevo) -- mismo dato que ya ven las tarjetas de
 * PredictionCard/TeamPredictionCard, solo agregado distinto.
 */
export default function PredictionsInsights({
  matches,
  teamMatches,
  participantsById,
  tallies,
  teamTallies
}: PredictionsInsightsProps) {
  const matchEntries = matches
    .filter((m): m is Match & { id: string } => Boolean(m.id))
    .map((m) => ({ match: m, tally: tallies[m.id] }))
    .filter((e): e is { match: Match & { id: string }; tally: PredictionTally } => Boolean(e.tally) && e.tally.totalVotes > 0);

  const teamEntries = teamMatches
    .filter((tm): tm is TeamMatch & { id: string } => Boolean(tm.id))
    .map((tm) => ({ teamMatch: tm, tally: teamTallies[tm.id] }))
    .filter(
      (e): e is { teamMatch: TeamMatch & { id: string }; tally: TeamPredictionTally } =>
        Boolean(e.tally) && e.tally.totalVotes > 0
    );

  const totalFighterVotes = matchEntries.reduce((sum, e) => sum + e.tally.totalVotes, 0);
  const totalTeamVotes = teamEntries.reduce((sum, e) => sum + e.tally.totalVotes, 0);
  const totalVotes = totalFighterVotes + totalTeamVotes;

  if (totalVotes === 0) {
    return <p className="text-center text-slate-500">{copy.insightsEmptyState}</p>;
  }

  // Peleador mas votado: suma de votos a favor de cada jugador a lo largo
  // de todos sus 1v1 abiertos a pronostico (alguien con 2 combates suma
  // los votos de ambos).
  const votesPerFighter = new Map<string, number>();
  for (const { match, tally } of matchEntries) {
    votesPerFighter.set(match.player1Id, (votesPerFighter.get(match.player1Id) ?? 0) + tally.player1Votes);
    votesPerFighter.set(match.player2Id, (votesPerFighter.get(match.player2Id) ?? 0) + tally.player2Votes);
  }
  const mostVotedFighter = [...votesPerFighter.entries()]
    .map(([id, votes]) => ({ participant: participantsById[id], votes }))
    .filter((e): e is { participant: Participant; votes: number } => Boolean(e.participant))
    .sort((a, b) => b.votes - a.votes)[0];

  // Mayor diferencia de votos entre rivales, en un mismo combate 1v1.
  const biggestGapMatch = matchEntries
    .map((e) => ({
      ...e,
      gap: Math.abs(e.tally.player1Votes - e.tally.player2Votes),
      leader:
        e.tally.player1Votes >= e.tally.player2Votes
          ? participantsById[e.match.player1Id]
          : participantsById[e.match.player2Id],
      trailer:
        e.tally.player1Votes >= e.tally.player2Votes
          ? participantsById[e.match.player2Id]
          : participantsById[e.match.player1Id]
    }))
    .filter((e) => e.leader && e.trailer)
    .sort((a, b) => b.gap - a.gap)[0];

  // Combate 1v1 con mas votos totales.
  const mostVotedMatch = [...matchEntries].sort((a, b) => b.tally.totalVotes - a.tally.totalVotes)[0];

  // Mayor diferencia de votos entre equipos, en un mismo combate por equipos.
  const biggestGapTeamMatch = teamEntries
    .map((e) => ({
      ...e,
      gap: Math.abs(e.tally.teamAVotes - e.tally.teamBVotes),
      leaderLabel: e.tally.teamAVotes >= e.tally.teamBVotes ? PAGES.matches.teamALabel : PAGES.matches.teamBLabel
    }))
    .sort((a, b) => b.gap - a.gap)[0];

  const cards = [
    mostVotedFighter && {
      label: copy.mostVotedFighterLabel,
      value: mostVotedFighter.participant.name,
      detail: `${mostVotedFighter.votes.toLocaleString("es")} ${copy.votesSuffix}`,
      photo: mostVotedFighter.participant.photo ?? fallbackPhoto(mostVotedFighter.participant)
    },
    biggestGapMatch && {
      label: copy.biggestGapMatchLabel,
      value: `${biggestGapMatch.leader!.name} vs ${biggestGapMatch.trailer!.name}`,
      detail: `${biggestGapMatch.gap.toLocaleString("es")} ${copy.gapSuffix}`,
      href: `/combates/${biggestGapMatch.match.id}`
    },
    mostVotedMatch && {
      label: copy.mostVotedMatchLabel,
      value: `${participantsById[mostVotedMatch.match.player1Id]?.name ?? "?"} vs ${participantsById[mostVotedMatch.match.player2Id]?.name ?? "?"}`,
      detail: `${mostVotedMatch.tally.totalVotes.toLocaleString("es")} ${copy.votesSuffix}`,
      href: `/combates/${mostVotedMatch.match.id}`
    },
    biggestGapTeamMatch && {
      label: copy.biggestGapTeamMatchLabel,
      value: biggestGapTeamMatch.teamMatch.name ?? biggestGapTeamMatch.leaderLabel,
      detail: `${biggestGapTeamMatch.gap.toLocaleString("es")} ${copy.gapSuffix}`,
      href: `/combates/equipo/${biggestGapTeamMatch.teamMatch.id}`
    },
    {
      label: copy.totalVotesLabel,
      value: totalVotes.toLocaleString("es"),
      detail: null
    }
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <div className="insights-grid">
      {cards.map((card) => (
        <InsightCard key={card.label} {...card} />
      ))}
      <style>{`
        .insights-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
      `}</style>
    </div>
  );
}

function InsightCard({
  label,
  value,
  detail,
  photo,
  href
}: {
  label: string;
  value: string;
  detail: string | null;
  photo?: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="insight-card-label">{label}</span>
      <div className="insight-card-main">
        {photo && <img src={photo} alt="" className="insight-card-photo" />}
        <span className="insight-card-value">{value}</span>
      </div>
      {detail && <span className="insight-card-detail">{detail}</span>}
      <style>{`
        .insight-card-label {
          display: block;
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a09b8c;
          margin-bottom: 10px;
        }

        .insight-card-main {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .insight-card-photo {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(200, 170, 110, 0.4);
          flex-shrink: 0;
        }

        .insight-card-value {
          font-family: var(--font-display, inherit);
          font-weight: 700;
          font-size: 1rem;
          color: white;
          line-height: 1.2;
        }

        .insight-card-detail {
          display: block;
          margin-top: 8px;
          font-size: 0.7rem;
          color: #C8AA6E;
          font-weight: 700;
        }
      `}</style>
    </>
  );

  const className = `insight-card bg-lol-cardBg border border-lol-border p-5 block ${href ? "insight-card-clickable" : ""}`;

  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }

  return <div className={className}>{inner}</div>;
}
