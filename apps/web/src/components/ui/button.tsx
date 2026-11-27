import React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "secondary"
    | "outline"
    | "ghost"
    | "destructive"
    | "gradient";
  size?: "sm" | "md" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]",
        {
          "bg-primary text-primary-foreground shadow-sm shadow-primary/15 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/20":
            variant === "default",
          "bg-secondary text-secondary-foreground hover:bg-secondary/70":
            variant === "secondary",
          "border border-border/80 bg-background/50 hover:bg-accent hover:border-primary/20":
            variant === "outline",
          "hover:bg-accent/60 hover:text-accent-foreground":
            variant === "ghost",
          "bg-destructive text-white shadow-sm shadow-destructive/15 hover:bg-destructive/90":
            variant === "destructive",
          "gradient-bg text-white shadow-md shadow-primary/15 hover:shadow-lg hover:shadow-primary/25 hover:brightness-105":
            variant === "gradient",
        },
        {
          "h-8 px-3.5 text-xs rounded-lg": size === "sm",
          "h-10 px-5 text-sm": size === "md",
          "h-12 px-8 text-base rounded-xl": size === "lg",
          "h-10 w-10 p-0 rounded-xl": size === "icon",
        },
        className,
      )}
      {...props}
    />
  );
}
