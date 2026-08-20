"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useTokens } from "@/hooks/useTokens";
import { motion } from "framer-motion";

function PrivateRoomContent() {
  const router = useRouter();
  const { refresh, setBalance } = useTokens();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [callType, setCallType] = useState<"video" | "text">("video");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [capacity, setCapacity] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name || password.length < 6) {
      setError("Room name and password (min 6 chars) required");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rooms/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": globalThis.crypto.randomUUID(),
          "x-call-type": callType,
        },
        body: JSON.stringify({ name, password, capacity }),
      });
      const data = await res.json();

      if (!res.ok) {
        console.error("[tokens] room create POST rejected", {
          status: res.status, body: data,
        });
        setError(data.error || "Failed to create room");
        setLoading(false);
        return;
      }

      if (typeof data.balance === "number") setBalance(data.balance);
      await refresh();

      // Capacity lives behind the 00011 migration. When the backend can't
      // store it (capacity_supported: false) the room silently falls back
      // to 2 people — tell the room page so it can say so.
      const degraded = data.capacity_supported === false ? "?cap=degraded" : "";
      router.push(`/chat/room/${data.session?.id || data.room?.id}${degraded}`);
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!name || !password) {
      setError("Room name and password required");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": globalThis.crypto.randomUUID(),
          "x-call-type": callType,
        },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        console.error("[tokens] room join POST rejected", {
          status: res.status, body: data,
        });
        setError(data.error || "Failed to join room");
        setLoading(false);
        return;
      }

      if (typeof data.balance === "number") setBalance(data.balance);
      await refresh();

      router.push(`/chat/room/${data.session?.id || data.room?.id}`);
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16">
      <div className="w-full max-w-sm">
        <div className="glass-card rounded-2xl p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold text-white/90 mb-2">Private Room</h1>
            <p className="text-sm text-muted">Create or join a password-protected room.</p>
          </div>

          <div className="flex rounded-lg bg-white/5 border border-white/10 p-0.5 mb-6">
            <button
              onClick={() => { setTab("create"); setError(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                tab === "create"
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-white/40 hover:text-white/60"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
            >
              Create Room
            </button>
            <button
              onClick={() => { setTab("join"); setError(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                tab === "join"
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-white/40 hover:text-white/60"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
            >
              Join Room
            </button>
          </div>

          <div className="flex rounded-lg bg-white/5 border border-white/10 p-0.5 mb-6">
            <button
              onClick={() => { setCallType("video"); setError(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                callType === "video"
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-white/40 hover:text-white/60"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
            >
              Video
            </button>
            <button
              onClick={() => { setCallType("text"); setError(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                callType === "text"
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-white/40 hover:text-white/60"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
            >
              Text
            </button>
          </div>

          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <Input
              label="Room Name"
              placeholder="Enter room name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              placeholder={tab === "create" ? "Create a password (min 6 chars)" : "Enter room password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {tab === "create" && (
              <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-white/80">Room capacity</p>
                  <p className="text-[11px] text-muted">1 host + up to {capacity - 1} guests</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="Decrease capacity"
                    onClick={() => setCapacity((c) => Math.max(2, c - 1))}
                    className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 text-white/80 text-sm hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    −
                  </button>
                  <span aria-label="Capacity value" className="w-6 text-center text-sm font-medium text-white/90">
                    {capacity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase capacity"
                    onClick={() => setCapacity((c) => Math.min(8, c + 1))}
                    className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 text-white/80 text-sm hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-400/80">{error}</p>}

            <Button
              size="lg"
              className="w-full"
              loading={loading}
              onClick={tab === "create" ? handleCreate : handleJoin}
            >
              {tab === "create" ? "Create " : "Join "}
              {callType === "video" ? "Video" : "Text"} Room (5 tokens)
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default function PrivateRoomPage() {
  return (
    <AuthGuard>
      <PrivateRoomContent />
    </AuthGuard>
  );
}
