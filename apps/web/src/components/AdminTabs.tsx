import { useState } from "react";
import type { Participant, EventState, Match, TeamMatch } from "@velada/core";
import { PAGES } from "@velada/core";
import ParticipantManager from "./ParticipantManager";
import AdminControl from "./AdminControl";
import MatchManager from "./MatchManager";
import TeamMatchManager from "./TeamMatchManager";

interface AdminTabsProps {
  initialParticipants: Participant[];
  eventState: EventState;
  initialMatches: Match[];
  initialTeamMatches: TeamMatch[];
}

type Tab = "participants" | "event" | "matches" | "teams";

const copy = PAGES.rosterManager;

export default function AdminTabs({ initialParticipants, eventState, initialMatches, initialTeamMatches }: AdminTabsProps) {
  const [tab, setTab] = useState<Tab>("participants");

  const realParticipants = initialParticipants.filter((p) => !p.excludeFromMatches);

  return (
    <div>
      <div className="flex items-center justify-center gap-2 mb-8 border-b border-lol-border">
        <TabButton active={tab === "participants"} onClick={() => setTab("participants")}>
          {copy.tabParticipants}
        </TabButton>
        <TabButton active={tab === "event"} onClick={() => setTab("event")}>
          {copy.tabEvent}
        </TabButton>
        <TabButton active={tab === "matches"} onClick={() => setTab("matches")}>
          {copy.tabMatches}
        </TabButton>
        <TabButton active={tab === "teams"} onClick={() => setTab("teams")}>
          {copy.tabTeams}
        </TabButton>
      </div>

      {tab === "participants" && <ParticipantManager initialParticipants={realParticipants} />}
      {tab === "event" && (
        <AdminControl
          participants={realParticipants}
          initialMatches={initialMatches}
          initialRouletteUnlocked={eventState.rouletteUnlocked}
          initialStartTime={eventState.startTime}
          initialRegistrationsOpen={eventState.registrationsOpen}
          initialVotingEnabled={eventState.votingEnabled}
          initialEventStarted={eventState.eventStarted}
        />
      )}
      {tab === "matches" && (
        <MatchManager initialMatches={initialMatches} participants={realParticipants} />
      )}
      {tab === "teams" && (
        <TeamMatchManager initialTeamMatches={initialTeamMatches} participants={realParticipants} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-6 py-3 font-bold uppercase text-sm tracking-wide border-b-2 transition-colors ${
        active
          ? "border-lol-gold text-lol-gold"
          : "border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
