// api/generate.js  —  deploy this on Vercel (free tier is fine)
// Your Anthropic API key lives ONLY here, as an environment variable.
// The frontend never sees it.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// --- Simple in-memory rate limiter ---
// Resets when the serverless function cold-starts, but good enough for abuse prevention.
// For a production app, replace with Vercel KV or Upstash Redis.
const ipHits = new Map();
const RATE_LIMIT = 5;        // max requests per IP
const RATE_WINDOW = 60_000;  // per 60 seconds

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    // Window expired — reset
    ipHits.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  ipHits.set(ip, entry);
  return false;
}

export default async function handler(req, res) {
  // 1. Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. CORS — replace with your actual domain before going public
  const origin = req.headers.origin;
  const allowed = process.env.ALLOWED_ORIGIN || "http://localhost:3000";
  if (origin !== allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.setHeader("Access-Control-Allow-Origin", allowed);

  // 3. Rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }

  // 4. Validate the request body — only accept a prompt string, nothing else
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string" || prompt.length > 4000) {
    return res.status(400).json({ error: "Invalid request" });
  }

  // 5. Forward to Anthropic — API key stays server-side
  try {
    const response = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,   // set this in Vercel env vars
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic error:", data);
      return res.status(502).json({ error: "Generation failed. Please try again." });
    }

    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
}