import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ExpensePlanner } from "@/components/ExpensePlanner";

export default function Home() {
  return (
    <AppErrorBoundary>
      <ExpensePlanner />
    </AppErrorBoundary>
  );
}
