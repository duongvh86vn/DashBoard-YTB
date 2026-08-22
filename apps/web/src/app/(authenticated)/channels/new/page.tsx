import { AdminGate } from "../../../../components/auth-gate";
import { AddChannelForm } from "../../../../components/channels-screen";

export default function NewChannelPage() {
  return (
    <AdminGate>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="eyebrow">Quản trị kênh</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Thêm kênh YouTube
          </h1>
          <p className="mt-3 text-slate-600">Không cần OAuth, API key hay backend vidIQ.</p>
        </div>
        <AddChannelForm />
      </div>
    </AdminGate>
  );
}
