import React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  /** Supplementary description. Callers without a `label` should pass `aria-label`. */
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, hint, id, ...props }, ref) => {
    // Stable across renders and identical on server and client (unlike Math.random).
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const describedBy =
      [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null, props["aria-describedby"]]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-foreground/80"
          >
            {label}
          </label>
        )}
        <div className="relative group">
          {icon && (
            <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors group-focus-within:text-primary/60">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            className={cn(
              "flex h-11 w-full rounded-[var(--radius)] border border-border/70 bg-background px-4 py-2.5 text-sm transition-all duration-200",
              "placeholder:text-muted-foreground/40",
              "focus:outline-none focus:ring-2 focus:ring-primary/12 focus:border-primary/50",
              "hover:border-border",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-muted",
              error &&
                "border-destructive/50 focus:ring-destructive/12 focus:border-destructive/50",
              icon && "pl-11",
              className,
            )}
            ref={ref}
            {...props}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </div>
        {hint && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground mt-0.5">
            {hint}
          </p>
        )}
        {error && (
          <p
            id={`${inputId}-error`}
            className="text-xs text-destructive mt-0.5"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
