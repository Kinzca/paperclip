CREATE TABLE IF NOT EXISTS plugin_llm_wiki_8f50da974f.wiki_background_companies (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  policy jsonb NOT NULL,
  runtime jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plugin_llm_wiki_8f50da974f.wiki_background_roots (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  root_issue_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  event_id text NOT NULL,
  source_hash text,
  processed_hash text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, root_issue_id)
);
CREATE INDEX IF NOT EXISTS wiki_background_pending_idx
  ON plugin_llm_wiki_8f50da974f.wiki_background_roots (company_id, status, due_at);
CREATE INDEX IF NOT EXISTS wiki_background_processed_hash_idx
  ON plugin_llm_wiki_8f50da974f.wiki_background_roots (company_id, processed_hash)
  WHERE status = 'processed';
