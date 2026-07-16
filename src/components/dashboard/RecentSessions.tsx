"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatRelativeTime } from "@/lib/utils";
import Icons from "@/components/icons/icons";

interface Session {
  id: string;
  mode: "random" | "interest" | "private_room";
  status: "waiting" | "matching" | "connected" | "ended";
  user1_id: string | null;
  user2_id: string | null;
  created_at: string;
  ended_at: string | null;
}

const modeLabels: Record<string, string> = {
  random: "Random Chat",
  interest: "Interest Chat",
  private_room: "Private Room",
};

const modeIcons: Record<string, React.ReactNode> = {
  random: <Icons.Users size={16} />,
  interest: <Icons.Heart size={16} />,
  private_room: <Icons.Lock size={16} />,
};

export function RecentSessions() {
  const { user } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchSessions = async () => {
      const supabase = await createClient();
      if (!supabase) { setLoading(false); return; }

      const { data } = await supabase
        .from("chat_sessions")
        .select("*")
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(10);

      setSessions(data ?? []);
      setLoading(false);
    };

    fetchSessions();
  }, [user]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Chat size={20} />}
        title="No conversations yet"
        description="Start a new chat to see your conversation history here."
      />
    );
  }

  return (
    <div className="space-y-1.5">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => {
            if (session.status === "connected") {
              router.push(`/chat/room/${session.id}`);
            }
          }}
          disabled={session.status !== "connected"}
          className="w-full glass-card rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
        >
          <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
            <span className="text-white/30">{modeIcons[session.mode]}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white/70">{modeLabels[session.mode]}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                session.status === "connected"
                  ? "bg-success-soft text-success border border-success/20"
                  : session.status === "ended"
                  ? "bg-white/[0.04] text-white/25 border border-white/[0.06]"
                  : "bg-warning-soft text-warning border border-warning/20"
              }`}>
                {session.status}
              </span>
            </div>
            <p className="text-xs text-white/25 mt-0.5">
              {formatRelativeTime(session.created_at)}
            </p>
          </div>
          {session.status === "connected" && (
            <svg className="w-4 h-4 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
