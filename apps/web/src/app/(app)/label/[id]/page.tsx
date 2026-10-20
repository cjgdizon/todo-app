import { LabelScreen } from "@/components/view-screens";

export default async function LabelPage({ params }: PageProps<"/label/[id]">) {
  const { id } = await params;
  return <LabelScreen id={id} />;
}
