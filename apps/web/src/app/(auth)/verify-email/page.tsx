"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { useLanguageStore } from "@/stores/language-store";

function EmailVerification() {
  const token = useSearchParams().get("token");
  const { locale, t } = useLanguageStore();
  const vi = locale === "vi";
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function verifyEmail() {
    setPending(true);
    setError("");
    try {
      await apiClient.get("/auth/verify-email", { params: { token } });
      setVerified(true);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(status === 400
        ? vi ? "Liên kết đã hết hạn hoặc đã được sử dụng. Hãy đăng nhập hoặc yêu cầu liên kết mới." : "This link has expired or was already used. Sign in or request a new link."
        : vi ? "Chưa thể xác minh email. Hãy thử lại." : "We couldn't verify your email. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function resendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSent(false);
    setError("");
    try {
      await apiClient.post("/auth/resend-verification", { email: email.trim() });
      setSent(true);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(status === 429
        ? vi ? "Bạn đã gửi nhiều yêu cầu. Hãy thử lại sau." : "Too many requests. Please try again later."
        : vi ? "Chưa thể gửi liên kết. Hãy thử lại." : "We couldn't send the link. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-border/40 bg-card/70 p-8 shadow-xl shadow-black/[0.04] backdrop-blur-2xl">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl gradient-bg">
        <MailCheck className="h-6 w-6 text-white" aria-hidden="true" />
      </div>
      <h1 className="text-center text-xl font-bold">{vi ? "Xác minh email" : "Verify your email"}</h1>

      {verified ? (
        <p role="status" className="text-sm text-success">
          {vi ? "Email đã được xác minh. Bạn có thể đăng nhập và bắt đầu học." : "Your email is verified. You can sign in and start learning."}
        </p>
      ) : (
        <>
          {token ? (
            <Button className="w-full" variant="gradient" disabled={pending} onClick={verifyEmail}>
              {vi ? "Xác minh email của tôi" : "Verify my email"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {vi ? "Mở liên kết xác minh trong email. Nếu chưa nhận được, hãy kiểm tra thư rác hoặc yêu cầu gửi lại." : "Open the verification link in your email. If it hasn't arrived, check your spam folder or request another link."}
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <form onSubmit={resendEmail} className="space-y-3">
            <Input
              id="verification-email"
              label={t.auth.email}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" variant="outline" disabled={pending}>
              {vi ? "Gửi lại liên kết xác minh" : "Resend verification link"}
            </Button>
          </form>
          {sent && <p role="status" className="text-sm text-success">
            {vi ? "Nếu địa chỉ này có tài khoản cần xác minh, bạn sẽ nhận được liên kết mới." : "If this address has an account awaiting verification, you will receive a new link."}
          </p>}
        </>
      )}

      <Link href="/login" className="block w-fit rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
        {t.auth.signIn}
      </Link>
    </section>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><EmailVerification /></Suspense>;
}
