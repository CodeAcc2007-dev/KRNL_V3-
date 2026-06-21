import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Calendar, AlertCircle, Tag, Star, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiCall } from "../lib/api";
import { EmailDetailScreen } from "./EmailDetailScreen";

interface InboxScreenProps {
  onOpenSettings: () => void;
}

interface EventItem {
  id: number;
  user_id: string;
  display_name: string;
  deadline?: string;
  venue?: string;
  category?: string;
  tags?: string[];
  importance_score: number;
  raw_summary?: string;
  created_at?: string;
  personalized_priority?: number;
}

const priorityColor = {
  High: "#ef4444",
  Med: "#f59e0b",
  Low: "#8a8f98",
};

export function InboxScreen({ onOpenSettings }: InboxScreenProps) {
  // FUTURE_PROOF_HOOK: Custom Tab Configuration
  const [inboxTabs, setInboxTabs] = useState<string[]>([
    "Important",
    "Opportunities",
    "Announcement",
    "Academic",
  ]);
  const [activeFilter, setActiveFilter] = useState("Important");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Refetch the prioritized events list (reused by initial load and Sync Now)
  const refreshEvents = useCallback(async () => {
    const eventsData = await apiCall("/api/v1/events");
    setEvents(eventsData || []);
  }, []);

  // Trigger a sync, poll for completion if queued, then refresh the inbox
  const handleSyncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await apiCall("/api/v1/sync/trigger", { method: "POST" });

      // If the backend ran synchronously (no Celery), it's already done.
      if (res?.status === "triggered" && res?.task_id) {
        // Poll task status up to ~2.5 min (sync throttles ~13s/email).
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const st = await apiCall(`/api/v1/sync/status/${res.task_id}`);
            if (st?.status === "SUCCESS" || st?.status === "FAILURE") break;
          } catch {
            // status endpoint hiccup — keep waiting
          }
        }
      }

      await refreshEvents();
      setSyncMsg("Inbox synced");
    } catch (err: any) {
      console.error("Sync failed:", err);
      setSyncMsg("Sync failed — try again");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 3000);
    }
  }, [syncing, refreshEvents]);

  useEffect(() => {
    async function loadInboxData() {
      try {
        setLoading(true);
        // 1. Fetch user's profile to get custom tabs configuration
        const profileData = await apiCall("/api/v1/profile");
        if (profileData && profileData.inbox_tabs) {
          setInboxTabs(profileData.inbox_tabs);
          // Set first tab as active if the current active tab is not in the list
          if (!profileData.inbox_tabs.includes(activeFilter)) {
            setActiveFilter(profileData.inbox_tabs[0] || "Important");
          }
        }

        // 2. Fetch user's prioritized events
        await refreshEvents();
        setError(null);
      } catch (err: any) {
        console.error("Failed to load inbox data:", err);
        setError("Failed to sync inbox. Showing offline mode.");
        // Fallback mock events for premium feel during network errors
        setEvents([
          {
            id: 1,
            user_id: "mock",
            display_name: "CS 302: Quiz 1 Rescheduled",
            deadline: "2026-06-12 18:00:00",
            category: "Academic",
            importance_score: 0.9,
            personalized_priority: 90,
            raw_summary: "Rescheduled to Friday, October 12th — room change to LT 101",
            created_at: new Date().toISOString(),
          },
          {
            id: 2,
            user_id: "mock",
            display_name: "Prof. Sharma: Extension",
            deadline: "2026-06-15 23:59:00",
            category: "Academic",
            importance_score: 0.7,
            personalized_priority: 70,
            raw_summary: "Project milestone 2 submission extended by 48 hours due to lab maintenance",
            created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
          },
          {
            id: 3,
            user_id: "mock",
            display_name: "Career Cell IITB",
            deadline: "2026-06-14 12:00:00",
            category: "Opportunities",
            importance_score: 0.85,
            personalized_priority: 85,
            raw_summary: "Goldman Sachs internship applications closing — 3 slots left",
            created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    }

    loadInboxData();
  }, []);

  const getPriorityLabel = (score?: number) => {
    if (score === undefined) return "Low";
    if (score >= 70) return "High";
    if (score >= 40) return "Med";
    return "Low";
  };

  const formatDeadline = (deadlineStr?: string) => {
    if (!deadlineStr) return "—";
    try {
      const date = new Date(deadlineStr);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[date.getMonth()]} ${date.getDate()}`;
    } catch {
      return deadlineStr;
    }
  };

  const getTimeLabel = (createdAt?: string) => {
    if (!createdAt) return "1d";
    try {
      const diffMs = new Date().getTime() - new Date(createdAt).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 60) return `${diffMins}m`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h`;
      return `${Math.floor(diffHours / 24)}d`;
    } catch {
      return "1d";
    }
  };

  // FUTURE_PROOF_HOOK: Custom Tab Configuration
  const filteredEvents = events.filter((ev) => {
    const tabLower = activeFilter.toLowerCase();
    if (tabLower === "important") {
      // Show high importance or high priority items
      return (
        (ev.personalized_priority && ev.personalized_priority >= 70) ||
        (ev.category && ev.category.toLowerCase() === "important")
      );
    }
    // Filter match by category name
    return ev.category && ev.category.toLowerCase() === tabLower;
  });

  // Sort by personalized_priority descending (handled by API, but reinforced on client)
  const sortedEvents = [...filteredEvents].sort(
    (a, b) => (b.personalized_priority || 0) - (a.personalized_priority || 0)
  );

  return (
    <div className="flex flex-col h-full" style={{ background: "#08090a" }}>
      {/* Safe area top */}
      <div style={{ paddingTop: 48 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSyncNow}
            disabled={syncing}
            title="Sync now"
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{
              background: "#1c1c21",
              border: "1px solid #2d2d34",
              cursor: syncing ? "default" : "pointer",
            }}
          >
            <RefreshCw
              size={18}
              color={syncing ? "#6366f1" : "#8a8f98"}
              strokeWidth={1.8}
              className={syncing ? "animate-spin" : ""}
            />
          </motion.button>

          <span
            className="tracking-[0.2em] uppercase"
            style={{ color: "#f7f8f8", fontSize: 17, fontWeight: 700, letterSpacing: "0.18em" }}
          >
            KRNL
          </span>

          <button onClick={onOpenSettings} className="relative">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-full"
              style={{ background: "#6366f1", fontWeight: 700, color: "white", fontSize: 15 }}
            >
              R
            </div>
            <div
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full"
              style={{ background: "#10b981", border: "2px solid #08090a" }}
            />
          </button>
        </div>

        {/* Sync status toast */}
        <AnimatePresence>
          {(syncing || syncMsg) && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-2 mx-4 mb-3 px-3 py-2"
              style={{
                background: "#1c1c21",
                border: "1px solid #2d2d34",
                borderRadius: 12,
              }}
            >
              {syncing ? (
                <Loader2 size={13} color="#6366f1" className="animate-spin" />
              ) : (
                <RefreshCw size={13} color="#10b981" strokeWidth={2} />
              )}
              <span style={{ color: "#8a8f98", fontSize: 12 }}>
                {syncing ? "Syncing your inbox…" : syncMsg}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter Pills */}
        <div className="flex gap-2 px-4 pb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {inboxTabs.map((f) => {
            const active = f === activeFilter;
            return (
              <motion.button
                key={f}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActiveFilter(f)}
                className="flex items-center gap-1.5 whitespace-nowrap px-4 py-1.5 flex-shrink-0"
                style={{
                  borderRadius: 24,
                  background: active ? "rgba(99,102,241,0.18)" : "transparent",
                  border: active ? "1px solid rgba(99,102,241,0.4)" : "1px solid #2d2d34",
                  color: active ? "#f7f8f8" : "#8a8f98",
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {active && <Star size={11} fill="#f7f8f8" color="#f7f8f8" />}
                {f}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Error alert toast */}
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs text-center">
          {error}
        </div>
      )}

      {/* Email List */}
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-2" style={{ scrollbarWidth: "none", paddingBottom: 110 }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#8a8f98]">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-xs">Synchronizing feeds...</span>
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#8a8f98] gap-2">
            <span style={{ fontSize: 13, fontWeight: 500 }}>All caught up!</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>No events found in this category.</span>
          </div>
        ) : (
          sortedEvents.map((email, i) => {
            const pLabel = getPriorityLabel(email.personalized_priority);
            return (
              <motion.div
                key={email.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.3 }}
                className="flex items-center gap-3 px-3 py-3.5 cursor-pointer"
                onClick={() => setSelectedEventId(email.id)}
                whileTap={{ scale: 0.98 }}
                style={{
                  background: "#1c1c21",
                  border: "1px solid #2d2d34",
                  borderRadius: 16,
                }}
              >
                {/* Avatar */}
                <div
                  className="flex items-center justify-center flex-shrink-0 rounded-full"
                  style={{
                    width: 40,
                    height: 40,
                    background: "#6366f1",
                    color: "white",
                    fontSize: 15,
                    fontWeight: 700,
                  }}
                >
                  {email.display_name ? email.display_name.charAt(0).toUpperCase() : "E"}
                </div>

                {/* Text Stack */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="truncate"
                      style={{
                        color: "#f7f8f8",
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      {email.display_name}
                    </span>
                  </div>
                  <span
                    className="block truncate mt-0.5"
                    style={{ color: "#8a8f98", fontSize: 12, lineHeight: 1.4 }}
                  >
                    {email.raw_summary}
                  </span>
                </div>

                {/* Metadata icon group */}
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {/* Time */}
                  <span style={{ color: "#8a8f98", fontSize: 10 }}>{getTimeLabel(email.created_at)}</span>

                  {/* Deadline chip */}
                  {email.deadline && (
                    <div
                      className="flex items-center gap-1 px-1.5 py-0.5"
                      style={{
                        background: "rgba(239,68,68,0.1)",
                        borderRadius: 6,
                        border: "1px solid rgba(239,68,68,0.2)",
                      }}
                    >
                      <Calendar size={9} color="#ef4444" strokeWidth={2} />
                      <span style={{ color: "#ef4444", fontSize: 9, fontWeight: 600 }}>
                        {formatDeadline(email.deadline)}
                      </span>
                    </div>
                  )}

                  {/* Priority */}
                  <div className="flex items-center gap-1">
                    <AlertCircle
                      size={10}
                      color={priorityColor[pLabel as keyof typeof priorityColor]}
                      strokeWidth={2}
                    />
                    <span
                      style={{
                        color: priorityColor[pLabel as keyof typeof priorityColor],
                        fontSize: 9,
                        fontWeight: 600,
                      }}
                    >
                      {pLabel}
                    </span>
                  </div>

                  {/* Category */}
                  {email.category && (
                    <div className="flex items-center gap-1">
                      <Tag size={9} color="#8a8f98" strokeWidth={2} />
                      <span style={{ color: "#8a8f98", fontSize: 9 }}>{email.category}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Email Detail Overlay */}
      <AnimatePresence>
        {selectedEventId !== null && (() => {
          const selectedEvent = events.find((e) => e.id === selectedEventId);
          return (
            <EmailDetailScreen
              eventId={selectedEventId}
              previewData={
                selectedEvent
                  ? {
                      display_name: selectedEvent.display_name,
                      raw_summary: selectedEvent.raw_summary,
                      category: selectedEvent.category,
                      importance_score: selectedEvent.importance_score,
                      personalized_priority: selectedEvent.personalized_priority,
                      deadline: selectedEvent.deadline,
                      created_at: selectedEvent.created_at,
                    }
                  : undefined
              }
              onBack={() => setSelectedEventId(null)}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
