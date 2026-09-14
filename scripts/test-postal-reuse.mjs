// Run against isolated PostgreSQL, never the application's database.
// Install @electric-sql/pglite in a temporary folder, then point POSTAL_TEST_PGLITE
// at its dist/index.js file, or install it locally and omit that variable.
const { PGlite } = await import(process.env.POSTAL_TEST_PGLITE || '@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE couriers(id uuid PRIMARY KEY,slug text,is_active boolean,config jsonb);
CREATE TABLE orders(order_number text PRIMARY KEY,postal_barcode text,courier_id uuid,courier_service text CONSTRAINT orders_courier_service_check CHECK(courier_service IN ('dtdc','trackon')),courier_entered_at timestamptz,courier_sent_at timestamptz,tracking_number text,status text,updated_at timestamptz);
CREATE TABLE postal_barcode_ranges(id uuid PRIMARY KEY,courier_id uuid,prefix text,suffix text,serial_from bigint,serial_to bigint,next_serial bigint,exhausted_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE postal_barcodes(barcode text PRIMARY KEY,range_id uuid,order_number text UNIQUE,state text CONSTRAINT postal_barcodes_state_check CHECK(state IN ('allocated','booked','spent')),allocated_at timestamptz DEFAULT now(),booked_at timestamptz,error text);
CREATE TABLE audit_log(entity text NOT NULL DEFAULT 'order',entity_id text,action text,meta jsonb,created_at timestamptz DEFAULT now());
INSERT INTO couriers VALUES('00000000-0000-0000-0000-000000000001','mubashir-logistic',true,'{"tracking":"india-post"}');
INSERT INTO postal_barcode_ranges VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','CX','IN',5492271,5492999,5492300,null,now());
INSERT INTO orders(order_number,postal_barcode,courier_id,status) VALUES('A','CX054922714IN','00000000-0000-0000-0000-000000000001','confirmed'),('B',null,'00000000-0000-0000-0000-000000000001','confirmed');
INSERT INTO postal_barcodes(barcode,range_id,order_number,state) VALUES('CX054922714IN','00000000-0000-0000-0000-000000000002','A','allocated');`);
await db.exec(fs.readFileSync(process.cwd()+'/supabase/migrations/0081_mubashir_services_and_reusable_articles.sql','utf8'));
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const replace=async(n,b)=>q('SELECT replace_postal_article($1,$2) AS result',[n,b]);
let r=await replace('A','EX123456785IN');assert.equal(r[0].result.released,'CX054922714IN');
assert.equal((await q("SELECT state FROM postal_barcodes"))[0].state,'available');
r=await q("SELECT * FROM claim_reusable_postal_articles('00000000-0000-0000-0000-000000000001',ARRAY['B'])");assert.equal(r[0].barcode,'CX054922714IN');
await assert.rejects(()=>replace('A','CX054922714IN'),/already on another/);
await db.exec("UPDATE postal_barcodes SET state='booked',booked_at=now() WHERE order_number='B'");
await assert.rejects(()=>replace('B','EX223456785IN'),/booked/);
assert.equal((await q("SELECT postal_barcode FROM orders WHERE order_number='B'"))[0].postal_barcode,'CX054922714IN');
await db.exec("UPDATE postal_barcodes SET state='allocated',booked_at=null WHERE order_number='B'; INSERT INTO audit_log(entity_id,action,meta) VALUES('B','order.courier_entered','{\"entered\":true}')");
await assert.rejects(()=>replace('B','EX223456785IN'),/previous handover/);
await q("SELECT set_mubashir_channel('A','delhivery')");
assert.equal((await q("SELECT courier_service,postal_barcode FROM orders WHERE order_number='A'"))[0].courier_service,'delhivery');
await q("SELECT set_mubashir_channel('A','india_post')");
assert.equal((await q("SELECT courier_service FROM orders WHERE order_number='A'"))[0].courier_service,null);
await assert.rejects(()=>replace('A','CX054929991IN'),/belongs to an allotment/);
console.log('PASS: migration, atomic replacement, reusable allocation, duplicate rejection, booked-number protection, handover protection, service switching, range protection');
await db.close();
