import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
          <div className="text-white/20">{icon}</div>
        </div>
      )}
      <h3 className="text-base font-medium text-white/70 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted text-center max-w-xs mb-5 leading-relaxed">{description}</p>
      )}
      {action}
    </div>
  );
}
