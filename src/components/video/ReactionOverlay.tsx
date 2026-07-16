"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Icons, { type IconName } from "@/components/icons/icons";

interface ReactionOverlayProps {
  reactions: { id: string; icon: IconName }[];
}

const REACTION_ICONS: Record<string, IconName> = {
  heart: "Heart",
  thumbsup: "ThumbsUp",
  clap: "Clap",
  fire: "Fire",
  laugh: "Laugh",
  celebrate: "Celebrate",
};

export function ReactionOverlay({ reactions }: ReactionOverlayProps) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {reactions.map((r) => (
        <ReactionBubble key={r.id} icon={r.icon} />
      ))}
    </div>
  );
}

function ReactionBubble({ icon }: { icon: IconName }) {
  const elRef = useRef<HTMLDivElement>(null);
  const [startX] = useState(() => Math.random() * 80 + 10);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const driftX1 = (Math.random() - 0.5) * 60;
    const driftX2 = (Math.random() - 0.5) * 100;

    const anim = el.animate(
      [
        { transform: "translateY(0px) scale(0.5)", opacity: 0 },
        { transform: "translateY(-40px) scale(1.1)", opacity: 1, offset: 0.15 },
        { transform: `translateY(-200px) translateX(${driftX1}px) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translateY(-400px) translateX(${driftX2}px) scale(0.6)`, opacity: 0 },
      ],
      {
        duration: 2500,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      }
    );

    return () => anim.cancel();
  }, []);

  const IconComponent = Icons[icon];

  return (
    <div
      ref={elRef}
      className="absolute bottom-24"
      style={{ left: `${startX}%` }}
    >
      <IconComponent size={28} active />
    </div>
  );
}

export function useReactions() {
  const reactionsRef = useRef<{ id: string; icon: IconName }[]>([]);

  const addReaction = useCallback((type: string) => {
    const iconName = REACTION_ICONS[type] || "Heart";
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    reactionsRef.current = [...reactionsRef.current, { id, icon: iconName }];
    setTimeout(() => {
      reactionsRef.current = reactionsRef.current.filter((r) => r.id !== id);
    }, 2600);
  }, []);

  return { reactionsRef, addReaction };
}

export type { ReactionOverlayProps };
