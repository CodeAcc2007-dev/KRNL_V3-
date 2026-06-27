import { useState, useRef, useEffect } from "react";
import { Send, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiCall } from "../lib/api";
import { EmailDetailScreen } from "./EmailDetailScreen";

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

// Tappable starters shown on the empty state — each sends a real query.
const suggestions = [
  "What's due this week?",
  "Any internship opportunities?",
  "What's due today?",
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Tapped citation → full event detail (the shared, already-designed screen).
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const sendQuery = async (raw: string) => {
    const text = raw.trim();
    if (!text || isTyping) return;

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
      console.error("Query failed:", err);
      const aiMsg: Message = {
        id: Date.now() + 1,
        role: "ai",
        content: "Couldn't reach KRNL just now — check your connection and try again.",
        citations: [],
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = () => sendQuery(inputValue);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCitationClick = (c: Citation) => {
    onOpenEventDetail?.(c.event_id);
    setActiveCitation(c);
  };

  return (
    <div className="flex flex-col h-full relative" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <div style={{ paddingTop: "var(--status-bar-pad)" }} className="flex-shrink-0">
        <div className="px-4 pb-3">
          <span style={{ color: "var(--text)", fontSize: 20, fontWeight: 700, display: "block" }}>
            Ask KRNL
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981" }} />
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>Synced</span>
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "0 16px" }} />
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Empty state: greeting + tappable suggestions */}
        {messages.length === 0 && !isTyping && (
          <div className="flex-1 flex flex-col justify-center py-6">
            <span style={{ color: "var(--text)", fontSize: 16, fontWeight: 600 }}>
              Ask about your inbox
            </span>
            <span style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
              Get answers from your synced emails and deadlines.
            </span>
            <div className="flex flex-col gap-2 mt-4">
              {suggestions.map((s) => (
                <motion.button
                  key={s}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => sendQuery(s)}
                  className="flex items-center justify-between px-3.5 py-2.5 text-left"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                  }}
                >
                  <span style={{ color: "var(--text)", fontSize: 13.5 }}>{s}</span>
                  <ChevronRight size={15} color="var(--text-3)" />
                </motion.button>
              ))}
            </div>
          </div>
        )}

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
                    borderRadius: 12,
                    color: "var(--text)",
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                </div>
              ) : (
                <div className="w-full">
                  <span
                    style={{
                      color: "var(--text-3)",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.6,
                    }}
                  >
                    KRNL
                  </span>
                  <div style={{ color: "var(--text-2)", marginTop: 2 }}>
                    {renderAIText(msg.content)}
                  </div>

                  {/* Citations as rich tappable cards */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-col gap-2 mt-3">
                      {msg.citations.map((c) => (
                        <motion.button
                          key={c.id}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleCitationClick(c)}
                          className="flex items-center gap-2.5 px-3 py-2.5 text-left"
                          style={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                          }}
                        >
                          <span
                            className="flex-shrink-0 flex items-center justify-center"
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 7,
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {c.id}
                          </span>
                          <span
                            className="flex-1 min-w-0 line-clamp-1"
                            style={{ color: "var(--text)", fontSize: 13.5, fontWeight: 500 }}
                          >
                            {c.label}
                          </span>
                          <ChevronRight size={16} color="var(--text-3)" className="flex-shrink-0" />
                        </motion.button>
                      ))}
                    </div>
                  )}
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
              className="flex flex-col items-start"
            >
              <span style={{ color: "var(--text-3)", fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>
                KRNL
              </span>
              <div className="flex items-center gap-1 mt-2">
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
            placeholder="Ask about your emails..."
            className="flex-1 bg-transparent outline-none text-[var(--text)] text-sm"
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSend}
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
            style={{
              background: inputValue.trim() ? "var(--accent)" : "var(--surface)",
              border: inputValue.trim() ? "none" : "1px solid var(--border)",
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

      {/* Citation → full event detail (shared screen, slides up) */}
      <AnimatePresence>
        {activeCitation !== null && (
          <EmailDetailScreen
            eventId={activeCitation.event_id}
            direction="up"
            previewData={{ display_name: activeCitation.label, importance_score: 0 }}
            onBack={() => setActiveCitation(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
