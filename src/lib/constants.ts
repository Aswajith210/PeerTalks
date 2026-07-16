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

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const SITE_NAME = "PeerTalks";
export const SITE_DESCRIPTION =
  "Connect meaningfully with people from around the world through video and text conversations.";
