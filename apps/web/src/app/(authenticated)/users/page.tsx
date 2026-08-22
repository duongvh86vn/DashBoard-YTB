import { AdminGate } from "../../../components/auth-gate";
import { UsersScreen } from "../../../components/users-screen";

export default function UsersPage() {
  return (
    <AdminGate>
      <UsersScreen />
    </AdminGate>
  );
}
