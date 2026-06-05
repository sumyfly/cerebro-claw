# extension-surface Specification

## Purpose

Make the agent's extensibility obvious and complete: publish a discoverable map of every extension seam ("to do X, implement Y"), and promote the four-band action policy from a hardcoded prompt+tool set into a registered set so a new band can be added without editing core. This serves "easy to use" (discoverability) and keeps the door open for an `observe-only` capability without forking the system prompt.

## ADDED Requirements

### Requirement: All extension seams are documented in one place

The project SHALL provide a single discoverability document that enumerates every extension seam, its interface/type, and a minimal example. It SHALL cover at least: agent runtime (`AgentBackend`), input sources (`AccountSource`, `TaskSource`, `RenewalSource`), tools (`ToolDefinition`), CSM channel (`ChannelAdapter`), customer channel (`CustomerChannel`), persistence (`MemoryStore`, `ActionLedger`, and the new `SituationStore`), and the extension plugin system (`ExtensionFactory` + lifecycle events).

#### Scenario: A developer can find how to extend a seam

- **WHEN** a developer wants to add a new capability of a documented kind (e.g. a new CSM channel)
- **THEN** the discoverability document names the interface to implement and where to register it, without reading the core source first

#### Scenario: New persistence seam is included

- **WHEN** the situation-threads capability adds a `SituationStore`
- **THEN** it appears in the extension-surface map as a swappable persistence seam alongside `MemoryStore` and `ActionLedger`

### Requirement: The action policy is a registered set, not hardcoded

The four action bands SHALL be expressed as a registered policy set rather than only as prose in the system prompt, such that the set of available bands is enumerable at runtime and a band can be added through an extension seam without editing the core decision prompt or tool wiring by hand.

#### Scenario: Bands are enumerable

- **WHEN** the system initializes its action policy
- **THEN** the available bands can be listed programmatically, and the list is exactly `act`, `notify-then-act`, `escalate`, `prep` by default

#### Scenario: Adding a band does not require core edits

- **WHEN** an extension registers an additional band with its tool and guidance
- **THEN** the new band becomes available to the agent without modifying the built-in band definitions

### Requirement: Existing four bands are unchanged by the refactor

Promoting the policy to a registered set SHALL NOT change the behavior, names, or semantics of the existing four bands. This requirement makes the refactor a no-op for current behavior.

#### Scenario: Default policy behavior is identical

- **WHEN** no extra band is registered
- **THEN** the agent classifies and acts exactly as before across `act`, `notify-then-act`, `escalate`, `prep`, with identical ledger and dispatcher behavior

### Requirement: observe-only is satisfied without a new band

"The agent noticed something and is watching, with no work performed" SHALL be representable without logging it as an `act`. This intent SHALL be expressed by opening or advancing a Situation (see situation-threads), so the `act` counter is not inflated by non-actions.

#### Scenario: Watching is not counted as an act

- **WHEN** the agent observes a condition worth tracking but performs no action
- **THEN** it opens or advances a Situation and does NOT record an `act` ledger entry, so the digest's act count excludes pure observation
