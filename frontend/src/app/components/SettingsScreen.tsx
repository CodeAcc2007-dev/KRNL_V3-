import { useState, useEffect } from "react";
import { Plus, RefreshCw, Mail, ChevronRight, AlertTriangle, Info, Shield, Check, LogOut, Trash2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "../utils/supabase";
import { apiFetch } from "../utils/api";

const tracks = ["Software", "Quant", "Research", "Core", "Design", "Finance"];

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

export function SettingsScreen() {
  const [selectedTracks, setSelectedTracks] = useState<string[]>(["Software", "Research"]);
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const toggleTrack = (track: string) => {
    setSelectedTracks((prev) =>
      prev.includes(track) ? prev.filter((t) => t !== track) : [...prev, track]
    );
  };

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


  return (
    <div className="flex flex-col h-full" style={{ background: "#08090a" }}>
      <div style={{ paddingTop: "var(--status-bar-pad)" }} className="flex-shrink-0">
        {/* Header */}
        <div className="px-4 pb-4">
          <span style={{ color: "#f7f8f8", fontSize: 20, fontWeight: 700, display: "block" }}>
            Settings & Connections
          </span>
          <span style={{ color: "#8a8f98", fontSize: 13, marginTop: 2, display: "block" }}>
            Manage your accounts and preferences
          </span>
        </div>
        <div style={{ height: 1, background: "#2d2d34", margin: "0 16px 16px" }} />
      </div>

      <div
        className="flex-1 overflow-y-auto px-4"
        style={{ scrollbarWidth: "none", paddingBottom: 110 }}
      >
        {/* Google Sign-In Block */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <GoogleIcon size={13} />
            <span style={{ color: "#8a8f98", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Google Account
            </span>
          </div>

          <AnimatePresence mode="wait">
            {email ? (
              <motion.div
                key="signed-in"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="flex items-center gap-3 px-4 py-3.5"
                style={{
                  background: "rgba(66,133,244,0.07)",
                  border: "1px solid rgba(66,133,244,0.25)",
                  borderRadius: 16,
                }}
              >
                {/* Google avatar placeholder */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg, #22c55e, #15803d)",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "white",
                  }}
                >
                  {email.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <span
                    className="block truncate"
                    style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 600 }}
                  >
                    {email}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Check size={10} color="#22c55e" strokeWidth={2.5} />
                    <span style={{ color: "#22c55e", fontSize: 11 }}>Signed in with Google</span>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSignOut}
                  disabled={loading}
                  className="px-3 py-2 flex items-center gap-1.5"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    borderRadius: 8,
                    cursor: "pointer"
                  }}
                >
                  <LogOut size={12} color="#f87171" />
                  <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700 }}>SIGN OUT</span>
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                key="signed-out"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-center px-4 py-6"
                style={{
                  background: "#1c1c21",
                  border: "1px solid #2d2d34",
                  borderRadius: 16,
                }}
              >
                <span style={{ color: "#8a8f98", fontSize: 13 }}>No active session found.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Block 1: Connections */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={13} color="#8a8f98" strokeWidth={2} />
            <span style={{ color: "#8a8f98", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Connected Accounts
            </span>
          </div>

          {accountsLoading ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-[#8a8f98]">
              <Loader2 className="animate-spin" size={20} />
              <span style={{ fontSize: 11 }}>Loading accounts...</span>
            </div>
          ) : connectedAccounts.length === 0 ? (
            <div
              className="flex items-center justify-center px-4 py-6 mb-3"
              style={{
                background: "#1c1c21",
                border: "1px dashed #2d2d34",
                borderRadius: 16,
              }}
            >
              <span style={{ color: "#8a8f98", fontSize: 13 }}>No connected email accounts.</span>
            </div>
          ) : (
            connectedAccounts.map((account) => {
              const lastSyncedText = account.last_synced_at
                ? (() => {
                    try {
                      const diffMs = new Date().getTime() - new Date(account.last_synced_at).getTime();
                      const diffMins = Math.floor(diffMs / 60000);
                      if (diffMins < 60) return `Synced ${diffMins}m ago`;
                      const diffHours = Math.floor(diffMins / 60);
                      if (diffHours < 24) return `Synced ${diffHours}h ago`;
                      return `Synced ${Math.floor(diffHours / 24)}d ago`;
                    } catch {
                      return "Never synced";
                    }
                  })()
                : "Never synced";

              return (
                <div
                  key={account.id}
                  className="flex items-center gap-3 px-4 py-3.5 mb-2"
                  style={{
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 16,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    <Mail size={18} color="#10b981" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className="block truncate"
                      style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 600 }}
                    >
                      {account.email_address}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: account.connection_status === "connected" ? "#10b981" : "#ef4444",
                          boxShadow:
                            account.connection_status === "connected"
                              ? "0 0 5px #10b981"
                              : "0 0 5px #ef4444",
                        }}
                      />
                      <RefreshCw size={10} color="#10b981" strokeWidth={2} />
                      <span style={{ color: "#10b981", fontSize: 11 }}>{lastSyncedText}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="px-2.5 py-1"
                      style={{
                        background: "rgba(16,185,129,0.1)",
                        border: "1px solid rgba(16,185,129,0.25)",
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ color: "#10b981", fontSize: 10, fontWeight: 700 }}>
                        {account.account_type === "iitb_imap" ? "IITB" : "GMAIL"}
                      </span>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDeleteAccount(account.id)}
                      className="p-1 rounded hover:bg-red-500/10 transition-colors"
                      style={{ cursor: "pointer" }}
                    >
                      <Trash2 size={14} color="#f87171" />
                    </motion.button>
                  </div>
                </div>
              );
            })
          )}

          <div className="flex flex-col gap-2 mt-3">
            {/* Add IITB Webmail */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setShowConnectModal(true);
                setConnectionError(null);
              }}
              className="w-full flex items-center justify-center gap-2.5 py-4"
              style={{
                background: "transparent",
                border: "1.5px dashed #2d2d34",
                borderRadius: 16,
                cursor: "pointer",
              }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "#1c1c21", border: "1px solid #2d2d34" }}
              >
                <Plus size={14} color="#8a8f98" strokeWidth={2} />
              </div>
              <span style={{ color: "#8a8f98", fontSize: 13 }}>Connect IITB Webmail</span>
            </motion.button>

            {/* Add Gmail (disabled) */}
            <div
              className="w-full flex items-center justify-center gap-2.5 py-4 opacity-50"
              style={{
                background: "transparent",
                border: "1.5px dashed #2d2d34",
                borderRadius: 16,
                cursor: "not-allowed",
              }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "#1c1c21", border: "1px solid #2d2d34" }}
              >
                <Plus size={14} color="#8a8f98" strokeWidth={2} />
              </div>
              <span style={{ color: "#8a8f98", fontSize: 13 }}>Connect Gmail (Coming Soon)</span>
            </div>
          </div>
        </div>

        {/* Block 2: Career Track Preferences */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Info size={13} color="#8a8f98" strokeWidth={2} />
            <span style={{ color: "#8a8f98", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Career Track
            </span>
          </div>

          <div
            className="px-4 py-4"
            style={{
              background: "#1c1c21",
              border: "1px solid #2d2d34",
              borderRadius: 16,
            }}
          >
            <p style={{ color: "#8a8f98", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              KRNL surfaces relevant opportunities and filters emails based on your selected tracks.
            </p>
            <div className="flex flex-wrap gap-2">
              {tracks.map((track) => {
                const active = selectedTracks.includes(track);
                return (
                  <motion.button
                    key={track}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => toggleTrack(track)}
                    className="px-4 py-1.5"
                    style={{
                      borderRadius: 24,
                      background: active ? "rgba(99,102,241,0.18)" : "transparent",
                      border: active ? "1px solid rgba(99,102,241,0.5)" : "1px solid #2d2d34",
                      color: active ? "#818cf8" : "#8a8f98",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {track}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Block 3: System Details */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Info size={13} color="#8a8f98" strokeWidth={2} />
            <span style={{ color: "#8a8f98", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              System
            </span>
          </div>

          <div
            className="px-4 py-4"
            style={{
              background: "#1c1c21",
              border: "1px solid #2d2d34",
              borderRadius: 16,
            }}
          >
            {[
              { label: "Version", value: "KRNL v0.9.2 beta" },
              { label: "Sync frequency", value: "Every 5 minutes" },
              { label: "AI Model", value: "claude-sonnet-4-6" },
              { label: "Data stored", value: "On-device only" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between py-2.5"
                style={{ borderBottom: "1px solid #2d2d34" }}
              >
                <span style={{ color: "#8a8f98", fontSize: 13 }}>{item.label}</span>
                <span style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 500 }}>{item.value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-2.5">
              <span style={{ color: "#8a8f98", fontSize: 13 }}>Last full sync</span>
              <span style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 500 }}>Just now</span>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={13} color="#ef4444" strokeWidth={2} />
            <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Danger Zone & Compliance
            </span>
          </div>

          <div
            className="px-4 py-4 mb-3"
            style={{
              background: "#1c1c21",
              border: "1px solid #2d2d34",
              borderRadius: 16,
            }}
          >
            <p style={{ color: "#8a8f98", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              Under GDPR, you have the right to portability. Export all your user profile, events, and connected accounts data in a structured ZIP.
            </p>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleExportData}
              disabled={exporting}
              className="w-full py-3 flex items-center justify-center gap-2"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid #2d2d34",
                borderRadius: 12,
                cursor: exporting ? "not-allowed" : "pointer"
              }}
            >
              {exporting ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "1.5px solid rgba(255,255,255,0.2)",
                      borderTopColor: "#ffffff",
                    }}
                  />
                  <span style={{ color: "#8a8f98", fontSize: 13 }}>Exporting...</span>
                </>
              ) : (
                <>
                  <Shield size={14} color="#f7f8f8" />
                  <span style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 600 }}>Export My Data (ZIP)</span>
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
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 16,
                }}
              >
                <div className="flex gap-2.5 items-start">
                  <AlertTriangle size={18} color="#f87171" className="flex-shrink-0 mt-0.5" />
                  <div>
                    <span style={{ color: "#f87171", fontSize: 13, fontWeight: 600, display: "block" }}>
                      Account Scheduled for Deletion
                    </span>
                    <span style={{ color: "#8a8f98", fontSize: 12, marginTop: 4, display: "block", lineHeight: 1.4 }}>
                      Your account data will be permanently wiped in 24 hours (due at {deletionDueAt ? new Date(deletionDueAt).toLocaleString() : ""}). You can cancel this anytime by clicking below.
                    </span>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleCancelDeletion}
                  disabled={confirmDeleteLoading}
                  className="w-full mt-4 py-2.5 flex items-center justify-center gap-2"
                  style={{
                    background: "rgba(16,185,129,0.12)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    borderRadius: 10,
                    cursor: confirmDeleteLoading ? "not-allowed" : "pointer"
                  }}
                >
                  <Check size={14} color="#34d399" />
                  <span style={{ color: "#34d399", fontSize: 13, fontWeight: 600 }}>Cancel Deletion Request</span>
                </motion.button>
              </motion.div>
            ) : showDangerConfirm ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="px-4 py-4"
                style={{
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 16,
                }}
              >
                <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
                  This will schedule your account and all data (emails, connected credentials, calendar syncs, vectors) for permanent deletion.
                </p>
                <div className="mb-4">
                  <span style={{ color: "#8a8f98", fontSize: 11, display: "block", marginBottom: 6 }}>
                    Type <strong style={{ color: "#ef4444" }}>DELETE</strong> to confirm:
                  </span>
                  <input
                    type="text"
                    value={deletionInput}
                    onChange={(e) => setDeletionInput(e.target.value)}
                    placeholder="DELETE"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      color: "#ffffff",
                      background: "#0e0f11",
                      border: "1px solid #2d2d34",
                      borderRadius: 8,
                      outline: "none",
                      fontSize: 14,
                    }}
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
                      background: "#1c1c21",
                      border: "1px solid #2d2d34",
                      borderRadius: 10,
                      color: "#8a8f98",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer"
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
                      background: deletionInput === "DELETE" ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.05)",
                      border: deletionInput === "DELETE" ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(239,68,68,0.15)",
                      borderRadius: 10,
                      color: deletionInput === "DELETE" ? "#f87171" : "rgba(248,113,113,0.4)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: deletionInput === "DELETE" ? "pointer" : "not-allowed"
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Confirm Delete</span>
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="trigger"
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowDangerConfirm(true)}
                className="w-full py-4 flex items-center justify-center gap-2.5"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: 16,
                  cursor: "pointer"
                }}
              >
                <Trash2 size={16} color="#f87171" strokeWidth={2} />
                <span style={{ color: "#f87171", fontSize: 14, fontWeight: 600 }}>
                  Disconnect Account & Wipe Data
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
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-md p-6 overflow-hidden text-left align-middle transition-all transform shadow-xl"
              style={{
                background: "#0e0f11",
                border: "1px solid #2d2d34",
                borderRadius: 24,
              }}
            >
              <h3 style={{ color: "#f7f8f8", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                Connect IITB Webmail
              </h3>
              <p style={{ color: "#8a8f98", fontSize: 13, marginBottom: 20 }}>
                Link your IIT Bombay LDAP account to sync academic emails.
              </p>

              {connectionError && (
                <div
                  className="mb-4 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs flex gap-2 items-start"
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{connectionError}</span>
                </div>
              )}

              <div className="flex flex-col gap-4">
                <div>
                  <label style={{ color: "#f7f8f8", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    Webmail Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="ldap_username@iitb.ac.in"
                    value={ldapEmail}
                    onChange={(e) => {
                      setLdapEmail(e.target.value);
                      // Auto-fill username if email has @iitb.ac.in
                      const parts = e.target.value.split("@");
                      if (parts.length > 0 && parts[1] === "iitb.ac.in" && !ldapUsername) {
                        setLdapUsername(parts[0]);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      color: "#ffffff",
                      background: "#1c1c21",
                      border: "1px solid #2d2d34",
                      borderRadius: 12,
                      outline: "none",
                      fontSize: 14,
                    }}
                  />
                </div>

                <div>
                  <label style={{ color: "#f7f8f8", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    LDAP Username
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 25b2164"
                    value={ldapUsername}
                    onChange={(e) => setLdapUsername(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      color: "#ffffff",
                      background: "#1c1c21",
                      border: "1px solid #2d2d34",
                      borderRadius: 12,
                      outline: "none",
                      fontSize: 14,
                    }}
                  />
                </div>

                <div>
                  <label style={{ color: "#f7f8f8", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    LDAP Password / Access Token
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={ldapPassword}
                    onChange={(e) => setLdapPassword(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      color: "#ffffff",
                      background: "#1c1c21",
                      border: "1px solid #2d2d34",
                      borderRadius: 12,
                      outline: "none",
                      fontSize: 14,
                    }}
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
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 12,
                    color: "#8a8f98",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: connectionLoading ? "not-allowed" : "pointer"
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
                    background: (ldapEmail && ldapUsername && ldapPassword) ? "#6366f1" : "rgba(99,102,241,0.2)",
                    borderRadius: 12,
                    color: (ldapEmail && ldapUsername && ldapPassword) ? "#ffffff" : "rgba(255,255,255,0.4)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: (connectionLoading || !ldapEmail || !ldapUsername || !ldapPassword) ? "not-allowed" : "pointer"
                  }}
                >
                  {connectionLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Verifying...</span>
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

      {/* Custom Disconnect Confirmation Modal */}
      <AnimatePresence>
        {confirmDeleteAccountId !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-sm p-6 overflow-hidden text-left align-middle transition-all transform shadow-xl"
              style={{
                background: "#0e0f11",
                border: "1px solid #2d2d34",
                borderRadius: 24,
              }}
            >
              <h3 style={{ color: "#f87171", fontSize: 16, fontWeight: 700, marginBottom: 8 }} className="flex items-center gap-2">
                <AlertTriangle size={18} />
                Disconnect Account?
              </h3>
              <p style={{ color: "#8a8f98", fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
                Are you sure you want to disconnect this email account? This will stop future email syncs.
              </p>

              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setConfirmDeleteAccountId(null)}
                  disabled={confirmDeleteLoading}
                  className="flex-1 py-3"
                  style={{
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 12,
                    color: "#8a8f98",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: confirmDeleteLoading ? "not-allowed" : "pointer"
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
                    background: "rgba(239,68,68,0.15)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    borderRadius: 12,
                    color: "#f87171",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: confirmDeleteLoading ? "not-allowed" : "pointer"
                  }}
                >
                  {confirmDeleteLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Disconnecting...</span>
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
