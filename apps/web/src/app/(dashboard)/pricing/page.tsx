"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Gift,
  MessageSquare,
  PenTool,
  BookOpen,
  Headphones,
  Gamepad2,
  Languages,
  Mic,
  Map,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/stores/language-store";
import { useEffect } from "react";
import {
  useTokenStore,
  TOKEN_PACKAGES,
  TOKEN_COSTS,
  TOKEN_FEATURE_LABELS,
  type AIFeature,
} from "@/stores/token-store";

const pricingLocalDict = {
  vi: {
    historyTitle: "Lịch sử giao dịch Token",
    historyEmpty: "Chưa có giao dịch nào được ghi nhận.",
    colTime: "Thời gian",
    colType: "Loại",
    colFeature: "Tính năng",
    colAmount: "Số lượng",
    colBalanceAfter: "Số dư sau",
    exportCsv: "Xuất CSV",
    purchaseComingSoon: "Nạp token sẽ sớm ra mắt",
    purchaseComingSoonHint: "Thanh toán chưa khả dụng. Bạn vẫn nhận 30 token miễn phí mỗi ngày.",
    faqPurchaseSoonQ: "Khi nào có thể mua token?",
    faqPurchaseSoonA: "Tính năng nạp token bằng tiền đang được phát triển. Hiện bạn chỉ dùng được token miễn phí hàng ngày và token được cấp cho tài khoản.",
  },
  en: {
    historyTitle: "Token Transaction History",
    historyEmpty: "No transactions recorded yet.",
    colTime: "Date & Time",
    colType: "Type",
    colFeature: "Feature",
    colAmount: "Amount",
    colBalanceAfter: "Balance After",
    exportCsv: "Export CSV",
    purchaseComingSoon: "Token top-up coming soon",
    purchaseComingSoonHint: "Payments are not available yet. You still receive 30 free tokens every day.",
    faqPurchaseSoonQ: "When can I buy tokens?",
    faqPurchaseSoonA: "Paid token top-up is still under development. For now you can use daily free tokens and any tokens granted to your account.",
  },
  ja: {
    historyTitle: "トークン取引履歴",
    historyEmpty: "取引履歴はありません。",
    colTime: "日時",
    colType: "種類",
    colFeature: "機能",
    colAmount: "数量",
    colBalanceAfter: "取引後残高",
    exportCsv: "CSV出力",
    purchaseComingSoon: "トークン購入は近日公開",
    purchaseComingSoonHint: "決済はまだ利用できません。毎日30トークン無料で受け取れます。",
    faqPurchaseSoonQ: "トークンはいつ購入できますか？",
    faqPurchaseSoonA: "有料トークンの購入機能は開発中です。現在は毎日の無料トークンと付与されたトークンをご利用ください。",
  },
  ko: {
    historyTitle: "토큰 거래 내역",
    historyEmpty: "거래 내역이 없습니다.",
    colTime: "시간",
    colType: "유형",
    colFeature: "기능",
    colAmount: "수량",
    colBalanceAfter: "거래 후 잔액",
    exportCsv: "CSV 내보내기",
    purchaseComingSoon: "토큰 충전 준비 중",
    purchaseComingSoonHint: "결제는 아직 이용할 수 없습니다. 매일 30개의 무료 토큰을 받을 수 있습니다.",
    faqPurchaseSoonQ: "토큰은 언제 구매할 수 있나요?",
    faqPurchaseSoonA: "유료 토큰 충전 기능은 개발 중입니다. 지금은 매일 무료 토큰과 지급된 토큰을 사용할 수 있습니다.",
  },
  zh: {
    historyTitle: "代币交易历史",
    historyEmpty: "暂无交易记录。",
    colTime: "时间",
    colType: "类型",
    colFeature: "功能",
    colAmount: "数量",
    colBalanceAfter: "交易后余额",
    exportCsv: "导出 CSV",
    purchaseComingSoon: "代币充值即将推出",
    purchaseComingSoonHint: "暂不支持付款。您每天仍可获得 30 个免费代币。",
    faqPurchaseSoonQ: "什么时候可以购买代币？",
    faqPurchaseSoonA: "付费代币充值仍在开发中。目前可使用每日免费代币和账户获赠的代币。",
  },
};

export default function PricingPage() {
  const { t, locale } = useLanguageStore();
  const localT = pricingLocalDict[locale as keyof typeof pricingLocalDict] || pricingLocalDict.en;
  const { balance, isLoading, transactions, loadBalance, loadHistory } = useTokenStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [tab, setTab] = useState<"packages" | "usage" | "history">("packages");

  useEffect(() => {
    loadBalance().catch(() => {});
    loadHistory().catch(() => {});
  }, [loadBalance, loadHistory]);

  const getTxTypeLabel = (type: string, amount: number) => {
    switch (type) {
      case "purchase": return "Nạp thêm (Mua)";
      case "bonus": return "Nhận thưởng (Bonus)";
      case "daily_topup": return "Hệ thống cấp (Hàng ngày)";
      case "admin_grant": return amount > 0 ? "Quản trị viên cấp" : "Quản trị viên trừ";
      case "consumption": return "Tiêu dùng";
      default: return type;
    }
  };

  const exportToCSV = (data: typeof transactions, filename = "token-billing-history.csv") => {
    const headers = ["Thời gian", "Loại giao dịch", "Tính năng", "Số lượng", "Số dư sau"];
    const rows = data.map((tx) => {
      const dateStr = tx.created_at || tx.createdAt ? new Date(tx.created_at || tx.createdAt || "").toLocaleString("vi-VN").replace(/,/g, "") : "";
      const typeStr = getTxTypeLabel(tx.type, tx.amount);
      const featureStr = tx.feature && TOKEN_FEATURE_LABELS[tx.feature as AIFeature]
        ? TOKEN_FEATURE_LABELS[tx.feature as AIFeature]
        : tx.feature || "-";
      const amountStr = tx.amount > 0 ? `+${tx.amount}` : tx.amount.toString();
      const balanceStr = (tx.balance_after ?? tx.balanceAfter ?? "").toString();
      return [dateStr, typeStr, featureStr, amountStr, balanceStr];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const featureIcons: Record<AIFeature, typeof MessageSquare> = {
    ai_chat: MessageSquare,
    writing_feedback: PenTool,
    reading_generate: BookOpen,
    grammar_explain: Languages,
    listening_generate: Headphones,
    quiz_generate: Gamepad2,
    translation_ai: Languages,
    speaking_feedback: Mic,
    learning_path: Map,
    cards_generate: BookOpen,
  };

  // The shared dictionary's last two entries promise purchased-token/refund
  // behaviour that is not available; keep only the general token questions.
  const faqItems = [
    ...t.tokens.faq.slice(0, 2),
    { q: localT.faqPurchaseSoonQ, a: localT.faqPurchaseSoonA },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center animate-fade-in">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
          <Coins className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-3xl font-bold">{t.tokens.title}</h1>
        <p className="mt-2 text-muted-foreground max-w-xl mx-auto">
          {t.tokens.subtitle}
        </p>
      </div>

      {/* Current balance card */}
      <div
        className="max-w-md mx-auto animate-fade-in"
        style={{ animationDelay: "80ms" }}
      >
        <Card className="border-amber-500/30 bg-linear-to-br from-amber-500/5 via-background to-orange-500/5">
          <CardContent className="flex items-center justify-between p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                <Coins className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t.tokens.currentBalance}
                </p>
                <p className="text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {isLoading ? "…" : balance.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="text-right">
              <Badge
                variant="secondary"
                className="bg-green-500/10 text-green-600 text-xs"
              >
                <Gift className="mr-1 h-3 w-3" /> +30 {t.tokens.freePerDay}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab switcher */}
      <div className="flex justify-center gap-1 rounded-xl bg-muted/30 p-1 max-w-sm mx-auto">
        <button
          onClick={() => setTab("packages")}
          className={cn(
            "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            tab === "packages"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.tokens.packagesTab}
        </button>
        <button
          onClick={() => setTab("usage")}
          className={cn(
            "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            tab === "usage"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.tokens.costsTab}
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            tab === "history"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {localT.historyTitle.replace(" Token", "").replace(" 代币", "").replace(" 토큰", "").replace("の取引", "")}
        </button>
      </div>

      {tab === "packages" && (
        <>
          {/* Token packages */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
            {TOKEN_PACKAGES.map((pkg, i) => (
              <Card
                key={pkg.id}
                className={cn(
                  "relative card-hover animate-fade-in-up",
                  pkg.popular &&
                    "border-primary/50 shadow-lg shadow-primary/10",
                  pkg.bestValue &&
                    "border-amber-500/50 shadow-lg shadow-amber-500/10",
                )}
                style={{ animationDelay: `${(i + 1) * 80}ms` }}
              >
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-white shadow-md">
                      {t.tokens.popular}
                    </Badge>
                  </div>
                )}
                {pkg.bestValue && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-amber-500 text-white shadow-md">
                      {t.tokens.bestValue}
                    </Badge>
                  </div>
                )}
                <CardContent className="p-5 text-center space-y-4">
                  <div>
                    <p className="text-lg font-bold">{pkg.name}</p>
                    <div className="mt-2 flex items-baseline justify-center gap-1">
                      <Coins className="h-5 w-5 text-amber-500" />
                      <span className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                        {pkg.tokens.toLocaleString()}
                      </span>
                    </div>
                    {pkg.bonus > 0 && (
                      <Badge
                        variant="secondary"
                        className="mt-1.5 bg-green-500/10 text-green-600 text-xs"
                      >
                        +{pkg.bonus}% bonus
                      </Badge>
                    )}
                  </div>

                  <div>
                    <p className="text-2xl font-bold">${pkg.price}</p>
                    <p className="text-xs text-muted-foreground">
                      ~{pkg.priceVi.toLocaleString()}.000₫
                    </p>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      ≈{" "}
                      {Math.floor(
                        (pkg.tokens + (pkg.tokens * pkg.bonus) / 100) /
                          TOKEN_COSTS.ai_chat,
                      )}{" "}
                      {t.tokens.chatRuns}
                    </p>
                    <p>
                      ≈{" "}
                      {Math.floor(
                        (pkg.tokens + (pkg.tokens * pkg.bonus) / 100) /
                          TOKEN_COSTS.writing_feedback,
                      )}{" "}
                      {t.tokens.writingRuns}
                    </p>
                  </div>

                  <Button variant="outline" className="w-full" disabled>
                    {localT.purchaseComingSoon}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground animate-fade-in">
            {localT.purchaseComingSoonHint}
          </p>
        </>
      )}

      {tab === "usage" && (
        /* Token cost table */
        <div className="max-w-2xl mx-auto animate-fade-in">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.tokens.costsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {(Object.entries(TOKEN_COSTS) as [AIFeature, number][]).map(
                  ([feature, cost]) => {
                    const Icon = featureIcons[feature];
                    const usesWithBalance = Math.floor(balance / cost);
                    return (
                      <div
                        key={feature}
                        className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/5">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {t.tokens.featureLabels[feature]}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ~{usesWithBalance} {t.tokens.usesLeft}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Coins className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
                            {cost}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t.tokens.tokensSuffix}
                          </span>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "history" && (
        /* Token transaction history table */
        <div className="max-w-3xl mx-auto animate-fade-in">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-5 w-5 text-amber-500" />
                {localT.historyTitle}
              </CardTitle>
              {transactions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs flex items-center gap-1.5"
                  onClick={() => exportToCSV(transactions, "token-billing-history.csv")}
                >
                  <Download className="h-3.5 w-3.5" />
                  {localT.exportCsv}
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground text-sm">
                  {localT.historyEmpty}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left bg-muted/50">
                        <th className="px-5 py-3 font-medium text-muted-foreground">{localT.colTime}</th>
                        <th className="px-5 py-3 font-medium text-muted-foreground">{localT.colType}</th>
                        <th className="px-5 py-3 font-medium text-muted-foreground">{localT.colFeature}</th>
                        <th className="px-5 py-3 font-medium text-muted-foreground">{localT.colAmount}</th>
                        <th className="px-5 py-3 font-medium text-muted-foreground text-right">{localT.colBalanceAfter}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {transactions.map((tx) => {
                        const amount = tx.amount;
                        const isPositive = amount > 0;
                        return (
                          <tr key={tx.id} className="hover:bg-muted/10 transition">
                            <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                              {new Date(tx.created_at || tx.createdAt || "").toLocaleString("vi-VN")}
                            </td>
                            <td className="px-5 py-3 font-medium">
                              {getTxTypeLabel(tx.type, amount)}
                            </td>
                            <td className="px-5 py-3 text-muted-foreground">
                              {tx.feature && TOKEN_FEATURE_LABELS[tx.feature as AIFeature]
                                ? TOKEN_FEATURE_LABELS[tx.feature as AIFeature]
                                : tx.feature || "-"}
                            </td>
                            <td className="px-5 py-3">
                              <span className={cn(
                                "font-bold tabular-nums",
                                isPositive ? "text-emerald-500" : "text-amber-500 dark:text-amber-400"
                              )}>
                                {isPositive ? `+${amount}` : amount}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right font-medium tabular-nums">
                              {tx.balance_after ?? tx.balanceAfter}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* FAQ */}
      <div
        className="max-w-2xl mx-auto mt-8 animate-fade-in"
        style={{ animationDelay: "400ms" }}
      >
        <h2 className="text-xl font-bold text-center mb-6">
          {t.tokens.faqTitle}
        </h2>
        <div className="space-y-3">
          {faqItems.map((item, i) => (
            <Card key={i} className="overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-medium hover:bg-accent/50 transition-colors"
              >
                {item.q}
                {openFaq === i ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              {openFaq === i && (
                <div className="px-6 pb-4 text-sm text-muted-foreground">
                  {item.a}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

    </div>
  );
}
