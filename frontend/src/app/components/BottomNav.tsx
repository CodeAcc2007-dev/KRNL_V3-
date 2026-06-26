import { Mail, MessageSquare, CheckSquare } from "lucide-react";
import { motion } from "motion/react";

type Screen = "inbox" | "deadlines" | "ask" | "settings";

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

const items = [
  { key: "inbox", label: "Inbox", Icon: Mail },
  { key: "ask", label: "Ask", Icon: MessageSquare },
  { key: "deadlines", label: "Deadlines", Icon: CheckSquare },
] as const;

export function BottomNav({ activeScreen, onNavigate }: BottomNavProps) {
  return (
    <div
      className="flex items-center justify-around"
      style={{
        background: "rgba(20, 20, 22, 0.85)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid var(--border-strong)",
        borderRadius: 28,
        padding: "5px 8px",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
      }}
    >
      {items.map(({ key, label, Icon }) => {
        const active = activeScreen === key;
        const color = active ? "var(--accent)" : "var(--text-3)";
        return (
          <motion.button
            key={key}
            whileTap={{ scale: 0.94 }}
            onClick={() => onNavigate(key)}
            className="flex flex-col items-center gap-0.5 flex-1 py-1.5"
          >
            <Icon size={20} color={color} strokeWidth={active ? 2.2 : 1.8} />
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 500, color }}>
              {label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
