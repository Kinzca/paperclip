import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_WORKFLOW_LIMITS,
  workflowLimitsSchema,
} from "@paperclipai/shared";
import { workflowsApi } from "@/api/workflows";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { uiText, useUiLocale } from "@/i18n/ui";
import "@/i18n/workflows";

export function WorkflowPlatformLimits({ disabled }: { disabled?: boolean }) {
  useUiLocale();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {uiText("Platform limits")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{uiText("Platform limits")}</DialogTitle>
          <DialogDescription>
            {uiText(
              "Applies to new workflows in every company. Company and project rules may lower these limits. Existing tasks keep their original allowance.",
            )}
          </DialogDescription>
        </DialogHeader>
        {open && <PlatformLimitsForm close={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PlatformLimitsForm({ close }: { close: () => void }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["workflow-platform-editor"],
    queryFn: workflowsApi.platform,
    staleTime: 0,
    gcTime: 0,
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [base, setBase] = useState<Awaited<
    ReturnType<typeof workflowsApi.platform>
  > | null>(null);
  const current = base ?? query.data;
  const limits = { ...DEFAULT_WORKFLOW_LIMITS, ...current?.policy.limits };
  const values =
    draft ??
    Object.fromEntries(
      Object.entries(limits).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ]),
    );
  const parsed = workflowLimitsSchema.safeParse({
    maxAttempts: Number(values.maxAttempts),
    timeoutMinutes: Number(values.timeoutMinutes),
    maxParallelism: Number(values.maxParallelism),
    maxCostCents:
      values.maxCostCents === "" ? null : Number(values.maxCostCents),
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!current || !parsed.success)
        throw new Error(uiText("Check the limit values."));
      return workflowsApi.savePlatform({
        expectedVersion: current.version,
        policy: { ...current.policy, limits: parsed.data },
        allowHostCommands: current.allowHostCommands,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workflows"] });
      client.removeQueries({ queryKey: ["workflow-platform-editor"] });
      close();
    },
  });
  if (query.isPending) return <p role="status">{uiText("Loading...")}</p>;
  if (query.error)
    return (
      <div className="flex flex-col gap-3">
        <p role="alert">{query.error.message}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {uiText("Retry")}
        </Button>
      </div>
    );
  const fields = [
    { key: "maxAttempts", label: "Attempts per stage", max: 10, min: 1 },
    {
      key: "timeoutMinutes",
      label: "Active execution minutes",
      max: 1440,
      min: 1,
    },
    { key: "maxParallelism", label: "Concurrent stages", max: 10, min: 1 },
    {
      key: "maxCostCents",
      label: "Recorded cost ceiling (cents, optional)",
      max: 1000000,
      min: 1,
    },
  ];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-2 text-sm">
          {uiText(field.label)}
          <Input
            type="number"
            min={field.min}
            max={field.max}
            step={1}
            required={field.key !== "maxCostCents"}
            value={values[field.key]}
            disabled={save.isPending}
            onChange={(event) => {
              setBase(current!);
              setDraft({ ...values, [field.key]: event.target.value });
            }}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        {uiText(
          "Human-only acceptance waits do not consume execution time. Manual grants apply to one stopped task and remain subject to company budgets.",
        )}
      </p>
      {!parsed.success && (
        <p role="alert" className="text-sm text-destructive">
          {uiText("Check the limit values.")}
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={close}
        >
          {uiText("Cancel")}
        </Button>
        <Button type="submit" disabled={!parsed.success || save.isPending}>
          {uiText("Save platform limits")}
        </Button>
      </div>
    </form>
  );
}
