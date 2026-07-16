"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

interface User {
  id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
}

export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const supabase = await createClient();
      if (!supabase) { if (mounted) setLoading(false); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("id", session.user.id)
          .single();

        if (mounted) {
          setUser({
            id: session.user.id,
            email: session.user.email,
            display_name: profile?.display_name || session.user.user_metadata?.full_name,
            avatar_url: profile?.avatar_url || session.user.user_metadata?.avatar_url,
          });
        }
      }
      if (mounted) setLoading(false);
    };
    init();
    return () => { mounted = false; };
  }, []);

  const handleLogout = async () => {
    const supabase = await createClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setOpen(false);
    router.refresh();
  };

  if (loading) return <div className="w-8 h-8 rounded-full bg-white/[0.04] animate-pulse" />;

  if (!user) return null;

  return (
    <div className="relative">
      <motion.button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 p-0.5 rounded-full border border-white/[0.08] hover:border-white/[0.15] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        aria-label="User menu"
      >
        <Avatar src={user.avatar_url} alt={user.display_name || "User"} size={28} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-0 top-full mt-2 z-50 w-56 glass-strong rounded-xl overflow-hidden shadow-premium-lg"
            >
              <div className="px-4 py-3 border-b border-white/[0.04]">
                <p className="text-sm font-medium text-white/90 truncate">{user.display_name || "User"}</p>
                <p className="text-xs text-muted truncate mt-0.5">{user.email}</p>
              </div>
              <div className="p-1">
                <MenuItem onClick={() => { router.push("/dashboard"); setOpen(false); }} label="Dashboard" />
                <MenuItem onClick={() => { router.push("/dashboard/settings"); setOpen(false); }} label="Settings" />
                <MenuItem onClick={handleLogout} label="Sign out" danger />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        danger
          ? "text-error/80 hover:text-error hover:bg-white/[0.04]"
          : "text-muted hover:text-white/90 hover:bg-white/[0.04]"
      }`}
    >
      {label}
    </button>
  );
}
