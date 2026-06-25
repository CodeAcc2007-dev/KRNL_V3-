import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  AlertCircle,
  Tag,
  ExternalLink,
  Clock,
  Loader2,
  Link2,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiCall } from "../lib/api";

interface EventDetail {
  id: number;
  user_id: string;
  display_name: string;
  deadline?: string;
  venue?: string;
  category?: string;
  tags?: string[];
  importance_score: number;
  raw_summary?: string;
  full_body?: string;
  raw_body?: string;
  links?: string[];
  has_registration?: boolean;
  registration_link?: string;
  created_at?: string;
  updated_at?: string;
  personalized_priority?: number;
  urgency_label?: string;
}

interface EmailDetailScreenProps {
  eventId: number;
  /** Quick-load preview data passed from the list */
  previewData?: {
    display_name: string;
    raw_summary?: string;
    category?: string;
    importance_score: number;
    personalized_priority?: number;
    deadline?: string;
    created_at?: string;
  };
  onBack: () => void;
}

const priorityConfig = {
  High: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)" },
  Med: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
  Low: { color: "#8a8f98", bg: "rgba(138,143,152,0.08)", border: "rgba(138,143,152,0.15)" },
};

const urgencyConfig: Record<string, { label: string; color: string; bg: string }> = {
  expired: { label: "Expired", color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
  today: { label: "Today", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  tomorrow: { label: "Tomorrow", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  this_week: { label: "This Week", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  upcoming: { label: "Upcoming", color: "#8a8f98", bg: "rgba(138,143,152,0.08)" },
};

export function EmailDetailScreen({ eventId, previewData, onBack }: EmailDetailScreenProps) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  useEffect(() => {
    async function fetchDetail() {
      try {
        setLoading(true);
        const data = await apiCall(`/api/v1/events/${eventId}`);
        setEvent(data);
        setError(null);
      } catch (err: any) {
        console.error("Failed to load event detail:", err);
        setError("Failed to load details.");
        // Build fallback from preview data
        if (previewData) {
          setEvent({
            id: eventId,
            user_id: "",
            display_name: previewData.display_name,
            raw_summary: previewData.raw_summary,
            category: previewData.category,
            importance_score: previewData.importance_score,
            personalized_priority: previewData.personalized_priority,
            deadline: previewData.deadline,
            created_at: previewData.created_at,
          });
        }
      } finally {
        setLoading(false);
      }
    }

    fetchDetail();
  }, [eventId]);

  const getPriorityLabel = (score?: number) => {
    if (score === undefined) return "Low";
    if (score >= 70) return "High";
    if (score >= 40) return "Med";
    return "Low";
  };

  const formatFullDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-IN", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const formatRelativeTime = (dateStr?: string) => {
    if (!dateStr) return "";
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return `${Math.floor(diffDays / 7)}w ago`;
    } catch {
      return "";
    }
  };

  const getDomainFromUrl = (url: string) => {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return url.substring(0, 30);
    }
  };

  // Use preview data while loading full detail
  const displayEvent = event || (previewData
    ? {
        id: eventId,
        user_id: "",
        display_name: previewData.display_name,
        raw_summary: previewData.raw_summary,
        category: previewData.category,
        importance_score: previewData.importance_score,
        personalized_priority: previewData.personalized_priority,
        deadline: previewData.deadline,
        created_at: previewData.created_at,
      }
    : null);

  const pLabel = getPriorityLabel(displayEvent?.personalized_priority);
  const pConfig = priorityConfig[pLabel as keyof typeof priorityConfig];

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0.5 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 350, damping: 35, mass: 0.8 }}
      className="absolute inset-0 flex flex-col z-30"
      style={{ background: "#08090a" }}
    >
      {/* Header */}
      <div style={{ paddingTop: 48 }}>
        <div className="flex items-center gap-3 px-4 pb-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: "#1c1c21", border: "1px solid #2d2d34" }}
          >
            <ArrowLeft size={18} color="#f7f8f8" strokeWidth={1.8} />
          </motion.button>

          <div className="flex-1 min-w-0">
            <span
              className="block truncate"
              style={{ color: "#f7f8f8", fontSize: 15, fontWeight: 600 }}
            >
              {displayEvent?.display_name || "Loading..."}
            </span>
            {displayEvent?.created_at && (
              <span style={{ color: "#8a8f98", fontSize: 11 }}>
                {formatRelativeTime(displayEvent.created_at)}
              </span>
            )}
          </div>

          {/* Priority badge in header */}
          {displayEvent && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1"
              style={{
                background: pConfig.bg,
                border: `1px solid ${pConfig.border}`,
                borderRadius: 10,
              }}
            >
              <AlertCircle size={12} color={pConfig.color} strokeWidth={2} />
              <span style={{ color: pConfig.color, fontSize: 11, fontWeight: 600 }}>
                {pLabel}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-4 flex flex-col gap-4"
        style={{ scrollbarWidth: "none", paddingBottom: 110 }}
      >
        {/* Error toast */}
        {error && (
          <div className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs text-center">
            {error}
          </div>
        )}

        {/* Loading skeleton or content */}
        {loading && !previewData ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#8a8f98]">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-xs">Loading details...</span>
          </div>
        ) : displayEvent ? (
          <>
            {/* ─── Sender Avatar Card ─── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.3 }}
              className="flex items-center gap-3 p-4"
              style={{
                background: "#1c1c21",
                border: "1px solid #2d2d34",
                borderRadius: 16,
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 rounded-full"
                style={{
                  width: 46,
                  height: 46,
                  background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
                  color: "white",
                  fontSize: 18,
                  fontWeight: 700,
                  boxShadow: "0 4px 16px rgba(99,102,241,0.3)",
                }}
              >
                {displayEvent.display_name?.charAt(0).toUpperCase() || "E"}
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className="block truncate"
                  style={{ color: "#f7f8f8", fontSize: 15, fontWeight: 600 }}
                >
                  {displayEvent.display_name}
                </span>
                <span style={{ color: "#8a8f98", fontSize: 11 }}>
                  {formatFullDate(displayEvent.created_at)}
                </span>
              </div>
            </motion.div>

            {/* ─── Metadata Chips Grid ─── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="grid grid-cols-2 gap-2"
            >
              {/* Deadline */}
              {displayEvent.deadline && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5"
                  style={{
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 12,
                  }}
                >
                  <Calendar size={14} color="#ef4444" strokeWidth={1.8} />
                  <div className="flex flex-col">
                    <span style={{ color: "#8a8f98", fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Deadline
                    </span>
                    <span style={{ color: "#f7f8f8", fontSize: 12, fontWeight: 500 }}>
                      {formatFullDate(displayEvent.deadline).split(",").slice(0, 2).join(",")}
                    </span>
                  </div>
                </div>
              )}

              {/* Venue */}
              {displayEvent.venue && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5"
                  style={{
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 12,
                  }}
                >
                  <MapPin size={14} color="#3b82f6" strokeWidth={1.8} />
                  <div className="flex flex-col">
                    <span style={{ color: "#8a8f98", fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Venue
                    </span>
                    <span
                      className="truncate"
                      style={{ color: "#f7f8f8", fontSize: 12, fontWeight: 500, maxWidth: 120 }}
                    >
                      {displayEvent.venue}
                    </span>
                  </div>
                </div>
              )}

              {/* Category */}
              {displayEvent.category && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5"
                  style={{
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 12,
                  }}
                >
                  <Tag size={14} color="#a78bfa" strokeWidth={1.8} />
                  <div className="flex flex-col">
                    <span style={{ color: "#8a8f98", fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Category
                    </span>
                    <span style={{ color: "#f7f8f8", fontSize: 12, fontWeight: 500 }}>
                      {displayEvent.category}
                    </span>
                  </div>
                </div>
              )}

              {/* Urgency */}
              {displayEvent.urgency_label && displayEvent.urgency_label !== "upcoming" && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5"
                  style={{
                    background: "#1c1c21",
                    border: "1px solid #2d2d34",
                    borderRadius: 12,
                  }}
                >
                  <Clock size={14} color={urgencyConfig[displayEvent.urgency_label]?.color || "#8a8f98"} strokeWidth={1.8} />
                  <div className="flex flex-col">
                    <span style={{ color: "#8a8f98", fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Urgency
                    </span>
                    <span
                      style={{
                        color: urgencyConfig[displayEvent.urgency_label]?.color || "#f7f8f8",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {urgencyConfig[displayEvent.urgency_label]?.label || displayEvent.urgency_label}
                    </span>
                  </div>
                </div>
              )}
            </motion.div>

            {/* ─── Tags ─── */}
            {displayEvent.tags && displayEvent.tags.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="flex flex-wrap gap-1.5"
              >
                {displayEvent.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1"
                    style={{
                      background: "rgba(99,102,241,0.1)",
                      border: "1px solid rgba(99,102,241,0.2)",
                      borderRadius: 8,
                      color: "#818cf8",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </motion.div>
            )}

            {/* ─── AI Summary Card ─── */}
            {displayEvent.raw_summary && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.3 }}
                className="p-4"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.04) 100%)",
                  border: "1px solid rgba(99,102,241,0.15)",
                  borderRadius: 16,
                }}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <Sparkles size={13} color="#818cf8" strokeWidth={2} />
                  <span
                    style={{
                      color: "#818cf8",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    AI Summary
                  </span>
                </div>
                <p
                  style={{
                    color: "#e4e5e7",
                    fontSize: 13,
                    lineHeight: 1.65,
                    fontWeight: 400,
                  }}
                >
                  {displayEvent.raw_summary}
                </p>
              </motion.div>
            )}

            {/* ─── Full Email Body (collapsible) ─── */}
            {(displayEvent.full_body || displayEvent.raw_body) && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.3 }}
                style={{
                  background: "#1c1c21",
                  border: "1px solid #2d2d34",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setBodyExpanded((v) => !v)}
                  className="w-full flex items-center justify-between p-4"
                  style={{ background: "transparent", cursor: "pointer" }}
                >
                  <span
                    style={{
                      color: "#8a8f98",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Full Message
                  </span>
                  <motion.div
                    animate={{ rotate: bodyExpanded ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronRight size={16} color="#8a8f98" strokeWidth={2} />
                  </motion.div>
                </button>
                <AnimatePresence initial={false}>
                  {bodyExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div
                        className="px-4 pb-4"
                        style={{
                          color: "#c8cad0",
                          fontSize: 13,
                          lineHeight: 1.7,
                          fontWeight: 400,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {displayEvent.full_body || displayEvent.raw_body}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ─── Registration CTA ─── */}
            {displayEvent.has_registration && displayEvent.registration_link && (
              <motion.a
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                href={displayEvent.registration_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-4 py-3.5"
                style={{
                  background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
                  borderRadius: 14,
                  textDecoration: "none",
                  boxShadow: "0 4px 20px rgba(99,102,241,0.3)",
                }}
                whileTap={{ scale: 0.97 }}
              >
                <div className="flex items-center gap-2.5">
                  <ExternalLink size={16} color="white" strokeWidth={1.8} />
                  <span style={{ color: "white", fontSize: 14, fontWeight: 600 }}>
                    Register Now
                  </span>
                </div>
                <ChevronRight size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />
              </motion.a>
            )}

            {/* ─── Extracted Links ─── */}
            {displayEvent.links && displayEvent.links.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.3 }}
                className="flex flex-col gap-2"
              >
                <span
                  className="px-1"
                  style={{
                    color: "#8a8f98",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  Links
                </span>
                {displayEvent.links.map((link, idx) => (
                  <a
                    key={idx}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2.5"
                    style={{
                      background: "#1c1c21",
                      border: "1px solid #2d2d34",
                      borderRadius: 12,
                      textDecoration: "none",
                    }}
                  >
                    <Link2 size={13} color="#3b82f6" strokeWidth={1.8} />
                    <span
                      className="truncate flex-1"
                      style={{ color: "#3b82f6", fontSize: 12, fontWeight: 500 }}
                    >
                      {getDomainFromUrl(link)}
                    </span>
                    <ExternalLink size={11} color="#8a8f98" strokeWidth={1.8} />
                  </a>
                ))}
              </motion.div>
            )}

            {/* ─── Timestamps Footer ─── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="flex flex-col gap-1 pt-2 pb-4"
              style={{ borderTop: "1px solid #2d2d34" }}
            >
              {displayEvent.created_at && (
                <span style={{ color: "#555960", fontSize: 10 }}>
                  Received: {formatFullDate(displayEvent.created_at)}
                </span>
              )}
              {displayEvent.updated_at && (
                <span style={{ color: "#555960", fontSize: 10 }}>
                  Updated: {formatFullDate(displayEvent.updated_at)}
                </span>
              )}
            </motion.div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-[#8a8f98] gap-2">
            <span style={{ fontSize: 13, fontWeight: 500 }}>Event not found</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>This email may have been removed.</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
