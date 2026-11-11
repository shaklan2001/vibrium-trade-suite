import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cn(
        variant === "primary" && "primary-button",
        (variant === "secondary" || variant === "ghost") && "ghost-button",
        variant === "danger" && "danger-button",
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

const BADGE_TONE = {
  neutral: "badge-neutral",
  success: "badge-success",
  warning: "badge-warning",
  info: "badge-info",
  danger: "badge-danger",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONE;
}) {
  return <span className={cn("badge", BADGE_TONE[tone])}>{children}</span>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("field", props.className)} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <textarea {...props} className={cn("field", props.className)} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="field-label">{children}</label>;
}

export function ChannelBadge({ channel }: { channel: string }) {
  const tone =
    channel === "email"
      ? "info"
      : channel === "whatsapp"
        ? "success"
        : channel === "voice"
          ? "warning"
          : "neutral";
  return <Badge tone={tone}>{channel}</Badge>;
}

export function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
