"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthStore } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, User, Sparkles } from "lucide-react";
import {
  registerSchema,
  type RegisterFormData,
} from "@/lib/validation/auth.schema";

export default function RegisterPage() {
  const { register: registerUser } = useAuthStore();
  const { t } = useLanguageStore();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
  });

  const onSubmit = async (data: RegisterFormData) => {
    try {
      await registerUser(data.email, data.password, data.displayName);
      router.push("/verify-email");
    } catch (err: unknown) {
      const responseData = (
        err as { response?: { data?: { message?: string; errors?: string[] } } }
      )?.response?.data;
      const msg =
        (responseData?.errors?.length
          ? responseData.errors.join(", ")
          : responseData?.message) || t.auth.registerFailed;
      setError("root", { message: msg });
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
            {t.auth.createAccount}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground/60">
            {t.auth.createAccountDesc}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {errors.root && (
          <div className="rounded-xl bg-destructive/[0.06] border border-destructive/15 px-4 py-2.5 text-xs text-destructive animate-scale-in">
            {errors.root.message}
          </div>
        )}

        <div>
          <Input
            label={t.auth.displayName}
            placeholder="John Doe"
            icon={<User className="h-4 w-4" />}
            {...register("displayName")}
            error={errors.displayName?.message}
          />
        </div>

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
            placeholder={t.auth.passwordHint}
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
              {t.auth.creatingAccount}
            </div>
          ) : (
            t.auth.createAccount
          )}
        </Button>
      </form>

      <div className="mt-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border/50" />
        <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">
          LinguaAI
        </span>
        <div className="h-px flex-1 bg-border/50" />
      </div>

      <p className="mt-5 text-center text-[13px] text-muted-foreground/70">
        {t.auth.hasAccount}{" "}
        <Link
          href="/login"
          className="font-medium text-primary/80 hover:text-primary transition-colors"
        >
          {t.auth.signInLink}
        </Link>
      </p>
    </div>
  );
}
