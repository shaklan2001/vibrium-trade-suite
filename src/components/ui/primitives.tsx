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
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-50",
        variant === "primary" &&
          "bg-teal-700 text-white hover:bg-teal-800",
        variant === "secondary" &&
          "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
        variant === "ghost" && "text-zinc-700 hover:bg-zinc-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
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
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
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
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "info" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-zinc-100 text-zinc-700",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "warning" && "bg-amber-50 text-amber-800",
        tone === "info" && "bg-sky-50 text-sky-800",
        tone === "danger" && "bg-red-50 text-red-700",
      )}
    >
      {children}
    </span>
  );
}

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600",
        props.className,
      )}
    />
  );
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600",
        props.className,
      )}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-zinc-600">
      {children}
    </label>
  );
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

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-2xl font-semibold text-zinc-900">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}
