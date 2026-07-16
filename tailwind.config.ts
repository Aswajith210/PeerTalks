import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: {
          DEFAULT: "var(--surface)",
          elevated: "var(--surface-elevated)",
        },
        glass: {
          DEFAULT: "var(--glass)",
          border: "var(--glass-border)",
        },
        border: {
          DEFAULT: "var(--border)",
          hover: "var(--border-hover)",
        },
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
          muted: "var(--accent-muted)",
        },
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
        },
        error: {
          DEFAULT: "var(--error)",
          soft: "var(--error-soft)",
        },
        graphite: {
          50: "#f5f5f7",
          100: "#e8e8ed",
          200: "#d1d1d6",
          300: "#aeaeb2",
          400: "#8e8e93",
          500: "#636366",
          600: "#48484a",
          700: "#363639",
          800: "#1c1c1e",
          900: "#111113",
          950: "#0f0f11",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "22px",
        "3xl": "28px",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
      },
      backdropBlur: {
        xs: "2px",
        glass: "20px",
      },
      boxShadow: {
        glass: "0 4px 30px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "glass-lg": "0 8px 60px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        "glass-sm": "0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
        premium: "0 0 0 1px rgba(255, 255, 255, 0.04), 0 2px 4px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.15)",
        "premium-lg": "0 0 0 1px rgba(255, 255, 255, 0.05), 0 4px 8px rgba(0, 0, 0, 0.12), 0 16px 48px rgba(0, 0, 0, 0.2)",
        edge: "0 0 40px rgba(255, 255, 255, 0.02), 0 0 80px rgba(255, 255, 255, 0.01)",
      },
      animation: {
        "float": "float 8s ease-in-out infinite",
        "float-slow": "float 12s ease-in-out infinite",
        "float-slower": "float 16s ease-in-out infinite",
        "drift": "drift 20s ease-in-out infinite",
        "metallic-sweep": "metallic-sweep 25s ease-in-out infinite",
        "shimmer": "shimmer 4s ease-in-out infinite",
        "pulse-soft": "pulse-soft 4s ease-in-out infinite",
        "scale-in": "scale-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-in": "fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "glass-float": "glass-float 6s ease-in-out infinite",
        "glass-float-2": "glass-float-2 10s ease-in-out infinite",
        "glass-float-3": "glass-float-3 14s ease-in-out infinite",
        "spin-slow": "spin 20s linear infinite",
        "topo-shift": "topo-shift 60s linear infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "breath": "breath 4s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        "float-slower": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
          "25%": { transform: "translate(30px, -20px) rotate(2deg)" },
          "50%": { transform: "translate(-10px, -40px) rotate(-1deg)" },
          "75%": { transform: "translate(-30px, -10px) rotate(1deg)" },
        },
        "metallic-sweep": {
          "0%": { transform: "translateX(-100%) translateY(-20%) rotate(-15deg)", opacity: "0" },
          "5%": { opacity: "0.08" },
          "20%": { opacity: "0.12" },
          "45%": { transform: "translateX(100%) translateY(20%) rotate(-15deg)", opacity: "0.1" },
          "50%": { opacity: "0" },
          "100%": { opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.6" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "glass-float": {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
          "33%": { transform: "translate(15px, -25px) rotate(1.5deg)" },
          "66%": { transform: "translate(-10px, -10px) rotate(-0.5deg)" },
        },
        "glass-float-2": {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
          "25%": { transform: "translate(-20px, 15px) rotate(-1deg)" },
          "50%": { transform: "translate(10px, -20px) rotate(2deg)" },
          "75%": { transform: "translate(15px, 10px) rotate(-1.5deg)" },
        },
        "glass-float-3": {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
          "50%": { transform: "translate(25px, 15px) rotate(-2deg)" },
        },
        "topo-shift": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "100px 100px" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.6" },
        },
        breath: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.005)" },
        },
      },
      backgroundImage: {
        "graphite-mesh": "var(--graphite-mesh)",
        "topo-lines": "var(--topo-lines)",
        "metallic-gradient": "var(--metallic-gradient)",
      },
      transitionTimingFunction: {
        "premium": "cubic-bezier(0.16, 1, 0.3, 1)",
        "premium-out": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        "400": "400ms",
        "500": "500ms",
        "600": "600ms",
      },
    },
  },
  plugins: [],
};

export default config;
