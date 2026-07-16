"use client";

import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-xs font-medium text-muted-light">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={`h-11 px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 ${
            error ? "border-error/30" : ""
          } ${className}`}
          {...props}
        />
        {error && <span className="text-xs text-error/80">{error}</span>}
      </div>
    );
  }
);

Input.displayName = "Input";
