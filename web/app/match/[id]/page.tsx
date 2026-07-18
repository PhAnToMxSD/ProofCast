import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/catalog";
import { MatchExperience } from "@/components/MatchExperience";

// Statically generate a page for every verified match in the catalog.
export function generateStaticParams() {
  return getCatalog().map((m) => ({ id: m.matchId }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const match = getCatalog().find((m) => m.matchId === id);
  if (!match) return { title: "Match not found — ProofCast" };
  const line = `${match.homeTeam} ${match.finalScore.home}–${match.finalScore.away} ${match.awayTeam}`;
  return {
    title: `${line} — ProofCast`,
    description: `Hear a verified recap of ${line} (${match.competition}).`,
  };
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getCatalog().find((m) => m.matchId === id);
  if (!match) notFound();
  return <MatchExperience match={match} />;
}
