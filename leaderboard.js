import { createClient } from "@supabase/supabase-js";

// Publishable key is safe to ship in the browser (RLS protects the table)
const url = import.meta.env.VITE_SUPABASE_URL || "https://awmpnoxmoosfvkkyipie.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_nj0Jm72tLUGHm7JARzkE4Q__kAdhbDo";
export const enabled = Boolean(url && key);
const sb = enabled ? createClient(url, key) : null;

export const MAX_ROUND_SCORE = 3500; // theoretical max ≈ 3405

export async function submitScore({ name, score, level, meanMs, mode }) {
  if (!sb) return { ok: false, reason: "offline" };
  const clean = (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ANO";
  const { error } = await sb.from("scores").insert({ name: clean, score, level, mean_ms: meanMs, mode });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function fetchTop(mode, limit = 20) {
  if (!sb) return [];
  const { data } = await sb.from("scores").select("name,score,level,mean_ms,created_at")
    .eq("mode", mode).order("score", { ascending: false }).limit(limit);
  return data || [];
}
