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

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col items-center justify-center h-full px-6 relative" style={{ background: "#08090a" }}>
      {/* Background ambient glow effect */}
      <div 
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full filter blur-[80px] opacity-15 pointer-events-none"
        style={{
          background: "radial-gradient(circle, #22c55e 0%, rgba(34,197,94,0) 70%)"
        }}
      />

      <div className="w-full max-w-sm flex flex-col items-center text-center z-10">
        {/* Stylized KRNL Logo Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative flex items-center justify-center w-20 h-20 rounded-[24px] mb-8 border border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.15)] bg-gradient-to-br from-[#0c0d0e] to-[#08090a]"
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {/* Internal core dot */}
          <div className="absolute w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="text-white text-3xl font-bold tracking-tight uppercase"
        >
          KRNL
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-neutral-400 text-sm mt-3 px-4 leading-relaxed font-medium"
        >
          Your unified campus email & deadline portal.
        </motion.p>

        {/* Action Button Card */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="w-full mt-10 px-6 py-8 rounded-[28px] border border-white/5 bg-[#0e0f11]/60 backdrop-blur-xl"
        >
          {error && (
            <div className="mb-4 text-red-400 text-xs py-2.5 px-3 rounded-lg border border-red-500/10 bg-red-500/5">
              {error}
            </div>
          )}

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3.5 py-4 px-5 transition-all"
            style={{
              background: "#161719",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                className="w-5 h-5 rounded-full border-2 border-white/20"
                style={{ borderTopColor: "#22c55e" }}
              />
            ) : (
              <>
                <GoogleIcon size={20} />
                <span className="text-white text-sm font-semibold">
                  Sign in with Google
                </span>
              </>
            )}
          </motion.button>
        </motion.div>

        {/* Gate enforcement description footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="text-neutral-500 text-xs mt-12 leading-relaxed"
        >
          Sign in using any standard Google Account as your master account.<br />
          Inside, you can securely connect and monitor your university and personal mailboxes.
        </motion.p>
      </div>
    </div>
  );
}
