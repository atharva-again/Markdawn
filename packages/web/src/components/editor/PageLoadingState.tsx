import { LoadingIndicator } from '../ui/LoadingIndicator';

export function PageLoadingState() {
  return (
    <div className="flex items-center justify-center animate-fade-in">
      <LoadingIndicator label="Loading page" size="md" />
    </div>
  );
}
