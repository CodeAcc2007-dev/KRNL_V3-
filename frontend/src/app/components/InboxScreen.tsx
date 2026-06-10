import { useState, useEffect } from "react";
import { Menu, Calendar, AlertCircle, Tag, Star, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { apiCall } from "../lib/api";

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
        const eventsData = await apiCall("/api/v1/events");
        setEvents(eventsData || []);
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
        (ev.importance_score && ev.importance_score >= 0.7) ||
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
          <button
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: "#1c1c21", border: "1px solid #2d2d34" }}
          >
            <Menu size={18} color="#8a8f98" strokeWidth={1.8} />
          </button>

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
    </div>
  );
}
