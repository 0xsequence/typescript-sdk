# Session Expiry Flow

This note documents the wallet session expiry flow for maintainers. Public API behavior is covered in `API.md`; this file focuses on how restored, active, and stale expiry paths are coordinated.

## Behavior Contract

- A valid stored session is restored into memory and gets an expiry timer.
- An expired stored session is not restored as active, but its metadata stays in storage so `onSessionExpired` can replay after a page refresh.
- Active sessions can expire from the timer or from a protected wallet operation checking the session before use.
- `signOut()` or a new auth flow clears or replaces stored session metadata, which cancels stale expired-session replay.

## Flow

```mermaid
flowchart TD
  A["WalletClient constructor"] --> B{"Stored wallet id and address?"}
  B -- "No" --> C["Start signed out"]

  B -- "Yes" --> D["Build restored session snapshot"]
  D --> E{"Snapshot expired?"}

  E -- "No" --> F["Restore active in-memory session"]
  F --> G["Schedule active session expiry timer"]

  E -- "Yes" --> H["Keep expired metadata in storage"]
  H --> I["Do not restore active in-memory session"]
  I --> J["Schedule deferred expiry replay"]

  J --> K{"Storage still matches expired snapshot?"}
  K -- "No" --> L["Cancel stale replay"]
  K -- "Yes" --> M["Clear signer credential"]

  M --> N{"Storage still matches expired snapshot?"}
  N -- "No" --> L
  N -- "Yes" --> O["Notify onSessionExpired"]

  G --> P["Timer fires"]
  P --> Q{"In-memory session snapshot still current?"}
  Q -- "No" --> R["Ignore stale timer"]
  Q -- "Yes" --> S{"Session expired now?"}
  S -- "No" --> G
  S -- "Yes" --> T["Clear in-memory session and signer"]
  T --> U["Keep expired metadata in storage"]
  U --> O

  V["signOut or new auth flow"] --> W["Clear or replace stored session"]
  W --> L
```

