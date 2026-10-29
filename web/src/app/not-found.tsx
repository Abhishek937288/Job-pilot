import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-zinc-500">The page you're looking for doesn't exist.</p>
      <ButtonLink href="/" className="mt-2">
        Go home
      </ButtonLink>
    </div>
  );
}
