import { getProductPricing } from "@/lib/db/courses";
import CheckoutForm from "./CheckoutForm";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const pricing = await getProductPricing();
  return <CheckoutForm pricing={pricing} />;
}
