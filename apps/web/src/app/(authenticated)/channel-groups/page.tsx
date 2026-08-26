import { AdminGate } from "../../../components/auth-gate";
import { ChannelGroupsScreen } from "../../../components/channel-groups-screen";

export default function ChannelGroupsPage() {
  return (
    <AdminGate>
      <ChannelGroupsScreen />
    </AdminGate>
  );
}
