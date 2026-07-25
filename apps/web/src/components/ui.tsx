import * as React from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants: Record<string, string> = {
    primary: "bg-blue-700 text-white border border-blue-800 hover:bg-blue-800 disabled:opacity-50",
    secondary: "bg-white text-black border border-gray-500 hover:bg-gray-100",
    danger: "bg-red-700 text-white border border-red-800 hover:bg-red-800 disabled:opacity-50",
    ghost: "bg-transparent text-gray-700 border border-transparent hover:text-black underline",
  };
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full border border-gray-500 bg-white px-2 text-sm text-black outline-none focus:border-blue-700",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full border border-gray-500 bg-white px-2 py-1 text-sm text-black outline-none focus:border-blue-700",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1 block text-sm text-black", className)}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border border-gray-500 bg-white p-4", className)}
      {...props}
    />
  );
}

const badgeStyles: Record<string, string> = {
  draft: "bg-gray-200 text-gray-800 border-gray-500",
  queued: "bg-blue-100 text-blue-800 border-blue-600",
  sending: "bg-yellow-100 text-yellow-800 border-yellow-600",
  sent: "bg-green-100 text-green-800 border-green-700",
  completed: "bg-green-100 text-green-800 border-green-700",
  pending: "bg-gray-100 text-gray-700 border-gray-500",
  failed: "bg-red-100 text-red-800 border-red-700",
};

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block border px-2 py-0.5 text-xs capitalize",
        badgeStyles[status] ?? badgeStyles.draft,
      )}
    >
      {status}
    </span>
  );
}
