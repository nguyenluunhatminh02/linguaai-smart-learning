"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Crown,
  Zap,
  Star,
  ChevronDown,
  ChevronUp,
  Coins,
  Sparkles,
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
  CreditCard,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import { useLanguageStore } from "@/stores/language-store";
import { useEffect } from "react";
import {
  useTokenStore,
  TOKEN_PACKAGES,
  TOKEN_COSTS,
  TOKEN_FEATURE_LABELS,
  type AIFeature,
  type TokenPackage,
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
    sandboxTitle: "Cổng thanh toán thử nghiệm",
    cancel: "Hủy",
    packagePrefix: "Gói",
    receiveTokens: "Nhận {tokens} Tokens (bao gồm bonus)",
    payWith: "Thanh toán",
    cardName: "Tên trên thẻ",
    cardNumber: "Số thẻ",
    expiry: "Hạn sử dụng",
    cvc: "CVC",
    momoScan: "Quét mã MoMo để thanh toán",
    sandboxWarning: "Đây là môi trường thử nghiệm giả lập.",
    processing: "Đang xử lý giao dịch thử nghiệm...",
    paymentUnavailable: "Không thể bắt đầu thanh toán. Vui lòng thử lại sau.",
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
    sandboxTitle: "Experimental Payment Sandbox",
    cancel: "Cancel",
    packagePrefix: "Package",
    receiveTokens: "Receive {tokens} Tokens (includes bonus)",
    payWith: "Pay with",
    cardName: "Cardholder Name",
    cardNumber: "Card Number",
    expiry: "Expiry",
    cvc: "CVC",
    momoScan: "Scan MoMo QR to pay",
    sandboxWarning: "This is a simulated testing environment.",
    processing: "Processing simulated transaction...",
    paymentUnavailable: "Could not start checkout. Please try again later.",
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
    sandboxTitle: "テスト用決済ゲートウェイ",
    cancel: "キャンセル",
    packagePrefix: "パック",
    receiveTokens: "{tokens}トークンを受け取る（ボーナス含む）",
    payWith: "決済",
    cardName: "カード名義",
    cardNumber: "カード番号",
    expiry: "有効期限",
    cvc: "CVC",
    momoScan: "MoMo QRコードをスキャンして決済",
    sandboxWarning: "これはテスト用のシミュレーション環境です。",
    processing: "テスト決済を処理中...",
    paymentUnavailable: "決済を開始できませんでした。しばらくしてからもう一度お試しください。",
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
    sandboxTitle: "테스트 결제 게이트웨이",
    cancel: "취소",
    packagePrefix: "패키지",
    receiveTokens: "{tokens}토큰 받기 (보너스 포함)",
    payWith: "결제하기",
    cardName: "카드 소유자 이름",
    cardNumber: "카드 번호",
    expiry: "만료일",
    cvc: "CVC",
    momoScan: "MoMo QR 스캔하여 결제",
    sandboxWarning: "이것은 시뮬레이션된 테스트 환경입니다.",
    processing: "시뮬레이션된 결제 처리 중...",
    paymentUnavailable: "결제를 시작할 수 없습니다. 나중에 다시 시도해 주세요.",
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
    sandboxTitle: "测试支付网关",
    cancel: "取消",
    packagePrefix: "礼包",
    receiveTokens: "获得 {tokens} 代币（含赠送）",
    payWith: "支付",
    cardName: "持卡人姓名",
    cardNumber: "卡号",
    expiry: "有效期",
    cvc: "CVC",
    momoScan: "扫描 MoMo 二维码进行支付",
    sandboxWarning: "这是模拟测试环境。",
    processing: "正在处理模拟交易...",
    paymentUnavailable: "无法开始结账，请稍后再试。",
  },
};

export default function PricingPage() {
  const { t, locale } = useLanguageStore();
  const localT = pricingLocalDict[locale as keyof typeof pricingLocalDict] || pricingLocalDict.en;
  const { balance, isLoading, transactions, loadBalance, loadHistory } = useTokenStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [tab, setTab] = useState<"packages" | "usage" | "history">("packages");

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<TokenPackage | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "momo">("stripe");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvc, setCardCvc] = useState("123");
  const [cardName, setCardName] = useState("NGUYEN VAN A");
  const [isPaying, setIsPaying] = useState(false);

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

  const handlePurchase = (pkg: TokenPackage) => {
    setSelectedPackage(pkg);
    setShowPaymentModal(true);
  };

  const confirmPayment = async () => {
    if (!selectedPackage) return;
    setIsPaying(true);
    try {
      // Tokens may only be credited by the backend after the payment provider
      // confirms the charge (via a verified webhook). Never call
      // /tokens/purchase from the browser: that endpoint grants free tokens.
      const { data } = await apiClient.post("/payments/checkout", {
        packageId: selectedPackage.id,
        method: paymentMethod,
      });
      const payload = data?.data ?? data;
      const checkoutUrl = payload?.checkoutUrl ?? payload?.url;
      if (typeof checkoutUrl !== "string" || !checkoutUrl) {
        throw new Error("Checkout URL missing from payment response");
      }
      window.location.assign(checkoutUrl);
    } catch {
      toast.error(localT.paymentUnavailable);
      setIsPaying(false);
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

  const faqItems = t.tokens.faq;

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

                  <Button
                    variant={pkg.popular ? "gradient" : "default"}
                    className="w-full"
                    onClick={() => handlePurchase(pkg)}
                    disabled={purchasing !== null}
                  >
                    {purchasing === pkg.id ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        {t.tokens.processing}
                      </span>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 h-4 w-4" />{" "}
                        {t.tokens.buyNow}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Guarantee */}
          <p className="text-center text-sm text-muted-foreground animate-fade-in">
            {t.tokens.moneyBack}
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

      {showPaymentModal && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity animate-fade-in">
          <Card className="w-full max-w-md p-6 shadow-2xl bg-card/90 border border-border/80 backdrop-blur-md animate-scale-in">
            <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-amber-500" />
                Cổng thanh toán thử nghiệm
              </CardTitle>
              <button
                className="text-muted-foreground hover:text-foreground text-sm font-medium"
                onClick={() => {
                  setShowPaymentModal(false);
                  setSelectedPackage(null);
                }}
                disabled={isPaying}
              >
                {localT.cancel}
              </button>
            </CardHeader>
            <CardContent className="p-0 space-y-4">
              {/* Package Summary */}
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3.5 flex justify-between items-center text-sm">
                <div>
                  <p className="font-semibold text-foreground">{localT.packagePrefix} {selectedPackage.name}</p>
                  <p className="text-xs text-muted-foreground">{localT.receiveTokens.replace("{tokens}", (selectedPackage.tokens + Math.floor(selectedPackage.tokens * selectedPackage.bonus / 100)).toLocaleString())}</p>
                </div>
                <div className="text-right font-bold text-lg text-amber-600 dark:text-amber-400">
                  ${selectedPackage.price} <span className="text-xs font-normal text-muted-foreground">({selectedPackage.priceVi}.000₫)</span>
                </div>
              </div>

              {/* Payment Method Switcher */}
              <div className="flex gap-2 p-1 rounded-xl bg-muted/40 text-xs">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("stripe")}
                  className={cn(
                    "flex-1 py-2 rounded-lg font-medium transition",
                    paymentMethod === "stripe" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Stripe Sandbox
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("momo")}
                  className={cn(
                    "flex-1 py-2 rounded-lg font-medium transition",
                    paymentMethod === "momo" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  MoMo Giả lập
                </button>
              </div>

              {paymentMethod === "stripe" ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{localT.cardName}</label>
                    <input
                      type="text"
                      className="w-full bg-muted/30 border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-amber-500/50"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value.toUpperCase())}
                      disabled={isPaying}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{localT.cardNumber}</label>
                    <input
                      type="text"
                      className="w-full bg-muted/30 border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-amber-500/50"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      disabled={isPaying}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">{localT.expiry}</label>
                      <input
                        type="text"
                        placeholder="MM/YY"
                        className="w-full bg-muted/30 border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-amber-500/50"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        disabled={isPaying}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">{localT.cvc}</label>
                      <input
                        type="text"
                        placeholder="123"
                        className="w-full bg-muted/30 border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-amber-500/50"
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value)}
                        disabled={isPaying}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-4 flex flex-col items-center justify-center space-y-3 bg-muted/20 border border-dashed rounded-xl">
                  {/* Mock QR code */}
                  <div className="h-32 w-32 bg-white p-2 rounded-lg shadow-sm border flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="h-full w-full text-pink-600">
                      <rect width="100" height="100" fill="none" />
                      {/* Outer markers */}
                      <path d="M 5,5 h 25 v 25 h -25 z M 70,5 h 25 v 25 h -25 z M 5,70 h 25 v 25 h -25 z" fill="currentColor" />
                      {/* Inner markers */}
                      <path d="M 10,10 h 15 v 15 h -15 z M 75,10 h 15 v 15 h -15 z M 10,75 h 15 v 15 h -15 z" fill="white" />
                      {/* Random pixel-like patterns */}
                      <path d="M 40,10 h 10 v 10 h -10 z M 50,20 h 10 v 10 h -10 z M 40,40 h 20 v 20 h -20 z M 20,40 h 10 v 10 h -10 z M 70,50 h 20 v 10 h -20 z M 10,50 h 10 v 10 h -10 z M 40,70 h 10 v 20 h -10 z M 50,80 h 20 v 10 h -20 z M 80,70 h 10 v 20 h -10 z" fill="currentColor" />
                    </svg>
                  </div>
                  <div className="text-center text-xs space-y-1">
                    <p className="font-semibold text-pink-600">{localT.momoScan}</p>
                    <p className="text-muted-foreground">{localT.sandboxWarning}</p>
                  </div>
                </div>
              )}

              <Button
                variant="gradient"
                className="w-full h-11 text-sm rounded-xl font-medium flex items-center justify-center gap-2"
                onClick={confirmPayment}
                disabled={isPaying}
              >
                {isPaying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin animate-spin-slow" />
                    {localT.processing}
                  </>
                ) : (
                  <>
                    {localT.payWith} {paymentMethod === "stripe" ? "Stripe Sandbox" : "MoMo Giả lập"} (${selectedPackage.price})
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
