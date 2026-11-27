"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import { TokenTransaction } from "@/stores/token-store";
import { Trash2, Search, Users, Coins, History, Loader2, Download } from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  xp: number;
  tokens: number;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [tokenAmount, setTokenAmount] = useState(100);
  const [submittingTokens, setSubmittingTokens] = useState(false);

  // History states
  const [selectedUserForHistory, setSelectedUserForHistory] = useState<AdminUser | null>(null);
  const [adminUserHistory, setAdminUserHistory] = useState<TokenTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const getTxTypeLabel = (txType: string, amount: number) => {
    switch (txType) {
      case "purchase": return t.admin.txTypePurchase;
      case "bonus": return t.admin.txTypeBonus;
      case "daily_topup": return t.admin.txTypeDailyTopup;
      case "admin_grant": return amount > 0 ? t.admin.txTypeAdminGrant : t.admin.txTypeAdminDeduct;
      case "consumption": return t.admin.txTypeConsumption;
      default: return txType;
    }
  };

  const exportToCSV = (data: TokenTransaction[], filename = "user-billing-history.csv") => {
    const headers = [
      t.admin.colTime,
      t.admin.colType,
      t.admin.colFeature,
      t.admin.colAmount,
      t.admin.colBalanceAfter
    ];
    const rows = data.map((tx) => {
      const dateStr = tx.created_at || tx.createdAt ? new Date(tx.created_at || tx.createdAt!).toLocaleString().replace(/,/g, "") : "";
      const typeStr = getTxTypeLabel(tx.type, tx.amount);
      const featureStr = tx.feature || "-";
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

  useEffect(() => {
    apiClient
      .get("/admin/users")
      .then((r) => setUsers(r.data.items || r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await apiClient.patch(`/admin/users/${userId}/role`, { role });
      setUsers(users.map((u) => (u.id === userId ? { ...u, role } : u)));
    } catch {
      /* silently handle */
    }
  };

  const handleGrantTokens = async () => {
    if (!selectedUser) return;
    setSubmittingTokens(true);
    try {
      await apiClient.post(`/admin/users/${selectedUser.id}/tokens`, {
        amount: tokenAmount,
      });
      setUsers(
        users.map((u) =>
          u.id === selectedUser.id
            ? { ...u, tokens: u.tokens + tokenAmount }
            : u,
        ),
      );
      setShowGrantModal(false);
    } catch {
      /* silently handle */
    } finally {
      setSubmittingTokens(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm(t.admin.deleteUserConfirm)) return;
    setDeletingId(userId);
    try {
      await apiClient.delete(`/admin/users/${userId}`);
      setUsers(users.filter((u) => u.id !== userId));
    } catch {
      /* silently handle */
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = search
    ? users.filter(
        (u) =>
          u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
          u.email?.toLowerCase().includes(search.toLowerCase()),
      )
    : users;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t.admin.manageUsers}</h2>
          <p className="text-sm text-muted-foreground">
            {t.admin.manageUsersDesc}
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          <Users className="mr-1.5 h-3.5 w-3.5" /> {users.length} {t.admin.usersCount}
        </Badge>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.admin.searchUsersPlaceholder}
          className="input-cls pl-10"
        />
      </div>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-20 text-center text-muted-foreground">
              {t.common.loading}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              {search
                ? t.admin.noUsersFound
                : t.admin.noUsersYet}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left bg-muted/50">
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      {t.admin.colUser}
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      {t.admin.colRole}
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      {t.admin.colTokens}
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      {t.admin.colXp}
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      {t.admin.colJoined}
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                      {t.admin.colActions}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.displayName || u.email} size="sm" />
                          <div>
                            <p className="font-medium">{u.displayName}</p>
                            <p className="text-xs text-muted-foreground">
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-lg border bg-background px-2.5 py-1.5 text-xs"
                          value={u.role}
                          onChange={(e) =>
                            handleRoleChange(u.id, e.target.value)
                          }
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                          {u.tokens}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{u.xp} XP</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg mr-1"
                          onClick={() => {
                            setSelectedUser(u);
                            setTokenAmount(100);
                            setShowGrantModal(true);
                          }}
                          title={t.admin.grantTokensTooltip}
                        >
                          <Coins className="h-4 w-4 text-amber-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg mr-1"
                          onClick={async () => {
                            setSelectedUserForHistory(u);
                            setLoadingHistory(true);
                            try {
                              const res = await apiClient.get(`/admin/users/${u.id}/tokens/history`);
                              setAdminUserHistory(res.data || []);
                            } catch {
                              /* silently handle */
                            } finally {
                              setLoadingHistory(false);
                            }
                          }}
                          title={t.admin.txHistoryTooltip}
                        >
                          <History className="h-4 w-4 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => handleDeleteUser(u.id)}
                          disabled={u.id === user?.id}
                          title={t.admin.deleteUserTooltip}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showGrantModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity">
          <Card className="w-full max-w-md p-6 shadow-xl bg-card border">
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className="h-5 w-5 text-amber-500" /> {t.admin.grantTokensModalTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 space-y-4">
              <div className="text-sm text-muted-foreground">
                {t.admin.grantTokensModalDesc
                  .replace("{name}", selectedUser.displayName || "")
                  .replace("{email}", selectedUser.email || "")}
              </div>
              
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t.admin.tokenAmountLabel}</label>
                <input
                  type="number"
                  min="1"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(Number(e.target.value))}
                  className="flex h-11 w-full rounded-xl border border-border/70 bg-background px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder={t.admin.tokenAmountPlaceholder}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowGrantModal(false)}
                  disabled={submittingTokens}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  variant="gradient"
                  onClick={handleGrantTokens}
                  disabled={submittingTokens || tokenAmount <= 0}
                >
                  {submittingTokens ? t.admin.submitting : t.admin.grantTokensSubmit}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedUserForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity animate-fade-in">
          <Card className="w-full max-w-2xl p-6 shadow-xl bg-card border animate-scale-in">
            <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5 text-primary" /> {t.admin.txHistoryModalTitle}
              </CardTitle>
              <div className="flex items-center gap-2">
                {adminUserHistory.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs flex items-center gap-1.5"
                    onClick={() => exportToCSV(adminUserHistory, `history-${selectedUserForHistory.displayName}.csv`)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t.admin.exportCsv}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedUserForHistory(null)}
                >
                  {t.admin.close}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 space-y-4">
              <div className="text-sm text-muted-foreground">
                {t.admin.txHistoryModalDesc
                  .replace("{name}", selectedUserForHistory.displayName || "")
                  .replace("{email}", selectedUserForHistory.email || "")}
              </div>

              <div className="max-h-96 overflow-y-auto border border-border/80 rounded-xl">
                {loadingHistory ? (
                  <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" /> {t.admin.submitting}
                  </div>
                ) : adminUserHistory.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">{t.admin.noTxYet}</div>
                ) : (
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b bg-muted/50 sticky top-0">
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">{t.admin.colTime}</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">{t.admin.colType}</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">{t.admin.colFeature}</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">{t.admin.colAmount}</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">{t.admin.colBalanceAfter}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {adminUserHistory.map((tx) => {
                        const amount = tx.amount;
                        const isPositive = amount > 0;
                        return (
                          <tr key={tx.id} className="hover:bg-muted/10 transition">
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                              {tx.created_at || tx.createdAt ? new Date(tx.created_at || tx.createdAt!).toLocaleString() : "-"}
                            </td>
                            <td className="px-4 py-2.5 font-semibold">
                              {getTxTypeLabel(tx.type, amount)}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {tx.feature || "-"}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`font-bold tabular-nums ${isPositive ? "text-emerald-500" : "text-amber-500"}`}>
                                {isPositive ? `+${amount}` : amount}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-muted-foreground">
                              {tx.balance_after || tx.balanceAfter}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
