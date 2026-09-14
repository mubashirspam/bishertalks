-- Service selection for Mubashir, and explicit reuse of unbooked allotments.
-- Released numbers are never confused with orphaned or uncertain allocations.
BEGIN;
ALTER TABLE orders DROP CONSTRAINT orders_courier_service_check;
ALTER TABLE orders ADD CONSTRAINT orders_courier_service_check
 CHECK (courier_service IS NULL OR courier_service IN ('delhivery','dtdc','trackon'));
ALTER TABLE postal_barcodes DROP CONSTRAINT postal_barcodes_state_check;
ALTER TABLE postal_barcodes ADD CONSTRAINT postal_barcodes_state_check
 CHECK (state IN ('allocated','booked','spent','available'));

CREATE OR REPLACE FUNCTION replace_postal_article(p_order_number TEXT, p_barcode TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE o orders%ROWTYPE; old_number postal_barcodes%ROWTYPE; next_number postal_barcodes%ROWTYPE;
 released TEXT; serial BIGINT;
BEGIN
 -- Also excludes legacy allocation/booking writes while the two records change.
 LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE postal_barcodes IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO o FROM orders WHERE order_number=p_order_number FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
 IF p_barcode IS NOT NULL AND (o.courier_service IS NOT NULL OR NOT EXISTS
    (SELECT 1 FROM couriers WHERE id=o.courier_id AND config->>'tracking'='india-post')) THEN
   RAISE EXCEPTION 'This parcel is not using India Post';
 END IF;
 IF o.postal_barcode IS NOT DISTINCT FROM p_barcode THEN
   RETURN jsonb_build_object('barcode',p_barcode,'released',NULL);
 END IF;
 IF o.courier_entered_at IS NOT NULL OR o.courier_sent_at IS NOT NULL
    OR o.tracking_number IS NOT NULL OR o.status NOT IN ('confirmed','processing') THEN
   RAISE EXCEPTION 'This parcel has already been handed over or has tracking. Its article number cannot be released.';
 END IF;
 SELECT * INTO old_number FROM postal_barcodes WHERE barcode=o.postal_barcode FOR UPDATE;
 IF FOUND THEN
   IF old_number.state <> 'allocated' OR old_number.booked_at IS NOT NULL
      OR old_number.order_number IS DISTINCT FROM p_order_number THEN
     RAISE EXCEPTION 'The existing article is booked, spent, or held elsewhere and cannot be reused.';
   END IF;
   -- Unticking confirmation does not erase a previous handover.
   IF EXISTS (SELECT 1 FROM audit_log WHERE entity_id=p_order_number AND
       created_at >= old_number.allocated_at AND
       ((action='order.courier_entered' AND meta->>'entered'='true') OR
        (action='order.status' AND meta->>'status' IN ('shipped','out_for_delivery','delivered','returned')))) THEN
     RAISE EXCEPTION 'This article has a previous handover. It cannot return to unused stock.';
   END IF;
 END IF;
 IF p_barcode IS NOT NULL THEN
   IF p_barcode !~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid article number'; END IF;
   IF EXISTS (SELECT 1 FROM orders WHERE order_number<>p_order_number AND
      (postal_barcode=p_barcode OR tracking_number=p_barcode)) THEN
     RAISE EXCEPTION 'This article number is already on another parcel';
   END IF;
   SELECT * INTO next_number FROM postal_barcodes WHERE barcode=p_barcode FOR UPDATE;
   IF FOUND THEN
     IF NOT EXISTS (SELECT 1 FROM postal_barcode_ranges r JOIN couriers owner ON owner.id=r.courier_id
       JOIN couriers carrier ON carrier.id=o.courier_id WHERE r.id=next_number.range_id AND
       (owner.id=carrier.id OR (owner.config->>'tracking'='india-post' AND
        NULLIF(owner.config->>'contract_id','')=NULLIF(carrier.config->>'contract_id','')))) THEN
       RAISE EXCEPTION 'This article belongs to a different postal account';
     END IF;
     IF next_number.state <> 'available' OR next_number.order_number IS NOT NULL OR next_number.booked_at IS NOT NULL THEN
       RAISE EXCEPTION 'This article number is already allocated, booked or spent';
     END IF;
   ELSE
     serial := substring(p_barcode,3,8)::BIGINT;
     IF EXISTS (SELECT 1 FROM postal_barcode_ranges WHERE prefix=left(p_barcode,2)
       AND suffix=right(p_barcode,2) AND serial BETWEEN serial_from AND serial_to) THEN
       RAISE EXCEPTION 'This number belongs to an allotment. Use Allot article numbers to claim it.';
     END IF;
   END IF;
 END IF;
 IF old_number.barcode IS NOT NULL THEN
   UPDATE postal_barcodes SET state='available',order_number=NULL,error=NULL WHERE barcode=old_number.barcode;
   released := old_number.barcode;
   INSERT INTO audit_log(entity,entity_id,action,meta) VALUES('order',p_order_number,'order.article_released',
     jsonb_build_object('article_number',released,'replacement',p_barcode));
 END IF;
 IF next_number.barcode IS NOT NULL THEN
   UPDATE postal_barcodes SET state='allocated',order_number=p_order_number,allocated_at=now(),error=NULL
    WHERE barcode=next_number.barcode;
 END IF;
 UPDATE orders SET postal_barcode=p_barcode,updated_at=now() WHERE order_number=p_order_number;
 RETURN jsonb_build_object('barcode',p_barcode,'released',released);
END $$;

CREATE OR REPLACE FUNCTION claim_reusable_postal_articles(p_courier_id UUID,p_order_numbers TEXT[])
RETURNS TABLE(order_number TEXT,barcode TEXT) LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE n TEXT; b TEXT;
BEGIN
 LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE postal_barcodes IN SHARE ROW EXCLUSIVE MODE;
 FOREACH n IN ARRAY p_order_numbers LOOP
   IF NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number=n AND o.postal_barcode IS NULL
     AND o.courier_entered_at IS NULL AND o.courier_sent_at IS NULL AND o.courier_service IS NULL
     AND o.status IN ('confirmed','processing')) THEN CONTINUE; END IF;
   SELECT pb.barcode INTO b FROM postal_barcodes pb JOIN postal_barcode_ranges r ON r.id=pb.range_id
    WHERE r.courier_id=p_courier_id AND pb.state='available' AND pb.order_number IS NULL
      AND pb.booked_at IS NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.postal_barcode=pb.barcode OR o.tracking_number=pb.barcode)
    ORDER BY pb.allocated_at,pb.barcode LIMIT 1 FOR UPDATE OF pb;
   IF b IS NULL THEN EXIT; END IF;
   UPDATE postal_barcodes pb SET state='allocated',order_number=n,allocated_at=now(),error=NULL WHERE pb.barcode=b;
   UPDATE orders o SET postal_barcode=b,updated_at=now() WHERE o.order_number=n;
   order_number:=n; barcode:=b; RETURN NEXT;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION set_mubashir_channel(p_order_number TEXT,p_channel TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE o orders%ROWTYPE; new_service TEXT;
BEGIN
 LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO o FROM orders WHERE order_number=p_order_number FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM couriers WHERE id=o.courier_id AND slug='mubashir-logistic' AND is_active) THEN
   RAISE EXCEPTION 'This is not an active Mubashir Logistic parcel';
 END IF;
 IF p_channel NOT IN ('india_post','delhivery','dtdc','trackon') OR p_channel IS NULL THEN RAISE EXCEPTION 'Unknown service'; END IF;
 new_service:= CASE WHEN p_channel='india_post' THEN NULL ELSE p_channel END;
 IF o.courier_service IS NOT DISTINCT FROM new_service THEN RETURN; END IF;
 IF o.courier_entered_at IS NOT NULL OR o.courier_sent_at IS NOT NULL OR o.tracking_number IS NOT NULL
   OR o.status NOT IN ('confirmed','processing') THEN RAISE EXCEPTION 'Change the service before handing the parcel to the courier'; END IF;
 IF p_channel<>'india_post' THEN PERFORM replace_postal_article(p_order_number,NULL); END IF;
 UPDATE orders SET courier_service=new_service,updated_at=now() WHERE order_number=p_order_number;
END $$;

REVOKE ALL ON FUNCTION replace_postal_article(TEXT,TEXT), claim_reusable_postal_articles(UUID,TEXT[]),set_mubashir_channel(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION replace_postal_article(TEXT,TEXT), claim_reusable_postal_articles(UUID,TEXT[]),set_mubashir_channel(TEXT,TEXT) TO service_role;
CREATE OR REPLACE VIEW postal_barcode_stock AS
SELECT r.courier_id,
 COUNT(*) FILTER (WHERE r.exhausted_at IS NULL) AS open_ranges,
 COALESCE(SUM(GREATEST(r.serial_to-r.next_serial+1,0)),0) +
 (SELECT COUNT(*) FROM postal_barcodes b JOIN postal_barcode_ranges br ON br.id=b.range_id
   WHERE br.courier_id=r.courier_id AND b.state='available') AS unused,
 COALESCE(SUM(r.serial_to-r.serial_from+1),0) AS allotted,
 MIN(r.created_at) AS oldest_range_at
FROM postal_barcode_ranges r GROUP BY r.courier_id;
NOTIFY pgrst,'reload schema';
COMMIT;
