import { AiSettingsScreen } from "../../../../components/ai-settings-screen";
import { AdminGate } from "../../../../components/auth-gate";

export default function AiSettingsPage() {
  return (
    <AdminGate>
      <AiSettingsScreen />
    </AdminGate>
  );
}
