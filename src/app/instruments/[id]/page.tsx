import { InstrumentDetail } from "@/components/instruments/InstrumentDetail";

export const dynamic = "force-dynamic";

export default function InstrumentPage({ params }: { params: { id: string } }) {
  return <InstrumentDetail id={params.id} />;
}
