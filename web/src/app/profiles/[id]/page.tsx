"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ProfileView } from "@/components/profile-view";
import { PageLoader } from "@/components/ui/feedback";
import { useRequireSession } from "@/lib/session";

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const session = useRequireSession();
  if (session.status !== "authenticated") return <PageLoader />;
  return (
    <Suspense fallback={<PageLoader />}>
      <ProfileView key={id} id={id} />
    </Suspense>
  );
}
