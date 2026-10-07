import Crewline from "@/components/Crewline";
import { loadVolunteers, loadWorld } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Crewline initialVolunteers={loadVolunteers()} world={loadWorld()} />;
}
