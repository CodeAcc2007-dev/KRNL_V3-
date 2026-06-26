import { useState, useRef, useEffect } from "react";
import { Send, Wifi, ExternalLink, X, Clock, MapPin, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiCall } from "../lib/api";

interface Message {
  id: number;
  role: "user" | "ai";
  content: string;
  citations?: Citation[];
}

interface Citation {
  id: number;
  label: string;
  event_id: number;
}

interface AskKrnlScreenProps {
  onOpenEventDetail?: (eventId: number) => void;
}

const initialMessages: Message[] = [
  {
    id: 1,
    role: "ai",
    content:
      "Hi! I'm **KRNL** — ask me anything about your synced emails and deadlines.\n\nFor example: *\"What deadlines do I have this week?\"* or *\"Any internship opportunities?\"*",
  },
];

function renderAIText(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*|¹|²|³|⁴|⁵)/g);
    return (
      <p key={i} style={{ margin: "2px 0", fontSize: 14, lineHeight: 1.6 }}>
        {parts.map((part, j) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={j} style={{ color: "var(--text)", fontWeight: 600 }}>
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (["¹", "²", "³", "⁴", "⁵"].includes(part)) {
            const num = part === "¹" ? 1 : part === "²" ? 2 : part === "³" ? 3 : part === "⁴" ? 4 : 5;
            return (
              <sup
                key={j}
                style={{
                  color: "var(--accent)",
                  fontSize: 10,
                  fontWeight: 700,
                  verticalAlign: "super",
                }}
              >
                [{num}]
              </sup>
            );
          }
          return <span key={j}>{part}</span>;
        })}
      </p>
    );
  });
}

export function AskKrnlScreen({ onOpenEventDetail }: AskKrnlScreenProps = {}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Event Detail Drawer State
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [eventDetail, setEventDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text) return;

    const userMsg: Message = { id: Date.now(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsTyping(true);

    try {
      const data = await apiCall("/api/v1/query", {
        method: "POST",
        body: JSON.stringify({ query: text }),
      });

      const aiMsg: Message = {
        id: Date.now() + 1,
        role: "ai",
        content: data.answer,
        citations: data.citations || [],
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error("AI query failed:", err);
      const aiMsg: Message = {
        id: Date.now() + 1,
        role: "ai",
        content: "Sorry, I had trouble contacting KRNL AI engine. Please verify that the backend and AI services are running correctly.",
        citations: [],
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCitationClick = async (c: Citation) => {
    if (onOpenEventDetail) {
      onOpenEventDetail(c.event_id);
    }

    // Load full details in the bottom sliding drawer
    setActiveEventId(c.event_id);
    setDetailLoading(true);
    setDetailError(null);
    setEventDetail(null);

    try {
      const data = await apiCall(`/api/v1/events/${c.event_id}`);
      setEventDetail(data);
    } catch (err) {
      console.error("Failed to fetch event detail:", err);
      setDetailError("Failed to fetch complete event details from the server.");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <div style={{ paddingTop: "var(--status-bar-pad)" }} className="flex-shrink-0">
        <div className="px-4 pb-3 flex items-center justify-between">
          <div>
            <span
              style={{ color: "var(--text)", fontSize: 20, fontWeight: 700, display: "block" }}
            >
              Ask KRNL
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }}
              />
              <Wifi size={11} color="#10b981" strokeWidth={2} />
              <span style={{ color: "#10b981", fontSize: 11, fontWeight: 500 }}>
                Connected to imap.iitb.ac.in
              </span>
            </div>
          </div>
          <div
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{
              background: "rgba(59,130,246,0.12)",
              border: "1px solid rgba(59,130,246,0.25)",
            }}
          >
            <span style={{ color: "var(--accent)", fontSize: 15, fontWeight: 700 }}>K</span>
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "0 16px" }} />
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
        style={{ scrollbarWidth: "none" }}
      >
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              {msg.role === "user" ? (
                <div
                  className="max-w-[80%] px-4 py-2.5"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "18px 18px 4px 18px",
                    color: "var(--text)",
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[90%] flex gap-2.5">
                  {/* AI avatar */}
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
                    style={{
                      background: "linear-gradient(135deg, var(--accent) 0%, var(--accent) 100%)",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "white",
                    }}
                  >
                    K
                  </div>
                  <div>
                    <div
                      className="px-4 py-3"
                      style={{
                        background: "rgba(28,28,33,0.8)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px 18px 18px 18px",
                        color: "#c8cdd6",
                      }}
                    >
                      {renderAIText(msg.content)}
                    </div>

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {msg.citations.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => handleCitationClick(c)}
                            className="flex items-center gap-1 px-2.5 py-1 cursor-pointer hover:bg-rgba(59,130,246,0.2) active:scale-95 transition-all"
                            style={{
                              background: "rgba(59,130,246,0.1)",
                              border: "1px solid rgba(59,130,246,0.3)",
                              borderRadius: 8,
                            }}
                          >
                            <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700 }}>
                              [{c.id}]
                            </span>
                            <span style={{ color: "var(--accent)", fontSize: 11 }}>{c.label}</span>
                            <ExternalLink size={9} color="var(--accent)" strokeWidth={2} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex gap-2.5 items-start"
            >
              <div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent))" }}
              >
                <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>K</span>
              </div>
              <div
                className="px-4 py-3 flex items-center gap-1"
                style={{
                  background: "rgba(28,28,33,0.8)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px 18px 18px 18px",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--text-3)" }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* Input Box */}
      <div
        className="flex-shrink-0 px-4 pb-1"
        style={{ paddingBottom: 110 }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 28,
          }}
        >
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search or ask about your emails..."
            className="flex-1 bg-transparent outline-none text-[var(--text)] text-sm"
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSend}
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
            style={{
              background: inputValue.trim()
                ? "linear-gradient(135deg, var(--accent), var(--accent))"
                : "rgba(45,45,52,0.8)",
            }}
          >
            <Send
              size={14}
              color={inputValue.trim() ? "white" : "var(--text-3)"}
              strokeWidth={2}
            />
          </motion.button>
        </div>
      </div>

      {/* Bottom sliding detailed drawer */}
      <AnimatePresence>
        {activeEventId !== null && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveEventId(null)}
              className="absolute inset-0 bg-black z-40"
            />

            {/* Sliding Content Drawer */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 z-50 rounded-t-3xl border-t border-[var(--border)] flex flex-col p-5 pb-8"
              style={{
                background: "#121215",
                maxHeight: "75%",
              }}
            >
              {/* Drag Handle indicator */}
              <div className="w-12 h-1 bg-[var(--border)] rounded-full mx-auto mb-4" />

              {/* Close Button */}
              <button
                onClick={() => setActiveEventId(null)}
                className="absolute top-4 right-4 p-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-3)] hover:text-white"
              >
                <X size={16} />
              </button>

              {/* Detail Content */}
              <div className="overflow-y-auto flex-1 flex flex-col gap-4 mt-2 pr-1" style={{ scrollbarWidth: "none" }}>
                {detailLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--text-3)]">
                    <Loader2 className="animate-spin" size={24} />
                    <span className="text-xs">Loading event details...</span>
                  </div>
                ) : detailError ? (
                  <div className="py-8 text-center text-red-400 text-xs">
                    {detailError}
                  </div>
                ) : eventDetail ? (
                  <>
                    <div>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                        {eventDetail.category || "General"}
                      </span>
                      <h3 className="text-lg font-bold text-[var(--text)] mt-1.5 leading-tight">
                        {eventDetail.display_name}
                      </h3>
                    </div>

                    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-[var(--surface)] border border-[var(--border)]">
                      {eventDetail.deadline && (
                        <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                          <Clock size={12} className="text-[var(--accent)]" />
                          <span>Due: {new Date(eventDetail.deadline).toLocaleString()}</span>
                        </div>
                      )}
                      {eventDetail.venue && (
                        <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                          <MapPin size={12} className="text-[#10b981]" />
                          <span>Venue: {eventDetail.venue}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-[var(--text-3)]">CONTEXT / SUMMARY</span>
                      <p className="text-sm text-[#c8cdd6] leading-relaxed whitespace-pre-wrap">
                        {eventDetail.full_body || eventDetail.raw_summary || "No description provided."}
                      </p>
                    </div>

                    {eventDetail.links && eventDetail.links.length > 0 && (
                      <div className="flex flex-col gap-2 mt-2">
                        <span className="text-xs font-semibold text-[var(--text-3)]">ACTION LINKS</span>
                        <div className="flex flex-col gap-1.5">
                          {eventDetail.links.map((link: string, idx: number) => (
                            <a
                              key={idx}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
                            >
                              <ExternalLink size={11} />
                              <span className="truncate">{link}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
