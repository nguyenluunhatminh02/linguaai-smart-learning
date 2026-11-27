"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { setAccessToken, useAuthStore } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Sparkles } from "lucide-react";
import { loginSchema, type LoginFormData } from "@/lib/validation/auth.schema";

function LoginForm() {
  const { t, locale } = useLanguageStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "1";
  // Only follow local paths from protected-route redirects; never navigate to
  // an attacker-supplied absolute URL.
  const requestedCallback = searchParams.get("callbackUrl");
  const callbackUrl =
    requestedCallback &&
    requestedCallback.startsWith("/") &&
    !requestedCallback.startsWith("//") &&
    !requestedCallback.includes("://")
      ? requestedCallback
      : "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      // Log in via fetch rather than the shared axios client: its 401
      // interceptor assumes an expired token, calls /auth/refresh and then
      // hard-redirects to /login, destroying the inline "invalid credentials"
      // error that a failed login should display.
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const errorData = json?.data ?? json ?? {};
        const messages = [
          ...(Array.isArray(errorData.errors) ? errorData.errors : []),
          ...(Array.isArray(errorData.message) ? errorData.message : []),
        ].filter((m): m is string => typeof m === "string");
        const message = messages.length
          ? messages.join(", ")
          : (typeof errorData.message === "string" ? errorData.message : "") || t.auth.loginFailed;
        throw new Error(message);
      }
      const payload = json?.data ?? json ?? {};
      const token = payload.accessToken || null;
      setAccessToken(token);
      try {
        localStorage.setItem("auth_timestamp", Date.now().toString());
      } catch { /* private browsing */ }
      const u = payload.user ?? {};
      useAuthStore.setState({
        user: {
          ...u,
          displayName: u.fullName || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
          avatarUrl: u.avatarUrl ?? u.profilePicture ?? null,
          streakCount: u.streakCount ?? 0,
          totalXp: u.totalXp ?? 0,
          role: (Array.isArray(u.roles) ? (u.roles[0] ?? "user") : (u.role ?? "user")).toLowerCase(),
        },
        isLoading: false,
      });
      router.push(callbackUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.auth.loginFailed;
      setError("root", { message: msg || t.auth.loginFailed });
    }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/70 p-8 shadow-xl shadow-black/[0.04] backdrop-blur-2xl backdrop-saturate-150">
      <div className="mb-7 flex flex-col items-center gap-3.5">
        <div className="flex h-13 w-13 items-center justify-center rounded-2xl gradient-bg shadow-md shadow-primary/15">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight gradient-text">
            {t.auth.welcomeBack}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground/60">
            {t.auth.signInDesc}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {registered && (
          <div className="rounded-xl bg-success/[0.06] border border-success/15 px-4 py-2.5 text-xs text-success animate-scale-in">
            {locale === "vi" ? "Hãy xác minh email trước khi đăng nhập." : "Please verify your email before signing in."}
          </div>
        )}
        {errors.root && (
          <div className="rounded-xl bg-destructive/[0.06] border border-destructive/15 px-4 py-2.5 text-xs text-destructive animate-scale-in">
            {errors.root.message}
          </div>
        )}

        <div>
          <Input
            label={t.auth.email}
            type="email"
            placeholder="you@example.com"
            icon={<Mail className="h-4 w-4" />}
            {...register("email")}
            error={errors.email?.message}
          />
        </div>

        <div>
          <Input
            label={t.auth.password}
            type="password"
            placeholder="••••••••"
            icon={<Lock className="h-4 w-4" />}
            {...register("password")}
            error={errors.password?.message}
          />
        </div>

        <Button
          type="submit"
          variant="gradient"
          className="w-full h-11 rounded-xl text-sm"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {t.auth.signingIn}
            </div>
          ) : (
            t.auth.signIn
          )}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link href="/verify-email" className="rounded text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
          {locale === "vi" ? "Gửi lại email xác minh" : "Resend verification email"}
        </Link>
      </p>

      <div className="mt-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border/50" />
        <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">
          LinguaAI
        </span>
        <div className="h-px flex-1 bg-border/50" />
      </div>

      <p className="mt-5 text-center text-[13px] text-muted-foreground/70">
        {t.auth.noAccount}{" "}
        <Link
          href="/register"
          className="font-medium text-primary/80 hover:text-primary transition-colors"
        >
          {t.auth.createOne}
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
