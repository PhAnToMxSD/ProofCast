"use client";

import { useState } from "react";
import { flagFor, flagUrl } from "@/lib/flags";

// Country flag with graceful degradation: flagcdn PNG → emoji → ⚽.
export function Flag({ team, size = 48 }: { team: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const { code, emoji } = flagFor(team);
  const height = Math.round(size * 0.75);

  if (!code || failed) {
    return (
      <span
        className="flag-emoji"
        style={{ width: size, height, fontSize: Math.round(size * 0.66) }}
        role="img"
        aria-label={`${team} flag`}
      >
        {emoji}
      </span>
    );
  }
  return (
    <img
      className="flag-img"
      src={flagUrl(code)}
      width={size}
      height={height}
      alt={`${team} flag`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
