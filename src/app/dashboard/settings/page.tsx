"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";

function SettingsContent() {
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const supabase = await createClient();
      if (!supabase) return;
      const { data } = await supabase
        .from("profiles")
        .select("display_name, bio")
        .eq("id", user.id)
        .single();
      if (data) {
        setDisplayName(data.display_name || "");
        setBio(data.bio || "");
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const supabase = await createClient();
    if (!supabase) { setSaving(false); return; }
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: displayName, bio });
    setSaving(false);
    if (error) {
      toast.error("Failed to save", error.message);
    } else {
      toast.success("Profile updated");
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-24 sm:pt-28 pb-16 relative z-10">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-48 rounded-lg bg-white/[0.04]" />
          <div className="h-4 w-64 rounded-lg bg-white/[0.04]" />
          <div className="h-64 rounded-3xl bg-white/[0.04] mt-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-24 sm:pt-28 pb-16 relative z-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="text-2xl sm:text-3xl font-semibold text-white/90 tracking-tight">Settings</h1>
        <p className="text-sm text-muted mt-1.5">Manage your profile and preferences.</p>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="mt-10 glass-card rounded-3xl p-6 sm:p-8"
      >
        <h2 className="text-base font-semibold text-white/90 mb-6">Profile</h2>
        <div className="space-y-5">
          <div>
            <label htmlFor="display-name" className="text-xs font-medium text-muted-light block mb-1.5">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              maxLength={40}
              className="h-11 w-full px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="bio" className="text-xs font-medium text-muted-light block mb-1.5">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A short bio..."
              rows={3}
              maxLength={160}
              className="w-full px-4 py-3 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none resize-none"
            />
            <p className="text-xs text-muted mt-1.5 text-right">{bio.length}/160</p>
          </div>
          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-11 px-6 rounded-xl bg-white/10 text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 glass-card rounded-3xl p-6 sm:p-8"
      >
        <h2 className="text-base font-semibold text-white/90 mb-3">Account</h2>
        <p className="text-sm text-muted mb-5 leading-relaxed">
          Signed in as <span className="text-white/60">{user?.email}</span>
        </p>
        <button
          onClick={async () => {
            const supabase = await createClient();
            if (supabase) await supabase.auth.signOut();
            window.location.href = "/login";
          }}
          className="h-11 px-6 rounded-xl bg-error-soft text-sm font-medium text-error hover:bg-error/15 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/30"
        >
          Sign out
        </button>
      </motion.section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}
