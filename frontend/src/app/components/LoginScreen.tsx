import { useState } from "react";
import { supabase } from "../utils/supabase";
import { motion } from "motion/react";

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export function LoginScreen({ oauthError }: { oauthError?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ?? null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { error: oAuthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oAuthError) throw oAuthError;
    } catch (err: any) {
      setError(err.message || "Failed to initialize Google login.");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        {/* KRNL logo mark */}
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex items-center justify-center mb-8"
          style={{ width: 72, height: 72, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18 }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.45 }}
          style={{ color: "var(--text)", fontSize: 30, fontWeight: 700, letterSpacing: "0.04em" }}
        >
          KRNL
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.45 }}
          style={{ color: "var(--text-3)", fontSize: 14, marginTop: 10, lineHeight: 1.5 }}
        >
          Your unified campus email &amp; deadline portal.
        </motion.p>

        {/* Action area */}
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.45 }}
          className="w-full mt-10"
        >
          {error && (
            <div className="mb-4 text-red-400 text-xs py-2.5 px-3 rounded-xl border border-red-500/15 bg-red-500/5">
              {error}
            </div>
          )}

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-4 px-5"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                className="w-5 h-5 rounded-full border-2"
                style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
              />
            ) : (
              <>
                <GoogleIcon size={20} />
                <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>
                  Sign in with Google
                </span>
              </>
            )}
          </motion.button>
        </motion.div>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.45 }}
          style={{ color: "var(--text-3)", fontSize: 12, marginTop: 40, lineHeight: 1.6, opacity: 0.8 }}
        >
          Sign in with any Google Account as your master account. Inside, connect and monitor your
          university and personal mailboxes.
        </motion.p>
      </div>
    </div>
  );
}
