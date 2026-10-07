import Crewline from "@/components/Crewline";
import PhoneShell from "@/components/PhoneShell";
import { loadVolunteers, loadWorld } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PhoneShell>
      <Crewline initialVolunteers={loadVolunteers()} world={loadWorld()} />
    </PhoneShell>
  );
}
