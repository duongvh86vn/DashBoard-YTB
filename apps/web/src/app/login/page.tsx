import { LoginGate } from "../../components/auth-gate";
import { LoginForm } from "../../components/login-form";

export default function LoginPage() {
  return (
    <LoginGate>
      <LoginForm />
    </LoginGate>
  );
}
