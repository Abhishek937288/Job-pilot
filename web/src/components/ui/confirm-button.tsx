"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./button";

interface ConfirmButtonProps {
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  confirmLabel?: string;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost" | "danger";
  disabled?: boolean;
  "aria-label"?: string;
}

/** Two-step inline confirm: the first click reveals "Confirm" and "Cancel". */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm delete",
  size = "sm",
  variant = "ghost",
  disabled,
  ...rest
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <Button size={size} variant={variant} disabled={disabled} onClick={() => setArmed(true)} aria-label={rest["aria-label"]}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <Button
        size={size}
        variant="danger"
        loading={busy}
        autoFocus
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)} disabled={busy}>
        Cancel
      </Button>
    </span>
  );
}
