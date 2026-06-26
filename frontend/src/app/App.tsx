import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BottomNav } from "./components/BottomNav";
import { InboxScreen } from "./components/InboxScreen";
import { DeadlinesScreen } from "./components/DeadlinesScreen";
import { AskKrnlScreen } from "./components/AskKrnlScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { LoginScreen } from "./components/LoginScreen";
import { supabase } from "./utils/supabase";
import { Session } from "@supabase/supabase-js";

type Screen = "inbox" | "deadlines" | "ask" | "settings";

const screenOrder: Screen[] = ["inbox", "ask", "deadlines", "settings"];

function getDirection(from: Screen, to: Screen): number {
  const fromIdx = screenOrder.indexOf(from);
  const toIdx = screenOrder.indexOf(to);
  return toIdx > fromIdx ? 1 : -1;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<Screen>("inbox");
  const [direction, setDirection] = useState(0);

  // PWA Display & Installer Promos
  const [isMobileOrStandalone, setIsMobileOrStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    // Parse OAuth error from redirect URL (e.g. ?error=server_error&error_description=...)
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error_description") || params.get("error");
    if (urlError) {
      setOauthError(decodeURIComponent(urlError.replace(/\+/g, " ")));
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Check initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setAuthLoading(false);
    });

    // Listen to changes in auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setAuthLoading(false);
    });

    // Detect if standalone or mobile viewport
    const checkDisplayMode = () => {
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches 
        || (window.navigator as any).standalone 
        || window.innerWidth <= 500;
      setIsMobileOrStandalone(isStandalone);
    };

    checkDisplayMode();
    window.addEventListener("resize", checkDisplayMode);

    // Listen to beforeinstallprompt PWA installer triggers
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const isDismissed = sessionStorage.getItem("pwa-prompt-dismissed");
      if (!isDismissed) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Listen to complete installation events
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowInstallBanner(false);
      console.log("KRNL was successfully installed.");
    };
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("resize", checkDisplayMode);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  const handleDismissBanner = () => {
    sessionStorage.setItem("pwa-prompt-dismissed", "true");
    setShowInstallBanner(false);
  };

  const navigate = (screen: Screen) => {
    if (screen === activeScreen) return;
    setDirection(getDirection(activeScreen, screen));
    setActiveScreen(screen);
  };

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? "100%" : "-100%",
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? "-100%" : "100%",
      opacity: 0,
    }),
  };

  return (
    <div
      className="flex items-center justify-center w-full"
      style={{
        background: "#050507",
        height: isMobileOrStandalone ? "100dvh" : undefined,
        minHeight: isMobileOrStandalone ? undefined : "100vh",
        overflow: isMobileOrStandalone ? "hidden" : undefined,
      }}
    >{/* MARKER-MAKE-KIT-INVOKED */}
      {/* Mobile frame wrapper */}
      <div
        className="relative overflow-hidden"
        style={{
          width: isMobileOrStandalone ? "100%" : 390,
          height: isMobileOrStandalone ? "100dvh" : 844,
          maxHeight: isMobileOrStandalone ? "100dvh" : 844,
          maxWidth: isMobileOrStandalone ? "100vw" : 390,
          background: "#08090a",
          borderRadius: isMobileOrStandalone ? 0 : 44,
          boxShadow: isMobileOrStandalone
            ? "none"
            : "0 0 0 1px #2d2d34, 0 40px 100px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.04)",
          position: "relative",
        }}
      >
        {authLoading ? (
          <div className="flex items-center justify-center h-full" style={{ background: "#08090a" }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                border: "2px solid rgba(99,102,241,0.2)",
                borderTopColor: "#6366f1",
              }}
            />
          </div>
        ) : !session ? (
          <LoginScreen oauthError={oauthError} />
        ) : (
          <>
            {/* Status bar notch area (Desktop frame only) */}
            {!isMobileOrStandalone && (
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 z-50"
                style={{
                  width: 126,
                  height: 34,
                  background: "#08090a",
                  borderRadius: "0 0 18px 18px",
                }}
              />
            )}

            {/* Status bar time (Desktop frame only) */}
            {!isMobileOrStandalone && (
              <div
                className="absolute top-3 left-6 z-40"
                style={{ color: "#f7f8f8", fontSize: 15, fontWeight: 600 }}
              >
                9:41
              </div>
            )}

            {/* Status bar icons (Desktop frame only) */}
            {!isMobileOrStandalone && (
              <div className="absolute top-3 right-5 z-40 flex items-center gap-1.5">
                {/* Signal bars */}
                <div className="flex items-end gap-0.5">
                  {[3, 5, 7, 9].map((h, i) => (
                    <div
                      key={i}
                      style={{
                        width: 3,
                        height: h,
                        borderRadius: 1.5,
                        background: i < 3 ? "#f7f8f8" : "rgba(247,248,248,0.35)",
                      }}
                    />
                  ))}
                </div>
                {/* WiFi */}
                <svg width="15" height="12" viewBox="0 0 15 12" fill="none">
                  <path d="M7.5 10.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="#f7f8f8" />
                  <path
                    d="M4.5 8.5c.8-.8 1.9-1.3 3-1.3s2.2.5 3 1.3"
                    stroke="#f7f8f8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M1.8 5.8C3.3 4.3 5.3 3.5 7.5 3.5s4.2.8 5.7 2.3"
                    stroke="#f7f8f8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
                {/* Battery */}
                <div className="flex items-center gap-0.5">
                  <div
                    style={{
                      width: 22,
                      height: 11,
                      border: "1.5px solid rgba(247,248,248,0.6)",
                      borderRadius: 3,
                      padding: 1.5,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        width: "80%",
                        height: "100%",
                        background: "#f7f8f8",
                        borderRadius: 1,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        right: -4,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 2.5,
                        height: 5,
                        background: "rgba(247,248,248,0.5)",
                        borderRadius: "0 1px 1px 0",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Screen content wrapper (Notch safe on real mobile) */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                paddingTop: isMobileOrStandalone ? "env(safe-area-inset-top)" : 0
              }}
            >
              <AnimatePresence custom={direction} initial={false} mode="popLayout">
                <motion.div
                  key={activeScreen}
                  custom={direction}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "spring", stiffness: 340, damping: 35, mass: 0.8 }}
                  className="absolute inset-0"
                >
                  {activeScreen === "inbox" && (
                    <InboxScreen onOpenSettings={() => navigate("settings")} />
                  )}
                  {activeScreen === "deadlines" && <DeadlinesScreen />}
                  {activeScreen === "ask" && <AskKrnlScreen />}
                  {activeScreen === "settings" && <SettingsScreen />}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Home indicator (Desktop frame only) */}
            {!isMobileOrStandalone && (
              <div
                className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50"
                style={{
                  width: 134,
                  height: 5,
                  background: "rgba(247,248,248,0.25)",
                  borderRadius: 100,
                }}
              />
            )}

            {/* Global Bottom Nav (only visible if logged in, styled notch-safe) */}
            <div
              style={{
                paddingBottom: isMobileOrStandalone ? "env(safe-area-inset-bottom)" : 0,
                background: "rgba(8,9,10,0.85)",
                backdropFilter: "blur(20px)"
              }}
              className="absolute bottom-0 left-0 right-0 z-40"
            >
              <BottomNav activeScreen={activeScreen} onNavigate={navigate} />
            </div>
          </>
        )}

        {/* Install Promotive Bottom Sheet Banner */}
        <AnimatePresence>
          {showInstallBanner && deferredPrompt && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 z-[100] px-5 pb-8 pt-6 rounded-t-3xl border-t border-white/10"
              style={{
                background: "rgba(10, 11, 12, 0.95)",
                backdropFilter: "blur(20px)",
                paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)"
              }}
            >
              {/* Handle bar */}
              <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mb-4" />
              
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)] bg-[#08090a]"
                >
                  <img src="/icons/icon-192x192.png" alt="KRNL" className="w-10 h-10 object-contain rounded-xl" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold text-base leading-tight">Add KRNL to Home Screen</h3>
                  <p className="text-neutral-400 text-xs mt-1">Get instant access, fast offline loading, and notifications.</p>
                </div>
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleDismissBanner}
                  className="flex-1 py-3 text-neutral-400 font-medium text-sm rounded-xl hover:text-white transition-colors bg-neutral-900 border border-white/5"
                >
                  Dismiss
                </button>
                <button
                  onClick={handleInstallClick}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 text-black font-semibold text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                >
                  Install
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

