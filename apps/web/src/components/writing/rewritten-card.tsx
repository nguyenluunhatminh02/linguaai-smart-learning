"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Check, Copy } from "lucide-react";
import type { Translations } from "@/lib/i18n/types";

interface RewrittenCardProps {
  text: string;
  t: Translations;
}

export function RewrittenCard({ text, t }: RewrittenCardProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Card className="border-violet-200 dark:border-violet-900/40">
      <CardHeader className="px-6 pt-5 pb-3">
        <CardTitle className="flex items-center justify-between text-base text-violet-600 dark:text-violet-400">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t.writing.rewrittenText}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={copy}
            className="h-7 gap-1.5 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />{" "}
                {t.writing.copied}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> {t.writing.copyText}
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <p className="whitespace-pre-wrap rounded-xl bg-violet-50/60 p-4 text-sm leading-relaxed dark:bg-violet-950/20">
          {text}
        </p>
      </CardContent>
    </Card>
  );
}
