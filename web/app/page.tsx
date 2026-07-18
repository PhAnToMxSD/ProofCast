import { Experience } from "@/components/Experience";
import { getCatalog } from "@/lib/catalog";

export default function Page() {
  return <Experience matches={getCatalog()} />;
}
