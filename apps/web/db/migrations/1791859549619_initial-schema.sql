-- Up Migration

-- Task 1.3: identity, ownership and association skeleton (design D2/D4/D7).
-- 7 domain-entity tables + 1 correction_worksheet_item association table.
-- Standard PostgreSQL only: gen_random_uuid() is core since PG 13; no extensions,
-- triggers, enums or custom functions. Forward-only: later changes add new migrations.
-- Cross-User/cross-Child links are rejected by composite foreign keys; flow rules
-- (first Child becomes current, GradingSession.child_id immutable) belong to the app.

-- current_child_id's foreign key is added after child exists (circular reference).
CREATE TABLE app_user (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  current_child_id uuid,
  CONSTRAINT app_user_pkey PRIMARY KEY (id)
);

CREATE TABLE identity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  identifier text NOT NULL,
  CONSTRAINT identity_pkey PRIMARY KEY (id),
  CONSTRAINT identity_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user (id),
  CONSTRAINT identity_provider_subject_key UNIQUE (provider, provider_subject),
  CONSTRAINT identity_provider_identifier_key UNIQUE (provider, identifier)
);

-- display_name is a non-unique label stored in normalized form: no leading/trailing
-- space, tab, LF, CR, VT or FF, and not empty. Internal whitespace is allowed.
CREATE TABLE child (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  CONSTRAINT child_pkey PRIMARY KEY (id),
  CONSTRAINT child_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user (id),
  CONSTRAINT child_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT child_display_name_normalized_check
    CHECK (display_name <> '' AND btrim(display_name, E' \t\n\r\x0B\f') = display_name)
);

ALTER TABLE app_user
  ADD CONSTRAINT app_user_current_child_fkey
  FOREIGN KEY (id, current_child_id) REFERENCES child (user_id, id);

-- User-level, shared by all of the User's Children (no child column).
CREATE TABLE worksheet_archive (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worksheet_archive_pkey PRIMARY KEY (id),
  CONSTRAINT worksheet_archive_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user (id),
  CONSTRAINT worksheet_archive_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT worksheet_archive_name_not_blank_check
    CHECK (btrim(name, E' \t\n\r\x0B\f') <> '')
);

-- user_id is redundant on purpose: it lets the composite keys prove that the Child and
-- the optional WorksheetArchive (NULL on the no-PDF path) belong to the same User.
CREATE TABLE grading_session (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  child_id uuid NOT NULL,
  worksheet_archive_id uuid,
  CONSTRAINT grading_session_pkey PRIMARY KEY (id),
  CONSTRAINT grading_session_child_fkey
    FOREIGN KEY (user_id, child_id) REFERENCES child (user_id, id),
  CONSTRAINT grading_session_worksheet_archive_fkey
    FOREIGN KEY (user_id, worksheet_archive_id) REFERENCES worksheet_archive (user_id, id),
  CONSTRAINT grading_session_id_child_id_key UNIQUE (id, child_id)
);

-- child_id must equal the owning GradingSession's child_id.
CREATE TABLE error_question (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  grading_session_id uuid NOT NULL,
  child_id uuid NOT NULL,
  CONSTRAINT error_question_pkey PRIMARY KEY (id),
  CONSTRAINT error_question_grading_session_fkey
    FOREIGN KEY (grading_session_id, child_id) REFERENCES grading_session (id, child_id),
  CONSTRAINT error_question_id_child_id_key UNIQUE (id, child_id)
);

CREATE TABLE correction_worksheet (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL,
  CONSTRAINT correction_worksheet_pkey PRIMARY KEY (id),
  CONSTRAINT correction_worksheet_child_id_fkey FOREIGN KEY (child_id) REFERENCES child (id),
  CONSTRAINT correction_worksheet_id_child_id_key UNIQUE (id, child_id)
);

-- Both foreign keys share child_id, so a worksheet cannot mix Children's questions.
-- Ordering and the Generation Snapshot are added by later tasks (9.2/9.3).
CREATE TABLE correction_worksheet_item (
  correction_worksheet_id uuid NOT NULL,
  error_question_id uuid NOT NULL,
  child_id uuid NOT NULL,
  CONSTRAINT correction_worksheet_item_pkey PRIMARY KEY (correction_worksheet_id, error_question_id),
  CONSTRAINT correction_worksheet_item_worksheet_fkey
    FOREIGN KEY (correction_worksheet_id, child_id) REFERENCES correction_worksheet (id, child_id),
  CONSTRAINT correction_worksheet_item_error_question_fkey
    FOREIGN KEY (error_question_id, child_id) REFERENCES error_question (id, child_id)
);

-- Referencing-side indexes for foreign keys not already led by a constraint index.
CREATE INDEX identity_user_id_idx ON identity (user_id);
CREATE INDEX grading_session_user_id_child_id_idx ON grading_session (user_id, child_id);
CREATE INDEX grading_session_user_id_worksheet_archive_id_idx
  ON grading_session (user_id, worksheet_archive_id);
CREATE INDEX error_question_grading_session_id_child_id_idx
  ON error_question (grading_session_id, child_id);
CREATE INDEX correction_worksheet_child_id_idx ON correction_worksheet (child_id);
CREATE INDEX correction_worksheet_item_error_question_id_child_id_idx
  ON correction_worksheet_item (error_question_id, child_id);
