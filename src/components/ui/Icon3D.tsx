"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";

interface Icon3DProps {
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function Icon3D({ children, className = "", size = "md" }: Icon3DProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [hovered, setHovered] = useState(false);

  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-12 h-12",
    lg: "w-14 h-14",
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setRotateX((y - 0.5) * -20);
    setRotateY((x - 0.5) * 20);
  };

  const handleMouseEnter = () => setHovered(true);
  const handleMouseLeave = () => {
    setHovered(false);
    setRotateX(0);
    setRotateY(0);
  };

  return (
    <motion.div
      ref={ref}
      className={`${sizeClasses[size]} rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center relative perspective-container ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      animate={{
        rotateX,
        rotateY,
        scale: hovered ? 1.08 : 1,
        borderColor: hovered ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
      }}
      transition={{ type: "spring", stiffness: 200, damping: 15, mass: 0.5 }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <motion.div
        className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent opacity-0"
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />
      <motion.div
        className="relative z-10"
        animate={{
          translateZ: hovered ? 12 : 0,
        }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
