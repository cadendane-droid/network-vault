-- indexes migration
-- DM §8 — all required indexes for Network Vault V1

-- RLS join performance
CREATE INDEX idx_people_user_id ON people(user_id);
CREATE INDEX idx_sources_user_id ON sources(user_id);
CREATE INDEX idx_facts_person_id ON facts(person_id);
CREATE INDEX idx_facts_source_id ON facts(source_id);
CREATE INDEX idx_edges_user_id ON edges(user_id);
CREATE INDEX idx_edges_person_a ON edges(person_a);
CREATE INDEX idx_edges_person_b ON edges(person_b);

-- Conversation lookups
CREATE INDEX idx_cp_conversation_id ON conversation_participants(conversation_id);
CREATE INDEX idx_cp_person_id ON conversation_participants(person_id);

-- Status filtering
CREATE INDEX idx_facts_status ON facts(status);
CREATE INDEX idx_edges_status ON edges(status);