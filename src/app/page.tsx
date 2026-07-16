"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef } from "react";
import { LoginButton } from "@/components/auth/LoginButton";

const HeroScene = dynamic(
  () => import("@/components/three/HeroScene").then((m) => ({ default: m.HeroScene })),
  { ssr: false }
);

function SectionDivider() {
  return (
    <div className="divider-premium max-w-3xl mx-auto my-0" />
  );
}

function StorySection({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`relative py-24 sm:py-32 px-4 ${className}`}>
      <div className="max-w-6xl mx-auto">
        {children}
      </div>
    </section>
  );
}

function FloatingCard({
  children,
  index = 0,
  className = "",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay: index * 0.12, ease: [0.16, 1, 0.3, 1] }}
      className={`glass-card rounded-3xl p-8 sm:p-10 card-lift ${className}`}
    >
      {children}
    </motion.div>
  );
}

function GlassIconWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
      {children}
    </div>
  );
}

export default function Home() {
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      {/* Hero Section */}
      <section ref={heroRef} className="relative min-h-screen flex items-center justify-center">
        <HeroScene />

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto pt-24 pb-16 sm:pt-32 sm:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-xs text-white/40 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse-soft" />
              Premium anonymous conversations
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-white/90 mb-6 leading-[1.1] text-balance"
          >
            Connect beyond
            <br />
            <span className="text-gradient">the surface</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-base sm:text-lg text-muted max-w-xl mx-auto mb-10 leading-relaxed"
          >
            PeerTalks is a private space for genuine conversation.
            No profiles, no followers — just meaningful human connection.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex flex-col sm:flex-row items-center gap-3"
          >
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-white text-graphite-950 text-sm font-medium hover:bg-white/90 active:bg-white/80 transition-all duration-200 btn-premium shadow-premium w-full sm:w-auto"
            >
              Start connecting
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl glass-strong text-white/70 hover:text-white text-sm font-medium transition-all duration-200 btn-premium w-full sm:w-auto"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
              </svg>
              How it works
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.4 }}
            className="mt-16 sm:mt-20"
          >
            <div className="flex items-center justify-center gap-6 sm:gap-10 text-xs text-white/20">
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                End-to-end encrypted
              </span>
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                </svg>
                No account needed
              </span>
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><circle cx="9" cy="9" r="1" /><circle cx="15" cy="9" r="1" />
                </svg>
                Free daily tokens
              </span>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <div className="flex flex-col items-center gap-2 text-white/15">
            <span className="text-[10px] uppercase tracking-widest">Scroll</span>
            <svg className="w-4 h-4 animate-float-scroll" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        </motion.div>
      </section>

      <SectionDivider />

      {/* How It Works - Storytelling section */}
      <StorySection id="how-it-works">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-16 sm:mb-20"
          >
            <span className="text-xs font-medium text-white/30 uppercase tracking-[0.2em] mb-4 block">The Experience</span>
            <h2 className="text-3xl sm:text-4xl font-semibold text-white/90 mb-4 tracking-tight">
              Three ways to connect
            </h2>
            <p className="text-muted text-base max-w-xl mx-auto leading-relaxed">
              Every conversation is a fresh start. Choose the path that feels right.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            <FloatingCard index={0}>
              <div className="flex flex-col items-center text-center">
                <GlassIconWrapper>
                  <svg className="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </GlassIconWrapper>
                <h3 className="text-lg font-semibold text-white/90 mt-4 mb-2">Random Chat</h3>
                <p className="text-sm text-muted leading-relaxed">
                  Instantly connect with someone new. No filters, no expectations — just a genuine human moment.
                </p>
                <div className="mt-4 text-xs text-white/20 font-mono">2 tokens</div>
              </div>
            </FloatingCard>

            <FloatingCard index={1}>
              <div className="flex flex-col items-center text-center">
                <GlassIconWrapper>
                  <svg className="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </GlassIconWrapper>
                <h3 className="text-lg font-semibold text-white/90 mt-4 mb-2">Interest Matching</h3>
                <p className="text-sm text-muted leading-relaxed">
                  Find people who share your passions. Music, art, technology — connect over what matters to you.
                </p>
                <div className="mt-4 text-xs text-white/20 font-mono">2 tokens</div>
              </div>
            </FloatingCard>

            <FloatingCard index={2}>
              <div className="flex flex-col items-center text-center">
                <GlassIconWrapper>
                  <svg className="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="5" y="11" width="14" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </GlassIconWrapper>
                <h3 className="text-lg font-semibold text-white/90 mt-4 mb-2">Private Rooms</h3>
                <p className="text-sm text-muted leading-relaxed">
                  Create a password-protected space. Share the link and control who joins your conversation.
                </p>
                <div className="mt-4 text-xs text-white/20 font-mono">5 tokens</div>
              </div>
            </FloatingCard>
          </div>
        </div>
      </StorySection>

      <SectionDivider />

      {/* Video Experience Section */}
      <StorySection>
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 sm:gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="text-xs font-medium text-white/30 uppercase tracking-[0.2em] mb-4 block">Experience</span>
              <h2 className="text-3xl sm:text-4xl font-semibold text-white/90 mb-4 tracking-tight">
                Video calls,<br />reimagined
              </h2>
              <p className="text-muted text-base leading-relaxed mb-6">
                A distraction-free video experience with premium glass controls,
                floating self-preview, and beautiful animations. The interface disappears
                when you don&apos;t need it and reappears gracefully.
              </p>
              <div className="flex flex-col gap-3">
                {[
                  "Floating control dock that auto-hides",
                  "Draggable picture-in-picture self view",
                  "Real-time reactions and chat",
                  "End-to-end encrypted conversations",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-muted">
                    <svg className="w-4 h-4 text-white/20 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <div className="glass-card rounded-3xl overflow-hidden aspect-[4/3] flex items-center justify-center">
                <div className="text-center px-6">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="2" y="4" width="16" height="16" rx="3" />
                      <path d="M18 10l4-2.5v9L18 14" />
                    </svg>
                  </div>
                  <p className="text-sm text-white/30 font-light">Premium video experience</p>
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 w-32 h-20 rounded-2xl glass-strong border border-white/[0.06] flex items-center justify-center">
                <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <svg className="w-4 h-4 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="5" y="3" width="14" height="10" rx="2" />
                    <circle cx="12" cy="8" r="1.5" />
                  </svg>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </StorySection>

      <SectionDivider />

      {/* Token System Section */}
      <StorySection>
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-xs font-medium text-white/30 uppercase tracking-[0.2em] mb-4 block">Token Economy</span>
            <h2 className="text-3xl sm:text-4xl font-semibold text-white/90 mb-4 tracking-tight">
              Simple, fair, generous
            </h2>
            <p className="text-muted text-base max-w-xl mx-auto mb-12 leading-relaxed">
              Every day you receive free tokens. Use them to start conversations.
              No subscriptions required.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <FloatingCard index={0}>
              <div className="text-center">
                <div className="text-3xl font-semibold text-white/90 mb-1">20</div>
                <div className="text-xs text-muted">Free daily tokens</div>
              </div>
            </FloatingCard>
            <FloatingCard index={1}>
              <div className="text-center">
                <div className="text-3xl font-semibold text-white/90 mb-1">2</div>
                <div className="text-xs text-muted">Per video chat</div>
              </div>
            </FloatingCard>
            <FloatingCard index={2}>
              <div className="text-center">
                <div className="text-3xl font-semibold text-white/90 mb-1">5</div>
                <div className="text-xs text-muted">Per private room</div>
              </div>
            </FloatingCard>
          </div>
        </div>
      </StorySection>

      <SectionDivider />

      {/* Privacy Section */}
      <StorySection>
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 sm:gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="order-2 md:order-1"
            >
              <div className="glass-card rounded-3xl aspect-square max-w-sm mx-auto flex items-center justify-center">
                <div className="text-center px-8">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <p className="text-sm text-white/30 font-light">Your privacy is built in, not bolted on</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="order-1 md:order-2"
            >
              <span className="text-xs font-medium text-white/30 uppercase tracking-[0.2em] mb-4 block">Privacy First</span>
              <h2 className="text-3xl sm:text-4xl font-semibold text-white/90 mb-4 tracking-tight">
                Designed for<br />private conversations
              </h2>
              <p className="text-muted text-base leading-relaxed mb-6">
                We don&apos;t store your video, audio, or messages.
                Conversations are peer-to-peer and ephemeral by design.
              </p>
              <div className="flex flex-col gap-3">
                {[
                  "No video or audio recordings",
                  "Peer-to-peer encrypted connections",
                  "Anonymous by default — no profiles",
                  "You control what you share",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-muted">
                    <svg className="w-4 h-4 text-white/20 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </StorySection>

      <SectionDivider />

      {/* FAQ Section */}
      <StorySection>
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-12"
          >
            <span className="text-xs font-medium text-white/30 uppercase tracking-[0.2em] mb-4 block">Questions</span>
            <h2 className="text-3xl sm:text-4xl font-semibold text-white/90 tracking-tight">
              Frequently asked
            </h2>
          </motion.div>

          <div className="space-y-3">
            {[
              { q: "Is PeerTalks really anonymous?", a: "Yes. You don't need to create a profile. Your conversations are ephemeral and peer-to-peer. We don't store your video, audio, or chat history." },
              { q: "How do tokens work?", a: "You receive 20 free tokens daily. Each video chat costs 2 tokens, and private rooms cost 5 tokens. You can also earn tokens through achievements." },
              { q: "Can I use PeerTalks without video?", a: "Absolutely. You can choose text-only chat or disable your camera during video calls. Both options are available." },
              { q: "Is my connection secure?", a: "All communications are encrypted. We use WebRTC with STUN for direct peer-to-peer connections. Your conversations stay between you and the person you're talking to." },
            ].map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="glass-card rounded-2xl p-5 sm:p-6"
              >
                <h3 className="text-sm font-medium text-white/80 mb-2">{faq.q}</h3>
                <p className="text-sm text-muted leading-relaxed">{faq.a}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </StorySection>

      <SectionDivider />

      {/* CTA Section */}
      <section className="relative py-24 sm:py-32 px-4">
        <div className="max-w-lg mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="glass-card rounded-3xl p-8 sm:p-10 card-lift"
          >
            <h2 className="text-2xl sm:text-3xl font-semibold text-white/90 mb-3 tracking-tight">
              Ready for something real?
            </h2>
            <p className="text-muted text-sm mb-8 max-w-sm mx-auto leading-relaxed">
              No sign-up required. Start a conversation and experience the difference.
            </p>
            <div className="max-w-xs mx-auto w-full">
              <LoginButton />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-4 py-8 sm:py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-6 h-6 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center group-hover:bg-white/[0.05] transition-colors">
                <svg className="w-3 h-3 text-white/40 group-hover:text-white/50 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-sm font-medium text-white/40 group-hover:text-white/50 transition-colors">PeerTalks</span>
            </Link>
            <span className="text-xs text-white/15">&copy; {new Date().getFullYear()} PeerTalks. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
