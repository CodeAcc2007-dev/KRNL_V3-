import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  AlertCircle,
  ExternalLink,
  Loader2,
  ChevronRight,
  Globe,
  FileText,
  ClipboardList,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiCall } from "../lib/api";

/** Monotone WhatsApp glyph (lucide has no brand logos). */
function WhatsAppIcon({ size = 15, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} className="flex-shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.546 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.892-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/** Classify a link by URL so we can show a recognisable monotone icon + label. */
function classifyLink(url: string): "whatsapp" | "form" | "doc" | "web" {
  const u = url.toLowerCase();
  if (u.includes("wa.me") || u.includes("whatsapp")) return "whatsapp";
  if (u.includes("forms.gle") || u.includes("docs.google.com/forms") || u.includes("typeform") || u.includes("/forms/")) return "form";
  if (u.includes("docs.google.com") || u.includes("drive.google.com")) return "doc";
  return "web";
}

function LinkTypeIcon({ url }: { url: string }) {
  switch (classifyLink(url)) {
    case "whatsapp": return <WhatsAppIcon size={16} color="#25d366" />;
    case "form": return <ClipboardList size={15} color="#a78bfa" strokeWidth={1.9} />;
    case "doc": return <FileText size={15} color="#60a5fa" strokeWidth={1.9} />;
    default: return <Globe size={15} color="var(--accent)" strokeWidth={1.9} />;
  }
}

/** Color-coding per category so the UI isn't monochrome. */
function categoryStyle(cat?: string): { color: string; bg: string } {
  switch ((cat || "").toLowerCase()) {
    case "academic": return { color: "#60a5fa", bg: "rgba(59,130,246,0.14)" };
    case "career": return { color: "#4ade80", bg: "rgba(34,197,94,0.14)" };
    case "cultural": return { color: "#f472b6", bg: "rgba(236,72,153,0.14)" };
    case "technical": return { color: "#22d3ee", bg: "rgba(6,182,212,0.14)" };
    case "security": return { color: "#fbbf24", bg: "rgba(245,158,11,0.14)" };
    default: return { color: "var(--text-2)", bg: "rgba(255,255,255,0.06)" };
  }
}

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
  /** Slide-in direction: "right" (default, page-style) or "up" (sheet-style). */
  direction?: "right" | "up";
}

const priorityConfig = {
  High: { color: "var(--danger)", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)" },
  Med: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
  Low: { color: "var(--text-3)", bg: "rgba(138,143,152,0.08)", border: "rgba(138,143,152,0.15)" },
};

export function EmailDetailScreen({ eventId, previewData, onBack, direction = "right" }: EmailDetailScreenProps) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  // Make the device/browser Back button close this detail (return to the list)
  // instead of navigating away from the app. Opening pushes a history entry;
  // Back pops it and we close the overlay.
  useEffect(() => {
    window.history.pushState({ krnlDetail: true }, "");
    const handlePop = () => onBack();
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // A bare date ("YYYY-MM-DD") has no real time — show date only. Rendering
      // it via new Date() would parse it as UTC midnight and show a phantom
      // 5:30 AM (the IST offset). Timestamps that carry a time render with it.
      const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
      const hasTime = !!(m && m[4] !== undefined && !(m[4] === "00" && m[5] === "00"));
      if (m && !hasTime) {
        const dateOnly = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return dateOnly.toLocaleDateString("en-IN", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
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

  const slide =
    direction === "up"
      ? { initial: { y: "100%", opacity: 0.5 }, animate: { y: 0, opacity: 1 }, exit: { y: "100%", opacity: 0 } }
      : { initial: { x: "100%", opacity: 0.5 }, animate: { x: 0, opacity: 1 }, exit: { x: "100%", opacity: 0 } };

  return (
    <motion.div
      initial={slide.initial}
      animate={slide.animate}
      exit={slide.exit}
      transition={{ type: "spring", stiffness: 350, damping: 35, mass: 0.8 }}
      className="absolute inset-0 flex flex-col z-30"
      style={{ background: "var(--bg)" }}
    >
      {/* Header */}
      <div style={{ paddingTop: "var(--status-bar-pad)" }}>
        <div className="flex items-center justify-between px-4 pb-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => window.history.back()}
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            <ArrowLeft size={18} color="var(--text)" strokeWidth={1.8} />
          </motion.button>

          {/* Priority badge */}
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
        className="flex-1 min-h-0 overflow-y-auto px-4 flex flex-col gap-4"
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
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--text-3)]">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-xs">Loading details...</span>
          </div>
        ) : displayEvent ? (
          <>
            {/* ─── Title ─── */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.3 }}
            >
              <h1 style={{ color: "var(--text)", fontSize: 21, fontWeight: 700, lineHeight: 1.32, letterSpacing: "-0.01em" }}>
                {displayEvent.display_name}
              </h1>
              <div className="flex items-center flex-wrap gap-2 mt-2.5">
                <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                  {formatFullDate(displayEvent.created_at)}
                </span>
                {displayEvent.category && (
                  <span
                    className="px-2 py-0.5"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      color: categoryStyle(displayEvent.category).color,
                      background: categoryStyle(displayEvent.category).bg,
                    }}
                  >
                    {displayEvent.category}
                  </span>
                )}
              </div>
            </motion.div>

            {/* ─── Key facts (deadline / venue) ─── */}
            {(displayEvent.deadline || displayEvent.venue) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.3 }}
                className="flex flex-col gap-3 items-start"
              >
                {displayEvent.deadline && (
                  <div className="flex items-center gap-2.5">
                    <Calendar size={16} color="var(--danger)" strokeWidth={1.9} className="flex-shrink-0" />
                    <span style={{ color: "var(--danger)", fontSize: 13.5, fontWeight: 600, lineHeight: 1 }}>
                      {formatFullDate(displayEvent.deadline)}
                    </span>
                  </div>
                )}
                {displayEvent.venue && (
                  <div className="flex items-center gap-2.5">
                    <MapPin size={16} color="var(--text-3)" strokeWidth={1.8} className="flex-shrink-0" />
                    <span style={{ color: "var(--text-2)", fontSize: 13.5, lineHeight: 1 }}>{displayEvent.venue}</span>
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── Tags (quiet) ─── */}
            {displayEvent.tags && displayEvent.tags.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="flex flex-wrap gap-x-3 gap-y-1"
              >
                {displayEvent.tags.map((tag, idx) => (
                  <span key={idx} style={{ color: "var(--text-3)", fontSize: 11.5 }}>
                    #{tag}
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
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span
                    style={{
                      color: "var(--text-3)",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Summary
                  </span>
                </div>
                <p
                  style={{
                    color: "var(--text-2)",
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
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setBodyExpanded((v) => !v)}
                  className="w-full flex items-center justify-between p-4"
                  style={{ background: "transparent", cursor: "pointer" }}
                >
                  <span
                    style={{
                      color: "var(--text-3)",
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
                    <ChevronRight size={16} color="var(--text-3)" strokeWidth={2} />
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
                          color: "var(--text-2)",
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
                    color: "var(--text-3)",
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
                    className="flex items-center gap-3 px-3 py-2.5"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      textDecoration: "none",
                    }}
                  >
                    <LinkTypeIcon url={link} />
                    <span
                      className="truncate flex-1"
                      style={{ color: "var(--text-2)", fontSize: 12.5, fontWeight: 500 }}
                    >
                      {getDomainFromUrl(link)}
                    </span>
                    <ExternalLink size={12} color="var(--text-3)" strokeWidth={1.8} />
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
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {displayEvent.created_at && (
                <span style={{ color: "var(--text-3)", fontSize: 10 }}>
                  Received: {formatFullDate(displayEvent.created_at)}
                </span>
              )}
              {displayEvent.updated_at && (
                <span style={{ color: "var(--text-3)", fontSize: 10 }}>
                  Updated: {formatFullDate(displayEvent.updated_at)}
                </span>
              )}
            </motion.div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-2">
            <span style={{ fontSize: 13, fontWeight: 500 }}>Event not found</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>This email may have been removed.</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
