import { VideosScreen } from "../../../../../components/videos-screen";

export default async function VideosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideosScreen channelId={id} />;
}
