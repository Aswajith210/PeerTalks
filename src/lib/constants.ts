export const TOKEN_COSTS = {
  VIDEO_CHAT: 2,
  TEXT_CHAT: 2,
  PRIVATE_ROOM: 5,
} as const;

export const TOKEN_ALLOWANCE = {
  AMOUNT: 20,
  INTERVAL_HOURS: 24,
} as const;

export const MATCHING_TIMEOUT_MS = 120_000;

const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const SITE_URL_FALLBACK = "https://peer-talks-three.vercel.app";

export const SITE_URL =
  envSiteUrl &&
  /^https?:\/\//.test(envSiteUrl) &&
  !/localhost|127\.0\.0\.1/.test(envSiteUrl)
    ? envSiteUrl.replace(/\/+$/, "")
    : SITE_URL_FALLBACK;

export const SITE_NAME = "PeerTalks";
export const SITE_DESCRIPTION =
  "Connect meaningfully with people from around the world through video and text conversations.";
