import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const csvPath = process.argv[2];
const text = readFileSync(csvPath, "utf-8");
const lines = text.split("\n").filter(Boolean);
const headers = lines[0].split(",");
const rows = lines.slice(1).map((line) => {
  const cells = line.split(",");
  const obj = {};
  headers.forEach((h, i) => (obj[h.trim()] = (cells[i] ?? "").trim()));
  return obj;
});

const orderNumbers = rows.map((r) => r["Order #"]);
const waybills = rows.map((r) => r["Waybill"]);

const [byOrderNumber, byReference, byWaybill] = await Promise.all([
  supabase.from("orders").select("order_number,status,courier_reference,tracking_number").in("order_number", orderNumbers),
  supabase.from("orders").select("order_number,status,courier_reference,tracking_number").in("courier_reference", orderNumbers),
  supabase.from("orders").select("order_number,status,courier_reference,tracking_number").in("tracking_number", waybills),
]);

const found = new Map();
for (const o of byOrderNumber.data ?? []) found.set(o.order_number, o);
for (const o of byReference.data ?? []) found.set(o.courier_reference, o);
for (const o of byWaybill.data ?? []) found.set(o.tracking_number, o);

console.log(`${rows.length} rows in CSV\n`);

const toMark = [];
for (const row of rows) {
  const key = row["Order #"];
  const o = found.get(key) || found.get(row["Waybill"]);
  const csvStatus = `${row["Current Status"]}/${row["Status Type"]}`;
  if (!o) {
    console.log(`${key} (${row["Waybill"]}): NOT FOUND in our DB (csv: ${csvStatus})`);
    continue;
  }
  const isReturnedInCsv = row["Current Status"] === "RTO" && row["Status Type"] === "Delivered";
  const mismatch = isReturnedInCsv && o.status !== "returned";
  console.log(
    `${key} -> ${o.order_number}  csv=${csvStatus}  our_status=${o.status}` +
    `${mismatch ? "  <<< NEEDS UPDATE TO RETURNED" : ""}`
  );
  if (mismatch) toMark.push(o.order_number);
}

console.log(`\n${toMark.length} order(s) need to be marked returned:`, toMark);
