/** Wiki 的内容区布局；视觉值复用宿主令牌，不改变主侧栏。 */
export const WIKI_WORKSPACE_STYLES = `
.pc-wiki-workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  container: pcWikiWorkspace / inline-size;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--background);
  color: var(--foreground);
  font: var(--text-sm)/var(--text-sm--line-height) var(--font-sans);
}
.pc-wiki-layout {
  display: grid;
  grid-template-columns: var(--sz-240px) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.pc-wiki-directory-wrapper { min-height: 0; min-width: 0; }
.pc-wiki-directory {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-inline-end: 1px solid var(--border);
}
.pc-wiki-directory-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
  border-block-end: 1px solid var(--border);
}
.pc-wiki-directory-header a {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--spacing) * 2);
  min-width: 0;
  color: var(--foreground);
  font-weight: var(--font-weight-semibold);
  text-decoration: none;
}
.pc-wiki-directory-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--spacing) * 3) calc(var(--spacing) * 2);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.pc-wiki-directory-heading {
  display: flex;
  align-items: center;
  gap: var(--spacing);
  min-height: calc(var(--spacing) * 8);
  padding-inline: calc(var(--spacing) * 2);
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.pc-wiki-directory-footer {
  flex-shrink: 0;
  border-block-start: 1px solid var(--border);
  padding: calc(var(--spacing) * 2);
}
.pc-wiki-tool-link {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * 2.5);
  min-height: calc(var(--spacing) * 8);
  padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2);
  border-radius: calc(var(--radius) - var(--spacing));
  font-size: var(--text-compact);
  font-weight: var(--font-weight-medium);
}
.pc-wiki-tool-link:hover { background: var(--accent); color: var(--accent-foreground); }
.pc-wiki-content {
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.pc-wiki-article {
  display: grid;
  gap: calc(var(--spacing) * 4);
  min-width: 0;
  padding: calc(var(--spacing) * 6);
}
.pc-wiki-button {
  justify-content: center;
  min-height: calc(var(--spacing) * 9);
  padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 3);
  font-size: var(--text-sm);
}
.pc-wiki-button[data-size="sm"] {
  min-height: calc(var(--spacing) * 8);
  padding: var(--spacing) calc(var(--spacing) * 2.5);
  font-size: var(--text-compact);
}
.pc-wiki-button:not(:disabled):hover { filter: brightness(0.94); }
.pc-wiki-workspace :is(button, a, input, textarea, select):focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: calc(var(--spacing) / 2);
}
.pc-wiki-workspace :is(input, textarea) { caret-color: var(--foreground); }
.pc-wiki-workspace :is(input, textarea)::placeholder { color: var(--muted-foreground); }
.pc-wiki-workspace ::selection { color: var(--primary-foreground); background: var(--primary); }
.pc-wiki-mobile-toolbar { display: none; }
.pc-wiki-directory-toggle {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--spacing) * 2);
  min-height: calc(var(--spacing) * 9);
  padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - var(--spacing));
  color: var(--foreground);
  background: var(--background);
  font: inherit;
  cursor: pointer;
}
@container pcWikiWorkspace (max-width: 48rem) {
  .pc-wiki-mobile-toolbar { display: block; padding-block-end: calc(var(--spacing) * 3); }
  .pc-wiki-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .pc-wiki-directory-wrapper { display: none; }
  .pc-wiki-directory-wrapper[data-open="true"] { display: block; height: calc(var(--spacing) * 72); }
  .pc-wiki-directory { border-inline-end: 0; border-block-end: 1px solid var(--border); }
  .pc-wiki-directory-header { display: none; }
  .pc-wiki-content { grid-row: 2; }
  .pc-wiki-article { padding: calc(var(--spacing) * 4); }
}
@media (max-width: 767px) {
  .pc-wiki-workspace { height: auto; }
  .pc-wiki-content { overflow: visible; }
}
@media (pointer: coarse) {
  .pc-wiki-workspace :is(button, .pc-wiki-tool-link) { min-height: var(--sz-44px); }
  .pc-wiki-input { font-size: var(--text-base) !important; }
}
@keyframes pcWikiPulse { 0%,100% { opacity:1 } 50% { opacity:0.45 } }
@media (prefers-reduced-motion: reduce) {
  .pc-wiki-workspace * { animation: none !important; transition: none !important; }
}
`;
