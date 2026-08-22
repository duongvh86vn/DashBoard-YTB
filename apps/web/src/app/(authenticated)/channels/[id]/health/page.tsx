import { ChannelHealthScreen } from "../../../../../components/channel-health-screen";

export default async function ChannelHealthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChannelHealthScreen channelId={id} />;
}
