"use client";

/**
 * Norty Vision — primitivos de UI do design system.
 *
 * Button (4 variantes), Card (+ CardHeader/Title/Content), Badge (6 tons).
 * Tudo em cima dos tokens de tema (bg/fg/surface/line/brand/...) — segue
 * claro/escuro automaticamente. Ícones via lucide-react.
 *
 * cn(): merge simples de classes (sem clsx/tailwind-merge pra não trazer dep).
 */
import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ============================== Button ============================== */

type ButtonVariant = "primary" | "grad" | "outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold " +
  "transition-all duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-[0_6px_18px_-6px_rgb(var(--brand)/0.6)] " +
    "hover:bg-brand/90 hover:shadow-[0_10px_24px_-8px_rgb(var(--brand)/0.7)]",
  grad:
    "bg-grad-brand text-white shadow-[0_8px_22px_-8px_rgb(var(--brand)/0.7)] " +
    "hover:brightness-[1.06]",
  outline: "border border-line-strong bg-surface text-fg hover:border-brand/60 hover:text-brand",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", loading, icon: Icon, iconRight: IconRight, className, children, disabled, ...rest },
    ref,
  ) {
    const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
        {...rest}
      >
        {loading ? (
          <Loader2 size={iconSize} className="animate-spin" />
        ) : Icon ? (
          <Icon size={iconSize} />
        ) : null}
        {children}
        {IconRight && !loading ? <IconRight size={iconSize} /> : null}
      </button>
    );
  },
);

/* =============================== Card =============================== */

export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-surface shadow-sm", className)}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3 border-b border-line px-5 py-4", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-fg", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted", className)} {...rest} />;
}

export function CardContent({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...rest} />;
}

/* ============================== Badge ============================== */

type BadgeTone = "neutral" | "brand" | "success" | "warn" | "danger" | "info";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  brand: "bg-brand/10 text-brand border-brand/20",
  success: "bg-success/10 text-success border-success/20",
  warn: "bg-warn/10 text-warn border-warn/25",
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-brand-2/10 text-brand-2 border-brand-2/20",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: LucideIcon;
}

export function Badge({ tone = "neutral", icon: Icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={12} /> : null}
      {children}
    </span>
  );
}
