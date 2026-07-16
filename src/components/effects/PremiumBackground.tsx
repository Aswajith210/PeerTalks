"use client";

import { useEffect, useRef } from "react";

interface DustParticle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  vx: number;
  vy: number;
}

export function PremiumBackground() {
  const dustCanvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<DustParticle[]>([]);
  const rafRef = useRef<number>(0);
  const spotlightRef = useRef<HTMLDivElement>(null);

  // Layer 7: Glass dust particles
  useEffect(() => {
    const canvas = dustCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const initParticles = () => {
      const count = Math.min(Math.floor(window.innerWidth * 0.015), 30);
      particlesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.2 + 0.3,
        opacity: Math.random() * 0.15 + 0.02,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
      }));
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220, 220, 230, ${p.opacity})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    resize();
    initParticles();
    animate();

    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Layer 8: Cursor-responsive spotlight
  useEffect(() => {
    const spotlight = spotlightRef.current;
    if (!spotlight) return;

    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      spotlight.style.background = `radial-gradient(
        600px circle at ${x}% ${y}%,
        rgba(255, 255, 255, 0.015) 0%,
        transparent 70%
      )`;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className="premium-bg" aria-hidden="true">
      {/* Layer 3: Metallic silver contour lines */}
      <div className="metallic-lines" />

      {/* Layer 4: Floating frosted glass panels */}
      <div className="glass-panels">
        <div className="glass-panel" />
        <div className="glass-panel" />
        <div className="glass-panel" />
        <div className="glass-panel" />
        <div className="glass-panel" />
      </div>

      {/* Layer 5: Graphite mesh */}
      <div className="graphite-mesh" />

      {/* Layer 6: Topographic contour lines */}
      <div className="topo-lines" />

      {/* Layer 7: Glass dust particles */}
      <canvas
        ref={dustCanvasRef}
        className="fixed inset-0 pointer-events-none z-[1]"
        aria-hidden="true"
      />

      {/* Layer 8: Cursor-responsive spotlight */}
      <div ref={spotlightRef} className="cursor-spotlight" />

      {/* Layer 9: Metallic reflection sweep */}
      <div className="metallic-sweep" />

      {/* Layer 11: Edge illumination */}
      <div className="edge-illumination" />
    </div>
  );
}
