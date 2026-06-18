import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data } = await sb.storage.from("course-files").list("", { limit: 100 });
const byId8 = {};
for (const f of data) {
  const m = f.name.match(/-([A-Za-z0-9_-]{8})\.(pdf|docx|doc|pptx|xlsx)$/);
  if (m) byId8[m[1]] = sb.storage.from("course-files").getPublicUrl(f.name).data.publicUrl;
}

const path = new URL("../lib/courses-data.ts", import.meta.url);
let src = readFileSync(path, "utf8");
let replaced = 0;
const missed = [];
src = src.replace(/https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/view[^'"]*/g, (full, id) => {
  const key = id.slice(0, 8);
  if (byId8[key]) {
    replaced++;
    return byId8[key];
  }
  missed.push(id);
  return full;
});
writeFileSync(path, src);
console.log("Replaced:", replaced, "Missed:", missed.length, missed);
