import { ProjectScreen } from "@/components/view-screens";

export default async function ProjectPage({ params }: PageProps<"/project/[id]">) {
  const { id } = await params;
  return <ProjectScreen id={id} />;
}
