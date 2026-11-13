import { useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "@/api/issues";
import { invalidateInboxIssueQueries } from "@/lib/inboxArchiveCache";
import { queryKeys } from "@/lib/queryKeys";

export function useTaskArchive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) => issuesApi.archiveFromInbox(id, true),
    onSuccess: async (_result, { id, companyId }) => {
      await Promise.all([
        invalidateInboxIssueQueries(client, companyId),
        client.invalidateQueries({ queryKey: ["archived-chats", companyId] }),
        client.invalidateQueries({ queryKey: queryKeys.issues.detail(id) }),
      ]);
    },
  });
}
