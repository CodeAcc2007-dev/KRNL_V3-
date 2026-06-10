import { useState, useEffect } from "react";
import { Plus, RefreshCw, Mail, ChevronRight, AlertTriangle, Info, Shield, Check, LogOut, Trash2 } from "lucide-react";
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
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setEmail(session.user.email || null);
        checkDeletionStatus();
      } else {
        setEmail(null);
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


  return (
    <div className="flex flex-col h-full" style={{ background: "#08090a" }}>
      <div style={{ paddingTop: 48 }} className="flex-shrink-0">
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

          {/* Connected Account */}
          <div
            className="flex items-center gap-3 px-4 py-3.5 mb-2"
            style={{
              background: "#1c1c21",
              border: "1px solid #2d2d34",
              borderRadius: 16,
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}
            >
              <Mail size={18} color="#10b981" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <span
                className="block truncate"
                style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 600 }}
              >
                ldap_username@iitb.ac.in
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "#10b981", boxShadow: "0 0 5px #10b981" }}
                />
                <RefreshCw size={10} color="#10b981" strokeWidth={2} />
                <span style={{ color: "#10b981", fontSize: 11 }}>Synced 2m ago</span>
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
                <span style={{ color: "#10b981", fontSize: 10, fontWeight: 700 }}>IITB</span>
              </div>
              <ChevronRight size={14} color="#2d2d34" strokeWidth={2} />
            </div>
          </div>

          {/* Add Gmail */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2.5 py-4"
            style={{
              background: "transparent",
              border: "1.5px dashed #2d2d34",
              borderRadius: 16,
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: "#1c1c21", border: "1px solid #2d2d34" }}
            >
              <Plus size={14} color="#8a8f98" strokeWidth={2} />
            </div>
            <span style={{ color: "#8a8f98", fontSize: 13 }}>Add Gmail Account</span>
          </motion.button>
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
    </div>
  );
}
