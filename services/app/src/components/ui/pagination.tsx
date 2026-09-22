import { Button } from "@/components/ui/button";

interface PaginationProps {
  hasMore: boolean;
  onNext: () => void;
  onPrevious: () => void;
  canGoBack: boolean;
  loading?: boolean;
}

/** Paginação por cursor — condiz com PageInfo (next_cursor/has_more) de api/openapi/_common.yaml. */
export function Pagination({ hasMore, onNext, onPrevious, canGoBack, loading = false }: PaginationProps) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
      <Button variant="outline" size="sm" onClick={onPrevious} disabled={!canGoBack || loading}>
        Anterior
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasMore || loading}>
        Próxima
      </Button>
    </div>
  );
}
