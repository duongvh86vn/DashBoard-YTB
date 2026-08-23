import { ChannelDetailScreen } from "../../../../components/channel-detail-screen";

export default async function ChannelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChannelDetailScreen channelId={id} />;
}
