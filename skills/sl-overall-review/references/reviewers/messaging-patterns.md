# Reviewer: messaging-patterns

Review message-broker consumption and production for reliability bugs — Kafka
(incl. Spring Kafka / Kafka Streams), RabbitMQ (Spring AMQP), and Artemis / ActiveMQ
(JMS). The headline failure mode is silent **message loss**: acking or committing a
message before it is fully processed, so a crash mid-processing drops it forever.

## Focus

1. Ack/commit **before** processing completes → message lost on crash. The ack/commit
   must happen only after the handler has durably finished its work.
2. At-least-once delivery consumed without idempotency/dedup → duplicate side effects
   (double charge, double insert) when a message is redelivered.
3. No dead-letter / poison-message handling → a permanently failing message is retried
   forever or stalls the partition/queue.
4. Swallowed exception in the listener (caught-and-logged, returns normally) that lets
   a *failed* message get acked as if it succeeded → silent loss.
5. Producer-side loss: treating a publish as done without awaiting broker confirmation
   (fire-and-forget send, ignored future/callback).
6. Non-atomic DB-commit + message-ack (dual write): DB transaction and broker ack are
   not coordinated and there is no outbox/inbox pattern → lost or phantom messages on
   partial failure.
7. Ordering assumptions broken by concurrency, multiple consumers, or partition
   rebalance (e.g. per-key ordering assumed but messages spread across partitions).
8. Durability gaps: non-persistent messages or non-durable queues/topics that are lost
   on broker restart, when the data must survive.
9. Long or blocking work on the consumer/poll thread risking a poll-timeout rebalance
   (and the duplicate processing it triggers).

## Kafka / Spring Kafka / Kafka Streams

1. `enable.auto.commit=true` (or relying on the timer-based auto-commit) commits offsets
   regardless of whether processing succeeded → loss. Prefer manual ack
   (`AckMode.MANUAL` / `MANUAL_IMMEDIATE`) and acknowledge **after** successful handling.
2. No `DefaultErrorHandler` + `DeadLetterPublishingRecoverer` (or equivalent) → a poison
   record blocks the partition indefinitely.
3. Producer reliability: `acks=all`, `enable.idempotence=true`, bounded `retries`, and
   `max.in.flight.requests.per.connection` constrained where ordering matters.
4. `auto.offset.reset` wrong for the use case (`latest` where `earliest` is needed, or
   vice-versa) causing skipped or replayed messages.
5. Processing time exceeding `max.poll.interval.ms` → consumer evicted, rebalance, and
   duplicate delivery.
6. Kafka Streams: `processing.guarantee` (`exactly_once_v2` vs `at_least_once`) and the
   default `DeserializationExceptionHandler` / `ProductionExceptionHandler` that either
   drop records (`LogAndContinue`) or crash the app unexpectedly.

## RabbitMQ / Spring AMQP

1. `AcknowledgeMode.NONE` (fire-and-forget) or raw-client `autoAck=true` → the broker
   drops the message before the handler runs.
2. `basicNack` / `basicReject` with `requeue=true` on a permanently failing message →
   infinite redelivery loop; route to a dead-letter exchange instead.
3. No dead-letter exchange (`x-dead-letter-exchange`) configured for failures.
4. Publisher confirms (`publisher-confirm-type`) and `mandatory`/returns not enabled →
   silent publish loss when a message is unroutable or the broker drops it.
5. Unbounded prefetch (`basicQos` / `prefetch`) — one consumer hogs the backlog and
   breaks fair dispatch / memory bounds.
6. Non-durable queue or non-persistent message (`deliveryMode` not PERSISTENT) for data
   that must survive a broker restart.

## Artemis / ActiveMQ (JMS)

1. Session `AUTO_ACKNOWLEDGE` acking before the handler finishes vs `CLIENT_ACKNOWLEDGE`
   (explicit `message.acknowledge()`) or a transacted session; for Spring check
   `@JmsListener` `sessionAcknowledgeMode` / `sessionTransacted`.
2. Non-persistent `DeliveryMode` for messages that must survive a broker restart.
3. Missing redelivery / DLQ config (`max-delivery-attempts`, dead-letter address) → a
   poison message loops or is dropped.
4. Atomic consume-then-produce needs a transacted or XA session; otherwise a crash
   between consume and produce loses or duplicates work.

## What to Report

For each issue:
- Location: exact file path and line number (listener, producer, config, or `application.yml`/`.properties`)
- Issue: which delivery guarantee is broken and how
- Impact: message loss, duplicate processing, poison loop, or ordering violation in production
- Fix: specific suggestion (e.g. switch to manual ack and ack after processing)

## Severity

Ack/commit-before-processing and producer-side loss (focus items 1, 5, 6) are at least
`major` — they cause data loss in production. A poison-message loop with no dead-letter
path (focus item 3) is at least `major` when it can stall a partition/queue.

Report problems only - no positive observations.
