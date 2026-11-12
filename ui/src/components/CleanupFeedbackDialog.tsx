import { Check, CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { uiText, useUiLocale } from "@/i18n/ui";

export interface CleanupFeedbackState {
  phase: "cleaning" | "complete" | "partial" | "error";
  title?: string;
  description?: string;
  completed?: number;
  attention?: number;
  metric?: { label: string; value: string };
  secondaryMetric?: { label: string; value: string };
  warning?: string;
  details?: Array<{ label: string; note?: string }>;
}

/** One lifecycle for all storage cleanup actions. No simulated percentages or automatic retries. */
export function CleanupFeedbackDialog({ state, onClose }: { state: CleanupFeedbackState | null; onClose: () => void }) {
  useUiLocale();
  const cleaning = state?.phase === "cleaning";
  const title = state?.title ?? uiText(cleaning ? "Cleaning up..." : state?.phase === "complete" ? "Cleanup complete"
    : state?.phase === "partial" ? "Cleanup needs attention" : "Cleanup result unavailable");
  const Icon = cleaning ? Loader2 : state?.phase === "complete" ? Check : state?.phase === "partial" ? TriangleAlert : CircleAlert;
  return <AlertDialog open={!!state} onOpenChange={open => { if (!open && !cleaning) onClose(); }}>
    <AlertDialogContent className="flex max-h-(--sz-85vh) flex-col gap-6 overflow-hidden sm:max-w-lg" aria-busy={cleaning}>
      <div key={state?.phase} className="cleanup-feedback-enter flex min-h-0 flex-col gap-6 overflow-y-auto">
        <AlertDialogHeader className="items-center gap-3 text-center sm:text-center">
          <div className={`flex size-20 items-center justify-center rounded-full ${cleaning ? "bg-primary/10 text-primary" : state?.phase === "complete" ? "bg-cleanup-success/10 text-cleanup-success" : "bg-destructive/10 text-destructive"}`} aria-hidden="true">
            <Icon className={`size-10 ${cleaning ? "animate-spin motion-reduce:animate-none" : "cleanup-feedback-enter"}`} strokeWidth={cleaning ? 1.5 : 2} />
          </div>
          <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
          <AlertDialogDescription>{state?.description ?? uiText(cleaning
            ? "Working through your selection. This window will update when cleanup finishes."
            : state?.phase === "error" ? "The request did not return a confirmed result. Some items may already be removed. Refresh the list before trying again."
            : state?.phase === "partial" ? "Some items need a closer look. Review the details before taking another action."
            : "Your cleanup has finished.")}</AlertDialogDescription>
        </AlertDialogHeader>
        {cleaning ? <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="cleanup-progress-sweep h-full w-1/3 rounded-full bg-primary" /></div>
          <p className="text-center text-xs text-muted-foreground">{uiText("Processing selected items...")}</p>
        </div> : <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          {state?.metric && <div className="flex flex-col items-center gap-1"><span className="text-sm text-muted-foreground">{state.metric.label}</span>
            <strong className="font-mono text-4xl font-semibold tracking-tight">{state.metric.value}</strong></div>}
          {(state?.completed !== undefined || state?.attention !== undefined) && <div className="flex flex-wrap justify-center gap-4 text-sm">
            {state?.completed !== undefined && <span>{uiText("{{value0}} completed", { value0: state.completed })}</span>}
            {!!state?.attention && <span className="text-destructive">{uiText("{{value0}} need attention", { value0: state.attention })}</span>}
          </div>}
          {state?.secondaryMetric && <p className="text-center text-xs text-muted-foreground">{state.secondaryMetric.label} · <span className="font-mono">{state.secondaryMetric.value}</span></p>}
        </div>}
        {state?.warning && <p role="alert" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{state.warning}</p>}
        {!!state?.details?.length && !cleaning && <details className="rounded-lg border text-sm">
          <summary className="cursor-pointer p-3 font-medium">{uiText("View details ({{value0}})", { value0: state.details.length })}</summary>
          <div className="max-h-(--sz-60vh) overflow-y-auto border-t px-3">{state.details.map((detail, index) => <div key={index} className="flex flex-col gap-1 border-b py-3 last:border-0">
            <p className="break-all font-mono text-xs">{detail.label}</p>{detail.note && <p className="break-words text-xs text-muted-foreground">{detail.note}</p>}
          </div>)}</div>
        </details>}
      </div>
      {!cleaning && <Button className="w-full shrink-0" onClick={onClose}>{uiText(state?.phase === "error" ? "Close and review list" : "Done")}</Button>}
    </AlertDialogContent>
  </AlertDialog>;
}
