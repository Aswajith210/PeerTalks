export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id">>;
      };
      token_balances: {
        Row: TokenBalance;
        Insert: Omit<TokenBalance, "created_at" | "updated_at">;
        Update: Partial<Omit<TokenBalance, "user_id">>;
      };
      token_transactions: {
        Row: TokenTransaction;
        Insert: Omit<TokenTransaction, "id" | "created_at">;
        Update: never;
      };
      chat_sessions: {
        Row: ChatSession;
        Insert: Omit<ChatSession, "id" | "created_at">;
        Update: Partial<Omit<ChatSession, "id">>;
      };
      messages: {
        Row: Message;
        Insert: Omit<Message, "id" | "created_at">;
        Update: never;
      };
      private_rooms: {
        Row: PrivateRoom;
        Insert: Omit<PrivateRoom, "id" | "created_at">;
        Update: Partial<Omit<PrivateRoom, "id">>;
      };
      user_interests: {
        Row: UserInterest;
        Insert: Omit<UserInterest, "id" | "created_at">;
        Update: never;
      };
      matching_queue: {
        Row: MatchingQueueEntry;
        Insert: Omit<MatchingQueueEntry, "id" | "created_at">;
        Update: Partial<Omit<MatchingQueueEntry, "id">>;
      };
    };
  };
}

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenBalance {
  user_id: string;
  balance: number;
  last_daily_at: string;
  created_at: string;
  updated_at: string;
}

export interface TokenTransaction {
  id: number;
  user_id: string;
  amount: number;
  type: "daily_allowance" | "chat_cost" | "admin_grant" | "refund";
  description: string | null;
  session_id: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  mode: "random" | "interest" | "private_room";
  status: "waiting" | "matching" | "connected" | "ended";
  user1_id: string | null;
  user2_id: string | null;
  room_id: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
}

export interface PrivateRoom {
  id: string;
  name: string;
  password_hash: string;
  host_id: string;
  guest_id: string | null;
  is_active: boolean;
  created_at: string;
  ended_at: string | null;
}

export interface UserInterest {
  id: number;
  user_id: string;
  interest: string;
  created_at: string;
}

export interface MatchingQueueEntry {
  id: number;
  user_id: string;
  mode: "random" | "interest";
  interests: string[];
  status: "waiting" | "matched";
  matched_user_id: string | null;
  session_id: string | null;
  created_at: string;
  matched_at: string | null;
}
