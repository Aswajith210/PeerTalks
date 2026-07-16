import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative z-10">
      <div className="text-center max-w-md">
        <div className="glass-card rounded-3xl p-10 sm:p-12 card-lift">
          <h1 className="text-7xl sm:text-8xl font-bold text-white/10 tracking-tight mb-4">404</h1>
          <h2 className="text-xl sm:text-2xl font-semibold text-white/90 tracking-tight mb-3">Page not found</h2>
          <p className="text-sm text-muted mb-8 font-light leading-relaxed">
            The page you are looking for does not exist or has been moved.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium rounded-xl glass-strong text-white/70 hover:text-white transition-all duration-200 btn-premium"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M19 12H5m7-7l-7 7 7 7" />
            </svg>
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
