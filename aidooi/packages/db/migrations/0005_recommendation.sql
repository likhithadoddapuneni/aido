-- Recommendation: projects, deterministic runs, explainable candidate scores, four compositions.

CREATE TABLE recommendation.project (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid REFERENCES identity.customer (id),
  guest_session_id   uuid REFERENCES identity.guest_session (id),
  path_id            text NOT NULL,
  spec               jsonb NOT NULL DEFAULT '{}',
  style_preference   text,
  colour_preference  text,
  budget_tier        text,
  project_budget_fils bigint,
  size_class         text,
  state              text NOT NULL DEFAULT 'Draft',
  media_keys         jsonb NOT NULL DEFAULT '[]',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_owner_ck CHECK (customer_id IS NOT NULL OR guest_session_id IS NOT NULL),
  CONSTRAINT project_path_id_enum CHECK (path_id IN
    ('livingRoom','bedroom','diningRoom','homeOffice','studio','fullApartment','villa','individualProduct')),
  CONSTRAINT project_budget_tier_enum CHECK (budget_tier IN ('Essential', 'Value', 'Standard', 'Premium', 'Luxury')),
  CONSTRAINT project_size_class_enum CHECK (size_class IN ('Compact', 'Small', 'Medium', 'Large', 'Extra Large')),
  CONSTRAINT project_state_enum CHECK (state IN ('Draft', 'In Progress', 'Ready for Recommendation')),
  CONSTRAINT project_budget_ck CHECK (project_budget_fils IS NULL OR project_budget_fils > 0),
  CONSTRAINT project_spec_ck CHECK (jsonb_typeof(spec) = 'object' AND jsonb_typeof(media_keys) = 'array')
);
CREATE INDEX project_customer_idx ON recommendation.project (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX project_guest_idx ON recommendation.project (guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE TRIGGER project_touch BEFORE UPDATE ON recommendation.project
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE recommendation.project_module (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES recommendation.project (id) ON DELETE CASCADE,
  room_path            text NOT NULL,
  label                text NOT NULL,
  area_m2              numeric(7, 2) NOT NULL,
  floor                text,
  bed_size             text,
  capacity             smallint,
  users_count          smallint,
  allocated_budget_fils bigint,
  CONSTRAINT project_module_room_path_enum CHECK (room_path IN
    ('livingRoom','bedroom','diningRoom','homeOffice','studio','fullApartment','villa','individualProduct')),
  CONSTRAINT project_module_area_ck CHECK (area_m2 > 0),
  CONSTRAINT project_module_budget_ck CHECK (allocated_budget_fils IS NULL OR allocated_budget_fils > 0)
);
CREATE INDEX project_module_project_idx ON recommendation.project_module (project_id);

-- Every run records exactly which standards, catalogue and maps produced it, so any result can
-- be reproduced and any regression bisected.
CREATE TABLE recommendation.recommendation_run (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES recommendation.project (id),
  project_module_id uuid REFERENCES recommendation.project_module (id),
  state             text NOT NULL DEFAULT 'Processing',
  size_class        text,
  budget_low_fils   bigint,
  budget_high_fils  bigint,
  catalogue_version text NOT NULL,
  standards_version text NOT NULL,
  engine_version    text NOT NULL,
  style_map_id      uuid NOT NULL REFERENCES catalogue.compat_map_version (id),
  colour_map_id     uuid NOT NULL REFERENCES catalogue.compat_map_version (id),
  material_map_id   uuid NOT NULL REFERENCES catalogue.compat_map_version (id),
  input_hash        text NOT NULL,
  failure_reason    text,
  duration_ms       integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_run_state_enum CHECK (state IN
    ('Processing', 'Completed', 'Limited Inventory', 'Failed')),
  CONSTRAINT recommendation_run_size_class_enum CHECK (size_class IN
    ('Compact', 'Small', 'Medium', 'Large', 'Extra Large')),
  CONSTRAINT recommendation_run_budget_ck CHECK (budget_low_fils IS NULL OR budget_high_fils IS NULL
    OR (budget_low_fils >= 0 AND budget_high_fils >= budget_low_fils)),
  CONSTRAINT recommendation_run_failure_ck CHECK ((state = 'Failed') = (failure_reason IS NOT NULL))
);
CREATE INDEX recommendation_run_project_idx ON recommendation.recommendation_run (project_id, created_at DESC);

-- One row per (slot, offer) evaluated, including rejections: this is what makes a result
-- explainable and a rejection testable. High volume; archive by run age.
CREATE TABLE recommendation.candidate_score (
  run_id          uuid NOT NULL REFERENCES recommendation.recommendation_run (id) ON DELETE CASCADE,
  slot_key        text NOT NULL,
  offer_id        text NOT NULL REFERENCES catalogue.seller_offer (id),
  product_id      text NOT NULL REFERENCES catalogue.product (id),
  fit             smallint NOT NULL,
  style           smallint NOT NULL,
  colour          smallint NOT NULL,
  budget          smallint NOT NULL,
  practical       smallint NOT NULL,
  availability    smallint NOT NULL,
  total           smallint NOT NULL,
  quality         smallint NOT NULL,
  eligible        boolean NOT NULL,
  rejected_reason text,
  CONSTRAINT candidate_score_pk PRIMARY KEY (run_id, slot_key, offer_id),
  CONSTRAINT candidate_score_range_ck CHECK (
    fit BETWEEN 0 AND 100 AND style BETWEEN 0 AND 100 AND colour BETWEEN 0 AND 100
    AND budget BETWEEN 0 AND 100 AND practical BETWEEN 0 AND 100 AND availability BETWEEN 0 AND 100
    AND total BETWEEN 0 AND 100 AND quality BETWEEN 0 AND 100),
  CONSTRAINT candidate_score_reason_ck CHECK (eligible = (rejected_reason IS NULL))
);

CREATE TABLE recommendation.composition (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  uuid NOT NULL REFERENCES recommendation.recommendation_run (id) ON DELETE CASCADE,
  objective               text NOT NULL,
  score                   smallint,
  product_match_quality   numeric(5, 2),
  harmony_style           numeric(5, 2),
  harmony_colour          numeric(5, 2),
  harmony_material        numeric(5, 2),
  functional_completeness numeric(5, 2),
  budget_performance      numeric(5, 2),
  total_price_fils        bigint NOT NULL,
  state                   text NOT NULL,
  modified_by_customer    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT composition_objective_enum CHECK (objective IN
    ('best_overall', 'best_value', 'best_style', 'premium')),
  CONSTRAINT composition_state_enum CHECK (state IN ('Valid', 'Rebuild', 'Rejected')),
  CONSTRAINT composition_run_objective_uq UNIQUE (run_id, objective),
  CONSTRAINT composition_score_ck CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CONSTRAINT composition_total_ck CHECK (total_price_fils >= 0),
  CONSTRAINT composition_valid_scored_ck CHECK (state <> 'Valid' OR score IS NOT NULL)
);

CREATE TABLE recommendation.composition_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id uuid NOT NULL REFERENCES recommendation.composition (id) ON DELETE CASCADE,
  slot_key       text NOT NULL,
  role           text NOT NULL,
  essential      boolean NOT NULL DEFAULT false,
  quantity       integer NOT NULL,
  product_id     text NOT NULL REFERENCES catalogue.product (id),
  offer_id       text NOT NULL REFERENCES catalogue.seller_offer (id),
  unit_price_fils bigint NOT NULL,
  CONSTRAINT composition_item_role_enum CHECK (role IN ('anchor', 'core', 'secondary')),
  CONSTRAINT composition_item_slot_uq UNIQUE (composition_id, slot_key),
  CONSTRAINT composition_item_quantity_ck CHECK (quantity > 0),
  CONSTRAINT composition_item_price_ck CHECK (unit_price_fils > 0)
);

CREATE TABLE recommendation.visualization (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id uuid NOT NULL REFERENCES recommendation.composition (id) ON DELETE CASCADE,
  fidelity       text NOT NULL,
  state          text NOT NULL DEFAULT 'Current',
  hotspots       jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visualization_fidelity_enum CHECK (fidelity IN ('Product-Faithful', 'Concept')),
  CONSTRAINT visualization_state_enum CHECK (state IN ('Current', 'Refresh Required')),
  CONSTRAINT visualization_hotspots_ck CHECK (jsonb_typeof(hotspots) = 'object')
);
CREATE INDEX visualization_composition_idx ON recommendation.visualization (composition_id);
