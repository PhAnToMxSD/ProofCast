import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { Flag } from "@/components/Flag";

// Pull real proof coordinates out of a stat-validation URL for the ticket stamp.
function proofStamp(url: string): string {
  try {
    const q = new URL(url).searchParams;
    const seq = q.get("seq");
    const key = q.get("statKey");
    if (seq && key) return `SEQ ${seq} · KEY ${key} · ✓ VERIFIED`;
  } catch {
    /* fall through */
  }
  return "✓ VERIFIED ON-CHAIN";
}

export default function Landing() {
  const catalog = getCatalog();
  const featured = catalog[0]; // most recent verified fixture

  return (
    <main className="landing shell">
      <span className="landing-bug">
        <span className="live-dot" aria-hidden="true" />
        ProofCast · matchday, on the record
      </span>

      <h1 className="landing-title">
        Every sentence
        <br />
        has a <span className="verify">receipt</span>.
      </h1>

      <p className="landing-sub">
        Matchday recaps built from cryptographically verified TxLINE data and narrated aloud.
        Every fact you hear links to its proof on Solana — nothing is invented.
      </p>

      {featured && (
        <div className="ticket" aria-label="Sample on-chain receipt">
          <div className="ticket-body">
            <span className="ticket-comp">{featured.competition} · full-time</span>
            <div className="ticket-row">
              <span>{featured.homeTeam}</span>
              <span className="ticket-score">
                {featured.finalScore.home}–{featured.finalScore.away}
              </span>
              <span>{featured.awayTeam}</span>
            </div>
            <p className="ticket-quote">
              The final score isn’t asserted — it’s proven against the day’s Merkle root
              published on-chain.
            </p>
          </div>
          <div className="ticket-tear" aria-hidden="true" />
          <div className="ticket-stub">
            <span className="stub-label">On-chain receipt</span>
            <span className="ticket-proof">{proofStamp(featured.finalProofApiUrl)}</span>
          </div>
        </div>
      )}

      <div className="landing-cta-row">
        <Link href="/matches" className="cta">
          Browse the matches <span aria-hidden="true">→</span>
        </Link>
        <span className="cta-note">{catalog.length} World Cup fixtures · 3 narrators each</span>
      </div>

      <ol className="how">
        <li>
          <span className="how-idx">STEP 01</span>
          <span className="how-k">Pick a match</span>
          <span className="how-v">
            {catalog.length} verified World Cup fixtures, final scores and all.
          </span>
        </li>
        <li>
          <span className="how-idx">STEP 02</span>
          <span className="how-k">Choose a narrator</span>
          <span className="how-v">
            Hype commentator, deadpan analyst, or bedtime story — same facts, different voice.
          </span>
        </li>
        <li>
          <span className="how-idx">STEP 03</span>
          <span className="how-k">Listen</span>
          <span className="how-v">
            Play the recap. Every claim carries a link to its on-chain proof.
          </span>
        </li>
      </ol>

      <div className="landing-crest" aria-hidden="true">
        {catalog.slice(0, 5).map((m) => (
          <Flag key={m.matchId} team={m.homeTeam} size={26} />
        ))}
      </div>
    </main>
  );
}
