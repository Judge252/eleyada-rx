import { notFound } from "next/navigation";
import { DoctorWorkspace } from "@/components/rx/doctor-workspace";

export const dynamic = "force-dynamic";

// Local UI preview only (tests and design review with mocked API responses). Disabled unless the local
// operator sets RX_UI_PREVIEW=1; it renders no data and grants no access. Never set it on a deployment.
export default function DoctorPreview() {
  if (process.env.RX_UI_PREVIEW !== "1") notFound();
  return <DoctorWorkspace />;
}
