import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="text-6xl font-extrabold gradient-text">404</p>
      <p className="text-sm text-muted-foreground/60">Page not found</p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-2 rounded-xl gradient-bg px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-primary/15 transition-all hover:shadow-md hover:brightness-105"
      >
        Go home
      </Link>
    </div>
  );
}
