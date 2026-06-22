import { useState, useEffect } from "react";
import { Clock, ChevronRight, CheckCircle2, Loader2, ChevronLeft, Calendar as CalendarIcon } from "lucide-react";
import { motion } from "motion/react";
import { apiCall } from "../lib/api";

interface EventItem {
  id: number;
  user_id: string;
  display_name: string;
  deadline: string;
  venue?: string;
  category?: string;
  tags?: string[];
  importance_score: number;
  raw_summary?: string;
  created_at?: string;
  urgency_label?: string;
  deadline_history?: Array<{ old?: string; new?: string }>;
}

const filters = ["Overdue", "This Week", "Later"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DeadlinesScreen() {
  const [activeFilter, setActiveFilter] = useState("This Week");
  const [checked, setChecked] = useState<number[]>([]);
  const [deadlines, setDeadlines] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calendar State
  const [activeView, setActiveView] = useState<"list" | "calendar">("list");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  useEffect(() => {
    async function loadDeadlines() {
      try {
        setLoading(true);
        const data = await apiCall("/api/v1/deadlines");
        setDeadlines(data || []);
        setError(null);
      } catch (err: any) {
        console.error("Failed to load deadlines:", err);
        setError("Offline mode: showing local schedule.");
        // Fallback mock deadlines for premium offline feel
        setDeadlines([
          {
            id: 1,
            user_id: "mock",
            display_name: "HSS 102 Assignment",
            category: "Assignment",
            deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
            urgency_label: "today",
            importance_score: 0.9,
          },
          {
            id: 2,
            user_id: "mock",
            display_name: "CS 213 Lab Submission",
            category: "Lab",
            deadline: new Date(Date.now() + 24 * 3600000).toISOString(),
            urgency_label: "tomorrow",
            importance_score: 0.8,
          },
          {
            id: 3,
            user_id: "mock",
            display_name: "Inter-IIT Registration",
            category: "Event",
            deadline: new Date(Date.now() + 5 * 24 * 3600000).toISOString(),
            urgency_label: "this_week",
            importance_score: 0.5,
          },
          {
            id: 4,
            user_id: "mock",
            display_name: "MA 214 Tutorial Sheet 5",
            category: "Homework",
            deadline: new Date(Date.now() + 6 * 24 * 3600000).toISOString(),
            urgency_label: "this_week",
            importance_score: 0.4,
          },
          {
            id: 5,
            user_id: "mock",
            display_name: "CS 302 Project Milestone",
            category: "Project",
            deadline: new Date(Date.now() + 9 * 24 * 3600000).toISOString(),
            urgency_label: "upcoming",
            importance_score: 0.7,
          },
        ]);
      } finally {
        setLoading(false);
      }
    }

    loadDeadlines();
  }, []);

  const toggleCheck = (id: number) => {
    setChecked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const getCardStyle = (urgency: string, isDone: boolean) => {
    if (isDone) {
      return {
        bgAccent: "rgba(16,185,129,0.05)",
        borderColor: "rgba(16,185,129,0.25)",
        badgeBg: "rgba(16,185,129,0.12)",
        badgeColor: "#10b981",
        dotColor: "#10b981",
      };
    }
    const urg = urgency.toLowerCase();
    if (urg === "today" || urg === "expired") {
      return {
        bgAccent: "rgba(239,68,68,0.06)",
        borderColor: "rgba(239,68,68,0.35)",
        badgeBg: "rgba(239,68,68,0.15)",
        badgeColor: "#f87171",
        dotColor: "#ef4444",
      };
    } else if (urg === "tomorrow") {
      return {
        bgAccent: "rgba(245,158,11,0.06)",
        borderColor: "rgba(245,158,11,0.35)",
        badgeBg: "rgba(245,158,11,0.15)",
        badgeColor: "#fbbf24",
        dotColor: "#f59e0b",
      };
    } else if (urg === "this_week") {
      return {
        bgAccent: "rgba(59,130,246,0.06)",
        borderColor: "rgba(59,130,246,0.35)",
        badgeBg: "rgba(59,130,246,0.15)",
        badgeColor: "#60a5fa",
        dotColor: "#3b82f6",
      };
    } else {
      return {
        bgAccent: "transparent",
        borderColor: "#2d2d34",
        badgeBg: "rgba(141,145,152,0.12)",
        badgeColor: "#8a8f98",
        dotColor: "#8a8f98",
      };
    }
  };

  const formatDueText = (deadlineStr: string, urgency: string) => {
    try {
      const date = new Date(deadlineStr);
      if (urgency.toLowerCase() === "today") {
        return `Due Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      if (urgency.toLowerCase() === "tomorrow") {
        return `Due Tomorrow, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      return `Due ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return `Due ${deadlineStr}`;
    }
  };

  // List View Filter mapping
  const filteredListDeadlines = deadlines.filter((item) => {
    const urg = item.urgency_label?.toLowerCase() || "upcoming";
    if (activeFilter === "Overdue") {
      return urg === "expired";
    }
    if (activeFilter === "This Week") {
      return urg === "today" || urg === "tomorrow" || urg === "this_week";
    }
    return urg === "upcoming";
  });

  const dueThisWeekCount = deadlines.filter((item) => {
    const urg = item.urgency_label?.toLowerCase() || "upcoming";
    return (urg === "today" || urg === "tomorrow" || urg === "this_week") && !checked.includes(item.id);
  }).length;

  // Calendar Helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Generate standard 42-cell calendar grid
  const totalDays = new Date(year, month + 1, 0).getDate();
  const startDayIndex = new Date(year, month, 1).getDay(); // Sunday-based index (0-6)
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  const calendarCells = [];
  // 1. Previous Month Padding
  for (let i = startDayIndex - 1; i >= 0; i--) {
    calendarCells.push({
      day: prevMonthTotalDays - i,
      month: month === 0 ? 11 : month - 1,
      year: month === 0 ? year - 1 : year,
      isPadding: true,
    });
  }
  // 2. Active Month Days
  for (let d = 1; d <= totalDays; d++) {
    calendarCells.push({
      day: d,
      month: month,
      year: year,
      isPadding: false,
    });
  }
  // 3. Next Month Padding
  const remaining = 42 - calendarCells.length;
  for (let d = 1; d <= remaining; d++) {
    calendarCells.push({
      day: d,
      month: month === 11 ? 0 : month + 1,
      year: month === 11 ? year + 1 : year,
      isPadding: true,
    });
  }

  const getDeadlinesForDate = (y: number, m: number, d: number) => {
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return deadlines.filter((item) => item.deadline && item.deadline.startsWith(prefix));
  };

  const getDotColorForDate = (dateDeadlines: EventItem[]) => {
    if (dateDeadlines.length === 0) return null;
    const allDone = dateDeadlines.every((item) => checked.includes(item.id));
    if (allDone) return "#10b981"; // Green

    const hasUrgent = dateDeadlines.some((item) => {
      const label = item.urgency_label?.toLowerCase();
      return label === "today" || label === "tomorrow" || label === "expired";
    });
    if (hasUrgent) return "#ef4444"; // Red

    const hasThisWeek = dateDeadlines.some((item) => item.urgency_label?.toLowerCase() === "this_week");
    if (hasThisWeek) return "#f59e0b"; // Yellow
    return "#3b82f6"; // Blue
  };

  const selectedDateDeadlines = getDeadlinesForDate(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate()
  );

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: "#08090a" }}>
      <div style={{ paddingTop: 48 }} className="flex-shrink-0">
        {/* Header */}
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-0.5">
            <span style={{ color: "#f7f8f8", fontSize: 22, fontWeight: 700 }}>
              Deadlines
            </span>

            {/* Toggle View Control */}
            <div className="flex p-0.5 rounded-lg bg-[#1c1c21] border border-[#2d2d34] flex-shrink-0">
              <button
                onClick={() => setActiveView("list")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeView === "list" ? "bg-[#6366f1] text-white" : "text-[#8a8f98]"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setActiveView("calendar")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeView === "calendar" ? "bg-[#6366f1] text-white" : "text-[#8a8f98]"
                }`}
              >
                Calendar
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span style={{ color: "#8a8f98", fontSize: 13 }}>
              Stay ahead of your schedule
            </span>
            {dueThisWeekCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-0.5"
                style={{
                  background: "rgba(99,102,241,0.12)",
                  borderRadius: 20,
                  border: "1px solid rgba(99,102,241,0.25)",
                }}
              >
                <Clock size={10} color="#818cf8" strokeWidth={2} />
                <span style={{ color: "#818cf8", fontSize: 10, fontWeight: 600 }}>
                  {dueThisWeekCount} due this week
                </span>
              </div>
            )}
          </div>
        </div>

        {/* List Filters (only shown in list view) */}
        {activeView === "list" && (
          <div className="flex gap-2 px-4 pb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {filters.map((f) => {
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
                  {f}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs text-center flex-shrink-0">
          {error}
        </div>
      )}

      {/* Main Screen Content */}
      <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth: "none", paddingBottom: 110 }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#8a8f98]">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-xs">Fetching deadline logs...</span>
          </div>
        ) : activeView === "list" ? (
          /* TIMELINE LIST VIEW */
          <div className="relative">
            {filteredListDeadlines.length > 0 && (
              <div
                className="absolute left-[19px] top-4 bottom-4 w-px"
                style={{ background: "linear-gradient(to bottom, #2d2d34, transparent)" }}
              />
            )}

            <div className="flex flex-col gap-3">
              {filteredListDeadlines.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8a8f98] gap-1">
                  <span className="text-sm font-semibold">Clean Slate!</span>
                  <span className="text-xs opacity-0.7">No deadlines in this range.</span>
                </div>
              ) : (
                filteredListDeadlines.map((item, i) => {
                  const isDone = checked.includes(item.id);
                  const style = getCardStyle(item.urgency_label || "upcoming", isDone);
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.3 }}
                      className="flex gap-3 items-start"
                    >
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center flex-shrink-0 pt-3.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full z-10"
                          style={{
                            background: style.dotColor,
                            boxShadow: isDone
                              ? "0 0 8px rgba(16,185,129,0.5)"
                              : item.urgency_label === "today" || item.urgency_label === "expired"
                              ? "0 0 8px rgba(239,68,68,0.5)"
                              : "none",
                          }}
                        />
                      </div>

                      {/* Card */}
                      <div
                        className="flex-1 flex items-center justify-between px-4 py-3.5"
                        style={{
                          background: style.bgAccent || "#1c1c21",
                          border: `1px solid ${style.borderColor}`,
                          borderRadius: 16,
                          opacity: isDone ? 0.7 : 1,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              style={{
                                color: isDone ? "#8a8f98" : "#f7f8f8",
                                fontSize: 14,
                                fontWeight: 600,
                                textDecoration: isDone ? "line-through" : "none",
                              }}
                              className="truncate"
                            >
                              {item.display_name}
                            </span>
                            {item.deadline_history && item.deadline_history.length > 0 && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 10,
                                  color: "#fbbf24",
                                  background: "rgba(245,158,11,0.15)",
                                  borderRadius: 4,
                                  padding: "1px 6px",
                                }}
                              >
                                Deadline extended
                              </span>
                            )}
                            <span
                              className="px-2 py-0.5 flex-shrink-0"
                              style={{
                                background: style.badgeBg,
                                color: style.badgeColor,
                                fontSize: 10,
                                fontWeight: 700,
                                borderRadius: 8,
                              }}
                            >
                              {isDone ? "Done" : item.urgency_label}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Clock size={10} color="#8a8f98" strokeWidth={2} />
                            <span style={{ color: "#8a8f98", fontSize: 12 }}>
                              {isDone ? "Completed" : formatDueText(item.deadline, item.urgency_label || "upcoming")}
                            </span>
                          </div>
                          {item.category && (
                            <span
                              className="mt-1.5 inline-block px-2 py-0.5"
                              style={{
                                background: "#2d2d34",
                                color: "#8a8f98",
                                fontSize: 10,
                                borderRadius: 6,
                              }}
                            >
                              {item.category}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 ml-3">
                          <motion.button
                            whileTap={{ scale: 0.88 }}
                            onClick={() => toggleCheck(item.id)}
                            className="flex items-center justify-center w-7 h-7 rounded-full"
                            style={{
                              background: isDone ? "rgba(16,185,129,0.15)" : "rgba(45,45,52,0.8)",
                              border: `1.5px solid ${isDone ? "#10b981" : "#2d2d34"}`,
                            }}
                          >
                            <CheckCircle2
                              size={14}
                              color={isDone ? "#10b981" : "#8a8f98"}
                              strokeWidth={2}
                            />
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* MONTHLY GRID CALENDAR VIEW */
          <div className="flex flex-col gap-4">
            {/* Calendar Month Header */}
            <div className="flex items-center justify-between px-2 py-1 bg-[#1c1c21] border border-[#2d2d34] rounded-2xl">
              <button
                onClick={prevMonth}
                className="p-2 rounded-xl bg-transparent hover:bg-[#2d2d34] text-[#8a8f98] active:scale-95 transition-all"
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ color: "#f7f8f8", fontSize: 14, fontWeight: 700 }}>
                {monthNames[month]} {year}
              </span>
              <button
                onClick={nextMonth}
                className="p-2 rounded-xl bg-transparent hover:bg-[#2d2d34] text-[#8a8f98] active:scale-95 transition-all"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="bg-[#1c1c21] border border-[#2d2d34] rounded-2xl p-3 flex flex-col gap-2">
              {/* Weekday Names Header */}
              <div className="grid grid-cols-7 text-center border-b border-[#2d2d34] pb-2">
                {weekdays.map((wd) => (
                  <span key={wd} style={{ color: "#8a8f98", fontSize: 10, fontWeight: 600 }}>
                    {wd}
                  </span>
                ))}
              </div>

              {/* Day cells grid */}
              <div className="grid grid-cols-7 gap-y-2.5 gap-x-1.5 text-center">
                {calendarCells.map((cell, idx) => {
                  const dateDeadlines = getDeadlinesForDate(cell.year, cell.month, cell.day);
                  const dotColor = getDotColorForDate(dateDeadlines);
                  const isSelected =
                    selectedDate.getDate() === cell.day &&
                    selectedDate.getMonth() === cell.month &&
                    selectedDate.getFullYear() === cell.year;

                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedDate(new Date(cell.year, cell.month, cell.day))}
                      className="flex flex-col items-center justify-center py-1.5 cursor-pointer relative rounded-xl transition-all"
                      style={{
                        background: isSelected ? "#6366f1" : "transparent",
                        opacity: cell.isPadding ? 0.3 : 1,
                      }}
                    >
                      <span
                        style={{
                          color: isSelected ? "white" : "#f7f8f8",
                          fontSize: 12,
                          fontWeight: isSelected ? 700 : 500,
                        }}
                      >
                        {cell.day}
                      </span>

                      {/* Small Indicator Dot */}
                      <div className="h-1 w-1 rounded-full mt-1.5" style={{ background: dotColor || "transparent" }} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected Date Header details */}
            <div className="flex items-center gap-2 mt-2 px-1">
              <CalendarIcon size={14} color="#818cf8" />
              <span style={{ color: "#f7f8f8", fontSize: 13, fontWeight: 600 }}>
                Due on {selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>

            {/* List of cards due on selected date */}
            <div className="flex flex-col gap-2">
              {selectedDateDeadlines.length === 0 ? (
                <div className="py-8 text-center bg-[#1c1c21]/40 border border-dashed border-[#2d2d34] rounded-2xl">
                  <span style={{ color: "#8a8f98", fontSize: 12 }}>No deadlines due on this day.</span>
                </div>
              ) : (
                selectedDateDeadlines.map((item) => {
                  const isDone = checked.includes(item.id);
                  const style = getCardStyle(item.urgency_label || "upcoming", isDone);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-4 py-3 bg-[#1c1c21] border rounded-2xl"
                      style={{
                        borderColor: style.borderColor,
                        opacity: isDone ? 0.7 : 1,
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            style={{
                              color: isDone ? "#8a8f98" : "#f7f8f8",
                              fontSize: 13,
                              fontWeight: 600,
                              textDecoration: isDone ? "line-through" : "none",
                            }}
                            className="truncate"
                          >
                            {item.display_name}
                          </span>
                          <span
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded"
                            style={{
                              background: style.badgeBg,
                              color: style.badgeColor,
                            }}
                          >
                            {isDone ? "Done" : item.urgency_label}
                          </span>
                        </div>
                        <span style={{ color: "#8a8f98", fontSize: 11 }}>
                          {isDone ? "Completed" : formatDueText(item.deadline, item.urgency_label || "upcoming")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <motion.button
                          whileTap={{ scale: 0.88 }}
                          onClick={() => toggleCheck(item.id)}
                          className="flex items-center justify-center w-6.5 h-6.5 rounded-full"
                          style={{
                            background: isDone ? "rgba(16,185,129,0.15)" : "rgba(45,45,52,0.8)",
                            border: `1.5px solid ${isDone ? "#10b981" : "#2d2d34"}`,
                          }}
                        >
                          <CheckCircle2
                            size={12}
                            color={isDone ? "#10b981" : "#8a8f98"}
                            strokeWidth={2}
                          />
                        </motion.button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
