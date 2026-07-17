import { redirect } from "next/navigation";
import { FEATURES } from "@/config/features";

// Gate only -- flipping FEATURES.travelClaim to true in config/features.ts is enough to make
// every route under here reachable again. Nothing in this file needs to change to unhide.
export default function TravelClaimGateLayout({ children }: { children: React.ReactNode }) {
  if (!FEATURES.travelClaim) {
    redirect("/portal/travel-request");
  }
  return <>{children}</>;
}
