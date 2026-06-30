import { useState, useEffect } from "react";
import { Plus, Mail, AlertTriangle, Shield, Check, LogOut, Trash2, Loader2, Download } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "../utils/supabase";
import { apiFetch } from "../utils/api";
import { isPushSupported } from "../utils/push";

// Relative "x ago" label from an ISO timestamp.
function agoLabel(ts?: string | null) {
  if (!ts) return "never";
  const diffMins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (isNaN(diffMins)) return "never";
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const h = Math.floor(diffMins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Shared grouped-list card (Apple Settings style).
const groupCard: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden",
};
const sectionLabel: React.CSSProperties = {
  color: "var(--text-3)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const rowDivider = (last: boolean): React.CSSProperties => ({
  borderBottom: last ? "none" : "1px solid var(--border)",
});

// Google "G" SVG logo
function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export function SettingsScreen({ canInstall = false, onInstall }: { canInstall?: boolean; onInstall?: () => void } = {}) {
  const [catalog, setCatalog] = useState<{ slug: string; label: string }[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<{ master: boolean; important: boolean; reminders: boolean; digest: boolean }>(
    { master: false, important: true, reminders: true, digest: true }
  );

  // Deletion and Portability States
  const [exporting, setExporting] = useState(false);
  const [deletionScheduled, setDeletionScheduled] = useState(false);
  const [deletionDueAt, setDeletionDueAt] = useState<string | null>(null);
  const [deletionInput, setDeletionInput] = useState("");
  const [confirmDeleteLoading, setConfirmDeleteLoading] = useState(false);

  // Connected Accounts State
  interface ConnectedAccount {
    id: number;
    account_type: string;
    email_address: string;
    imap_username?: string;
    connection_status: string;
    last_synced_at?: string;
    created_at: string;
  }

  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<number | null>(null);

  // Connect Modal state
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [ldapEmail, setLdapEmail] = useState("");
  const [ldapUsername, setLdapUsername] = useState("");
  const [ldapPassword, setLdapPassword] = useState("");
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const fetchAccounts = async () => {
    try {
      setAccountsLoading(true);
      const res = await apiFetch("/api/v1/accounts");
      if (res.ok) {
        const data = await res.json();
        setConnectedAccounts(data);
      }
    } catch (err) {
      console.error("Error fetching accounts:", err);
    } finally {
      setAccountsLoading(false);
    }
  };

  const loadInterests = async () => {
    try {
      const [catRes, profRes] = await Promise.all([
        apiFetch("/api/v1/interests/catalog"),
        apiFetch("/api/v1/profile"),
      ]);
      if (catRes.ok) setCatalog(await catRes.json());
      if (profRes.ok) {
        const prof = await profRes.json();
        setSelectedSlugs(prof.interest_slugs || []);
        if (prof.notification_prefs) setNotifPrefs((p) => ({ ...p, ...prof.notification_prefs }));
      }
    } catch (err) {
      console.error("Error loading interests:", err);
    }
  };

  const checkDeletionStatus = async () => {
    try {
      const res = await apiFetch("/api/v1/user/delete-request");
      if (res.ok) {
        const data = await res.json();
        if (data.scheduled) {
          setDeletionScheduled(true);
          setDeletionDueAt(data.due_at);
        } else {
          setDeletionScheduled(false);
          setDeletionDueAt(null);
        }
      }
    } catch (err) {
      console.error("Error checking deletion status:", err);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setEmail(session.user.email || null);
        checkDeletionStatus();
        fetchAccounts();
        loadInterests();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setEmail(session.user.email || null);
        checkDeletionStatus();
        fetchAccounts();
      } else {
        setEmail(null);
        setConnectedAccounts([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Error signing out:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const res = await apiFetch("/api/v1/user/export");
      if (!res.ok) {
        throw new Error("Failed to export data");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "krnl_data_export.zip";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export data. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (deletionInput !== "DELETE") {
      alert("Please type DELETE to confirm.");
      return;
    }
    setConfirmDeleteLoading(true);
    try {
      const res = await apiFetch("/api/v1/user/delete-request", {
        method: "POST",
        body: JSON.stringify({ confirmation: "DELETE" })
      });
      const data = await res.json();
      if (res.ok) {
        setDeletionScheduled(true);
        setDeletionDueAt(data.due_at);
        setShowDangerConfirm(false);
        setDeletionInput("");
      } else {
        alert(data.detail || "Failed to schedule account deletion.");
      }
    } catch (err) {
      console.error("Deletion request error:", err);
      alert("An error occurred. Please try again.");
    } finally {
      setConfirmDeleteLoading(false);
    }
  };

  const handleCancelDeletion = async () => {
    setConfirmDeleteLoading(true);
    try {
      const res = await apiFetch("/api/v1/user/delete-cancel", {
        method: "POST"
      });
      const data = await res.json();
      if (res.ok) {
        setDeletionScheduled(false);
        setDeletionDueAt(null);
        alert("Your account deletion request has been successfully cancelled.");
      } else {
        alert(data.detail || "Failed to cancel deletion.");
      }
    } catch (err) {
      console.error("Cancel deletion error:", err);
      alert("An error occurred. Please try again.");
    } finally {
      setConfirmDeleteLoading(false);
    }
  };

  const toggleInterest = async (slug: string) => {
    const next = selectedSlugs.includes(slug)
      ? selectedSlugs.filter((s) => s !== slug)
      : [...selectedSlugs, slug];
    setSelectedSlugs(next);
    try {
      await apiFetch("/api/v1/profile", {
        method: "POST",
        body: JSON.stringify({ interest_slugs: next }),
      });
    } catch (err) {
      console.error("Error saving interests:", err);
    }
  };

  const saveNotifPrefs = async (next: typeof notifPrefs) => {
    setNotifPrefs(next);
    try {
      await apiFetch("/api/v1/profile", {
        method: "POST",
        body: JSON.stringify({ notification_prefs: next }),
      });
    } catch (err) {
      console.error("Error saving notification prefs:", err);
    }
  };

  const toggleMaster = async () => {
    if (!notifPrefs.master) {
      const { enablePush } = await import("../utils/push");
      const ok = await enablePush();
      if (!ok) return;
      await saveNotifPrefs({ ...notifPrefs, master: true });
    } else {
      const { disablePush } = await import("../utils/push");
      await disablePush();
      await saveNotifPrefs({ ...notifPrefs, master: false });
    }
  };

  const toggleType = (key: "important" | "reminders" | "digest") =>
    saveNotifPrefs({ ...notifPrefs, [key]: !notifPrefs[key] });

  const handleDeleteAccount = async (accountId: number) => {
    setConfirmDeleteAccountId(accountId);
  };

  const executeDeleteAccount = async () => {
    if (confirmDeleteAccountId === null) return;
    setConfirmDeleteLoading(true);
    try {
      const res = await apiFetch(`/api/v1/accounts/${confirmDeleteAccountId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setConnectedAccounts((prev) => prev.filter((acc) => acc.id !== confirmDeleteAccountId));
        setConfirmDeleteAccountId(null);
      } else {
        const errData = await res.json();
        alert(errData.detail || "Failed to disconnect account.");
      }
    } catch (err) {
      console.error("Error deleting account:", err);
      alert("An error occurred while disconnecting the account.");
    } finally {
      setConfirmDeleteLoading(false);
    }
  };

  const handleConnectIITB = async () => {
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      const res = await apiFetch("/api/v1/accounts/iitb", {
        method: "POST",
        body: JSON.stringify({
          email_address: ldapEmail,
          imap_username: ldapUsername,
          sso_token: ldapPassword,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        // Refresh accounts list
        await fetchAccounts();

        // Trigger initial sync asynchronously (don't block the UI if celery is down)
        try {
          await apiFetch("/api/v1/sync/trigger", { method: "POST" });
        } catch (syncErr) {
          console.warn("Failed to trigger initial sync:", syncErr);
        }

        // Reset inputs and close modal
        setLdapEmail("");
        setLdapUsername("");
        setLdapPassword("");
        setShowConnectModal(false);
      } else {
        setConnectionError(data.detail || "Failed to connect account. Please check your credentials.");
      }
    } catch (err) {
      console.error("Connection error:", err);
      setConnectionError("A network error occurred. Please check if the server is running.");
    } finally {
      setConnectionLoading(false);
    }
  };

  // Most recent sync across connected accounts (for the System group).
  const lastSync = connectedAccounts
    .map((a) => a.last_synced_at)
    .filter(Boolean)
    .sort()
    .pop();

  const modalInput: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    color: "var(--text)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    outline: "none",
    fontSize: 14,
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      <div style={{ paddingTop: "var(--status-bar-pad)" }} className="flex-shrink-0">
        {/* Header */}
        <div className="px-4 pb-4">
          <span style={{ color: "var(--text)", fontSize: 20, fontWeight: 700, display: "block" }}>
            Settings
          </span>
          <span style={{ color: "var(--text-3)", fontSize: 13, marginTop: 2, display: "block" }}>
            Manage your accounts and preferences
          </span>
        </div>
        <div style={{ height: 1, background: "var(--border)", margin: "0 16px 16px" }} />
      </div>

      <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth: "none", paddingBottom: 110 }}>
        {/* ─── Account ─── */}
        <div className="mb-6">
          <span style={sectionLabel} className="block mb-2.5">Account</span>
          <div style={groupCard}>
            {email ? (
              <>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--surface-2, var(--border))", color: "var(--text)", fontSize: 15, fontWeight: 700 }}
                  >
                    {email.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block truncate" style={{ color: "var(--text)", fontSize: 13.5, fontWeight: 500 }}>
                      {email}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <GoogleIcon size={11} />
                      <span style={{ color: "var(--text-3)", fontSize: 11.5 }}>Signed in with Google</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  disabled={loading}
                  className="w-full flex items-center gap-2 px-4 py-3"
                  style={{ borderTop: "1px solid var(--border)", cursor: loading ? "not-allowed" : "pointer" }}
                >
                  <LogOut size={15} color="var(--danger)" strokeWidth={1.9} />
                  <span style={{ color: "var(--danger)", fontSize: 13.5, fontWeight: 500 }}>Sign out</span>
                </button>
              </>
            ) : (
              <div className="px-4 py-5 text-center">
                <span style={{ color: "var(--text-3)", fontSize: 13 }}>No active session found.</span>
              </div>
            )}
          </div>
        </div>

        {/* ─── Connected Accounts ─── */}
        <div className="mb-6">
          <span style={sectionLabel} className="block mb-2.5">Connected Accounts</span>
          <div style={groupCard}>
            {accountsLoading ? (
              <div className="flex items-center justify-center gap-2 py-5 text-[var(--text-3)]">
                <Loader2 className="animate-spin" size={16} />
                <span style={{ fontSize: 12 }}>Loading accounts…</span>
              </div>
            ) : (
              <>
                {connectedAccounts.length === 0 && (
                  <div className="px-4 py-4 text-center" style={rowDivider(false)}>
                    <span style={{ color: "var(--text-3)", fontSize: 13 }}>No connected email accounts.</span>
                  </div>
                )}

                {connectedAccounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-3 px-4 py-3" style={rowDivider(false)}>
                    <Mail size={17} color="var(--text-3)" strokeWidth={1.8} className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="block truncate" style={{ color: "var(--text)", fontSize: 13.5, fontWeight: 500 }}>
                        {account.email_address}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: account.connection_status === "connected" ? "#10b981" : "var(--danger)" }}
                        />
                        <span style={{ color: "var(--text-3)", fontSize: 11.5 }}>
                          {account.last_synced_at ? `Synced ${agoLabel(account.last_synced_at)}` : "Never synced"}
                        </span>
                      </div>
                    </div>
                    <span style={{ color: "var(--text-3)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4 }}>
                      {account.account_type === "iitb_imap" ? "IITB" : "GMAIL"}
                    </span>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDeleteAccount(account.id)}
                      className="p-1 flex-shrink-0"
                      style={{ cursor: "pointer" }}
                    >
                      <Trash2 size={15} color="var(--danger)" strokeWidth={1.8} />
                    </motion.button>
                  </div>
                ))}

                {/* Connect IITB row */}
                <button
                  onClick={() => {
                    setShowConnectModal(true);
                    setConnectionError(null);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3"
                  style={{ ...rowDivider(false), cursor: "pointer" }}
                >
                  <Plus size={17} color="var(--accent)" strokeWidth={2} className="flex-shrink-0" />
                  <span style={{ color: "var(--accent)", fontSize: 13.5, fontWeight: 500 }}>Connect IITB Webmail</span>
                </button>

                {/* Connect Gmail (disabled) */}
                <div className="w-full flex items-center gap-3 px-4 py-3 opacity-45" style={{ cursor: "not-allowed" }}>
                  <Plus size={17} color="var(--text-3)" strokeWidth={2} className="flex-shrink-0" />
                  <span style={{ color: "var(--text-3)", fontSize: 13.5 }}>Connect Gmail</span>
                  <span className="ml-auto" style={{ color: "var(--text-3)", fontSize: 11 }}>Coming soon</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ─── Interests ─── */}
        <div className="mb-6">
          <span style={sectionLabel} className="block mb-2.5">Interests</span>
          <div style={{ ...groupCard, padding: 16 }}>
            <p style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              Pick what you care about. KRNL surfaces matching mail higher and into your Important tab.
            </p>
            <div className="flex flex-wrap gap-2">
              {catalog.map((item) => {
                const active = selectedSlugs.includes(item.slug);
                return (
                  <motion.button
                    key={item.slug}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => toggleInterest(item.slug)}
                    className="px-3.5 py-1.5"
                    style={{
                      borderRadius: 9,
                      background: active ? "var(--accent-weak)" : "transparent",
                      border: active ? "1px solid transparent" : "1px solid var(--border)",
                      color: active ? "var(--accent)" : "var(--text-3)",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {item.label}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── Notifications ─── */}
        {isPushSupported() && (
          <div className="mb-6">
            <span style={sectionLabel} className="block mb-2.5">Notifications</span>
            <div style={groupCard}>
              <button
                onClick={toggleMaster}
                className="w-full flex items-center justify-between px-4 py-3"
                style={rowDivider(!notifPrefs.master)}
              >
                <span style={{ color: "var(--text)", fontSize: 13.5, fontWeight: 500 }}>Push notifications</span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: notifPrefs.master ? "var(--accent)" : "var(--text-3)",
                    background: notifPrefs.master ? "var(--accent-weak)" : "var(--surface-2, var(--border))",
                    borderRadius: 6,
                    padding: "2px 8px",
                  }}
                >
                  {notifPrefs.master ? "On" : "Off"}
                </span>
              </button>
              {notifPrefs.master && (
                <>
                  <button
                    onClick={() => toggleType("important")}
                    className="w-full flex items-center justify-between px-4 py-3"
                    style={rowDivider(false)}
                  >
                    <span style={{ color: "var(--text)", fontSize: 13.5 }}>Important mail</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: notifPrefs.important ? "var(--accent)" : "var(--text-3)",
                        background: notifPrefs.important ? "var(--accent-weak)" : "var(--surface-2, var(--border))",
                        borderRadius: 6,
                        padding: "2px 8px",
                      }}
                    >
                      {notifPrefs.important ? "On" : "Off"}
                    </span>
                  </button>
                  <button
                    onClick={() => toggleType("reminders")}
                    className="w-full flex items-center justify-between px-4 py-3"
                    style={rowDivider(false)}
                  >
                    <span style={{ color: "var(--text)", fontSize: 13.5 }}>Deadline reminders</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: notifPrefs.reminders ? "var(--accent)" : "var(--text-3)",
                        background: notifPrefs.reminders ? "var(--accent-weak)" : "var(--surface-2, var(--border))",
                        borderRadius: 6,
                        padding: "2px 8px",
                      }}
                    >
                      {notifPrefs.reminders ? "On" : "Off"}
                    </span>
                  </button>
                  <button
                    onClick={() => toggleType("digest")}
                    className="w-full flex items-center justify-between px-4 py-3"
                    style={rowDivider(true)}
                  >
                    <span style={{ color: "var(--text)", fontSize: 13.5 }}>Weekly digest</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: notifPrefs.digest ? "var(--accent)" : "var(--text-3)",
                        background: notifPrefs.digest ? "var(--accent-weak)" : "var(--surface-2, var(--border))",
                        borderRadius: 6,
                        padding: "2px 8px",
                      }}
                    >
                      {notifPrefs.digest ? "On" : "Off"}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ─── App (install) ─── */}
        {canInstall && (
          <div className="mb-6">
            <span style={sectionLabel} className="block mb-2.5">App</span>
            <div style={groupCard}>
              <button
                onClick={onInstall}
                className="flex items-center justify-between px-4 py-3 w-full text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Download size={16} style={{ color: "var(--accent)" }} />
                  <span style={{ color: "var(--text)", fontSize: 14 }}>Install KRNL</span>
                </div>
                <span style={{ color: "var(--text-3)", fontSize: 13 }}>Add to home screen</span>
              </button>
            </div>
          </div>
        )}

        {/* ─── System ─── */}
        <div className="mb-6">
          <span style={sectionLabel} className="block mb-2.5">System</span>
          <div style={groupCard}>
            <div className="flex items-center justify-between px-4 py-3" style={rowDivider(false)}>
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>Version</span>
              <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>v0.9.2 beta</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>Last synced</span>
              <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>{agoLabel(lastSync)}</span>
            </div>
          </div>
        </div>

        {/* ─── Danger Zone ─── */}
        <div className="mb-2">
          <span style={{ ...sectionLabel, color: "var(--danger)" }} className="block mb-2.5">
            Danger Zone &amp; Compliance
          </span>

          <div style={{ ...groupCard, padding: 16 }} className="mb-3">
            <p style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              Under GDPR you have the right to portability. Export your profile, events, and connected-account data as a ZIP.
            </p>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleExportData}
              disabled={exporting}
              className="w-full py-3 flex items-center justify-center gap-2"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 10,
                cursor: exporting ? "not-allowed" : "pointer",
              }}
            >
              {exporting ? (
                <>
                  <Loader2 size={14} className="animate-spin" color="var(--text-3)" />
                  <span style={{ color: "var(--text-3)", fontSize: 13 }}>Exporting…</span>
                </>
              ) : (
                <>
                  <Shield size={14} color="var(--text)" strokeWidth={1.9} />
                  <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Export My Data (ZIP)</span>
                </>
              )}
            </motion.button>
          </div>

          <AnimatePresence mode="wait">
            {deletionScheduled ? (
              <motion.div
                key="scheduled"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="px-4 py-4"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12 }}
              >
                <div className="flex gap-2.5 items-start">
                  <AlertTriangle size={18} color="var(--danger)" className="flex-shrink-0 mt-0.5" />
                  <div>
                    <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600, display: "block" }}>
                      Account scheduled for deletion
                    </span>
                    <span style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4, display: "block", lineHeight: 1.4 }}>
                      Your data will be permanently wiped in 24 hours (due {deletionDueAt ? new Date(deletionDueAt).toLocaleString() : ""}). You can cancel anytime below.
                    </span>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleCancelDeletion}
                  disabled={confirmDeleteLoading}
                  className="w-full mt-4 py-2.5 flex items-center justify-center gap-2"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    cursor: confirmDeleteLoading ? "not-allowed" : "pointer",
                  }}
                >
                  <Check size={14} color="#34d399" />
                  <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Cancel deletion request</span>
                </motion.button>
              </motion.div>
            ) : showDangerConfirm ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="px-4 py-4"
                style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12 }}
              >
                <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
                  This schedules your account and all data (emails, credentials, calendar syncs, vectors) for permanent deletion.
                </p>
                <div className="mb-4">
                  <span style={{ color: "var(--text-3)", fontSize: 11, display: "block", marginBottom: 6 }}>
                    Type <strong style={{ color: "var(--danger)" }}>DELETE</strong> to confirm:
                  </span>
                  <input
                    type="text"
                    value={deletionInput}
                    onChange={(e) => setDeletionInput(e.target.value)}
                    placeholder="DELETE"
                    style={{ ...modalInput, fontSize: 14 }}
                  />
                </div>
                <div className="flex gap-2">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      setShowDangerConfirm(false);
                      setDeletionInput("");
                    }}
                    className="flex-1 py-2.5"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      color: "var(--text-3)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={handleRequestDeletion}
                    disabled={deletionInput !== "DELETE" || confirmDeleteLoading}
                    className="flex-1 py-2.5 flex items-center justify-center gap-1.5"
                    style={{
                      background: deletionInput === "DELETE" ? "var(--danger)" : "rgba(239,68,68,0.12)",
                      borderRadius: 10,
                      color: deletionInput === "DELETE" ? "#fff" : "rgba(248,113,113,0.5)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: deletionInput === "DELETE" ? "pointer" : "not-allowed",
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Confirm delete</span>
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="trigger"
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowDangerConfirm(true)}
                className="w-full py-3.5 flex items-center justify-center gap-2"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 12,
                  cursor: "pointer",
                }}
              >
                <Trash2 size={15} color="var(--danger)" strokeWidth={1.9} />
                <span style={{ color: "var(--danger)", fontSize: 13.5, fontWeight: 600 }}>
                  Disconnect account &amp; wipe data
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* IITB Connection Modal */}
      <AnimatePresence>
        {showConnectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.97, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97, y: 12 }}
              className="w-full max-w-md p-6"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16 }}
            >
              <h3 style={{ color: "var(--text)", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                Connect IITB Webmail
              </h3>
              <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 20 }}>
                Link your IIT Bombay LDAP account to sync academic emails.
              </p>

              {connectionError && (
                <div className="mb-4 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs flex gap-2 items-start">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{connectionError}</span>
                </div>
              )}

              <div className="flex flex-col gap-4">
                <div>
                  <label style={{ color: "var(--text)", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    Webmail Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="ldap_username@iitb.ac.in"
                    value={ldapEmail}
                    onChange={(e) => {
                      setLdapEmail(e.target.value);
                      const parts = e.target.value.split("@");
                      if (parts.length > 0 && parts[1] === "iitb.ac.in" && !ldapUsername) {
                        setLdapUsername(parts[0]);
                      }
                    }}
                    style={modalInput}
                  />
                </div>

                <div>
                  <label style={{ color: "var(--text)", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    LDAP Username
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 25b2164"
                    value={ldapUsername}
                    onChange={(e) => setLdapUsername(e.target.value)}
                    style={modalInput}
                  />
                </div>

                <div>
                  <label style={{ color: "var(--text)", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    LDAP Password / Access Token
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={ldapPassword}
                    onChange={(e) => setLdapPassword(e.target.value)}
                    style={modalInput}
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setShowConnectModal(false);
                    setLdapEmail("");
                    setLdapUsername("");
                    setLdapPassword("");
                    setConnectionError(null);
                  }}
                  disabled={connectionLoading}
                  className="flex-1 py-3"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text-3)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: connectionLoading ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleConnectIITB}
                  disabled={connectionLoading || !ldapEmail || !ldapUsername || !ldapPassword}
                  className="flex-1 py-3 flex items-center justify-center gap-2"
                  style={{
                    background: (ldapEmail && ldapUsername && ldapPassword) ? "var(--accent)" : "rgba(59,130,246,0.2)",
                    borderRadius: 10,
                    color: (ldapEmail && ldapUsername && ldapPassword) ? "#fff" : "rgba(255,255,255,0.4)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: (connectionLoading || !ldapEmail || !ldapUsername || !ldapPassword) ? "not-allowed" : "pointer",
                  }}
                >
                  {connectionLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Verifying…</span>
                    </>
                  ) : (
                    <span>Connect</span>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disconnect Confirmation Modal */}
      <AnimatePresence>
        {confirmDeleteAccountId !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.97, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97, y: 12 }}
              className="w-full max-w-sm p-6"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16 }}
            >
              <h3 style={{ color: "var(--danger)", fontSize: 16, fontWeight: 700, marginBottom: 8 }} className="flex items-center gap-2">
                <AlertTriangle size={18} />
                Disconnect account?
              </h3>
              <p style={{ color: "var(--text-3)", fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
                This stops future email syncs for this account.
              </p>

              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setConfirmDeleteAccountId(null)}
                  disabled={confirmDeleteLoading}
                  className="flex-1 py-3"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text-3)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: confirmDeleteLoading ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={executeDeleteAccount}
                  disabled={confirmDeleteLoading}
                  className="flex-1 py-3 flex items-center justify-center gap-2"
                  style={{
                    background: "var(--danger)",
                    borderRadius: 10,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: confirmDeleteLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {confirmDeleteLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Disconnecting…</span>
                    </>
                  ) : (
                    <span>Disconnect</span>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
