import Cover from "@/components/Cover";
import { loadVolunteers, loadWorld } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Cover initialVolunteers={loadVolunteers()} world={loadWorld()} />;
}
