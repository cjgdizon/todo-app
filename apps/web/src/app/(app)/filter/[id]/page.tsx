import { FilterScreen } from "@/components/view-screens";

export const instant = false;

export default async function FilterPage({ params }: PageProps<"/filter/[id]">) {
  const { id } = await params;
  return <FilterScreen id={id} />;
}
