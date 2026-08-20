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
        Update: Partial<Omit<Message, "id" | "session_id">>;
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
      reports: {
        Row: Report;
        Insert: Omit<Report, "id" | "created_at">;
        Update: never;
      };
      blocks: {
        Row: Block;
        Insert: Omit<Block, "id" | "created_at">;
        Update: never;
      };
      message_reactions: {
        Row: MessageReaction;
        Insert: Omit<MessageReaction, "id" | "created_at">;
        Update: never;
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
  call_type: "video" | "text";
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
  // Soft-delete tombstone (00013): set by the sender's DELETE action; the
  // bubble renders "Message deleted" instead of the content.
  deleted_at?: string | null;
  deleted_by?: string | null;
  // Attachment ledger row (00012), folded in client-side for the bubble.
  // Absent when the migration isn't applied — the chat works as before.
  attachment?: MessageAttachment | null;
}

export interface MessageAttachment {
  id: number;
  message_id: number;
  session_id: string;
  uploader_id: string | null;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  storage_path: string;
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
  call_type: "video" | "text";
  status: "waiting" | "matched";
  matched_user_id: string | null;
  session_id: string | null;
  created_at: string;
  matched_at: string | null;
}

export interface Report {
  id: number;
  reporter_id: string;
  reported_user_id: string;
  session_id: string | null;
  reason: string;
  created_at: string;
}

export interface Block {
  id: number;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface MessageReaction {
  id: number;
  message_id: number;
  user_id: string;
  reaction: string;
  created_at: string;
}
