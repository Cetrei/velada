import { useState } from "react";
import type { Participant, EventState } from "@velada/core";
import { PAGES } from "@velada/core";
import ParticipantManager from "./ParticipantManager";
import AdminControl from "./AdminControl";

interface AdminTabsProps {
  initialParticipants: Participant[];
  eventState: EventState;
}

type Tab = "participants" | "event";

const copy = PAGES.rosterManager;

/**
 * Pestanas del panel de host: separa gestion de participantes (roster) de
 * control del evento (fases: inscripciones, ruleta, votaciones, inicio,
 * fecha) para que ambas cosas vivan en /gestion-roster-x9f2 sin quedar
 * amontonadas una debajo de la otra. AdminControl ya existia como
 * componente completo pero no estaba montado en ninguna pagina — este
 * archivo es solo el layout de pestanas que lo conecta junto a
 * ParticipantManager, sin tocar la logica interna de ninguno de los dos.
 */
export default function AdminTabs({ initialParticipants, eventState }: AdminTabsProps) {
  const [tab, setTab] = useState<Tab>("participants");

  return (
    <div>
      <div className="flex items-center justify-center gap-2 mb-8 border-b border-lol-border">
        <TabButton active={tab === "participants"} onClick={() => setTab("participants")}>
          {copy.tabParticipants}
        </TabButton>
        <TabButton active={tab === "event"} onClick={() => setTab("event")}>
          {copy.tabEvent}
        </TabButton>
      </div>

      {tab === "participants" ? (
        <ParticipantManager initialParticipants={initialParticipants} />
      ) : (
        <AdminControl
          participants={initialParticipants}
          initialRouletteUnlocked={eventState.rouletteUnlocked}
          initialStartTime={eventState.startTime}
          initialRegistrationsOpen={eventState.registrationsOpen}
          initialVotingEnabled={eventState.votingEnabled}
          initialEventStarted={eventState.eventStarted}
        />
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
