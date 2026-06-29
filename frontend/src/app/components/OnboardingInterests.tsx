import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { apiFetch } from "../utils/api";

export function OnboardingInterests({ onDone }: { onDone: () => void }) {
  const [catalog, setCatalog] = useState<{ slug: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/v1/interests/catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch((err) => console.error("Error loading catalog:", err));
  }, []);

  const toggle = (slug: string) =>
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/v1/profile", {
        method: "POST",
        body: JSON.stringify({ interest_slugs: selected }),
      });
      onDone();
    } catch (err) {
      console.error("Error saving interests:", err);
      onDone(); // don't trap the user if the save fails
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      <div style={{ paddingTop: "var(--status-bar-pad)" }} className="px-5 pt-6">
        <span style={{ color: "var(--text)", fontSize: 22, fontWeight: 700, display: "block" }}>
          What are you into?
        </span>
        <span style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4, display: "block" }}>
          Pick a few. KRNL uses these to surface the mail that matters to you.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 mt-6" style={{ scrollbarWidth: "none" }}>
        <div className="flex flex-wrap gap-2.5">
          {catalog.map((item) => {
            const active = selected.includes(item.slug);
            return (
              <motion.button
                key={item.slug}
                whileTap={{ scale: 0.93 }}
                onClick={() => toggle(item.slug)}
                className="px-4 py-2"
                style={{
                  borderRadius: 10,
                  background: active ? "var(--accent-weak)" : "transparent",
                  border: active ? "1px solid transparent" : "1px solid var(--border)",
                  color: active ? "var(--accent)" : "var(--text-3)",
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-8 pt-4">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={save}
          disabled={saving}
          className="w-full py-3.5"
          style={{
            background: "var(--accent)",
            borderRadius: 12,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : selected.length ? "Continue" : "Skip for now"}
        </motion.button>
      </div>
    </div>
  );
}
