import { uiText, useUiLocale } from "@/i18n/ui";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { CsvPreview } from "@/components/CsvPreview";
import { isCsvFile } from "@/lib/csv-preview";
import { MarkdownBody } from "@/components/MarkdownBody";
import { HtmlArtifactPreview } from "@/components/HtmlArtifactPreview";
import { FilePreviewModeToggle, type FilePreviewMode } from "@/components/FilePreviewModeToggle";
import { isHtmlPreview } from "@/lib/html-preview";
import { attachmentDownloadPath, isMarkdownAttachment, isTextAttachment } from "@/lib/issue-attachments";
import { queryKeys } from "@/lib/queryKeys";

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

/** Bound the actual response, not just producer-supplied attachment metadata. */
export async function readTextPreview(response: Response) {
  if (!response.ok) throw new Error(`Could not load file (${response.status}).`);
  if (!response.body) throw new Error("The file response is empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > TEXT_PREVIEW_MAX_BYTES) throw new Error("This file is too large to preview. Download it instead.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (text.includes("\0")) throw new Error("This file contains binary data. Download it instead.");
    return text;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function TextAttachmentPreview({ title, text, markdown, html = false, csv = false, downloadUrl }: {
  title: string;
  text: string;
  markdown: boolean;
  html?: boolean;
  csv?: boolean;
  downloadUrl: string;
}) {
  useUiLocale();
  const [mode, setMode] = useState<FilePreviewMode>("rendered");
  useEffect(() => setMode("rendered"), [title]);
  const renderCsv = csv && mode === "rendered" && text.length > 0;
  const renderHtml = html && mode === "rendered" && text.length > 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>{title}</h2>
        {markdown || html || csv ? <FilePreviewModeToggle mode={mode} onChange={setMode} label={html ? uiText("HTML view") : csv ? uiText("CSV view") : uiText("Markdown view")} /> : null}
        <Button asChild variant="ghost" size="icon-sm">
          <a href={downloadUrl} download aria-label={uiText("Download {{value0}}", { value0: title })} title={uiText("Download {{value0}}", { value0: title })}><Download aria-hidden /></a>
        </Button>
      </header>
      <div className={renderHtml || renderCsv ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-auto p-4"}>
        {text.length === 0 ? <p className="text-sm text-muted-foreground">{uiText("File is empty.")}</p>
          : renderCsv ? <CsvPreview text={text} title={title} />
          : renderHtml ? <HtmlArtifactPreview html={text} title={title} />
          : markdown && mode === "rendered" ? <MarkdownBody mediaMode="reference">{text}</MarkdownBody>
          : <pre className="whitespace-pre-wrap break-words font-mono text-sm" aria-label={`${title} raw text`}>{text}</pre>}
      </div>
    </div>
  );
}

export function TaskAttachmentPanel({ issueId, attachmentId }: { issueId: string; attachmentId: string }) {
  useUiLocale();
  const attachments = useQuery({
    queryKey: queryKeys.issues.attachments(issueId),
    queryFn: () => issuesApi.listAttachments(issueId),
  });
  // Re-resolve against this task's authorized attachment list; never trust persisted URLs.
  const attachment = attachments.data?.find((item) => item.id === attachmentId);
  const eligible = attachment && isTextAttachment(attachment) && attachment.byteSize <= TEXT_PREVIEW_MAX_BYTES;
  const content = useQuery({
    queryKey: ["task-text-attachment", issueId, attachmentId],
    queryFn: async ({ signal }) => readTextPreview(await fetch(
      `/api/attachments/${encodeURIComponent(attachmentId)}/content`,
      { signal, credentials: "same-origin" },
    )),
    enabled: Boolean(eligible),
    retry: false,
  });
  if (attachments.isLoading) return <p className="p-4 text-sm" role="status">{uiText("Loading file…")}</p>;
  if (attachments.isError) return <div className="p-4" role="alert">{uiText("Could not load attachment details. ")}<Button onClick={() => void attachments.refetch()}>{uiText("Retry")}</Button></div>;
  if (!attachment) return <p className="p-4 text-sm" role="status">{uiText("File no longer available. Close this tab or choose another file.")}</p>;
  const downloadUrl = attachmentDownloadPath(attachment);
  if (!eligible || content.isError) {
    return (
      <div className="space-y-3 p-4" role="alert">
        <p className="text-sm">{content.isError ? uiText("Could not preview this file. Retry or download it.") : uiText("This file is too large or is not supported for text preview. Download it instead.")}</p>
        {eligible ? <Button onClick={() => void content.refetch()}>{uiText("Retry")}</Button> : null}
        <Button asChild variant="outline"><a href={downloadUrl} download>{uiText("Download file")}</a></Button>
      </div>
    );
  }
  if (content.data === undefined) return <p className="p-4 text-sm" role="status">{uiText("Loading file…")}</p>;
  return <TextAttachmentPreview key={attachment.id} title={attachment.originalFilename ?? attachment.id} text={content.data} csv={isCsvFile(attachment.originalFilename ?? "", attachment.contentType)} markdown={isMarkdownAttachment(attachment)} html={isHtmlPreview(attachment.contentType, attachment.originalFilename)} downloadUrl={downloadUrl} />;
}
