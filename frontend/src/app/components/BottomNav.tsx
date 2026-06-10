import { Mail, CheckSquare, Sparkles } from "lucide-react";
import { motion } from "motion/react";

type Screen = "inbox" | "deadlines" | "ask" | "settings";

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

export function BottomNav({ activeScreen, onNavigate }: BottomNavProps) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex items-center justify-around px-10 pt-3"
      style={{
        background: "rgba(8, 9, 10, 0.94)",
        borderTop: "1px solid #2d2d34",
        backdropFilter: "blur(20px)",
        paddingBottom: "34px",
        zIndex: 100,
      }}
    >
      {/* Inbox Tab */}
      <button
        onClick={() => onNavigate("inbox")}
        className="flex flex-col items-center gap-1 relative"
        style={{ minWidth: 56 }}
      >
        <Mail
          size={22}
          color={activeScreen === "inbox" ? "#3b82f6" : "#8a8f98"}
          strokeWidth={activeScreen === "inbox" ? 2.2 : 1.8}
        />
        {activeScreen === "inbox" && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute -bottom-1 w-1 h-1 rounded-full"
            style={{ background: "#3b82f6" }}
          />
        )}
      </button>

      {/* Center FAB */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => onNavigate("ask")}
        className="flex items-center justify-center -mt-7 shadow-2xl"
        style={{
          width: 58,
          height: 58,
          borderRadius: "50%",
          background:
            activeScreen === "ask"
              ? "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)"
              : "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
          boxShadow: "0 0 24px rgba(99,102,241,0.45), 0 8px 20px rgba(0,0,0,0.5)",
          border: "1.5px solid rgba(129,140,248,0.3)",
        }}
      >
        <Sparkles size={22} color="white" strokeWidth={1.8} />
      </motion.button>

      {/* Deadlines Tab */}
      <button
        onClick={() => onNavigate("deadlines")}
        className="flex flex-col items-center gap-1 relative"
        style={{ minWidth: 56 }}
      >
        <CheckSquare
          size={22}
          color={activeScreen === "deadlines" ? "#3b82f6" : "#8a8f98"}
          strokeWidth={activeScreen === "deadlines" ? 2.2 : 1.8}
        />
        {activeScreen === "deadlines" && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute -bottom-1 w-1 h-1 rounded-full"
            style={{ background: "#3b82f6" }}
          />
        )}
      </button>
    </div>
  );
}
