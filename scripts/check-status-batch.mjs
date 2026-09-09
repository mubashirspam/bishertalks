import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const orderNumbers = [
  "ORD-56ZC6F","ORD-4JAV69","ORD-5H2V54","ORD-7TYZHW","ORD-LDQVNE",
  "ORD-8QBXEX","ORD-9FQ4SK","ORD-524RZP","ORD-6S67KB","ORD-M8RTBH",
  "ORD-D8JLWP","ORD-9XJZMW","ORD-QRRJSQ","ORD-6R64MC","ORD-DAGQG8",
  "ORD-PSGSHZ","ORD-G95QPJ","ORD-N8VZAX","ORD-USDYHW","ORD-HP2PTR",
  "ORD-YN4VBH","ORD-8KMMEY","ORD-53M88L","ORD-UEEH3U","ORD-88GTFA",
  "ORD-X9282N","ORD-U5434Y","ORD-VXJVRR","ORD-JM4EUF","ORD-9ATGYH",
  "ORD-DRANKV","ORD-Y5MGGB","ORD-73TQ4W","ORD-SX3M96",
];

const { data, error } = await supabase
  .from("orders")
  .select("order_number,buyer_name,status,delivery_mode,payment_status")
  .in("order_number", orderNumbers);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

const found = new Map(data.map((o) => [o.order_number, o]));
const missing = orderNumbers.filter((n) => !found.has(n));
const notDelivered = orderNumbers.filter((n) => found.has(n) && found.get(n).status !== "delivered");

console.log(`${orderNumbers.length} in list, ${found.size} found, ${missing.length} missing.\n`);

console.log(`NOT delivered (${notDelivered.length}):`);
for (const n of notDelivered) {
  const o = found.get(n);
  console.log(`  ${n}  ${o.status}  ${o.buyer_name ?? ""}${o.delivery_mode === "cod" ? `  COD/${o.payment_status}` : ""}`);
}

if (missing.length) {
  console.log(`\nNot found in the system (${missing.length}):`);
  for (const n of missing) console.log(`  ${n}`);
}
