export function SiteFooter() {
  return (
    <footer className="footer">
      <p>
        ProofCast — TxODDS World Cup Hackathon build. Match data:{" "}
        <a href="https://txline-docs.txodds.com" target="_blank" rel="noreferrer">TxLINE</a>{" "}
        (primary input, Solana devnet proofs) · Narration audio generated with{" "}
        <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">ElevenLabs</a>{" "}
        · Recaps cite only verified data — every fact links to its Merkle proof.
      </p>
    </footer>
  );
}
