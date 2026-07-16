"use client";

import { forwardRef } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, error, id, options, placeholder, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-xs font-medium text-muted-light">{label}</label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={`h-11 px-4 rounded-xl glass-input text-sm text-white/80 appearance-none cursor-pointer w-full transition-all duration-200 ${
              error ? "border-error/30" : ""
            } ${className}`}
            {...props}
          >
            {placeholder && (
              <option value="" disabled className="bg-surface">{placeholder}</option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-surface">{opt.label}</option>
            ))}
          </select>
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-3.5 h-3.5 text-white/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
        {error && <span className="text-xs text-error/80">{error}</span>}
      </div>
    );
  }
);

Select.displayName = "Select";
