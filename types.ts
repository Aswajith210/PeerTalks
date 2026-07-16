export interface User {
  id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
}

export interface TokenInfo {
  balance: number;
  last_daily_at: string;
}

export interface ChatParticipant {
  id?: string;
  display_name?: string;
  avatar_url?: string;
}
