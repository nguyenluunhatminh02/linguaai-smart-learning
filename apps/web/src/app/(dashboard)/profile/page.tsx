"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useUpdateProfile } from "@/hooks/use-profile";
import { useAuthStore, getAccessToken } from "@/stores/auth-store";
import { useDevices } from "@/hooks/use-devices";
import {
  Flame,
  Star,
  Calendar,
  Settings,
  CheckCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Lock,
  QrCode,
  Laptop,
  Smartphone,
  Trash2,
  Edit2,
  Shield,
  RefreshCw,
} from "lucide-react";
import { useLanguageStore } from "@/stores/language-store";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  profileSchema,
  type ProfileFormData,
} from "@/lib/validation/profile.schema";
import { apiClient } from "@/lib/api-client";

const mfaTranslations = {
  en: {
    mfaTitle: "Two-Factor Authentication (2FA)",
    mfaDescDisabled: "Two-factor authentication is currently disabled. Enable it to add an extra layer of security to your account.",
    mfaDescEnabled: "Two-factor authentication is currently enabled. Your account is secured with a TOTP authenticator.",
    mfaEnableBtn: "Enable 2FA",
    mfaDisableBtn: "Disable 2FA",
    mfaSetupTitle: "Configure Authenticator",
    mfaSetupDesc: "Scan this QR code with your authenticator app (like Google Authenticator or Microsoft Authenticator) to get your 6-digit TOTP codes.",
    mfaSecretKey: "Secret Key",
    mfaBackupCodesTitle: "Backup Codes",
    mfaBackupCodesDesc: "Save these backup codes in a safe place. You can use them if you lose access to your authenticator app. Each code can only be used once.",
    mfaVerifyInputLabel: "Enter 6-digit verification code",
    mfaVerifyBtn: "Verify & Enable",
    mfaCancelBtn: "Cancel",
    mfaDisableConfirmTitle: "Disable Two-Factor Authentication",
    mfaDisableConfirmDesc: "To disable two-factor authentication, enter a 6-digit verification code from your authenticator app.",
    mfaDisableConfirmBtn: "Confirm Disable",
    mfaSuccessEnabled: "Two-factor authentication enabled successfully!",
    mfaSuccessDisabled: "Two-factor authentication disabled successfully!",
    mfaErrorInvalidCode: "Invalid verification code. Please try again.",
    mfaCopied: "Copied!",
    mfaCopyBtn: "Copy",
  },
  vi: {
    mfaTitle: "Xác thực hai lớp (2FA)",
    mfaDescDisabled: "Xác thực hai lớp hiện đang tắt. Hãy bật 2FA để thêm một lớp bảo mật bổ sung cho tài khoản của bạn.",
    mfaDescEnabled: "Xác thực hai lớp hiện đang bật. Tài khoản của bạn được bảo vệ bằng ứng dụng xác thực TOTP.",
    mfaEnableBtn: "Bật 2FA",
    mfaDisableBtn: "Tắt 2FA",
    mfaSetupTitle: "Cấu hình ứng dụng xác thực",
    mfaSetupDesc: "Quét mã QR dưới đây bằng ứng dụng xác thực (như Google Authenticator hoặc Microsoft Authenticator) để lấy mã TOTP 6 chữ số.",
    mfaSecretKey: "Khóa bí mật",
    mfaBackupCodesTitle: "Mã dự phòng",
    mfaBackupCodesDesc: "Lưu trữ các mã dự phòng này ở nơi an toàn. Bạn có thể dùng chúng nếu mất quyền truy cập ứng dụng xác thực. Mỗi mã chỉ dùng được 1 lần.",
    mfaVerifyInputLabel: "Nhập mã xác thực 6 số",
    mfaVerifyBtn: "Xác minh & Kích hoạt",
    mfaCancelBtn: "Hủy bỏ",
    mfaDisableConfirmTitle: "Hủy xác thực hai lớp",
    mfaDisableConfirmDesc: "Để tắt xác thực hai lớp, vui lòng nhập mã xác thực 6 chữ số từ ứng dụng xác thực của bạn.",
    mfaDisableConfirmBtn: "Xác nhận tắt",
    mfaSuccessEnabled: "Đã kích hoạt xác thực hai lớp thành công!",
    mfaSuccessDisabled: "Đã tắt xác thực hai lớp thành công!",
    mfaErrorInvalidCode: "Mã xác thực không hợp lệ. Vui lòng thử lại.",
    mfaCopied: "Đã sao chép!",
    mfaCopyBtn: "Sao chép",
  }
};

const deviceTranslations = {
  en: {
    deviceTitle: "Device Management",
    deviceDesc: "Manage all devices and active sessions currently logged into your account.",
    currentDevice: "This Device",
    trustedDevice: "Trusted",
    untrustedDevice: "Not Trusted",
    trustBtn: "Trust Device",
    untrustBtn: "Remove Trust",
    renameBtn: "Rename",
    renameTitle: "Rename Device",
    renamePlaceholder: "Enter new device name",
    logoutBtn: "Log out",
    logoutOtherBtn: "Log out all other devices",
    lastActive: "Last active",
    ipAddress: "IP Address",
    browser: "Browser",
    os: "Operating System",
    noDevices: "No active devices found.",
    loadingDevices: "Loading active sessions...",
    renameSuccess: "Device renamed successfully!",
    trustSuccess: "Device trust status updated!",
    logoutSuccess: "Device session revoked successfully!",
    logoutOtherSuccess: "All other device sessions revoked!",
    confirmLogoutTitle: "Log out device?",
    confirmLogoutDesc: "Are you sure you want to log out this device? Any active session on it will be terminated.",
    confirmLogoutOtherTitle: "Log out all other devices?",
    confirmLogoutOtherDesc: "This will log out your account from all other browsers and devices except this one. Continue?",
    confirmBtn: "Confirm",
    cancelBtn: "Cancel",
  },
  vi: {
    deviceTitle: "Quản lý thiết bị",
    deviceDesc: "Quản lý các thiết bị và phiên hoạt động đang đăng nhập vào tài khoản của bạn.",
    currentDevice: "Thiết bị này",
    trustedDevice: "Tin cậy",
    untrustedDevice: "Chưa tin cậy",
    trustBtn: "Tin cậy thiết bị",
    untrustBtn: "Hủy tin cậy",
    renameBtn: "Đổi tên",
    renameTitle: "Đổi tên thiết bị",
    renamePlaceholder: "Nhập tên thiết bị mới",
    logoutBtn: "Đăng xuất",
    logoutOtherBtn: "Đăng xuất thiết bị khác",
    lastActive: "Hoạt động gần nhất",
    ipAddress: "Địa chỉ IP",
    browser: "Trình duyệt",
    os: "Hệ điều hành",
    noDevices: "Không tìm thấy thiết bị hoạt động nào.",
    loadingDevices: "Đang tải danh sách thiết bị...",
    renameSuccess: "Đã đổi tên thiết bị thành công!",
    trustSuccess: "Đã cập nhật trạng thái tin cậy thiết bị!",
    logoutSuccess: "Đã đăng xuất thiết bị thành công!",
    logoutOtherSuccess: "Đã đăng xuất tất cả các thiết bị khác thành công!",
    confirmLogoutTitle: "Đăng xuất thiết bị?",
    confirmLogoutDesc: "Bạn có chắc chắn muốn đăng xuất thiết bị này không? Phiên làm việc của thiết bị đó sẽ bị hủy bỏ.",
    confirmLogoutOtherTitle: "Đăng xuất khỏi tất cả các thiết bị khác?",
    confirmLogoutOtherDesc: "Hành động này sẽ đăng xuất tài khoản của bạn khỏi tất cả các trình duyệt và thiết bị ngoại trừ thiết bị hiện tại. Tiếp tục?",
    confirmBtn: "Xác nhận",
    cancelBtn: "Hủy bỏ",
  }
};

const auditTranslations = {
  en: {
    auditTitle: "Security & Activity Logs",
    auditDesc: "Review recent security-related actions and sign-in attempts on your account.",
    tabActivity: "Activity Log",
    tabLogin: "Login History",
    loadingLogs: "Loading security logs...",
    noLogs: "No events recorded.",
    refreshBtn: "Refresh",
    action: "Action",
    details: "Details",
    ipAddress: "IP Address",
    status: "Status",
    date: "Date",
    success: "Success",
    failed: "Failed",
    device: "Device",
    reason: "Reason",
  },
  vi: {
    auditTitle: "Nhật ký Hoạt động & Bảo mật",
    auditDesc: "Xem lại các hành động liên quan đến bảo mật và các lần đăng nhập gần đây trên tài khoản của bạn.",
    tabActivity: "Nhật ký hoạt động",
    tabLogin: "Lịch sử đăng nhập",
    loadingLogs: "Đang tải nhật ký bảo mật...",
    noLogs: "Chưa ghi nhận hoạt động nào.",
    refreshBtn: "Làm mới",
    action: "Hành động",
    details: "Chi tiết",
    ipAddress: "Địa chỉ IP",
    status: "Trạng thái",
    date: "Thời gian",
    success: "Thành công",
    failed: "Thất bại",
    device: "Thiết bị",
    reason: "Lý do",
  }
};

const formatAction = (action: string, lang: string) => {
  const map: Record<string, Record<string, string>> = {
    LOGIN: { en: "Login", vi: "Đăng nhập" },
    MFA_LOGIN: { en: "MFA Login", vi: "Đăng nhập MFA" },
    LOGOUT: { en: "Logout", vi: "Đăng xuất" },
    LOGOUT_ALL: { en: "Logout All Devices", vi: "Đăng xuất tất cả thiết bị" },
    LOGOUT_SESSION: { en: "Logout Session", vi: "Đăng xuất phiên" },
    CHANGE_PASSWORD: { en: "Change Password", vi: "Thay đổi mật khẩu" },
    MFA_ENABLED: { en: "MFA Enabled", vi: "Bật MFA" },
    MFA_DISABLED: { en: "MFA Disabled", vi: "Tắt MFA" },
    OAUTH_LOGIN: { en: "OAuth Login", vi: "Đăng nhập mạng xã hội" },
  };
  return map[action]?.[lang] || action;
};

function getDeviceIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload).deviceId || null;
  } catch {
    return null;
  }
}



interface LoginHistoryEntry {
  id: string;
  device_info?: string;
  deviceInfo?: string;
  success?: boolean;
  ip_address?: string;
  ipAddress?: string;
  failure_reason?: string;
  failureReason?: string;
  attempted_at?: string;
  attemptedAt?: string;
}

interface SecurityEventEntry {
  id: string;
  action: string;
  success?: boolean;
  ip_address?: string;
  ipAddress?: string;
  details?: string;
  created_at?: string;
  createdAt?: string;
}

interface MfaSetupResponse {
  secret: string;
  qrCodeUrl: string;
  backupCodes?: string[];
}

const AUDIT_PAGE_SIZE = 10;
const auditLogsKey = (userId?: string) => ["profile", "audit-logs", userId, { page: 1, size: AUDIT_PAGE_SIZE }] as const;

type AuditPayload<T> = T[] | { items?: T[]; data?: T[] | { items?: T[] } };

function normalizeAuditPayload<T>(payload: AuditPayload<T> | undefined | null): T[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload?.items ?? (Array.isArray(payload?.data?.items) ? payload.data.items : []);
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const response = (err as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === "string" && response.data.message) {
      return response.data.message;
    }
  }
  return fallback;
}

async function fetchLoginHistory(): Promise<LoginHistoryEntry[]> {
  const response = await apiClient.get<AuditPayload<LoginHistoryEntry>>(
    `/auth/login-history?page=1&size=${AUDIT_PAGE_SIZE}`,
  );
  return normalizeAuditPayload(response.data);
}

async function fetchSecurityEvents(): Promise<SecurityEventEntry[]> {
  const response = await apiClient.get<AuditPayload<SecurityEventEntry>>(
    `/auth/security-events?page=1&size=${AUDIT_PAGE_SIZE}`,
  );
  return normalizeAuditPayload(response.data);
}

/** Audit history is user-scoped: never reuse one account's logs for another. */
function useAuditLogs() {
  const userId = useAuthStore((state) => state.user?.id);
  const query = useQuery({
    queryKey: auditLogsKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const [loginHistory, securityEvents] = await Promise.all([
        fetchLoginHistory(),
        fetchSecurityEvents(),
      ]);
      return { loginHistory, securityEvents };
    },
  });

  return {
    loginHistory: query.data?.loginHistory ?? [],
    securityEvents: query.data?.securityEvents ?? [],
    // isFetching also covers refreshes, matching the old fetchAuditLogs spinner.
    isLoading: query.isFetching,
    hasError: query.isError,
    refetch: query.refetch,
  };
}

const mfaApi = {
  setup: async () => {
    const response = await apiClient.post<MfaSetupResponse & { data?: MfaSetupResponse }>("/mfa/setup");
    // apiClient unwraps the standard envelope; keep the legacy nested fallback.
    return response.data.data ?? response.data;
  },
  confirm: async (code: string) => {
    await apiClient.post("/mfa/setup/confirm", { code });
  },
  disable: async (code: string) => {
    await apiClient.post("/mfa/disable", { code });
  },
};

function useMfa() {
  const userId = useAuthStore((state) => state.user?.id);
  const loadUser = useAuthStore((state) => state.loadUser);
  const queryClient = useQueryClient();

  const refreshAfterChange = async () => {
    await loadUser();
    // MFA changes write new security events; refresh this page's logs.
    await queryClient.invalidateQueries({ queryKey: ["profile", "audit-logs", userId] });
    // invalidateQueries is fire-and-forget; await the refetch so a following
    // navigation cannot render the stale security log.
    await queryClient.refetchQueries({ queryKey: ["profile", "audit-logs", userId] });
  };

  const setupMutation = useMutation({ mutationFn: mfaApi.setup });
  const confirmMutation = useMutation({
    mutationFn: mfaApi.confirm,
    onSuccess: refreshAfterChange,
  });
  const disableMutation = useMutation({
    mutationFn: mfaApi.disable,
    onSuccess: refreshAfterChange,
  });

  return {
    setup: setupMutation.mutateAsync,
    confirm: confirmMutation.mutateAsync,
    disable: disableMutation.mutateAsync,
    isPending: setupMutation.isPending || confirmMutation.isPending || disableMutation.isPending,
  };
}

export default function ProfilePage() {
  const { t, locale } = useLanguageStore();
  const { user } = useAuthStore();
  const [saved, setSaved] = useState(false);
  const updateProfileMutation = useUpdateProfile();

  // Audit Log & Security Events from TanStack Query (user-scoped cache)
  const [activeAuditTab, setActiveAuditTab] = useState<"audit" | "login">("audit");
  const {
    loginHistory,
    securityEvents,
    isLoading: isAuditLoading,
    hasError: hasAuditError,
    refetch: refetchAuditLogs,
  } = useAuditLogs();
  const tAudit = auditTranslations[locale as "en" | "vi"] || auditTranslations["en"];
  // The old fetch cleared its error when a refresh started.
  const auditError = hasAuditError && !isAuditLoading ? "Failed to load activity logs" : null;

  // Device States & Hooks
  const tDev = deviceTranslations[locale as "en" | "vi"] || deviceTranslations["en"];
  const {
    sessions,
    isLoading: isDevLoading,
    renameDevice,
    trustDevice,
    untrustDevice,
    removeDevice,
    removeOthers
  } = useDevices();

  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [deviceSuccess, setDeviceSuccess] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    const devId = getDeviceIdFromToken(token);
    setCurrentDeviceId(devId);
  }, []);

  const handleRename = async (deviceId: string) => {
    if (!newDeviceName.trim()) return;
    setDeviceError(null);
    setDeviceSuccess(null);
    try {
      await renameDevice({ deviceId, newName: newDeviceName });
      setDeviceSuccess(tDev.renameSuccess);
      setRenamingDeviceId(null);
      setNewDeviceName("");
      setTimeout(() => setDeviceSuccess(null), 3000);
    } catch (err) {
      setDeviceError(apiErrorMessage(err, "Failed to rename device"));
      setTimeout(() => setDeviceError(null), 3000);
    }
  };

  const handleToggleTrust = async (deviceId: string, currentTrusted: boolean) => {
    setDeviceError(null);
    setDeviceSuccess(null);
    try {
      if (currentTrusted) {
        await untrustDevice(deviceId);
      } else {
        await trustDevice(deviceId);
      }
      setDeviceSuccess(tDev.trustSuccess);
      setTimeout(() => setDeviceSuccess(null), 3000);
    } catch (err) {
      setDeviceError(apiErrorMessage(err, "Failed to update trust status"));
      setTimeout(() => setDeviceError(null), 3000);
    }
  };

  const handleLogoutDevice = async (deviceId: string) => {
    if (!confirm(tDev.confirmLogoutDesc)) return;
    setDeviceError(null);
    setDeviceSuccess(null);
    try {
      await removeDevice(deviceId);
      setDeviceSuccess(tDev.logoutSuccess);
      setTimeout(() => setDeviceSuccess(null), 3000);
    } catch (err) {
      setDeviceError(apiErrorMessage(err, "Failed to log out device"));
      setTimeout(() => setDeviceError(null), 3000);
    }
  };

  const handleLogoutOthers = async () => {
    if (!confirm(tDev.confirmLogoutOtherDesc)) return;
    setDeviceError(null);
    setDeviceSuccess(null);
    try {
      await removeOthers();
      setDeviceSuccess(tDev.logoutOtherSuccess);
      setTimeout(() => setDeviceSuccess(null), 3000);
    } catch (err) {
      setDeviceError(apiErrorMessage(err, "Failed to log out other devices"));
      setTimeout(() => setDeviceError(null), 3000);
    }
  };

  // MFA state: secrets/codes stay in local component state, never in the query cache
  const mfa = useMfa();
  const [mfaStep, setMfaStep] = useState<"idle" | "setup" | "disable">("idle");
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSuccess, setMfaSuccess] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackups, setCopiedBackups] = useState(false);

  const tMfa = mfaTranslations[locale as "en" | "vi"] || mfaTranslations["en"];

  const handleInitiateSetup = async () => {
    setMfaError(null);
    setMfaSuccess(null);
    try {
      const res = await mfa.setup();
      setTotpSecret(res.secret);
      setQrCodeUrl(res.qrCodeUrl);
      setBackupCodes(res.backupCodes || []);
      setMfaStep("setup");
    } catch (err) {
      setMfaError(apiErrorMessage(err, "Failed to initiate MFA setup"));
    }
  };

  const handleConfirmSetup = async () => {
    if (!verifyCode.trim()) return;
    setMfaError(null);
    try {
      await mfa.confirm(verifyCode);
      setMfaSuccess(tMfa.mfaSuccessEnabled);
      setMfaStep("idle");
      setVerifyCode("");
    } catch (err) {
      setMfaError(apiErrorMessage(err, tMfa.mfaErrorInvalidCode));
    }
  };

  const handleInitiateDisable = () => {
    setMfaStep("disable");
    setMfaError(null);
    setMfaSuccess(null);
    setVerifyCode("");
  };

  const handleConfirmDisable = async () => {
    if (!verifyCode.trim()) return;
    setMfaError(null);
    try {
      await mfa.disable(verifyCode);
      setMfaSuccess(tMfa.mfaSuccessDisabled);
      setMfaStep("idle");
      setVerifyCode("");
    } catch (err) {
      setMfaError(apiErrorMessage(err, tMfa.mfaErrorInvalidCode));
    }
  };

  const handleCancel = () => {
    setMfaStep("idle");
    setVerifyCode("");
    setMfaError(null);
    setTotpSecret(null);
    setQrCodeUrl(null);
    setBackupCodes([]);
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // Clipboard API is unavailable in insecure contexts and can be denied by
    // the browser. Fall back to a hidden textarea before reporting success —
    // these values are the only way to recover 2FA, so a false "Copied!" is
    // dangerous.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // try the legacy path below
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopySecret = async () => {
    if (!totpSecret) return;
    setMfaError(null);
    if (await copyToClipboard(totpSecret)) {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setMfaError(locale === "vi"
        ? "Không thể sao chép. Vui lòng chọn và sao chép khóa bí mật ở trên thủ công trước khi tiếp tục."
        : "Could not copy the secret. Please select and copy it manually before continuing.");
    }
  };

  const handleCopyBackups = async () => {
    if (backupCodes.length === 0) return;
    setMfaError(null);
    if (await copyToClipboard(backupCodes.join("\n"))) {
      setCopiedBackups(true);
      setTimeout(() => setCopiedBackups(false), 2000);
    } else {
      setMfaError(locale === "vi"
        ? "Không thể sao chép. Vui lòng chọn và sao chép các mã dự phòng ở trên thủ công trước khi tiếp tục."
        : "Could not copy the backup codes. Please select and copy them manually before continuing.");
    }
  };


  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: "",
      nativeLanguage: undefined,
      targetLanguage: undefined,
    },
    mode: "onBlur",
  });

  useEffect(() => {
    if (user) {
      setValue("displayName", user.displayName || "");
      setValue(
        "nativeLanguage",
        (user.nativeLanguage as ProfileFormData["nativeLanguage"]) || undefined,
      );
      setValue(
        "targetLanguage",
        (user.targetLanguage as ProfileFormData["targetLanguage"]) || undefined,
      );
    }
  }, [user, setValue]);

  const onSubmit = async (data: ProfileFormData) => {
    setSaved(false);
    try {
      // Split displayName into firstName / lastName for the API
      const [firstName, ...rest] = data.displayName.trim().split(" ");
      const lastName = rest.join(" ") || undefined;
      await updateProfileMutation.mutateAsync({
        firstName,
        lastName,
        // An empty select means "clear this language". Send an explicit
        // null: undefined keys are dropped by JSON.stringify and Prisma
        // ignores them, which would silently keep the old value.
        nativeLanguage: data.nativeLanguage ?? null,
        targetLanguage: data.targetLanguage ?? null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silently handle
    }
  };

  const saving = updateProfileMutation.isPending;

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Profile Header */}
      <Card className="overflow-hidden">
        <div className="gradient-bg px-6 py-8 text-center text-white">
          <div className="mx-auto mb-3">
            <Avatar name={user.displayName || user.email} size="lg" />
          </div>
          <h2 className="text-xl font-bold">{user.displayName || "User"}</h2>
          <p className="mt-1 text-sm text-white/70">{user.email}</p>
          {user.role === "admin" && (
            <Badge variant="warning" className="mt-2">
              Admin
            </Badge>
          )}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="card-hover">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
              <Flame className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {user.streakCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.profile.dayStreak}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <Star className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {user.totalXp ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.profile.totalXP}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
              <Calendar className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-lg font-bold">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString()
                  : "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.profile.joined}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Profile */}
      <Card>
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-primary" />{" "}
            {t.profile.editProfile}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label={t.profile.email} value={user.email} disabled />
            <Input
              label={t.profile.displayName}
              {...register("displayName")}
              error={errors.displayName?.message}
            />
            <div>
              <label
                htmlFor="native-language"
                className="mb-1.5 block text-sm font-medium"
              >
                {t.profile.nativeLanguage}
              </label>
              <select
                id="native-language"
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                {...register("nativeLanguage")}
              >
                <option value="">{t.profile.selectLanguage}</option>
                <option value="vietnamese">{t.languages.vietnamese}</option>
                <option value="english">{t.languages.english}</option>
                <option value="japanese">{t.languages.japanese}</option>
                <option value="korean">{t.languages.korean}</option>
                <option value="chinese">{t.languages.chinese}</option>
                <option value="french">{t.languages.french}</option>
                <option value="spanish">{t.languages.spanish}</option>
              </select>
              {errors.nativeLanguage && (
                <p className="text-xs text-destructive mt-0.5">
                  {errors.nativeLanguage.message}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="target-language-profile"
                className="mb-1.5 block text-sm font-medium"
              >
                {t.profile.targetLanguage}
              </label>
              <select
                id="target-language-profile"
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                {...register("targetLanguage")}
              >
                <option value="">{t.profile.selectLanguage}</option>
                <option value="english">{t.languages.english}</option>
                <option value="vietnamese">{t.languages.vietnamese}</option>
                <option value="japanese">{t.languages.japanese}</option>
                <option value="korean">{t.languages.korean}</option>
                <option value="chinese">{t.languages.chinese}</option>
                <option value="french">{t.languages.french}</option>
                <option value="spanish">{t.languages.spanish}</option>
              </select>
              {errors.targetLanguage && (
                <p className="text-xs text-destructive mt-0.5">
                  {errors.targetLanguage.message}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" variant="gradient" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : (
                  t.profile.saveChanges
                )}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-sm font-medium text-emerald-500 animate-fade-in">
                  <CheckCircle className="h-4 w-4" /> Saved!
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Two-Factor Authentication Card */}
      <Card>
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {tMfa.mfaTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-4">
          {mfaSuccess && (
            <div className="rounded-xl bg-success/[0.06] border border-success/15 px-4 py-3 text-sm text-success flex items-center gap-2 animate-scale-in">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>{mfaSuccess}</span>
            </div>
          )}

          {mfaError && (
            <div className="rounded-xl bg-destructive/[0.06] border border-destructive/15 px-4 py-3 text-sm text-destructive flex items-center gap-2 animate-scale-in">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{mfaError}</span>
            </div>
          )}

          {mfaStep === "idle" && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border/50 bg-background/50 p-4">
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Lock className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {user.twoFactorEnabled ? tMfa.mfaDescEnabled : tMfa.mfaDescDisabled}
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                {user.twoFactorEnabled ? (
                  <Button
                    onClick={handleInitiateDisable}
                    variant="destructive"
                    className="w-full sm:w-auto text-sm"
                  >
                    {tMfa.mfaDisableBtn}
                  </Button>
                ) : (
                  <Button
                    onClick={handleInitiateSetup}
                    variant="gradient"
                    className="w-full sm:w-auto text-sm"
                    disabled={mfa.isPending}
                  >
                    {mfa.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      tMfa.mfaEnableBtn
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}

          {mfaStep === "setup" && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h4 className="text-sm font-bold flex items-center gap-1.5">
                  <QrCode className="h-4 w-4 text-primary" /> {tMfa.mfaSetupTitle}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {tMfa.mfaSetupDesc}
                </p>
              </div>

              {/* QR Code and Secret Key Fallback */}
              <div className="flex flex-col md:flex-row gap-6 items-center justify-center rounded-xl border border-border/50 bg-background/30 p-5">
                {qrCodeUrl && (
                  <div className="bg-white p-3 rounded-2xl shadow-sm border border-border/20 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCodeUrl}
                      alt="MFA QR Code"
                      className="h-40 w-40 block"
                    />
                  </div>
                )}
                <div className="flex-1 w-full space-y-3">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    {tMfa.mfaSecretKey}
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 select-all h-11 px-3 bg-muted rounded-xl flex items-center text-xs font-mono border overflow-x-auto break-all whitespace-nowrap">
                      {totpSecret}
                    </code>
                    <Button
                      type="button"
                      onClick={handleCopySecret}
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 rounded-xl shrink-0"
                    >
                      {copiedSecret ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Backup Codes */}
              {backupCodes.length > 0 && (
                <div className="space-y-3 rounded-xl border border-border/50 bg-background/30 p-5">
                  <div className="flex justify-between items-center">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      {tMfa.mfaBackupCodesTitle}
                    </h5>
                    <Button
                      type="button"
                      onClick={handleCopyBackups}
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-xs gap-1.5 px-3"
                    >
                      {copiedBackups ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          {tMfa.mfaCopied}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          {tMfa.mfaCopyBtn}
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                    {tMfa.mfaBackupCodesDesc}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                    {backupCodes.map((code, index) => (
                      <code
                        key={index}
                        className="text-center bg-muted/65 border border-border/40 py-1.5 rounded-lg text-xs font-mono select-all font-semibold"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirm Code Input */}
              <div className="space-y-4 pt-2 border-t">
                <div className="max-w-xs">
                  <Input
                    label={tMfa.mfaVerifyInputLabel}
                    placeholder="000000"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="text-center font-mono tracking-[0.25em] text-lg font-bold"
                    maxLength={6}
                    pattern="\d*"
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    onClick={handleConfirmSetup}
                    variant="gradient"
                    disabled={verifyCode.length < 6 || mfa.isPending}
                  >
                    {mfa.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      tMfa.mfaVerifyBtn
                    )}
                  </Button>
                  <Button type="button" onClick={handleCancel} variant="ghost" disabled={mfa.isPending}>
                    {tMfa.mfaCancelBtn}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {mfaStep === "disable" && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-destructive">
                  {tMfa.mfaDisableConfirmTitle}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {tMfa.mfaDisableConfirmDesc}
                </p>
              </div>

              <div className="max-w-xs">
                <Input
                  label={tMfa.mfaVerifyInputLabel}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center font-mono tracking-[0.25em] text-lg font-bold"
                  maxLength={6}
                  pattern="\d*"
                  inputMode="numeric"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={handleConfirmDisable}
                  variant="destructive"
                  disabled={verifyCode.length < 6 || mfa.isPending}
                >
                  {mfa.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Disabling...
                    </>
                  ) : (
                    tMfa.mfaDisableConfirmBtn
                  )}
                </Button>
                <Button type="button" onClick={handleCancel} variant="ghost" disabled={mfa.isPending}>
                  {tMfa.mfaCancelBtn}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Device Management Card */}
      <Card className="mt-6">
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="flex items-center justify-between text-base font-bold">
            <span className="flex items-center gap-2">
              <Laptop className="h-5 w-5 text-primary" />
              {tDev.deviceTitle}
            </span>
            {sessions && (
              <Badge variant="outline" className="text-[10px] font-bold py-0.5 px-2.5">
                {sessions.activeCount} active
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {tDev.deviceDesc}
          </p>

          {deviceSuccess && (
            <div className="rounded-xl bg-success/[0.06] border border-success/15 px-4 py-3 text-sm text-success flex items-center gap-2 animate-scale-in">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>{deviceSuccess}</span>
            </div>
          )}

          {deviceError && (
            <div className="rounded-xl bg-destructive/[0.06] border border-destructive/15 px-4 py-3 text-sm text-destructive flex items-center gap-2 animate-scale-in">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{deviceError}</span>
            </div>
          )}

          {isDevLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              {tDev.loadingDevices}
            </div>
          ) : !sessions || sessions.devices.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {tDev.noDevices}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="divide-y divide-border/40">
                {sessions.devices.map((device) => {
                  const isCurrent = device.deviceId === currentDeviceId;
                  const isRenaming = renamingDeviceId === device.deviceId;
                  const isMobile = device.deviceType?.toLowerCase() === "mobile" ||
                    /mobile|android|iphone/i.test(device.operatingSystem || "") ||
                    /mobile|android|iphone/i.test(device.browser || "");
                  const DeviceIcon = isMobile ? Smartphone : Laptop;

                  return (
                    <div
                      key={device.id}
                      className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex gap-3">
                        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/10">
                          <DeviceIcon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isRenaming ? (
                              <div className="flex items-center gap-2 max-w-xs">
                                <Input
                                  placeholder={tDev.renamePlaceholder}
                                  value={newDeviceName}
                                  onChange={(e) => setNewDeviceName(e.target.value)}
                                  className="h-8 py-0 px-2.5 text-xs font-semibold rounded-lg"
                                  maxLength={30}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="gradient"
                                  className="h-8 rounded-lg px-3 text-xs"
                                  onClick={() => handleRename(device.deviceId)}
                                >
                                  {tDev.confirmBtn}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 rounded-lg px-2 text-xs"
                                  onClick={() => {
                                    setRenamingDeviceId(null);
                                    setNewDeviceName("");
                                  }}
                                >
                                  {tDev.cancelBtn}
                                </Button>
                              </div>
                            ) : (
                              <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                                {device.deviceName || "Unknown Device"}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingDeviceId(device.deviceId);
                                    setNewDeviceName(device.deviceName || "");
                                  }}
                                  className="text-muted-foreground/60 hover:text-primary transition-colors"
                                  title={tDev.renameBtn}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              </span>
                            )}

                            {isCurrent && (
                              <Badge variant="default" className="text-[10px] py-0 px-2 font-bold shrink-0 bg-primary/10 text-primary border-none">
                                {tDev.currentDevice}
                              </Badge>
                            )}

                            <Badge
                              variant={device.trusted ? "success" : "outline"}
                              className="text-[10px] py-0 px-2 shrink-0 font-bold"
                            >
                              {device.trusted ? tDev.trustedDevice : tDev.untrustedDevice}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground font-medium">
                            {device.browser && (
                              <span className="flex items-center gap-1">
                                <span className="font-semibold text-foreground/70">{tDev.browser}:</span> {device.browser}
                              </span>
                            )}
                            {device.operatingSystem && (
                              <span className="flex items-center gap-1">
                                <span className="font-semibold text-foreground/70">{tDev.os}:</span> {device.operatingSystem}
                              </span>
                            )}
                            {device.ipAddress && (
                              <span className="flex items-center gap-1">
                                <span className="font-semibold text-foreground/70">{tDev.ipAddress}:</span> {device.ipAddress}
                              </span>
                            )}
                          </div>

                          <p className="text-[10px] text-muted-foreground/80 font-medium">
                            {tDev.lastActive}: {device.lastActiveAt ? new Date(device.lastActiveAt).toLocaleString() : "-"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-semibold rounded-lg gap-1.5 px-3"
                          onClick={() => handleToggleTrust(device.deviceId, device.trusted)}
                        >
                          <Shield className={`h-3.5 w-3.5 ${device.trusted ? "text-amber-500 fill-amber-500/10" : "text-emerald-500 fill-emerald-500/10"}`} />
                          {device.trusted ? tDev.untrustBtn : tDev.trustBtn}
                        </Button>

                        {!isCurrent && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-8 text-xs font-semibold rounded-lg gap-1.5 px-3"
                            onClick={() => handleLogoutDevice(device.deviceId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {tDev.logoutBtn}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {sessions.devices.length > 1 && (
                <div className="pt-4 border-t flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs rounded-xl font-bold h-10 border-destructive/20 hover:bg-destructive/[0.04] hover:text-destructive hover:border-destructive/30 transition-all text-destructive gap-1.5"
                    onClick={handleLogoutOthers}
                  >
                    <Trash2 className="h-4 w-4" />
                    {tDev.logoutOtherBtn}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security & Activity Logs Card */}
      <Card className="mt-6">
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="flex items-center justify-between text-base font-bold">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {tAudit.auditTitle}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold rounded-lg gap-1.5 px-3"
              onClick={() => void refetchAuditLogs()}
              disabled={isAuditLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isAuditLoading ? "animate-spin" : ""}`} />
              {tAudit.refreshBtn}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <p className="text-xs text-muted-foreground leading-relaxed mb-4">
            {tAudit.auditDesc}
          </p>

          {auditError && (
            <div className="rounded-xl bg-destructive/[0.06] border border-destructive/15 px-4 py-3 text-sm text-destructive flex items-center gap-2 mb-4 animate-scale-in">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{auditError}</span>
            </div>
          )}

          {/* Tab Headers */}
          <div className="flex border-b border-border/40 mb-4">
            <button
              type="button"
              className={`pb-2.5 px-4 text-sm font-bold border-b-2 transition-all ${
                activeAuditTab === "audit"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground/75 hover:text-foreground"
              }`}
              onClick={() => setActiveAuditTab("audit")}
            >
              {tAudit.tabActivity}
            </button>
            <button
              type="button"
              className={`pb-2.5 px-4 text-sm font-bold border-b-2 transition-all ${
                activeAuditTab === "login"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground/75 hover:text-foreground"
              }`}
              onClick={() => setActiveAuditTab("login")}
            >
              {tAudit.tabLogin}
            </button>
          </div>

          {isAuditLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              {tAudit.loadingLogs}
            </div>
          ) : activeAuditTab === "audit" ? (
            /* Activity Log List */
            securityEvents.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {tAudit.noLogs}
              </div>
            ) : (
              <div className="divide-y divide-border/30 max-h-[350px] overflow-y-auto pr-1">
                {securityEvents.map((evt: SecurityEventEntry) => (
                  <div key={evt.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground bg-primary/5 px-2 py-0.5 rounded-md border border-primary/10">
                          {formatAction(evt.action, locale)}
                        </span>
                        {evt.success ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-none font-bold text-[9px] hover:bg-emerald-500/10 animate-scale-in">
                            {tAudit.success}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="bg-rose-500/10 text-rose-600 border-none font-bold text-[9px] hover:bg-rose-500/10 animate-scale-in">
                            {tAudit.failed}
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground font-medium flex flex-wrap gap-x-3">
                        {(evt.ip_address || evt.ipAddress) && (
                          <span>IP: {evt.ip_address || evt.ipAddress}</span>
                        )}
                        {evt.details && (
                          <span>{tAudit.details}: {evt.details}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground/80 font-semibold shrink-0">
                      {new Date(evt.created_at || evt.createdAt || 0).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Login History List */
            loginHistory.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {tAudit.noLogs}
              </div>
            ) : (
              <div className="divide-y divide-border/30 max-h-[350px] overflow-y-auto pr-1">
                {loginHistory.map((attempt: LoginHistoryEntry) => (
                  <div key={attempt.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground/85">
                          {attempt.device_info || attempt.deviceInfo || tAudit.device + " Unknown"}
                        </span>
                        {attempt.success ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-none font-bold text-[9px] hover:bg-emerald-500/10 animate-scale-in">
                            {tAudit.success}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="bg-rose-500/10 text-rose-600 border-none font-bold text-[9px] hover:bg-rose-500/10 animate-scale-in">
                            {tAudit.failed}
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground font-medium flex flex-wrap gap-x-3">
                        <span>IP: {attempt.ip_address || attempt.ipAddress}</span>
                        {(attempt.failure_reason || attempt.failureReason) && (
                          <span className="text-rose-500/80 font-semibold">{tAudit.reason}: {attempt.failure_reason || attempt.failureReason}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground/80 font-semibold shrink-0">
                      {new Date(attempt.attempted_at || attempt.attemptedAt || 0).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
