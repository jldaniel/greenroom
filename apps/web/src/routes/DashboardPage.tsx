import { RepositoryRegistryPanel } from "../components/RepositoryRegistryPanel";
import { ReviewListPanel } from "../components/ReviewListPanel";

export function DashboardPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.15fr)]">
      <RepositoryRegistryPanel />
      <ReviewListPanel />
    </div>
  );
}
