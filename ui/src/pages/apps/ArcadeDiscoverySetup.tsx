import { uiText, useUiLocale } from "@/i18n/ui";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toolsApi } from "@/api/tools";
import { useAccountIdentity } from "@/api/companies-query";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ToolConnection } from "@paperclipai/shared";

export function ArcadeDiscoverySetup({ connection, onClose }: { connection: ToolConnection; onClose: () => void }) {
  useUiLocale();
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState("");
  const queries = useQueryClient();
  const { userId: viewingUserId, settled } = useAccountIdentity();
  const save = useMutation({ mutationFn: async () => {
      const result = await toolsApi.configureArcadeDiscovery(connection.id, { apiKey: apiKey.trim(), userId: userId.trim() });
      queries.setQueryData(queryKeys.tools.aggregatorApps(connection.id, viewingUserId), result);
    },
    onSuccess: onClose,
  });
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{uiText("Sync Arcade accounts")}</DialogTitle>
      <DialogDescription>{uiText("See apps available through “")}{connection.name}{uiText("”. Your gateway works without account sync.")}</DialogDescription>
    </DialogHeader>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <div className="space-y-2"><Label htmlFor="arcade-discovery-key">{uiText("Project API key")}</Label>
        <p className="text-xs text-muted-foreground">{uiText("Create a key in ")}<a className="underline" href="https://app.arcade.dev" target="_blank" rel="noopener noreferrer">{uiText("Arcade")}</a>{uiText(" for the same project as this gateway. The key is stored securely and used only for account sync.")}</p>
        <Input id="arcade-discovery-key" type="password" autoComplete="off" required value={apiKey} onChange={event => setApiKey(event.target.value)} />
      </div>
      <div className="space-y-2"><Label htmlFor="arcade-discovery-user">{uiText("Arcade user ID")}</Label>
        <p className="text-xs text-muted-foreground">{uiText("Use the end-user ID configured for this gateway’s sign-in. This may differ from your email address.")}</p>
        <Input id="arcade-discovery-user" autoComplete="off" required value={userId} onChange={event => setUserId(event.target.value)} />
      </div>
      {save.isError ? <p role="alert" className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : uiText("Couldn’t save account sync. Try again.")}</p> : null}
      <DialogFooter className="sm:justify-between"><Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>{uiText("Cancel")}</Button>
        <Button type="submit" disabled={!settled || save.isPending || !apiKey.trim() || !userId.trim()}>{save.isPending ? uiText("Saving…") : uiText("Save and sync")}</Button>
      </DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
