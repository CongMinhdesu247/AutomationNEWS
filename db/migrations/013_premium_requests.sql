-- Manual beta signup, independent of roles and entitlement assignment.
CREATE TABLE news_plan_requests (
 user_id uuid PRIMARY KEY REFERENCES hub_users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 review_note text,
 requested_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES hub_users(id)
);
CREATE INDEX news_plan_requests_pending_idx ON news_plan_requests(requested_at) WHERE status='pending';
