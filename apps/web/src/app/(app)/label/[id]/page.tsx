import { LabelScreen } from "@/components/view-screens";

export const instant = false;

export default async function LabelPage({ params }: PageProps<"/label/[id]">) {
  const { id } = await params;
  return <LabelScreen id={id} />;
}
