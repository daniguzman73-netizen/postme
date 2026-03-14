// api/fetch-url.js  —  fetches a URL server-side and returns clean text
// Sits alongside api/generate.js in your Vercel project

const MAX_CONTENT_LENGTH = 20_000; // chars — enough for a long article, caps token cost

function extractText(html) {
  // Remove scripts, styles, nav, footer, ads
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")       // strip remaining tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")        // collapse whitespace
    .trim();

  return text.slice(0, MAX_CONTENT_LENGTH);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Allow all origins for now — API key is still safe server-side
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.body;

  // Basic URL validation
  let parsed;
  // Detect social platforms that require login
  const hostname = parsed.hostname.replace("www.", "");
  const socialMessages = {
    "linkedin.com": "LinkedIn posts require you to be logged in, so we can't fetch them automatically. Copy the post text and paste it in the Paste Text tab instead.",
    "x.com": "X (Twitter) posts can't be fetched automatically. Copy the post text and paste it in the Paste Text tab instead.",
    "twitter.com": "X (Twitter) posts can't be fetched automatically. Copy the post text and paste it in the Paste Text tab instead.",
    "facebook.com": "Facebook posts require you to be logged in, so we can't fetch them automatically. Copy the post text and paste it in the Paste Text tab instead.",
  };
  if (socialMessages[hostname]) {
    return res.status(422).json({ error: socialMessages[hostname] });
  }

  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const response = await fetch(parsed.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        return res.status(422).json({ error: "This site is blocking access. Try copying the article text and using Paste Text instead." });
      }
      return res.status(422).json({ error: `Could not fetch page (${response.status}). Try Paste Text instead.` });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return res.status(422).json({ error: "URL doesn't point to a readable page" });
    }

    const html = await response.text();
    const text = extractText(html);

    if (text.length < 100) {
      return res.status(422).json({ error: "Page doesn't have enough readable content" });
    }

    return res.status(200).json({ text });

  } catch (err) {
    if (err.name === "TimeoutError") {
      return res.status(504).json({ error: "Page took too long to load" });
    }
    console.error("Fetch error:", err);
    return res.status(500).json({ error: "Could not read the page" });
  }
}
