import { LoadingIndicator } from '../ui/LoadingIndicator';

export function ExplorerLoadingState() {
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <LoadingIndicator label="Loading items" />
    </div>
  );
}
