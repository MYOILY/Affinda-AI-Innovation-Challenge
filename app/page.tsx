import Crewline from "@/components/Crewline";
import PhoneShell from "@/components/PhoneShell";
import StartScreen from "@/components/StartScreen";
import { loadVolunteers, loadWorld } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PhoneShell>
      <StartScreen>
        <Crewline initialVolunteers={loadVolunteers()} world={loadWorld()} />
      </StartScreen>
    </PhoneShell>
  );
}
