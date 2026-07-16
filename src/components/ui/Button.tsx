"use client";

import { forwardRef, useRef } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "premium";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => {
  const innerRef = useRef<HTMLButtonElement>(null);
    const buttonRef = (ref || innerRef) as React.RefObject<HTMLButtonElement>;

    const variants: Record<string, string> = {
      primary:
        "bg-white text-graphite-950 hover:bg-white/90 active:bg-white/80 shadow-premium",
      secondary:
        "bg-white/[0.04] text-white/80 border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.12] active:bg-white/[0.03] shadow-glass-sm",
      ghost:
        "text-white/40 hover:text-white/70 hover:bg-white/[0.03] active:bg-white/[0.02]",
      danger:
        "bg-error-soft text-error border border-error/20 hover:bg-error/[0.15] active:bg-error/[0.1] shadow-glass-sm",
      premium:
        "glass-strong text-white/90 hover:text-white active:bg-white/[0.08] shadow-glass-sm",
    };

    const sizes: Record<string, string> = {
      sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
      md: "h-10 px-4 text-sm rounded-xl gap-2",
      lg: "h-12 px-5 text-sm rounded-xl gap-2.5",
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!buttonRef.current || disabled) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      buttonRef.current.style.transform = `translate(${x * 4}px, ${y * 2}px) scale(1.02)`;
    };

    const handleMouseLeave = () => {
      if (buttonRef.current) {
        buttonRef.current.style.transform = "";
      }
    };

    return (
      <button
        ref={buttonRef}
        className={`inline-flex items-center justify-center font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 disabled:opacity-40 disabled:pointer-events-none select-none btn-premium ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || loading}
        onMouseMove={variant !== "primary" ? handleMouseMove : undefined}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
