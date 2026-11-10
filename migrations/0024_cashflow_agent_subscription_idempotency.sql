CREATE UNIQUE INDEX IF NOT EXISTS uq_client_subscription_canonical_order
  ON client_subscriptions (agent_id, order_id)
  WHERE order_id IS NOT NULL AND order_id LIKE 'canonical:%';