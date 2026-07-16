"use client";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "accent" | "success" | "warning" | "error";
  className?: string;
}

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variants: Record<string, string> = {
    default: "bg-white/[0.04] text-muted border border-white/[0.08]",
    accent: "bg-white/[0.08] text-white/70 border border-white/[0.15]",
    success: "bg-green-500/10 text-green-400 border border-green-500/20",
    warning: "bg-orange-500/10 text-orange-400 border border-orange-500/20",
    error: "bg-red-500/10 text-red-400 border border-red-500/20",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
