"use client";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export function LogoutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        window.location.href = "/login";
      }}
    >
      Log out
    </Button>
  );
}
