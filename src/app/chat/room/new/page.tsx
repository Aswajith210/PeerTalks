"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { motion } from "framer-motion";

function PrivateRoomContent() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create room");
        setLoading(false);
        return;
      }

      router.push(`/chat/room/${data.session?.id || data.room?.id}`);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to join room");
        setLoading(false);
        return;
      }

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

            {error && <p className="text-xs text-red-400/80">{error}</p>}

            <Button
              size="lg"
              className="w-full"
              loading={loading}
              onClick={tab === "create" ? handleCreate : handleJoin}
            >
              {tab === "create" ? "Create Room (5 tokens)" : "Join Room (5 tokens)"}
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
