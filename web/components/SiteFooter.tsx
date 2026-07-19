export function SiteFooter() {
  return (
    <footer className="footer">
      <p>
        ProofCast — TxODDS World Cup Hackathon build. A verified match-centre — full stats plus AI
        recaps — for every fixture. Match data:{" "}
        <a href="https://txline-docs.txodds.com" target="_blank" rel="noreferrer">TxLINE</a>{" "}
        (primary input, Solana devnet proofs) · Narration audio generated with{" "}
        <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">ElevenLabs</a>{" "}
        · Every stat and every recap fact links to its Merkle proof.
      </p>
    </footer>
  );
}
