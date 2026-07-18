// National flags for the scoreboard UI. flagcdn.com PNG (4:3) with an emoji
// fallback if the CDN is unreachable — the demo must never show a broken image.

type FlagInfo = { code: string | null; emoji: string };

const FLAGS: Record<string, FlagInfo> = {
  // The cached demo matches
  Norway: { code: "no", emoji: "🇳🇴" },
  France: { code: "fr", emoji: "🇫🇷" },
  Portugal: { code: "pt", emoji: "🇵🇹" },
  Uzbekistan: { code: "uz", emoji: "🇺🇿" },
  Uruguay: { code: "uy", emoji: "🇺🇾" },
  "Cape Verde": { code: "cv", emoji: "🇨🇻" },
  Tunisia: { code: "tn", emoji: "🇹🇳" },
  Netherlands: { code: "nl", emoji: "🇳🇱" },
  Canada: { code: "ca", emoji: "🇨🇦" },
  Qatar: { code: "qa", emoji: "🇶🇦" },
  // Cheap insurance for a 4th live-demo match
  Argentina: { code: "ar", emoji: "🇦🇷" },
  Belgium: { code: "be", emoji: "🇧🇪" },
  Brazil: { code: "br", emoji: "🇧🇷" },
  Croatia: { code: "hr", emoji: "🇭🇷" },
  England: { code: "gb-eng", emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  Germany: { code: "de", emoji: "🇩🇪" },
  Italy: { code: "it", emoji: "🇮🇹" },
  Japan: { code: "jp", emoji: "🇯🇵" },
  Mexico: { code: "mx", emoji: "🇲🇽" },
  Morocco: { code: "ma", emoji: "🇲🇦" },
  Spain: { code: "es", emoji: "🇪🇸" },
  USA: { code: "us", emoji: "🇺🇸" },
};

export function flagFor(team: string): FlagInfo {
  return FLAGS[team] ?? { code: null, emoji: "⚽" };
}

export function flagUrl(code: string): string {
  return `https://flagcdn.com/w160/${code}.png`;
}
